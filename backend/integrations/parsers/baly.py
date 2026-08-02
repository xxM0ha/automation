"""
Baly (com.example.balyvms merchant app) order parser.

Parses the comma-joined screen text captured from the order *detail* screen,
e.g.:

  الطلب #22246053, منذ دقيقة, محمد فراس فليح, بانتظار السائق,
  x1, بوكس رز, 26,750 د.ع, + ريزو كلاسيك, 0 د.ع, + ريزو جبن, 0 د.ع,
  x1, ريزو هني ماسترد, 7,750 د.ع,
  المجموع الجزئي, 34,500 د.ع, قيمة الخصم, 5,333 د.ع, عمولة بلي, 6,900 د.ع,
  المجموع, 22,267 د.ع, قبول الطلب

Item block: "x{qty}" → name → "<price> د.ع", followed by optional
"+ addition" / "<price> د.ع" pairs (modifiers, folded into the item's notes).
Order id:    digits after '#'.
Order total: the value right after the EXACT token "المجموع" (note that the
             subtotal label "المجموع الجزئي" also starts with "المجموع", so the
             match must be exact, not a prefix).
"""
import re
from .common import ar_to_en_digits, parse_price

_ORDER_ID = re.compile(r'#\s*(\d+)')
_QTY      = re.compile(r'^[xX×]\s*(\d+)$')
_PRICE    = re.compile(r'[\d,٬،]+\s*د\.ع')
_TIME     = re.compile(r'^(?:منذ|الان|الآن)')
# Delivery-method markers Baly shows between the customer name and the order
# status — not part of the customer's note, so we skip them when collecting it.
_DELIVERY_TYPES = {'biker', 'driver', 'car', 'bike', 'walker', 'pickup', 'استلام'}
# Burger spellings: برغر / برجر / بركر. Baly sends a burger's size variant as a
# free "+ عادي" modifier, but Foodics names the item "<burger> عادي" — so for
# burgers we fold that عادي into the NAME instead of the notes.
_BURGER   = re.compile(r'بر[غجك]ر')
_PLAIN    = ('عادي', 'عادى')
# A free soft-drink choice. On a MEAL the drink goes to the order NOTES (the meal
# is the product, so its name must still match the menu). On the generic
# "مشروبات غازية" item the drink IS the product, so it's folded into the name.
_DRINK      = re.compile(r'بيبسي|ببسي|بيبسى|كوكا|كولا|ميرندا|سفن|سبرايت|فانتا|شويبس|عصير|مياه|ماء|موية|زمزم')
_DRINK_ITEM = re.compile(r'مشروب|غازي')
_THOUSANDS_HEAD = re.compile(r'^\d{1,3}$')
_THOUSANDS_TAIL = re.compile(r'^(\d{3})(\D.*)?$')


def _rejoin_prices(tokens: list[str]) -> list[str]:
    """The raw_text is comma-joined, but Baly prices use ',' as a thousands
    separator (e.g. "22,267 د.ع"), so they arrive split as "22" + "267 د.ع".
    Re-merge a leading 1–3 digit token with the following 3-digit group(s)
    (the last of which carries the unit) back into one number token."""
    out: list[str] = []
    k = 0
    while k < len(tokens):
        head = ar_to_en_digits(tokens[k])
        if _THOUSANDS_HEAD.match(head):
            num = head
            k += 1
            while k < len(tokens):
                m = _THOUSANDS_TAIL.match(ar_to_en_digits(tokens[k]))
                if not m:
                    break
                num += m.group(1)
                tail = m.group(2) or ''
                k += 1
                if tail.strip():       # carried the " د.ع" unit → end of number
                    num += tail
                    break
            out.append(num)
        else:
            out.append(tokens[k])
            k += 1
    return out


