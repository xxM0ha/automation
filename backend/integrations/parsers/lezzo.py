"""Lezzo delivery platform order parser."""
import logging
import re

logger = logging.getLogger('prime.integrations')

_AR_TO_EN  = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
_QTY_PAT   = re.compile(r'^\s*([٠-٩]+)×')
_PRICE_PAT = re.compile(r'^([\d,]+)\s*(?:د\.ع|IQD)$', re.IGNORECASE)

_MODIFIER_SKIP = frozenset({'وجبة'})


def _ar2en(s: str) -> str:
    return s.translate(_AR_TO_EN)


def _protect(text: str) -> str:
    """Replace thousands-comma in numbers with \x00 so splits don't break prices."""
    return re.sub(r'([٠-٩\d]),([٠-٩\d]{3}\b)',
                  lambda m: m.group(1) + '\x00' + m.group(2), text)


def _price(tok: str) -> float:
    m = _PRICE_PAT.match(_ar2en(tok.strip()))
    return float(m.group(1).replace(',', '')) if m else 0.0


def _parse_item_block(block: str) -> dict | None:
    """
    Parse one item segment (everything between two غير متوفر,غير متوفر markers).
    Returns dict with name, qty, price (subtotal), notes, is_combo — or None.
    Uses _protect before splitting so prices like ٧,٠٠٠ survive as single tokens.
    """
    protected = _protect(block)
    tokens = protected.split(',')
    for i, tok in enumerate(tokens):
        if _QTY_PAT.match(tok):
            # Collect space-prefixed modifier tokens going backwards, then item name
            space_tokens = []
            item_name = None
            for j in range(i - 1, -1, -1):
                t = tokens[j]
                if t.startswith(' '):
                    space_tokens.append(t.strip())
                else:
                    if t.strip():
                        item_name = t.strip()
                    break
            if item_name is None:
                break

            is_combo = False
            if any(s.startswith('-') for s in space_tokens):
                choice = next((s for s in space_tokens if s and not s.startswith('-')), None)
                if choice and choice not in _MODIFIER_SKIP:
                    item_name = choice
                elif choice in _MODIFIER_SKIP:
                    is_combo = True

            # First price token after the qty token is the item subtotal
            price = 0.0
            for k in range(i + 1, len(tokens)):
                v = _price(tokens[k].replace('\x00', ','))
                if v:
                    price = v
                    break

            return {
                'name':     item_name,
                'qty':      int(_ar2en(_QTY_PAT.match(tok).group(1))),
                'price':    price,
                'notes':    '',
                'is_combo': is_combo,
            }
    return None


def _items_text(raw_text: str) -> str:
    """
    Select which part of the raw text to use for item parsing.

    Lezzo scrapes multiple screens into one payload:
      %full_order <notification-screen-1> %full_order <notification-screen-2> <condensed-summary-screen>

    The condensed summary (after the last يقبل,يقبل) is the most complete source —
    it always contains every item with its own غير متوفر,غير متوفر terminator,
    even when notification screens only show a subset of items.
    Fall back to the first %full_order block when no condensed block is present.
    """
    if '%full_order' not in raw_text:
        return raw_text

    parts = [p for p in raw_text.split('%full_order') if p.strip()]
    if not parts:
        return raw_text

    # Condensed block lives after يقبل,يقبل in the last %full_order part
    after_accept = parts[-1].split('يقبل,يقبل', 1)
    if len(after_accept) > 1 and after_accept[1].strip():
        return after_accept[1]

    return parts[0]


def parse(raw_text: str) -> dict:
    # Order ID (Arabic-Indic digits after #)
    ext_id = ''
    m = re.search(r'#([٠-٩\d]{6,})', raw_text)
    if m:
        ext_id = _ar2en(m.group(1))

    # Customer name (token after 'طلب جديد,')
    customer = ''
    m = re.search(r'طلب جديد,([^,\n]+)', raw_text)
    if m:
        customer = m.group(1).strip()

    # Items — split condensed block on غير متوفر,غير متوفر.
    # No [:-1]: _parse_item_block returns None for footer segments (no × token).
    items = []
    for seg in _items_text(raw_text).split('غير متوفر,غير متوفر'):
        item = _parse_item_block(seg)
        if item:
            is_combo = item.pop('is_combo', False)
            items.append(item)
            if is_combo:
                items.append({'name': 'كومبو', 'qty': item['qty'], 'price': 0.0, 'notes': ''})

    # Total: value immediately before 'المجموع' in the full raw token stream
    total = 0.0
    flat = [t.replace('\x00', ',').strip() for t in _protect(raw_text).split(',')]
    for i, tok in enumerate(flat):
        if tok == 'المجموع' and i > 0:
            for j in range(i - 1, max(i - 5, -1), -1):
                v = _price(flat[j])
                if v:
                    total = v
                    break
            break

    # Sanity check: sum of item prices should equal the subtotal (المجموع).
    # A mismatch means the condensed block had unexpected content.
    items_sum = sum(it['price'] for it in items)
    if total and items_sum and abs(items_sum - total) > 1:
        logger.warning(
            '[lezzo] price mismatch order %s: items_sum=%.0f total=%.0f — items: %s',
            ext_id, items_sum, total,
            [(it['name'], it['qty'], it['price']) for it in items],
        )

    return {
        'external_id':    ext_id,
        'customer_name':  customer,
        'customer_phone': '',
        'address':        '',
        'notes':          '',
        'total':          total,
        'items': [{'name': it['name'], 'qty': it['qty'], 'notes': it['notes']}
                  for it in items],
    }
