"""
Toters order parser.

Handles two raw-text formats (both are copied from the Toters merchant app):

Format A — dash-separated (old):
  الطلب #٦٦٠ — ريمان باسل صديق R — هوية … — تم — اليوم في … — ٣ عناصر
  — الريزو — ٣x — ريزو كلاسيك — IQD ٦٬٢٥٠ / عنصر — IQD ١٨٬٧٥٠
  — لديك ٢٨:١٤ دقيقة متبقية للإرسال. — أكد الطلب

Format B — comma-separated (new):
  فتح لائحة التنقل,الطلبات الحالية,...,#٢٢٠ موجود الآن في صفحة التحضير.,ملف ١,
  الريزو,١x,ريزو هني ماسترد,‏IQD ٧٬٥٠٠ / عنصر,IQD ٧٬٥٠٠,...,أكد الطلب

Multi-capture: the automation screenshots the order screen several times while
scrolling, concatenating each capture. Each capture is a "block" that ends with
"أكد الطلب" and is an overlapping WINDOW of the full item list. We reconstruct
the order by merging the windows at their seams (collapsing the scroll overlap)
while keeping every distinct line WITHIN a block — so two legitimate same-name
lines (e.g. "2x ريزو" + "1x ريزو") survive instead of being deduped away.
"""
import re
from .common import ar_to_en_digits, parse_price, parse_qty

_ORDER_ID_PAT   = re.compile(r'(?:الطلب\s*)?#([٠-٩\d]+)')
# Per-item base price. Usually "IQD ٧٬٥٠٠ / عنصر", but items sold by the piece
# show "IQD ٤٬٠٠٠ / قطع" — accept both so the base isn't missed (which would
# undercount the item vs حاصل الجمع and wrongly trip the incomplete-order guard).
_UNIT_PRICE_PAT = re.compile(r'^IQD\s*[\d,٬٠-٩]+\s*/\s*(?:عنصر|قطع)$')
_SUBTOTAL_PAT   = re.compile(r'^IQD\s*[\d,٬٠-٩]+$')
# Size/modifier surcharge shown after a chosen option, e.g. "اختر الحجم → دبل →
# +IQD ٣٬٠٠٠". Must be ADDED to the item's price (the base "/ عنصر" price is for
# the default size) — otherwise the item is undercounted vs the subtotal.
_UPCHARGE_PAT   = re.compile(r'^\+\s*IQD\s*[\d,٬٠-٩]+$')
_ITEM_COUNT_PAT = re.compile(r'^[٠-٩\d]+\s*عناصر?$')
_TIME_LEFT_PAT  = re.compile(r'^لديك\s')
_SIZE_SELECT_PAT    = re.compile(r'^اختر')          # اختر الكمية / اختر المشروب الغازي / etc.
_DRINK_SELECT_PAT   = re.compile(r'مشروب|غازي|عصير|كولا|بيبسي|ماء|ريزو')  # note keywords in اختر token
_DRINK_ITEM_PAT     = re.compile(r'مشروب|غازي|عصير|كولا|بيبسي|ببسي|ماء', re.IGNORECASE)
_NOTE_TRIGGER_PAT   = re.compile(r'^تعليمات خاصة')
_REMOVE_TRIGGER_PAT = re.compile(r'^ا?زالة مكونات|^إزالة مكونات')
# "اجعلها وجبة" (make it a meal) upgrades a plain item to a combo. The next token
# lists the combo contents, e.g. "فنکر وميرندا" (finger + a drink), then a
# "+IQD <upcharge>" surcharge. We keep the BASE item plain (so it matches the
# plain menu item, not a وجبة variant) and emit a SEPARATE "كومبو فنكر" line that
# carries the upcharge and the drink as its note.
_MAKE_MEAL_PAT      = re.compile(r'^اجعلها وجبة')
# Toters platform_name that resolves to the combo MenuItem (كومبو(بطاطا + ببسي)).
_COMBO_NAME = 'كومبو فنكر'


def _combo_drink(contents: str) -> str:
    """From the combo-contents token (e.g. "فنکر وميرندا") return the drink —
    the part after the "و" — so it can go in the combo line's note. Normalises
    the Farsi ک→ك / ی→ي so the text is clean Arabic."""
    c = (contents or '').replace('ک', 'ك').replace('ی', 'ي').strip()
    if ' و' in c:
        return c.split(' و', 1)[1].strip()
    return c

# Block delimiter — each scroll capture ends with the confirm button.
_BLOCK_END_PAT = re.compile(r'^أكد الطلب')

_SKIP_TOKENS = re.compile(
    r'^(تم|هوية|اليوم في|أكد الطلب|فتح لائحة التنقل|الطلبات الحالية|'
    r'Toters Merchant|جديد|تحضير|جاهز|لا توجد طلبات جديدة|تم التأكيد|'
    r'حاصل الجمع|مجموع|ملف|%full_order|New)'
)

