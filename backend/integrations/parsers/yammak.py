"""
Yammak order parser.

Handles comma-separated format with newlines within tokens (current app):

  %full_order طباعة الفاتورة,طلب #126799\n2026/04/21 21:40,Back,...
  عناصر الطلب\n1\nستيك دجاج عادي\nnull\n6750 د.ع\n1\nسلطة سيزر\nnull\n6250 د.ع,...

Also handles old dash-separated format (legacy):
  تفاصيل الطلب — رقم الطلب: 120912 — 1x ريزو خردل بالعسل — 7,500 د.ع

Order ID: last 3 digits of the full yammak order number.
Items: qty (bare number) → name → null (skip) → price (ن.ع)
"""
import re
from .common import ar_to_en_digits, parse_price

_ORDER_ID_PAT_NEW = re.compile(r'طلب\s*#(\d+)')          # طلب #126799
_ORDER_ID_PAT_OLD = re.compile(r'رقم الطلب:\s*(\d+)')    # رقم الطلب: 120912
_PRICE_LINE_PAT   = re.compile(r'([\d,]+)\s*د\.ع$')
_ITEM_OLD_PAT     = re.compile(r'^(\d+)[xX×]\s+(.+)$')   # legacy: 1x name
_MODIFIER_PAT     = re.compile(r'^(.+?)\s*\((.+)\)$')
_CHOICE_PAT       = re.compile(r'^[اإ]ختر\s+(.+?):\s*(.+)$')  # إختر X: Y
_DRINK_KEYWORDS   = re.compile(r'مشروب|غازي|عصير|كولا|بيبسي|ماء')


def _dedup(items: list[dict]) -> list[dict]:
    """Drop identical line items (same name + notes). The screen capture can grab
    the invoice more than once; a genuine multiple shows as one line with qty>1,
    so collapsing identical lines is safe and prevents duplicate Foodics items."""
    seen, unique = set(), []
    for it in items:
        key = (it['name'], it.get('notes', ''))
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)
    return unique


def _parse_new(lines: list[str]) -> dict:
    """Parse the comma+newline format."""
    external_id = ''
    items = []

    # Extract order ID — last 3 digits
    for line in lines:
        m = _ORDER_ID_PAT_NEW.search(line) or _ORDER_ID_PAT_OLD.search(line)
        if m:
            external_id = ar_to_en_digits(m.group(1))[-3:]
            break

    # Find items section and parse qty / name / null / price sequences.
    # The screen capture can grab the whole invoice more than once (scroll
    # overlap / re-render), so once we've finished the FIRST items block we stop
    # — a repeated "عناصر الطلب" is the same order captured again, not new items.
    in_items = False
    items_done = False
    order_notes = ''
    i = 0
    while i < len(lines):
        line = lines[i]

        if 'ملاحظة الطلب' in line or 'ملاحظات الطلب' in line:
            in_items = False
            if i + 1 < len(lines):
                order_notes = lines[i + 1].strip()
                i += 2
            else:
                i += 1
            continue

        if 'عناصر الطلب' in line:
            if not items_done:
                in_items = True
            i += 1
            continue

        if any(line.startswith(s) for s in ('ملخص السعر', 'سعر العناصر', 'المجموع', 'الإجمالي')):
            if in_items and items:
                items_done = True   # finished the first block — ignore any repeat
            in_items = False
            i += 1
            continue

        if in_items:
            en_line = ar_to_en_digits(line)
            if re.match(r'^\d+$', en_line):
                qty = int(en_line)
                if i + 1 >= len(lines):
                    i += 1
                    continue
                name = lines[i + 1]
                j = i + 2
                # size/option field: "null" = skip; اختر/إختر line = drink/option note; other = size variant
                item_note = ''
                if j < len(lines):
                    size_line = lines[j].strip()
                    if size_line.lower() == 'null':
                        j += 1  # skip null
                    else:
                        cm = _CHOICE_PAT.match(size_line)
                        if cm:
                            label, value = cm.group(1).strip(), cm.group(2).strip()
                            if _DRINK_KEYWORDS.search(label) or _DRINK_KEYWORDS.search(value):
                                if _DRINK_KEYWORDS.search(name):
                                    name = value  # standalone drink → choice is the item
                                else:
                                    item_note = value  # meal with drink side → put in notes
                            else:
                                name = name + ' ' + value  # size choice → append to name
                            j += 1
                        elif not _PRICE_LINE_PAT.search(size_line):
                            name = name + ' ' + size_line  # plain size variant → append to name
                            j += 1
                unit_price = 0.0
                if j < len(lines):
                    pm = _PRICE_LINE_PAT.search(lines[j])
                    if pm:
                        raw_price = pm.group(1).replace(',', '')
                        subtotal = float(raw_price)
                        unit_price = subtotal / qty if qty else subtotal
                        j += 1
                items.append({'name': name, 'qty': qty, 'unit_price': unit_price, 'notes': item_note})
                i = j
                continue

        i += 1

    items = _dedup(items)
    total = sum(it['qty'] * it['unit_price'] for it in items)
    return {
        'external_id':    external_id,
        'customer_name':  '',
        'customer_phone': '',
        'address':        '',
        'notes':          order_notes,
        'total':          total,
        'items':          items,
    }


def _parse_old(tokens: list[str]) -> dict:
    """Parse the legacy dash-separated format."""
    external_id = ''
    total = 0.0
    items = []

    for i, tok in enumerate(tokens):
        en_tok = ar_to_en_digits(tok)

        m = _ORDER_ID_PAT_OLD.match(en_tok) or _ORDER_ID_PAT_NEW.search(en_tok)
        if m:
            external_id = ar_to_en_digits(m.group(1))[-3:]
            continue

        m = re.match(r'^المبلغ الإجمالي:\s*([\d,]+)', tok)
        if m:
            total = float(m.group(1).replace(',', ''))
            continue

        m = _ITEM_OLD_PAT.match(ar_to_en_digits(tok))
        if m:
            qty = int(m.group(1))
            prefix_end = tok.index('x') + 1
            raw_name = tok[prefix_end:].strip()
            mod_match = _MODIFIER_PAT.match(raw_name)
            if mod_match:
                name = mod_match.group(1).strip()
                note = mod_match.group(2).strip()
            else:
                name = raw_name
                note = ''
            unit_price = 0.0
            if i + 1 < len(tokens) and _PRICE_LINE_PAT.search(tokens[i + 1]):
                pm = _PRICE_LINE_PAT.search(tokens[i + 1])
                subtotal = float(pm.group(1).replace(',', ''))
                unit_price = subtotal / qty if qty else subtotal
            items.append({'name': name, 'qty': qty, 'unit_price': unit_price, 'notes': note})

    items = _dedup(items)
    if total == 0.0:
        total = sum(it['qty'] * it['unit_price'] for it in items)
    return {
        'external_id':    external_id,
        'customer_name':  '',
        'customer_phone': '',
        'address':        '',
        'notes':          '',
        'total':          total,
        'items':          items,
    }


def parse(raw_text: str) -> dict:
    if ' — ' in raw_text and ',' not in raw_text:
        tokens = [t.strip() for t in raw_text.split(' — ') if t.strip()]
        return _parse_old(tokens)

    # Flatten comma+newline format into a single list of lines
    lines = []
    for chunk in raw_text.split(','):
        for line in chunk.split('\n'):
            line = line.strip()
            if line:
                lines.append(line)
    return _parse_new(lines)
