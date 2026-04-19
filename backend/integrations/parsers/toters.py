"""
Toters order parser.

Raw text is a long Arabic string with tokens separated by ' — '.

Example structure:
  الطلب #٦٦٠ — ريمان باسل صديق R — هوية … — تم — اليوم في … — ٣ عناصر
  — الريزو — ٣x — ريزو كلاسيك — IQD ٦٬٢٥٠ / عنصر — IQD ١٨٬٧٥٠
  — المشروبات — ١x — مشروبات غازية — IQD ٧٥٠ / عنصر — اختر المشروب الغازي — ميرندا — IQD ٧٥٠
  — لديك ٢٨:١٤ دقيقة متبقية للإرسال. — أكد الطلب

Item layout (per item):
  [optional category] Nx item_name IQD_unit_price IQD_subtotal [optional modifiers…]
"""
import re
from .common import ar_to_en_digits, parse_price, parse_qty

_ORDER_ID_PAT   = re.compile(r'الطلب\s*#([٠-٩\d]+)')
_UNIT_PRICE_PAT = re.compile(r'^IQD\s*[\d,٬٠-٩]+\s*/\s*عنصر$')
_SUBTOTAL_PAT   = re.compile(r'^IQD\s*[\d,٬٠-٩]+$')
_ITEM_COUNT_PAT = re.compile(r'^[٠-٩\d]+\s*عناصر?$')
_TIME_LEFT_PAT  = re.compile(r'^لديك\s')

# Tokens that signal "we are past the items section"
_END_MARKERS = {'أكد الطلب', 'لديك'}

# Tokens to skip entirely in the header section
_HEADER_SKIP = re.compile(
    r'^(تم|هوية|اليوم في|أكد الطلب)|(^لديك\s)'
)


def parse(raw_text: str) -> dict:
    tokens = [t.strip() for t in raw_text.split(' — ') if t.strip()]

    external_id   = ''
    customer_name = ''
    items         = []

    # ── Pass 1: extract order ID and customer name ────────────────────────────
    id_idx = -1
    for i, tok in enumerate(tokens):
        m = _ORDER_ID_PAT.search(tok)
        if m:
            external_id = ar_to_en_digits(m.group(1))
            id_idx = i
            break

    if id_idx >= 0:
        # The token immediately after the order-ID token is the customer name,
        # as long as it isn't a known skip token.
        for j in range(id_idx + 1, len(tokens)):
            cand = tokens[j]
            if (cand.startswith('هوية')
                    or cand.startswith('اليوم')
                    or cand == 'تم'
                    or _ITEM_COUNT_PAT.match(ar_to_en_digits(cand))):
                break
            customer_name = cand
            break

    # ── Pass 2: extract items ─────────────────────────────────────────────────
    # State machine:
    #   looking   → scanning for a qty token
    #   have_name → consumed qty+name, looking for unit price / modifiers
    current: dict | None = None
    notes_buf: list[str] = []

    def _flush(item, notes):
        if notes:
            item['notes'] = ', '.join(notes)
        items.append(item)

    for tok in tokens:
        # Hard stop
        if tok in _END_MARKERS or _TIME_LEFT_PAT.match(tok):
            break

        # Quantity token  (e.g. ٣x or 3x)
        en_tok = ar_to_en_digits(tok)
        qty_val = _parse_qty_token(en_tok)
        if qty_val is not None:
            if current is not None:
                _flush(current, notes_buf)
                notes_buf = []
            # Next token will be item name — look ahead is handled by state
            current = {'name': '', 'qty': qty_val, 'unit_price': 0.0}
            # Mark that the NEXT non-special token is the item name
            current['_awaiting_name'] = True
            continue

        # Awaiting item name
        if current and current.get('_awaiting_name'):
            current['name'] = tok
            del current['_awaiting_name']
            continue

        # Unit price  (IQD X / عنصر)
        if current and _UNIT_PRICE_PAT.match(tok):
            current['unit_price'] = parse_price(tok)
            continue

        # Per-item subtotal  (IQD X)  — skip
        if current and _SUBTOTAL_PAT.match(tok):
            continue

        # Item-count header token  (e.g. ٣ عناصر) — skip
        if _ITEM_COUNT_PAT.match(ar_to_en_digits(tok)):
            continue

        # Anything else while we have an active item = modifier note
        if current and not current.get('_awaiting_name'):
            notes_buf.append(tok)

    if current:
        _flush(current, notes_buf)

    total = sum(it['qty'] * it['unit_price'] for it in items)

    return {
        'external_id':    external_id,
        'customer_name':  customer_name,
        'customer_phone': '',
        'address':        '',
        'notes':          '',
        'total':          total,
        'items':          items,
    }


def _parse_qty_token(en_tok: str) -> int | None:
    """Return qty if token is exactly '<digits>x' (case-insensitive x)."""
    m = re.match(r'^(\d+)[xX×]$', en_tok)
    return int(m.group(1)) if m else None