_DIGITS_ONLY = re.compile(r'^[٠-٩\d\s]+$')


def _tokenize(raw_text: str) -> list[str]:
    # Strip RTL / LTR marks and extra whitespace from every token
    def clean(t):
        return t.replace('‏', '').replace('‎', '').strip()

    if ' — ' in raw_text:
        return [clean(t) for t in raw_text.split(' — ') if clean(t)]
    return [clean(t) for t in raw_text.split(',') if clean(t)]


def _parse_qty_token(en_tok: str) -> int | None:
    m = re.match(r'^(\d+)[xX×]$', en_tok)
    return int(m.group(1)) if m else None


def _extract(tokens: list[str]) -> tuple[list[dict], list[tuple[str, str]]]:
    """Extract the ordered item lines from ONE capture block's tokens. Returns
    (items, order_special). NO de-duplication here — every line is kept, so two
    genuine same-name lines in a single block both survive."""
    items: list[dict] = []
    order_special: list[tuple[str, str]] = []
    current: dict | None = None
    notes_buf: list[str] = []
    last_unrecognized: str | None = None  # for implicit qty-1 detection

    def _flush(item, notes):
        name = item.get('name', '').strip()
        # Discard orphan qty tokens — name is empty or pure digits (e.g. '١' from block header)
        if not name or _DIGITS_ONLY.match(name):
            return
        if notes:
            # If item is a generic drink placeholder and exactly one drink choice was
            # collected, promote the choice to be the item name (e.g. 'ببسي' + ['بيبسي']
            # → item='بيبسي'). For boxes with multiple choices, keep all in notes.
            if _DRINK_ITEM_PAT.search(name) and len(notes) == 1:
                item['name'] = notes[0]
            else:
                # Preserve duplicates — e.g. a box with 4x the same rice choice
                # needs to show the count, not collapse to one entry.
                item['notes'] = ', '.join(notes)
        # A "make it a meal" item is published as the plain base item PLUS a
        # separate "كومبو فنكر" line carrying the upcharge price and the drink.
        make_meal    = item.get('_make_meal')
        combo_price  = item.get('_combo_price') or 0.0
        combo_drink  = _combo_drink(item.get('_combo_contents', ''))
        # Drop the internal scratch flags before publishing the item.
        for k in ('_awaiting_name', '_awaiting_size', '_awaiting_drink', '_note_mode',
                  '_removal_mode', '_make_meal', '_awaiting_combo', '_combo_contents', '_combo_price'):
            item.pop(k, None)
        item.setdefault('notes', '')
        items.append(item)
        if make_meal:
            items.append({
                'name':       _COMBO_NAME,
                'qty':        item.get('qty', 1),
                'unit_price': combo_price,
                'notes':      combo_drink,
            })

    for tok in tokens:
        if _SKIP_TOKENS.match(tok) or _TIME_LEFT_PAT.match(tok):
            last_unrecognized = None
            # Close any in-progress item at a skip token. This MUST happen for the
            # totals labels ('حاصل الجمع' / 'مجموع'): the value token that follows
            # them is the whole-order subtotal, and if the last item is still open
            # it would be mistaken for that item's line total and overwrite its
            # price with the order subtotal. A waiting (name-less) item is orphaned.
            if current:
                if current.get('_awaiting_name'):
                    current = None
                else:
                    _flush(current, notes_buf)
                    current = None
                notes_buf = []
            continue

        # "اختر الكمية" → next token is size, append to name
        # "اختر المشروب الغازي" → next token is drink choice, put in notes
        if _SIZE_SELECT_PAT.match(tok):
            if current:
                if _DRINK_SELECT_PAT.search(tok):
                    current['_awaiting_drink'] = True
                else:
                    current['_awaiting_size'] = True
            continue

        if current and current.get('_awaiting_size'):
            current['name'] = current['name'] + ' ' + tok
            del current['_awaiting_size']
            continue

        if current and current.get('_awaiting_drink'):
            # Stop collecting when we hit a price, qty, or new selector
            en_tok_d = ar_to_en_digits(tok)
            if (_UNIT_PRICE_PAT.match(tok) or _SUBTOTAL_PAT.match(tok)
                    or _parse_qty_token(en_tok_d) is not None
                    or _SIZE_SELECT_PAT.match(tok)
                    or _NOTE_TRIGGER_PAT.match(tok)
                    or _REMOVE_TRIGGER_PAT.match(tok)):
                del current['_awaiting_drink']
                # fall through to normal processing
            else:
                notes_buf.append(tok)
                continue

        if _NOTE_TRIGGER_PAT.match(tok):
            if current:
                current['_note_mode'] = True
                current.pop('_removal_mode', None)
            continue

        if _REMOVE_TRIGGER_PAT.match(tok):
            if current:
                current['_removal_mode'] = True
                current.pop('_note_mode', None)
            continue

        if current and current.get('_note_mode'):
            notes_buf.append(tok)
            order_special.append((current.get('name', '').strip(), tok))
            current.pop('_note_mode', None)
            continue

        if current and current.get('_removal_mode'):
            en_tok2 = ar_to_en_digits(tok)
            # Stop removal mode when we hit qty, price, or size selector
            if _parse_qty_token(en_tok2) is not None or _UNIT_PRICE_PAT.match(tok) or _SUBTOTAL_PAT.match(tok):
                current.pop('_removal_mode', None)
                # Fall through to normal processing below
            else:
                notes_buf.append(f'بدون {tok}')
                continue

        # "اجعلها وجبة" → flag the item as a meal; the next token is the combo
        # contents (drink source) and the following "+IQD" goes to the combo line.
        if current and _MAKE_MEAL_PAT.match(tok):
            current['_make_meal'] = True
            current['_awaiting_combo'] = True
            current.pop('_note_mode', None)
            current.pop('_removal_mode', None)
            continue

        if current and current.get('_awaiting_combo'):
            current.pop('_awaiting_combo', None)
            en_c = ar_to_en_digits(tok)
            # The combo-contents token is plain text ("فنکر وميرندا"); if instead
            # the next token is already a price/qty, there were no listed contents.
            if not (_UPCHARGE_PAT.match(tok) or _SUBTOTAL_PAT.match(tok)
                    or _UNIT_PRICE_PAT.match(tok) or _parse_qty_token(en_c) is not None):
                current['_combo_contents'] = tok
                continue
            # else fall through to normal handling of this token (e.g. the upcharge)

        en_tok = ar_to_en_digits(tok)
        qty_val = _parse_qty_token(en_tok)
        if qty_val is not None:
            if current is not None:
                _flush(current, notes_buf)
                notes_buf = []
            last_unrecognized = None
            current = {'name': '', 'qty': qty_val, 'unit_price': 0.0}
            current['_awaiting_name'] = True
            continue

        if current and current.get('_awaiting_name'):
            # Skip pure-digit tokens (e.g. '١' from block headers) — keep waiting
            if _DIGITS_ONLY.match(tok):
                continue
            current['name'] = tok
            del current['_awaiting_name']
            continue

        if current and _UNIT_PRICE_PAT.match(tok):
            current['unit_price'] = parse_price(tok)
            continue

        # Size/modifier surcharge ("+IQD ٣٬٠٠٠") → add to the item's price so the
        # chosen size (e.g. دبل) is counted; otherwise items-sum < subtotal and
        # the order is wrongly rejected as "incomplete". For a "make it a meal"
        # item the upcharge belongs to the كومبو فنكر line, not the base item.
        if current and _UPCHARGE_PAT.match(tok):
            if current.get('_make_meal'):
                current['_combo_price'] = (current.get('_combo_price') or 0.0) + parse_price(tok)
            else:
                current['unit_price'] = (current.get('unit_price') or 0.0) + parse_price(tok)
            continue

        # Condensed-block format: item appears as "NAME, IQD X / عنصر" with no qty prefix.
        # When we see a unit price with no active item, promote the last unrecognized token
        # as an implicit qty-1 item.
        if not current and _UNIT_PRICE_PAT.match(tok) and last_unrecognized:
            current = {'name': last_unrecognized, 'qty': 1, 'unit_price': parse_price(tok)}
            last_unrecognized = None
            continue

        if current and _SUBTOTAL_PAT.match(tok):
            # Subtotals are normally redundant (qty × unit price). BUT the line
            # total Toters prints is the ground truth, so when our captured price
            # falls short of it — e.g. ورق عنب: "IQD ٤٬٠٠٠/ قطع" → "اختر الكمية" →
            # "10 قطعة" → "+IQD ٧٥٠" → "IQD ٤٬٧٥٠", where the "/ قطع" base or a
            # modifier wasn't fully captured — trust the line total instead. We
            # only ever raise an undercount (never lower a correct price), so the
            # item isn't wrongly counted short and flagged as "incomplete".
            qty = current.get('qty') or 1
            line_total = parse_price(tok)
            # For a make-it-a-meal item the printed line total covers BASE + combo
            # upcharge, so reconcile against that sum (and only ever raise the base,
            # never the fixed combo surcharge).
            combo = current.get('_combo_price') or 0.0
            if line_total > ((current.get('unit_price') or 0.0) + combo) * qty:
                current['unit_price'] = (line_total - combo * qty) / qty
            continue

        if _ITEM_COUNT_PAT.match(ar_to_en_digits(tok)):
            continue

        # Unrecognised token — remember it in case the next token is a unit price
        # (implicit qty-1 item in condensed-block format).
        last_unrecognized = tok

    if current:
        _flush(current, notes_buf)

    return items, order_special


