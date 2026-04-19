"""
Yammak order parser.

Raw text tokens separated by ' — '.

Example structure:
  تفاصيل الطلب — 14 Apr 2026 06:44 PM — رقم الطلب: 120912
  — الدفع عند الاستلام — توصيل — قيد الانتظار — 2 عنصر
  — 1x ريزو خردل بالعسل (غير دايت) — 7,500 د.ع
  — 1x مشروبات غازية دايت (كوكا كولا) — 750 د.ع
  — المجموع الفرعي: 8,250 — خصم: 2,475 — إكرامية: 0
  — رسوم الخدمة: 500 — رسوم التوصيل: 1,000
  — المبلغ الإجمالي: 7,275 د.ع — تأكيد — إلغاء — تأكيد وطباعة

Notes:
- Order ID in "رقم الطلب: 120912"
- Items: "Nx name (modifier)"  — modifier in parens should become notes
- Total in "المبلغ الإجمالي: X,XXX د.ع"
- No customer name exposed in this view.
"""
import re
from .common import ar_to_en_digits, parse_price

_ORDER_ID_PAT  = re.compile(r'^رقم الطلب:\s*(\d+)$')
_ITEM_PAT      = re.compile(r'^(\d+)[xX×]\s+(.+)$')
_PRICE_PAT     = re.compile(r'[\d,٠-٩٬]+\s*د\.ع$')
_TOTAL_PAT     = re.compile(r'^المبلغ الإجمالي:\s*([\d,٠-٩٬]+)\s*د\.ع$')
_ITEM_CNT_PAT  = re.compile(r'^\d+\s*عناصر?$')
_MODIFIER_PAT  = re.compile(r'^(.+?)\s*\((.+)\)$')   # "item name (modifier)"

_SKIP = {
    'تفاصيل الطلب', 'تأكيد', 'إلغاء', 'تأكيد وطباعة',
    'الدفع عند الاستلام', 'توصيل', 'استلام', 'قيد الانتظار',
    'الدفع الإلكتروني',
}
_SUMMARY_PREFIXES = ('المجموع', 'خصم', 'إكرامية', 'رسوم', 'السعر')


def parse(raw_text: str) -> dict:
    tokens = [t.strip() for t in raw_text.split(' — ') if t.strip()]

    external_id = ''
    total       = 0.0
    items       = []

    i = 0
    n = len(tokens)

    while i < n:
        tok = tokens[i]
        en_tok = ar_to_en_digits(tok)

        # Order ID
        m = _ORDER_ID_PAT.match(en_tok)
        if m:
            external_id = m.group(1)
            i += 1
            continue

        # Total
        m = _TOTAL_PAT.match(tok)
        if not m:
            m = _TOTAL_PAT.match(ar_to_en_digits(tok))
        if m:
            total = parse_price(m.group(1))
            i += 1
            continue

        # Item
        m = _ITEM_PAT.match(ar_to_en_digits(tok))
        if m:
            qty = int(m.group(1))
            # Reconstruct name from original token (preserves Arabic)
            prefix_end = tok.index('x') + 1
            raw_name   = tok[prefix_end:].strip()

            # Split off parenthetical modifier
            mod_match = _MODIFIER_PAT.match(raw_name)
            if mod_match:
                name      = mod_match.group(1).strip()
                item_note = mod_match.group(2).strip()
            else:
                name      = raw_name
                item_note = ''

            unit_price = 0.0
            if i + 1 < n and _PRICE_PAT.search(tokens[i + 1]):
                subtotal   = parse_price(tokens[i + 1])
                unit_price = subtotal / qty if qty else subtotal
                i += 2
            else:
                i += 1
            items.append({'name': name, 'qty': qty, 'unit_price': unit_price, 'notes': item_note})
            continue

        # Item count e.g. "2 عنصر"
        if _ITEM_CNT_PAT.match(ar_to_en_digits(tok)):
            i += 1
            continue

        # Summary lines, skip tokens, date lines
        if tok in _SKIP or any(tok.startswith(p) for p in _SUMMARY_PREFIXES):
            i += 1
            continue

        i += 1

    if total == 0.0:
        total = sum(it['qty'] * it['unit_price'] for it in items)

    return {
        'external_id':    external_id,
        'customer_name':  '',       # not available in Yammak's copy-paste view
        'customer_phone': '',
        'address':        '',
        'notes':          '',
        'total':          total,
        'items':          items,
    }
