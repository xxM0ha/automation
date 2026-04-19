"""
Lezzo order parser.

Raw text tokens separated by ' — '.

Example structure:
  طلب جديد — اشرف — سويس تايم مقابل كولد مول — توصيل إلى الباب
  — ملاحظة: لفه وحده بدون ثوميه
  — 3x لفي شاورما — 9,000 د.ع
  — 1x سلطة سيزر — 6,250 د.ع
  — المجموع: 15,250 د.ع — الضريبة: 0 — الخصم: 0 — 31 Minutes — يقبل

Notes:
- Lezzo doesn't expose an order ID in this view (no external_id).
- Items are "Nx name" tokens, followed immediately by "X,XXX د.ع".
- Order note is prefixed with "ملاحظة:".
- End marker: "يقبل"
"""
import re
from .common import ar_to_en_digits, parse_price

_ITEM_PAT    = re.compile(r'^(\d+)[xX×]\s+(.+)$')
_PRICE_PAT   = re.compile(r'[\d,٠-٩٬]+\s*د\.ع$')
_TOTAL_PAT   = re.compile(r'^المجموع:\s*([\d,٠-٩٬]+)')
_NOTE_PAT    = re.compile(r'^ملاحظة:\s*(.+)$')
_MINUTES_PAT = re.compile(r'^\d+\s*Minutes$', re.I)
_SKIP = {'طلب جديد', 'توصيل إلى الباب', 'يقبل', 'توصيل', 'استلام'}


def parse(raw_text: str) -> dict:
    tokens = [t.strip() for t in raw_text.split(' — ') if t.strip()]

    customer_name = ''
    address       = ''
    notes         = ''
    total         = 0.0
    items         = []

    # The structure is predictable:
    # طلب جديد | customer | address | delivery_type | [note] | items… | summary | يقبل
    header_done = False  # set once we find an item token
    header_tokens: list[str] = []

    i = 0
    n = len(tokens)

    while i < n:
        tok = tokens[i]
        en_tok = ar_to_en_digits(tok)

        # End
        if tok == 'يقبل':
            break

        # Start marker
        if tok == 'طلب جديد':
            i += 1
            continue

        # Note
        m = _NOTE_PAT.match(tok)
        if m:
            notes = m.group(1)
            i += 1
            continue

        # Prep time  "31 Minutes"
        if _MINUTES_PAT.match(tok):
            i += 1
            continue

        # Summary lines
        if any(tok.startswith(p) for p in ('المجموع', 'الضريبة', 'الخصم', 'رسوم')):
            m2 = _TOTAL_PAT.match(tok)
            if m2:
                total = parse_price(m2.group(1))
            i += 1
            continue

        # Item token "3x لفي شاورما"
        m = _ITEM_PAT.match(ar_to_en_digits(tok))
        if m:
            header_done = True
            qty  = int(m.group(1))
            # Name: strip leading "Nx " from original token
            prefix = tok[:tok.index('x') + 1]  # e.g. "3x"
            name = tok[len(prefix):].strip()
            unit_price = 0.0
            if i + 1 < n and _PRICE_PAT.search(tokens[i + 1]):
                subtotal   = parse_price(tokens[i + 1])
                unit_price = subtotal / qty if qty else subtotal
                i += 2
            else:
                i += 1
            items.append({'name': name, 'qty': qty, 'unit_price': unit_price, 'notes': ''})
            continue

        # Delivery type skip
        if tok in _SKIP:
            i += 1
            continue

        # Pre-item tokens: customer, address, delivery type
        if not header_done:
            header_tokens.append(tok)

        i += 1

    # Assign header tokens: first = customer, second = address
    if len(header_tokens) >= 1:
        customer_name = header_tokens[0]
    if len(header_tokens) >= 2:
        address = header_tokens[1]

    if total == 0.0:
        total = sum(it['qty'] * it['unit_price'] for it in items)

    return {
        'external_id':    '',       # Lezzo doesn't expose an order ID here
        'customer_name':  customer_name,
        'customer_phone': '',
        'address':        address,
        'notes':          notes,
        'total':          total,
        'items':          items,
    }