def parse(raw_text: str) -> dict:
    tokens = [
        t.strip()
        for chunk in raw_text.split(',')
        for t in chunk.split('\n')
        if t.strip()
    ]
    tokens = _rejoin_prices(tokens)
    n = len(tokens)

    # Order id — digits after '#'.
    external_id = ''
    for t in tokens:
        m = _ORDER_ID.search(ar_to_en_digits(t))
        if m:
            external_id = m.group(1)
            break

    # Customer name — the token right after the order-time token — and the main
    # order note, if any. Baly lays the header out as:
    #   ...,<time>,<customer>,[<note>,]<delivery-type>,بانتظار السائق,x1,...
    # The note is the free text the customer attached to the WHOLE order (e.g.
    # "الريزو كلاسيك بدون اي صلصه او صوصات"). It belongs in the order notes →
    # Foodics "ملاحظات المطبخ", NOT on any single item. When absent, the customer
    # token is followed directly by the delivery type ("biker").
    customer_name = ''
    note_tokens: list[str] = []
    for idx, t in enumerate(tokens):
        if _TIME.match(t) and idx + 1 < n:
            cand = tokens[idx + 1]
            if 'السائق' not in cand and not _PRICE.search(cand):
                customer_name = cand
                for j in range(idx + 2, n):
                    nxt = tokens[j]
                    en = ar_to_en_digits(nxt)
                    # Stop at the status line, an item qty, a price, or the action button.
                    if ('السائق' in nxt or nxt == 'قبول الطلب'
                            or _QTY.match(en) or _PRICE.search(en)):
                        break
                    if nxt.strip().lower() in _DELIVERY_TYPES:
                        continue   # delivery method, not part of the note
                    note_tokens.append(nxt)
            break

    notes = '، '.join(note_tokens).strip()

    # Order total — value after the exact "المجموع" label (NOT "المجموع الجزئي").
    total = 0.0
    for idx, t in enumerate(tokens):
        if t == 'المجموع' and idx + 1 < n:
            total = parse_price(tokens[idx + 1])
            break

    # Items — "x{qty}" → name → price, plus "+ addition" pairs folded into notes.
    items = []
    i = 0
    while i < n:
        qm = _QTY.match(ar_to_en_digits(tokens[i]))
        if not qm:
            i += 1
            continue
        qty = int(qm.group(1))
        name = tokens[i + 1] if i + 1 < n else ''
        unit_price = 0.0
        j = i + 2
        if j < n and _PRICE.search(ar_to_en_digits(tokens[j])):
            # Baly shows the PER-UNIT price next to the item (the subtotal equals
            # qty × this price), so use it as-is — do NOT divide by qty.
            unit_price = parse_price(tokens[j])
            j += 1
        name_mods = []   # modifiers folded into the NAME (size / variant)
        note_mods = []   # modifiers kept as NOTES (a drink choice on a meal)
        is_drink_item = _DRINK_ITEM.search(name) is not None
        while j < n and tokens[j].lstrip().startswith('+'):
            mod = tokens[j].lstrip('+ ').strip()
            if mod in _PLAIN and _BURGER.search(name):
                name = f'{name} عادي'        # burger size variant → name
            elif mod and _DRINK.search(mod) and not is_drink_item:
                note_mods.append(mod)        # drink choice on a meal → NOTES,
                                             # so the meal name still matches
            elif mod:
                name_mods.append(mod)        # size/variant, or the drink when the
                                             # item itself IS a drink → NAME
            j += 1
            if j < n and _PRICE.search(ar_to_en_digits(tokens[j])):
                # A paid modifier (e.g. "+ دبل, 3,000 د.ع") adds its surcharge to
                # the item's per-unit price so the effective price matches the
                # chosen variant in Foodics (the adapter disambiguates by price).
                # Free modifiers ("+ بيبسي, 0 د.ع") add 0, so this is harmless.
                unit_price += parse_price(tokens[j])
                j += 1
        # Size/variant modifiers become part of the name so each variant is a
        # distinct, mappable item — e.g. "وجبة دايت (+100 غم)",
        # "مشروبات غازية (+بيبسي دايت)". A drink on a meal stays in notes so the
        # meal still matches — e.g. "وجبة ريزو هني ماسترد" + notes "بيبسي".
        if name_mods:
            name = name + ' (' + '، '.join('+' + m for m in name_mods) + ')'
        if name:
            items.append({
                'name':       name,
                'qty':        qty,
                'unit_price': unit_price,
                'notes':      '، '.join(note_mods),
            })
        i = j

    # Deduplicate identical lines (same name + notes). The screen capture can
    # grab the order block more than once (scroll overlap / re-render), which
    # would otherwise create phantom duplicate line items — and the Foodics push
    # then fails trying to add the same item a second time and aborts the order.
    # A genuine multiple shows as one line with qty > 1, so this is safe.
    seen = set()
    unique = []
    for it in items:
        key = (it['name'], it.get('notes', ''))
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)
    items = unique

    if total == 0.0:
        total = sum(it['qty'] * it['unit_price'] for it in items)

    return {
        'external_id':    external_id,
        'customer_name':  customer_name,
        'customer_phone': '',
        'address':        '',
        'notes':          notes,
        'total':          total,
        'items':          items,
    }
