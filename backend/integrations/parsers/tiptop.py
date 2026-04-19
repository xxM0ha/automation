"""
TipTop order parser.

Raw text tokens are separated by ' — '.

Example structure:
  رجوع — #261961258682 — جديد — 1m ago — قيد التحضير — جاري التوصيل — مكتمل
  — abas — لم يتم تعيين السائق بعد
  — العنوان: 255، رقم المبنى: 5846، الشارع: Arpachay-2
  — 3x ريزو — 20,250 د.ع
  — المجموع الفرعي: 20,250 — الخصم: 5,000 — السعر النهائي: 15,250
  — رسوم التوصيل: 1,750 — رسوم الخدمة: 500
  — إجمالي السعر: 17,500 د.ع — قبول الطلب

Items are encoded as a single token: "Nx item_name"
The token immediately after an item token is that item's subtotal.
"""
import re
from .common import ar_to_en_digits, parse_price

# "3x ريزو" — qty and name in one token
_ITEM_PAT = re.compile(r'^(\d+)[xX×]\s+(.+)$')
_PRICE_PAT = re.compile(r'[\d,٠-٩٬]+\s*د\.ع$')
_EXT_ID_PAT = re.compile(r'^#(\d+)$')
_TOTAL_PAT = re.compile(r'^إجمالي السعر:\s*([\d,]+)\s*د\.ع$')
_ADDRESS_PAT = re.compile(r'^العنوان:\s*(.+)$')

# Status progression tokens to skip
_STATUS_TOKENS = {'جديد', 'قيد التحضير', 'جاري التوصيل', 'مكتمل', 'رجوع', 'قبول الطلب'}
_DRIVER_PAT = re.compile(r'^لم يتم تعيين')
_AGO_PAT    = re.compile(r'\d+[smhd]\s*(ago)?$', re.I)


def parse(raw_text: str) -> dict:
    tokens = [t.strip() for t in raw_text.split(' — ') if t.strip()]

    external_id   = ''
    customer_name = ''
    address       = ''
    total         = 0.0
    items         = []

    # ── Identify named fields ────────────────────────────────────────────────
    i = 0
    n = len(tokens)
    customer_found = False

    while i < n:
        tok = tokens[i]
        en_tok = ar_to_en_digits(tok)

        # Order ID: "#261961258682"
        m = _EXT_ID_PAT.match(en_tok)
        if m:
            external_id = m.group(1)
            i += 1
            continue

        # Total: "إجمالي السعر: 17,500 د.ع"
        m = _TOTAL_PAT.match(tok)
        if m:
            total = parse_price(m.group(1))
            i += 1
            continue

        # Address: "العنوان: ..."
        m = _ADDRESS_PAT.match(tok)
        if m:
            address = m.group(1)
            i += 1
            continue

        # Item token: "3x ريزو"
        m = _ITEM_PAT.match(ar_to_en_digits(tok))
        if not m:
            # Try with original (name may have Arabic only)
            m = re.match(r'^(\d+)[xX×]\s+(.+)$', ar_to_en_digits(tok))
        if m:
            qty  = int(m.group(1))
            # reconstruct name: slice out the "Nx " prefix from original token
            name = tok[tok.index('x') + 1:].strip() if 'x' in tok.lower() else m.group(2)
            # Get unit price from the next token
            unit_price = 0.0
            if i + 1 < n and _PRICE_PAT.search(tokens[i + 1]):
                subtotal   = parse_price(tokens[i + 1])
                unit_price = subtotal / qty if qty else subtotal
                i += 2
            else:
                i += 1
            items.append({'name': name, 'qty': qty, 'unit_price': unit_price, 'notes': ''})
            continue

        # Skip status tokens, driver message, "1m ago" etc.
        if tok in _STATUS_TOKENS or _DRIVER_PAT.match(tok) or _AGO_PAT.match(en_tok):
            i += 1
            continue

        # Skip summary lines (المجموع, الخصم, رسوم …)
        if any(tok.startswith(p) for p in ('المجموع', 'الخصم', 'السعر النهائي', 'رسوم', 'إكرامية')):
            i += 1
            continue

        # First non-skipped, non-ID, non-address text = customer name
        if not customer_found and not external_id:
            # Haven't found ID yet — can't determine customer yet
            pass
        elif not customer_found and external_id:
            customer_name = tok
            customer_found = True

        i += 1

    # If total wasn't in the text, derive it from items
    if total == 0.0:
        total = sum(it['qty'] * it['unit_price'] for it in items)

    return {
        'external_id':    external_id,
        'customer_name':  customer_name,
        'customer_phone': '',
        'address':        address,
        'notes':          '',
        'total':          total,
        'items':          items,
    }
