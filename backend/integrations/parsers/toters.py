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
"""
import re
from .common import ar_to_en_digits, parse_price, parse_qty

_ORDER_ID_PAT   = re.compile(r'(?:الطلب\s*)?#([٠-٩\d]+)')
_UNIT_PRICE_PAT = re.compile(r'^IQD\s*[\d,٬٠-٩]+\s*/\s*عنصر$')
_SUBTOTAL_PAT   = re.compile(r'^IQD\s*[\d,٬٠-٩]+$')
_ITEM_COUNT_PAT = re.compile(r'^[٠-٩\d]+\s*عناصر?$')
_TIME_LEFT_PAT  = re.compile(r'^لديك\s')

_END_MARKERS = {'أكد الطلب'}

_SKIP_TOKENS = re.compile(
    r'^(تم|هوية|اليوم في|أكد الطلب|فتح لائحة التنقل|الطلبات الحالية|'
    r'Toters Merchant|جديد|تحضير|جاهز|لا توجد طلبات جديدة|تم التأكيد|'
    r'حاصل الجمع|مجموع|ملف)'
)


def _tokenize(raw_text: str) -> list[str]:
    # Strip RTL / LTR marks and extra whitespace from every token
    def clean(t):
        return t.replace('\u200f', '').replace('\u200e', '').strip()

    if ' — ' in raw_text:
        return [clean(t) for t in raw_text.split(' — ') if clean(t)]
    return [clean(t) for t in raw_text.split(',') if clean(t)]


def parse(raw_text: str) -> dict:
    tokens = _tokenize(raw_text)

    external_id   = ''
    customer_name = ''
    items         = []

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

    # ── Pass 2: extract items ─────────────────────────────────────────────────
    current: dict | None = None
    notes_buf: list[str] = []

    def _flush(item, notes):
        if notes:
            item['notes'] = ', '.join(notes)
        items.append(item)

    for tok in tokens:
        if tok in _END_MARKERS or _TIME_LEFT_PAT.match(tok):
            break

        if _SKIP_TOKENS.match(tok):
            continue

        en_tok = ar_to_en_digits(tok)
        qty_val = _parse_qty_token(en_tok)
        if qty_val is not None:
            if current is not None:
                _flush(current, notes_buf)
                notes_buf = []
            current = {'name': '', 'qty': qty_val, 'unit_price': 0.0}
            current['_awaiting_name'] = True
            continue

        if current and current.get('_awaiting_name'):
            current['name'] = tok
            del current['_awaiting_name']
            continue

        if current and _UNIT_PRICE_PAT.match(tok):
            current['unit_price'] = parse_price(tok)
            continue

        if current and _SUBTOTAL_PAT.match(tok):
            continue

        if _ITEM_COUNT_PAT.match(ar_to_en_digits(tok)):
            continue

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
    m = re.match(r'^(\d+)[xX×]$', en_tok)
    return int(m.group(1)) if m else None