def _split_blocks(tokens: list[str]) -> list[list[str]]:
    """Split the token stream into scroll-capture blocks at 'أكد الطلب' (which
    ends each capture). A trailing block without the button is still returned."""
    blocks: list[list[str]] = []
    cur: list[str] = []
    for t in tokens:
        cur.append(t)
        if _BLOCK_END_PAT.match(t):
            blocks.append(cur)
            cur = []
    if cur:
        blocks.append(cur)
    return blocks or [tokens]


def _item_key(it: dict) -> tuple:
    # Identity for seam-overlap matching. Price is excluded (an item cut at a
    # window edge can be momentarily price-less) — overlap reconciliation below
    # keeps the better-priced copy.
    return (it.get('name', ''), it.get('qty', 0), it.get('notes', ''))


def _merge_windows(blocks: list[list[dict]]) -> list[dict]:
    """Merge per-block item lists (each a contiguous, overlapping scroll window
    of the full order) into the complete ordered list. At each seam, collapse the
    longest tail of the accumulated result that equals the head of the next
    window — so the scroll overlap is removed, while distinct lines inside any
    single block are preserved (the bug fix)."""
    result: list[dict] = []
    for win in blocks:
        if not win:
            continue
        if not result:
            result = [dict(it) for it in win]
            continue
        maxk = min(len(result), len(win))
        k = 0
        for kk in range(maxk, 0, -1):
            if all(_item_key(result[-kk + i]) == _item_key(win[i]) for i in range(kk)):
                k = kk
                break
        # Reconcile the overlapping items: keep the richer (higher-priced / noted)
        # copy, in case an earlier window showed the item only partially.
        for i in range(k):
            r, w = result[-k + i], win[i]
            if (w.get('unit_price') or 0) > (r.get('unit_price') or 0):
                r['unit_price'] = w['unit_price']
            if not r.get('notes') and w.get('notes'):
                r['notes'] = w['notes']
        result.extend(dict(it) for it in win[k:])
    return result


