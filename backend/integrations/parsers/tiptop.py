"""Tiptop delivery platform order parser."""
import re

_ORDER_ID_PAT   = re.compile(r'#(\d{6,})')
_CUSTOMER_PAT   = re.compile(r'^(.+?)\s*[-\u2013]\s*\d+\s*items?$', re.IGNORECASE)
_ITEM_PAT       = re.compile(r'^(\d+)x\s+(.+)')
_PRICE_FULL_PAT = re.compile(r'^([\d,]+)\s*د\.ع$')
_SIZE_PAT       = re.compile(r'^أختيارك من الحجم[:\s]+(.+)', re.IGNORECASE)
_DRINK_PAT      = re.compile(r'^أختيارك من (?:المشروب|الإضافة)[:\s]+(.+)', re.IGNORECASE)
_NOTES_PAT      = re.compile(r'^ملاحظة[:\s]*')
_DRINK_ITEM_PAT = re.compile(r'مشروب|غازي|عصير|كولا|بيبسي|ببسي|ماء', re.IGNORECASE)
_TOTAL_LABEL    = 'إجمالي السعر'
_STOP_TOKENS    = frozenset({
    'المجموع الفرعي', 'الخصم', 'رسوم التوصيل', 'الضرائب والرسوم',
    'رسوم الخدمة', 'السعر النهائي للمجموع الفرعي', 'قبول الطلب',
    'لا توجد ملاحظات',
})
_JUNK_PAT = re.compile(
    r'^علامة التبويب'
    r'|^%full_order'
    r'|^رجوع$'
    r'|^جديد$'
    r'|^قيد التحضير$'
    r'|^جاهز للاستلام$'
    r'|^جاري التوصيل$'
    r'|^مكتمل$'
    r'|^\(\d+\)$'
    r'|^مطعم'
    r'|^توصيل تيب توب$'
    r'|^الإعدادات$'
    r'|^مرحباً'
    r'|\d+m ago'
    r'|Laffe Restaurant'
    r'|Tiptop'
    r'|مفتوح$'
)


def _tokenize(raw: str) -> list[str]:
    tokens = []
    for line in raw.split('\n'):
        line = line.strip()
        if not line:
            continue
        # Protect thousands-separator commas (e.g. 2,500) from being split
        protected = re.sub(r'(\d),(\d{3}\b)', lambda m: m.group(1) + '\x00' + m.group(2), line)
        for part in protected.split(','):
            part = part.replace('\x00', ',').strip()
            if part:
                tokens.append(part)
    return tokens


def _price_val(tok: str) -> float:
    m = _PRICE_FULL_PAT.match(tok.strip())
    return float(m.group(1).replace(',', '')) if m else 0.0


def parse(raw_text: str) -> dict:
    tokens = _tokenize(raw_text)

    ext_id         = ''
    customer       = ''
    items          = []
    total          = 0.0
    order_notes    = ''
    current        = None
    in_items       = False
    in_notes       = False
    awaiting_total = False

    for tok in tokens:
        if _JUNK_PAT.search(tok):
            continue

        if not ext_id:
            id_m = _ORDER_ID_PAT.search(tok)
            if id_m:
                ext_id = id_m.group(1)

        if not customer and not in_items:
            cust_m = _CUSTOMER_PAT.match(tok)
            if cust_m:
                customer = cust_m.group(1).strip()
                continue

        if _NOTES_PAT.match(tok):
            if current:
                items.append(current)
                current = None
            in_items = False
            in_notes = True
            inline = _NOTES_PAT.sub('', tok).strip()
            if inline and inline not in _STOP_TOKENS:
                order_notes = inline
            continue

        if in_notes:
            if _ITEM_PAT.match(tok):
                in_notes = False  # new item starts — exit notes mode, fall through
            elif tok in _STOP_TOKENS or _PRICE_FULL_PAT.match(tok):
                continue  # skip prices and stop tokens while in notes
            else:
                order_notes = (order_notes + ' ' + tok).strip()
                continue

        if tok == _TOTAL_LABEL:
            if current:
                items.append(current)
                current = None
            in_items = False
            awaiting_total = True
            continue

        if awaiting_total:
            v = _price_val(tok)
            if v:
                total = v
            awaiting_total = False
            continue

        if tok in _STOP_TOKENS:
            if current:
                items.append(current)
                current = None
            in_items = False
            continue

        size_m = _SIZE_PAT.match(tok)
        if size_m:
            if current:
                current['name'] += ' ' + size_m.group(1).strip()
            continue

        drink_m = _DRINK_PAT.match(tok)
        if drink_m:
            if current:
                choice = drink_m.group(1).strip()
                # Strip "ModifierGroup: " prefix, e.g. "الغازي: سفن آب" → "سفن آب"
                if ':' in choice:
                    choice = choice.split(':', 1)[1].strip()
                if _DRINK_ITEM_PAT.search(current['name']):
                    current['name'] = choice  # standalone drink item → specific choice is the real name
                else:
                    current['notes'] = (current['notes'] + ', ' + choice).strip(', ') if current['notes'] else choice
            continue

        item_m = _ITEM_PAT.match(tok)
        if item_m:
            if current:
                items.append(current)
            current = {
                'qty':   int(item_m.group(1)),
                'name':  item_m.group(2).strip(),
                'notes': '',
            }
            in_items = True
            continue

        if in_items and _PRICE_FULL_PAT.match(tok):
            continue

    if current:
        items.append(current)

    return {
        'external_id':    ext_id,
        'customer_name':  customer,
        'customer_phone': '',
        'address':        '',
        'notes':          order_notes,
        'total':          total,
        'items': [
            {'name': it['name'], 'qty': it['qty'], 'notes': it['notes']}
            for it in items
        ],
    }