def parse(raw_text: str) -> dict:
    tokens = _tokenize(raw_text)

    external_id   = ''
    customer_name = ''

    # ── Pass 1: extract order ID and customer name (dash format only) ─────────
    id_idx = -1
    for i, tok in enumerate(tokens):
        m = _ORDER_ID_PAT.search(tok)
        if m:
            external_id = ar_to_en_digits(m.group(1))
            id_idx = i
            break

    if id_idx >= 0 and ' — ' in raw_text:
        for j in range(id_idx + 1, len(tokens)):
            cand = tokens[j]
            if (cand.startswith('هوية') or cand.startswith('اليوم')
                    or cand == 'تم'
                    or _ITEM_COUNT_PAT.match(ar_to_en_digits(cand))):
                break
            customer_name = cand
            break

    # ── Pass 2: per-block extraction, then overlap-merge across blocks ────────
    blocks = _split_blocks(tokens)
    per_block_items: list[list[dict]] = []
    order_special: list[tuple[str, str]] = []
    for b in blocks:
        b_items, b_special = _extract(b)
        per_block_items.append(b_items)
        order_special.extend(b_special)
    items = _merge_windows(per_block_items)

    # Order note from the per-item special instructions, de-duplicated (the bot
    # captures the order block several times) and prefixed with the item name so
    # the kitchen knows which item each note belongs to.
    seen_notes: set[tuple[str, str]] = set()
    note_lines: list[str] = []
    for nm, txt in order_special:
        txt = (txt or '').strip()
        if not txt:
            continue
        key = (nm, txt)
        if key in seen_notes:
            continue
        seen_notes.add(key)
        note_lines.append(f'{nm}: {txt}' if nm else txt)
    order_notes = '\n'.join(note_lines)

    total = sum(it['qty'] * it['unit_price'] for it in items)

    # Claimed items subtotal (حاصل الجمع) — the webhook uses this to detect an
    # incomplete capture (a long item list that wasn't fully scrolled). 0 if the
    # token isn't present.
    subtotal = 0.0
    for idx in range(len(tokens)):
        if tokens[idx].startswith('حاصل الجمع') and idx + 1 < len(tokens):
            subtotal = parse_price(tokens[idx + 1])
            break

    return {
        'external_id':    external_id,
        'customer_name':  customer_name,
        'customer_phone': '',
        'address':        '',
        'notes':          order_notes,
        'total':          total,
        'subtotal':       subtotal,
        'items':          items,
    }
