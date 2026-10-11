"""
Laffe Restaurant — Foodics POS adapter (Playwright-based).

Uses the singleton session from session.py.
One browser, one lock — orders are processed serially, never in parallel.
When Foodics provides a real API, replace _fill_order() with HTTP calls.
The BasePOSAdapter interface stays the same.
"""
import json
import logging
import os
import re
import time
from pathlib import Path

from integrations.base.pos_adapter import BasePOSAdapter, POSResult
from integrations.laffe.session import get_worker, setup_order_form, CALLCENTER_URL


class _ItemsNotFoundInMenu(Exception):
    def __init__(self, items: list[str], picks=None):
        self.failed_items = items
        self.picks = picks or []

logger = logging.getLogger('prime.laffe.adapter')

FAILURE_DIR = Path(__file__).parent.parent.parent / 'logs' / 'laffe-failures'
FAILURE_DIR.mkdir(parents=True, exist_ok=True)

# ── Foodics API capture ──────────────────────────────────────────────────────
# While the bot pushes an order, record every API call the Foodics console makes
# (method, URL, JSON sent, JSON received) to logs/foodics-capture/, so the order
# flow can later be re-implemented over HTTP instead of a browser. Tokens,
# cookies and passwords are redacted. Recording never affects the push itself.
CAPTURE_DIR = FAILURE_DIR.parent / 'foodics-capture'
CAPTURE_ENABLED = os.getenv('FOODICS_CAPTURE', '1') == '1'
CAPTURE_KEEP = 40                # newest capture files kept
CAPTURE_BODY_LIMIT = 1_000_000   # characters kept per body
_SECRET_HEADERS = {'authorization', 'cookie', 'set-cookie', 'x-xsrf-token', 'x-csrf-token'}
_SECRET_KEYS = {'token', 'access_token', 'refresh_token', 'password', 'secret'}
_SECRET_QUERY = re.compile(r'\b((?:access_)?token|password|secret)=[^&]+', re.I)
_SECRET_JSON = re.compile(r'"((?:access_|refresh_)?token|password|secret)"\s*:\s*"[^"]*"', re.I)


def _redact(value):
    if isinstance(value, dict):
        return {k: ('<redacted>' if str(k).lower() in _SECRET_KEYS else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _redact_text(text: str) -> str:
    text = _SECRET_QUERY.sub(lambda m: m.group(1) + '=<redacted>', text)
    return _SECRET_JSON.sub(lambda m: f'"{m.group(1)}": "<redacted>"', text)


def _decode_body(text):
    if text is None:
        return None
    if len(text) > CAPTURE_BODY_LIMIT:
        return {'truncated_chars': len(text), 'head': _redact_text(text[:CAPTURE_BODY_LIMIT])}
    try:
        return _redact(json.loads(text))
    except (ValueError, TypeError):
        return _redact_text(text)


class _FoodicsCapture:
    """Records the Foodics console's XHR/fetch calls on `page` until save()."""

    def __init__(self, page, oid: str, platform: str):
        self.page, self.oid, self.platform = page, oid, platform
        self.started = time.time()
        self.requests = []
        page.on('requestfinished', self._on_request)
        page.on('requestfailed', self._on_request)

    def _on_request(self, request):
        # Runs on Playwright's event dispatcher: cheap property reads only.
        try:
            if request.resource_type in ('xhr', 'fetch') and 'foodics' in request.url:
                self.requests.append((round(time.time() - self.started, 2), request))
        except Exception:
            pass

    def _describe(self, t, request) -> dict:
        call = {
            't': t,
            'method': request.method,
            'url': _redact_text(request.url),
            'request_headers': {k: ('<redacted>' if k.lower() in _SECRET_HEADERS else v)
                                for k, v in request.headers.items()},
            'request_body': _decode_body(request.post_data),
        }
        try:
            response = request.response()
        except Exception:
            response = None
        if response is None:
            call['failure'] = request.failure
            return call
        call['status'] = response.status
        call['response_type'] = response.headers.get('content-type', '')
        try:
            call['response_body'] = _decode_body(response.text())
        except Exception as e:
            call['response_body'] = f'<unavailable: {str(e).splitlines()[0][:120]}>'
        return call

    def save(self, outcome: str) -> None:
        try:
            self.page.remove_listener('requestfinished', self._on_request)
            self.page.remove_listener('requestfailed', self._on_request)
        except Exception:
            pass
        try:
            calls = [self._describe(t, r) for t, r in self.requests]
            CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime('%Y%m%d-%H%M%S', time.localtime(self.started))
            path = CAPTURE_DIR / f'{stamp}_{self.platform}_{self.oid}.json'
            path.write_text(json.dumps({
                'order': self.oid,
                'platform': self.platform,
                'outcome': outcome,
                'started': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(self.started)),
                'calls': calls,
            }, ensure_ascii=False, indent=1), encoding='utf-8')
            for old in sorted(CAPTURE_DIR.glob('*.json'))[:-CAPTURE_KEEP]:
                old.unlink(missing_ok=True)
            logger.info('[laffe] Captured %d Foodics API calls → %s', len(calls), path.name)
        except Exception:
            logger.exception('[laffe] Foodics API capture failed for %s', self.oid)

# Finds the card whose title equals the given one (normalised) and, when a
# price is given, whose price is exactly that — never a partial title or the
# closest price — and fires a native click on its clickable ancestor. Used
# instead of a Playwright click because the card name is mirrored by a hidden
# line-clamp tooltip clone and the filtered list renders late, both of which
# break Playwright's actionability checks.
_CLICK_ITEM_JS = r"""(args) => {
  const norm = s => (s||'').replace(/[\u064B-\u0652\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ـ/g,'').replace(/ی/g,'ي').replace(/ک/g,'ك')
                           .replace(/\s*\(\s*/g,' (').replace(/\s*\)\s*/g,') ').replace(/\s+/g,' ').trim();
  const pdig = s => { const d=(s||'').replace(/[^\d]/g,''); return d?parseInt(d,10):null; };
  const want = norm(args.title);
  const wp = pdig(args.price);
  const els = Array.from(document.querySelectorAll('div.line-clamp-2[title]'));
  let cands = els.filter(e => norm(e.getAttribute('title')) === want);
  if (wp != null) cands = cands.filter(e => { const c=e.parentElement; const p=c&&c.querySelector('.font-bold'); return pdig(p?p.textContent:'') === wp; });
  if (!cands.length) return false;
  const card = cands[0].closest('.cursor-pointer') || cands[0].parentElement || cands[0];
  try { card.scrollIntoView({block:'center'}); } catch (e) {}
  card.click();
  return true;
}"""

# Button labels tried in order when saving a completed order.
# Add new candidates at the front if the UI changes.
_SAVE_BUTTON_LABELS = [
    'حفظ الطلب',
    'تأكيد الطلب',
    'إتمام الطلب',
    'إرسال الطلب',
    'إنهاء الطلب',
    'تأكيد',
    'تم',
]


def _save_order(page, order_external_id: str) -> None:
    """
    Click the save/confirm button that finalises the order in Foodics.
    Tries each label in _SAVE_BUTTON_LABELS until one succeeds.
    Raises RuntimeError if none are found — the caller will screenshot and fail gracefully.
    """
    for label in _SAVE_BUTTON_LABELS:
        try:
            btn = page.get_by_role('button', name=label)
            if btn.is_visible(timeout=2_000):
                btn.click()
                logger.debug('[laffe] Clicked save button "%s" for order %s', label, order_external_id)
                page.wait_for_timeout(1_500)
                return
        except Exception:
            continue

    # Last resort — look for any button whose text matches Arabic save/confirm verbs
    try:
        btn = page.locator(
            'button:has-text("حفظ"), button:has-text("تأكيد"), button:has-text("إتمام")'
        ).last
        if btn.is_visible(timeout=2_000):
            btn.click()
            page.wait_for_timeout(1_500)
            logger.debug('[laffe] Clicked fallback save button for order %s', order_external_id)
            return
    except Exception:
        pass

    raise RuntimeError(
        f'[laffe] Could not find save-order button for {order_external_id}. '
        'UI may have changed — check _SAVE_BUTTON_LABELS in adapter.py.'
    )


def _extract_pos_id(page, order_external_id: str) -> str:
    """
    After saving, try to extract the Foodics internal order ID.

    Strategies (in order):
    1. URL path segment — Foodics navigates to /today-orders or /orders/{id}
    2. Success toast / confirmation element containing a numeric ID
    3. Current page URL fragment

    Returns '' if no ID can be determined — the order was still saved.
    """
    # Strategy 1: URL changed to include a numeric order ID
    current_url = page.url
    # Match patterns like /orders/12345 or ?order=12345
    m = re.search(r'/orders?/(\d+)', current_url)
    if m:
        return m.group(1)
    m = re.search(r'[?&]order[_-]?id=(\d+)', current_url)
    if m:
        return m.group(1)

    # Strategy 2: Look for order ID in a success/confirmation element
    id_selectors = [
        '[data-order-id]',
        '.order-id',
        '[class*="order-number"]',
        '[class*="order_number"]',
    ]
    for sel in id_selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=1_000):
                text = el.inner_text().strip()
                digits = re.sub(r'\D', '', text)
                if digits:
                    logger.debug('[laffe] Extracted pos_id from element "%s": %s', sel, digits)
                    return digits
        except Exception:
            continue

    # Strategy 3: Any visible numeric-heavy element near order confirmation text
    try:
        success_area = page.locator('text=رقم الطلب').first
        if success_area.is_visible(timeout=1_000):
            # The sibling/parent likely contains the number
            parent_text = success_area.locator('..').inner_text(timeout=1_000)
            digits = re.sub(r'\D', '', parent_text)
            if digits:
                return digits
    except Exception:
        pass

    logger.warning(
        '[laffe] Could not extract Foodics order ID for %s — order was saved but pos_id unknown',
        order_external_id,
    )
    return ''


_BRANCH_IDS = {}     # Foodics branch name -> UUID, resolved once per process
_CUSTOMER_IDS = {}   # app phone -> customer UUID
_CREATOR_ID = {}     # our Foodics login email -> user UUID


def _api_branches():
    """Branch slugs pushed through the Foodics API instead of the browser.
    Empty (the default) means every branch keeps using the browser."""
    import os
    raw = os.getenv('FOODICS_API_BRANCHES', '')
    return {s.strip() for s in raw.split(',') if s.strip()}


def _api_push(page, order, items, branch_name, platform_slug):
    """Create the order through the Foodics API. Returns (reference, meta).

    Raises on any failure EXCEPT one it can prove is harmless, so the caller
    can fall back to the browser. Before reporting failure it checks whether
    the order actually landed — a create that errors after writing must never
    be entered a second time.
    """
    from integrations.laffe import foodics_api as api
    from integrations.laffe.session import EMAIL, PLATFORM_CONFIG
    import hashlib
    from datetime import datetime, timezone

    cfg = PLATFORM_CONFIG.get(platform_slug, PLATFORM_CONFIG['toters'])
    oid = order.external_id

    lines = []
    for item in (items or []):
        pid = getattr(item, '_foodics_product_id', '') or ''
        price = getattr(item, '_foodics_price', None)
        if not pid or price is None:
            raise RuntimeError(f'"{item.name_snapshot}" has no Foodics product id/price — browser push')
        lines.append((pid, item.qty, int(price), (getattr(item, 'notes', '') or '').strip()))
    if not lines:
        raise RuntimeError('order has no items')

    branch = _BRANCH_IDS.get(branch_name) or api.branch_id(page, branch_name)
    if not branch:
        raise RuntimeError(f'no Foodics branch id for {branch_name!r}')
    _BRANCH_IDS[branch_name] = branch

    phone = cfg['phone']
    customer = _CUSTOMER_IDS.get(phone) or api.customer_id(page, phone)
    if not customer:
        raise RuntimeError(f'no Foodics customer for {platform_slug} ({phone})')
    _CUSTOMER_IDS[phone] = customer

    creator = _CREATOR_ID.get(EMAIL) or api.user_id_by_email(page, EMAIL)
    if not creator:
        raise RuntimeError(f'cannot resolve the Foodics user for {EMAIL}')
    _CREATOR_ID[EMAIL] = creator

    order_uuid = api.new_order_id(page)
    if not order_uuid:
        raise RuntimeError('Foodics did not issue an order id')

    id_digits = cfg.get('id_digits')
    display_id = oid[-id_digits:] if id_digits else oid
    kitchen_notes = f'{cfg["source"]} - {display_id}'
    if order.notes:
        kitchen_notes += f'\n{order.notes}'

    payload = api.order_payload(
        order_id=order_uuid,
        # Deterministic per ORDO order: a retry of the same order is refused by
        # Foodics rather than entered twice.
        idempotency_key=hashlib.md5(f'ordo-{order.id}-{oid}'.encode()).hexdigest()[:10],
        branch=branch, customer=customer, creator=creator, lines=lines,
        kitchen_notes=kitchen_notes,
        opened_at=datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
    )

    res = api.create_order(page, payload) or {}
    body = res.get('body') if isinstance(res.get('body'), dict) else {}
    data = body.get('data') or {}
    if res.get('status') in (200, 201) and data.get('id'):
        ref = str(data.get('reference') or '')
        logger.info('[laffe] Order %s created via API → reference %s (%d lines)', oid, ref, len(lines))
        return ref, {'method': 'api', 'order_id': order_uuid, 'reference': ref,
                     'lines': len(lines), 'total': payload['total_price']}

    landed, ref = api.order_exists(page, order_uuid)
    if landed:
        logger.warning('[laffe] Order %s: API reported %s but the order IS in Foodics (ref %s) — not retrying',
                       oid, res.get('status'), ref)
        return str(ref or ''), {'method': 'api', 'order_id': order_uuid, 'reference': ref,
                                'recovered': True, 'lines': len(lines)}

    raise RuntimeError(f'API create failed ({res.get("status")}): {str(res.get("body"))[:200]}')


def _shadow_calculate(page, branch_name, items):
    """Price this order through the Foodics API as a dry run — creates nothing.

    Shadow step on the way to pushing orders by API: the browser has already
    entered the order; here we build the same order from each item's Foodics
    product id and ask Foodics what it would charge. Comparing that with what
    we entered proves the ids and the payload before anything switches over.
    Never raises — a failed dry run must not affect a pushed order.
    """
    try:
        from integrations.laffe import foodics_api as api

        lines, missing = [], []
        for item in (items or []):
            pid = getattr(item, '_foodics_product_id', '') or ''
            price = getattr(item, '_foodics_price', None)
            if not pid or price is None:
                missing.append(item.name_snapshot)
                continue
            lines.append((pid, item.qty, int(price)))

        if not lines:
            return {'ran': False, 'reason': 'no line carries a Foodics product id', 'missing': missing}

        bid = _BRANCH_IDS.get(branch_name) or api.branch_id(page, branch_name)
        if not bid:
            return {'ran': False, 'reason': f'no Foodics branch id for {branch_name!r}'}
        _BRANCH_IDS[branch_name] = bid

        res = api.calculate(page, bid, lines) or {}
        body = res.get('body') if isinstance(res.get('body'), dict) else {}
        expected = sum(qty * price for _, qty, price in lines)
        api_total = body.get('total_price')
        out = {
            'ran': True,
            'status': res.get('status'),
            'lines': len(lines),
            'missing_product_id': missing,
            'expected_total': expected,
            'api_total': api_total,
            'match': api_total is not None and int(api_total) == int(expected),
        }
        if res.get('status') != 200:
            out['error'] = str(res.get('body'))[:300]
        logger.info(
            '[laffe] shadow API dry-run: %s lines=%d expected=%s api=%s%s',
            'match' if out.get('match') else 'MISMATCH',
            out['lines'], expected, api_total,
            f" | unmapped: {missing}" if missing else '',
        )
        return out
    except Exception as e:
        logger.warning('[laffe] shadow API dry-run failed: %s: %s', type(e).__name__, e)
        return {'ran': False, 'reason': f'{type(e).__name__}: {e}'[:200]}


class LaffeAdapter(BasePOSAdapter):

    def push_order(self, order) -> POSResult:
        """
        Push one order to Foodics.
        Acquires the singleton session lock — waits if another order is in progress.
        """
        logger.info('[laffe] Pushing order %s (queued)', order.external_id)

        try:
            # Pre-fetch items in the Django thread before entering the Playwright thread
            items = list(order.order_items.select_related('menu_item').all())
            # Resolve each item's Foodics category here too — any DB access must
            # happen in this (sync) thread, never inside the Playwright worker.
            self._attach_pos_categories(items, order)
            # Exact Foodics card price per item (set on the menu page), read here
            # in the Django thread for the same reason as the category above.
            for item in items:
                fp = getattr(getattr(item, 'menu_item', None), 'foodics_price', None)
                item._foodics_price = int(round(float(fp))) if fp is not None else None
                # Foodics product id — the API dry run addresses items by id,
                # never by name. Read here, in the Django thread, like the price.
                item._foodics_product_id = getattr(
                    getattr(item, 'menu_item', None), 'foodics_product_id', '') or ''
            worker = get_worker(self.restaurant.id)

            # ── API path ────────────────────────────────────────────────────
            # When this branch is switched to the API and every line carries a
            # Foodics product id, the order is CREATED by API and the browser
            # flow does not run for it — never both, or the branch gets the
            # order twice. Any failure that provably did NOT write the order
            # falls through to the browser below.
            if self.restaurant.slug in _api_branches():
                branch_name = self._branch_name(order)
                platform_slug = order.platform.slug if order.platform else 'toters'
                try:
                    ref, meta = worker.submit(
                        lambda page: _api_push(page, order, items, branch_name, platform_slug)
                    )
                    return POSResult(ok=True, external_id=ref, failed_items=[], raw=meta)
                except Exception as e:
                    logger.warning('[laffe] API push failed for %s — falling back to the browser: %s',
                                   order.external_id, e)

            result = worker.submit(lambda page: self._fill_order(page, order, items))
            if isinstance(result, tuple):
                pos_id = result[0]
                failed_items = result[1] if len(result) > 1 else []
                picks = result[2] if len(result) > 2 else []
                warnings = result[3] if len(result) > 3 else []
                shadow = result[4] if len(result) > 4 else None
            else:
                pos_id, failed_items, picks, warnings, shadow = result, [], [], [], None
            return POSResult(
                ok=True, external_id=pos_id, failed_items=failed_items,
                raw={'method': 'search_price', 'picks': picks, 'warnings': warnings,
                     'shadow_api': shadow},
            )

        except _ItemsNotFoundInMenu as e:
            logger.warning('[laffe] Order %s aborted — items not found: %s', order.external_id, e.failed_items)
            return POSResult(
                ok=False, failed_items=e.failed_items, error='items not found in Foodics menu',
                raw={'method': 'search_price', 'picks': getattr(e, 'picks', [])},
            )

        except Exception as e:
            self._screenshot(order.external_id)
            logger.exception('[laffe] push_order failed for %s', order.external_id)
            return POSResult(ok=False, error=str(e))

    def _attach_pos_categories(self, items, order) -> None:
        """Resolve the Foodics category for each item and stash it on the item
        as ``_pos_category``. Runs in the Django thread (the Playwright worker
        can't touch the ORM). Precedence: the item's per-app category for this
        order's platform → the item-level category → '' (adapter default)."""
        pid = order.platform_id
        for item in items:
            mi = getattr(item, 'menu_item', None)
            cat = ''
            if mi is not None and pid:
                m = mi.platform_mappings.filter(platform_id=pid).first()
                if m and (m.pos_category or '').strip():
                    cat = m.pos_category.strip()
            if not cat and mi is not None:
                cat = (getattr(mi, 'pos_category', '') or '').strip()
            item._pos_category = cat

    def _branch_name(self, order=None) -> str:
        # Account-driven: the restaurant account explicitly carries its Foodics
        # branch. Falls back to the legacy source-text guess only if unset.
        branch = (getattr(self.restaurant, 'foodics_branch', '') or '').strip()
        if branch:
            return branch
        src = (order.raw_payload.get('source_restaurant', '') if order else '') or self.restaurant.slug
        src = src.lower()
        if any(k in src for k in ('ziraee', 'زراعي', 'zira')):
            return 'الزراعي'
        return 'المصارف'

    def _menu_category(self, order=None) -> str:
        src = (order.raw_payload.get('source_restaurant', '') if order else '') or self.restaurant.slug
        src = src.lower()
        if any(k in src for k in ('riz', 'رز', 'rice')):
            return 'منيو تطبيقات RIZ'
        return 'منيو التطبيقات'

    def _fill_order(self, page, order, items=None):
        """Run the push steps, recording the Foodics API calls they trigger."""
        if not CAPTURE_ENABLED:
            return self._fill_order_steps(page, order, items)
        platform = order.platform.slug if order.platform else 'toters'
        capture = _FoodicsCapture(page, order.external_id, platform)
        outcome = 'error'
        try:
            result = self._fill_order_steps(page, order, items)
            outcome = 'saved'
            return result
        except _ItemsNotFoundInMenu:
            outcome = 'aborted_items_not_found'
            raise
        finally:
            capture.save(outcome)

    def _fill_order_steps(self, page, order, items=None) -> str:
        """
        Fill the order form in Foodics.
        At entry: page is at idle state (pickup selected, توترز chosen).
        At exit: order is saved, Foodics order ID returned.
        """
        oid = order.external_id
        platform_slug = order.platform.slug if order.platform else 'toters'

        # Switch phone/platform if needed, then click البدء + set pickup
        setup_order_form(page, platform_slug)

        def snap(label: str) -> None:
            try:
                path = FAILURE_DIR / f'{oid}_{label}.png'
                page.screenshot(path=str(path))
                logger.info('[laffe] Screenshot: %s', path)
            except Exception:
                pass

        # Select branch
        branch_name = self._branch_name(order)
        try:
            page.evaluate("""() => {
                const triggers = document.querySelectorAll('div.input.cursor-pointer');
                for (const el of triggers) {
                    if (el.textContent.trim() === 'اختر') {
                        el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                        el.click();
                        el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                        break;
                    }
                }
            }""")
            search = page.get_by_placeholder('ابدأ الكتابة للبحث')
            search.wait_for(state='visible', timeout=5_000)
            search.fill(branch_name)
            page.wait_for_timeout(800)
            option = page.locator('#app-teleport a').filter(has_text=branch_name).first
            option.wait_for(state='visible', timeout=5_000)
            option.click()
            page.wait_for_timeout(500)
            logger.debug('[laffe] Branch selected: %s', branch_name)
        except Exception as e:
            snap('1_branch_failed')
            raise RuntimeError(f'[laffe] Branch selection failed for {oid}: {e}') from e

        # Save order setup
        try:
            page.get_by_role('button', name='حفظ').click(force=True)
            # Wait for the menu grid (category/menu cards) to render.
            page.wait_for_selector('div.line-clamp-2[title]', timeout=8_000)
            snap('2_after_save')
        except Exception as e:
            page.wait_for_timeout(2_000)
            snap('2_after_save')

        # ── Item selection by SEARCH + price disambiguation ──────────────────
        # Foodics search finds an item regardless of its category, so we no
        # longer navigate the category grid. When the search returns several
        # cards with the SAME name, we pick the one whose price matches the
        # parsed order item's unit price. Each menu card looks like:
        #   <div title="<name>" class="line-clamp-2 …">…</div>
        #   <div class="mt-auto"><div class="font-bold text-black">IQD 7,000</div>…
        _AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')

        def _norm(s: str) -> str:
            s = re.sub(r'[\u064B-\u0652\u0670]', '', s or '')      # tashkeel
            s = s.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ـ', '')
            s = s.replace('ی', 'ي').replace('ک', 'ك')
            s = re.sub(r'\s*\(\s*', ' (', s)
            s = re.sub(r'\s*\)\s*', ') ', s)
            return re.sub(r'\s+', ' ', s).strip()

        def _price_to_int(s):
            digits = re.sub(r'[^\d]', '', (s or '').translate(_AR_DIGITS))
            return int(digits) if digits else None

        # Channel/app tags Foodics appends to per-channel listings of the SAME
        # item ("… APP", "… - توترز", "… (تطبيقات)"). They are the only part of a
        # card name ignored when matching — see _strict_key.
        _CHANNEL_TAGS = ('app', 'توترز', 'تطبيقات', 'طلبات', 'بلي', 'توصيل', 'لزو', 'يمك', 'يماك')

        def _strict_key(s: str) -> str:
            """Name used for matching: normalised (tashkeel, tatweel, alef forms,
            spacing) with trailing channel tags removed. Two names match only
            when these keys are EQUAL — no substring, prefix or fuzzy match."""
            toks = _norm(s).split()
            while len(toks) > 1 and toks[-1].strip('()').lower() in _CHANNEL_TAGS:
                toks.pop()
                if len(toks) > 1 and toks[-1] in ('-', '–'):
                    toks.pop()
            return ' '.join(toks)

        def _search_terms(raw: str):
            """Search terms to try, most-specific first. The parsed name may carry
            modifiers Foodics has no card for (e.g. 'ستيك دجاج عادي', 'وجبة ريزو
            ( صلصة بوب)'), so if the full term returns nothing we fall back to the
            base name (drop parentheticals → drop trailing 'عادي' → drop trailing
            words). Matching is always done against the FULL parsed name."""
            out = []

            def add(t):
                t = re.sub(r'\s+', ' ', (t or '')).strip()
                if t and t not in out:
                    out.append(t)

            base = (raw or '').strip()
            add(base)
            no_paren = re.sub(r'\([^)]*\)', ' ', base)            # drop ( … )
            add(no_paren)
            no_plain = re.sub(r'(^|\s)عادي(\s|$)', ' ', no_paren)  # drop the 'plain' modifier
            add(no_plain)
            words = re.sub(r'\s+', ' ', no_plain).strip().split()
            for k in range(len(words) - 1, 1, -1):                 # progressive word-trim down to 2
                add(' '.join(words[:k]))
            return out

        def _collect_cards(term: str):
            """Fill the search with `term` and return [{title, price}] for every
            item card shown. Read as plain data in one evaluate call — NOT element
            handles: the list re-renders when the filter applies, which detaches
            any handle and makes a later .click() fail."""
            try:
                sb = page.locator('input[type="search"], input[placeholder*="بحث"]').first
                sb.fill('', timeout=2_000)
                sb.fill(term, timeout=3_000)
                page.wait_for_timeout(1_100)
            except Exception:
                pass
            try:
                return page.eval_on_selector_all(
                    'div.line-clamp-2[title]',
                    "els => els.map(e => { const c = e.parentElement;"
                    " const p = c && c.querySelector('.font-bold');"
                    " return {title: e.getAttribute('title') || '', price: p ? p.textContent : ''}; })",
                ) or []
            except Exception:
                return []

        def _read_menu_cards():
            """All item cards currently shown in the menu as [{title, price}].
            Read directly — the in-menu search box doesn't reliably filter via
            automation, and every item of a menu is in the DOM, so we just read
            them all (no per-term search → much faster across menus)."""
            try:
                return page.eval_on_selector_all(
                    'div.line-clamp-2[title]',
                    "els => els.map(e => { const c = e.parentElement;"
                    " const p = c && c.querySelector('.font-bold');"
                    " return {title: e.getAttribute('title') || '', price: p ? p.textContent : ''}; })",
                ) or []
            except Exception:
                return []

        def _exact_cards(cards, name: str):
            """Cards whose name matches `name` exactly (equal _strict_key)."""
            target = _strict_key(name)
            return [c for c in cards if target and _strict_key(c.get('title')) == target]

        def _fmt_price(cp):
            return '؟' if cp is None else f'{cp:,}'

        def _goto_grid():
            """Click 'back' until we're at the top menu grid."""
            try:
                for _ in range(4):
                    back = page.locator('[id="menu.back"]')
                    if back.count() == 0:
                        break
                    back.first.click(timeout=4_000, force=True)
                    page.wait_for_timeout(500)
            except Exception:
                pass

        def _menu_titles():
            """Titles of the menu cards shown at the grid."""
            _goto_grid()
            try:
                return page.eval_on_selector_all(
                    'div.line-clamp-2[title]', "els => els.map(e => e.getAttribute('title') || '')"
                ) or []
            except Exception:
                return []

        def _enter(menu_title: str) -> bool:
            """From the grid, click into the menu with exactly this title. True if we entered it."""
            try:
                page.evaluate(_CLICK_ITEM_JS, {'title': menu_title, 'price': ''})
                page.wait_for_timeout(800)
                return page.locator('[id="menu.back"]').count() > 0
            except Exception:
                return False

        _menu_cache = {}      # menu title -> [{title, price, cp}], read once per order
        _menu_order = []      # cached ordered menu titles (default first)

        def _cache_menu(menu: str):
            """Enter `menu` once, read & cache its items. Returns [{title,price,cp}]."""
            if menu in _menu_cache:
                return _menu_cache[menu]
            _goto_grid()
            cards = []
            if _enter(menu):
                cards = [{'title': c['title'], 'price': c.get('price') or '',
                          'cp': _price_to_int(c.get('price'))} for c in _read_menu_cards()]
            _menu_cache[menu] = cards
            return cards

        def _select_and_add(name: str, target_price):
            """Find the Foodics card with the SAME name (see _strict_key) and the
            EXACT price, across all menus, and click it. Never a similar or
            partial name and never the closest price: when no card matches both,
            nothing is clicked and the result carries the reason, so the order is
            aborted and the branch notified. With no price to match, the name
            must have a single price in Foodics. Menus are cached per order; the
            default menu is searched first and the first exact card wins."""
            nonlocal _menu_order
            default = self._menu_category(order)
            if not _menu_order:
                _menu_order = [default] + [m for m in _menu_titles() if m and m != default]

            same_name = []    # (card, menu) — same name, any price
            hit = None
            for menu in _menu_order:
                for c in _exact_cards(_cache_menu(menu), name):
                    same_name.append((c, menu))
                    if hit is None and target_price is not None and c['cp'] == target_price:
                        hit = (c, menu)
                if hit:
                    break
            if hit is None and target_price is None and same_name:
                if len({c['cp'] for c, _ in same_name}) == 1 and same_name[0][0]['cp'] is not None:
                    hit = same_name[0]

            if hit is None:
                if not same_name:
                    reason = 'لا يوجد صنف بنفس الاسم في Foodics'
                elif target_price is None:
                    reason = 'لا يوجد سعر للمطابقة والصنف بأكثر من سعر في Foodics'
                else:
                    found = '، '.join(sorted({_fmt_price(c['cp']) for c, _ in same_name}))
                    reason = f'موجود في Foodics بسعر {found} فقط'
                logger.warning('[laffe] "%s" @ %s: no exact Foodics card — %s', name, target_price, reason)
                return ({'matched': False, 'title': None, 'price_text': '', 'chosen': None,
                         'chosen_price': None, 'candidates': len(same_name), 'by_price': False,
                         'exact': False, 'reason': reason}, False)

            card, menu = hit
            _goto_grid()
            clicked = _enter(menu) and _click_item(card['title'], card['price'])
            logger.info('[laffe] "%s": picked %r @ %r in menu %r (exact name + price)',
                        name, card['title'], card['price'], menu)
            return ({'matched': True, 'title': card['title'], 'price_text': card['price'],
                     'chosen': card['title'], 'chosen_price': card['cp'],
                     'candidates': len(same_name), 'by_price': len(same_name) > 1, 'exact': True,
                     'reason': '' if clicked else 'تعذّر الضغط على الصنف في Foodics'}, clicked)

        def _click_item(title: str, price_text: str) -> bool:
            """Click the chosen item card via JavaScript. Playwright's actionable
            click is unreliable here — the card's name node is matched by a hidden
            line-clamp tooltip clone and the filtered list renders late — so we
            locate the card in the DOM (by title, disambiguated by price) and fire
            a native click on its clickable ancestor. Returns True if clicked."""
            try:
                return bool(page.evaluate(_CLICK_ITEM_JS, {'title': title, 'price': price_text or ''}))
            except Exception:
                return False

        # Add each item
        failed_items = []
        picks = []  # per-item diagnostics for the dev page
        push_warnings = []  # non-fatal problems (e.g. notes not written) → branch alert

        for item in (items or []):
            # Strip internal ` APP` suffix — Foodics menu items don't carry it.
            search_name = item.name_snapshot
            if search_name.endswith(' APP'):
                search_name = search_name[:-4].strip()

            order_price = None
            try:
                if getattr(item, 'unit_price', None) is not None:
                    order_price = int(round(float(item.unit_price)))
            except Exception:
                order_price = None
            # The menu's Foodics price, when set, is the price of the exact card
            # to pick; otherwise match against the price the app charged.
            foodics_price = getattr(item, '_foodics_price', None)
            target_price = foodics_price if foodics_price is not None else order_price
            pick = {
                'item': item.name_snapshot, 'qty': item.qty, 'order_price': order_price,
                'foodics_price': foodics_price,
                'candidates': 0, 'chosen': None, 'chosen_price': None,
                'by_price': False, 'ok': False,
            }
            picks.append(pick)

            try:
                # Exact name + exact price across all menus (the same item can
                # exist in several menus at different prices). No fallback.
                res, clicked = _select_and_add(search_name, target_price)
                pick.update({
                    'candidates': res.get('candidates', 0),
                    'chosen': res.get('chosen'),
                    'chosen_price': res.get('chosen_price'),
                    'by_price': res.get('by_price', False),
                    'exact': res.get('exact', False),
                })
                if not res.get('matched') or not clicked:
                    snap(f'4_item_failed_{search_name[:20]}')
                    reason = res.get('reason') or 'تعذّر إضافة الصنف'
                    wanted = f' بسعر {_fmt_price(target_price)}' if target_price is not None else ''
                    logger.warning('[laffe] Item not added: %s%s — %s', item.name_snapshot, wanted, reason)
                    pick['reason'] = reason
                    failed_items.append(f'{item.name_snapshot}{wanted}: {reason}')
                    continue
                page.wait_for_timeout(800)

                # Check if a modal opened (has a confirm button)
                modal_open = False
                for confirm_label in ['تحديث', 'إضافة', 'إضافة إلى الطلب', 'تأكيد', 'موافق']:
                    btn = page.locator(f'button:has-text("{confirm_label}")').last
                    try:
                        if btn.is_visible(timeout=1_000):
                            modal_open = True
                            # Set qty using الكمية + button (top-right of modal)
                            if item.qty > 1:
                                qty_plus = page.locator('[id="item.increase"]')
                                for _ in range(item.qty - 1):
                                    try:
                                        qty_plus.click(timeout=1_000)
                                        page.wait_for_timeout(150)
                                    except Exception:
                                        break
                            # Fill item notes if present
                            if getattr(item, 'notes', None):
                                try:
                                    notes_input = None
                                    # Try semantic selectors first (more resilient to UI changes)
                                    for sel in [
                                        'textarea[placeholder*="ملاح"]',
                                        'input[placeholder*="ملاح"]',
                                        '#decorated-modal-body textarea',
                                        '#decorated-modal-body form > div > div > div:first-child > div:nth-child(3) textarea',
                                        '#decorated-modal-body form > div > div > div:first-child > div:nth-child(3) input',
                                    ]:
                                        try:
                                            el = page.locator(sel).first
                                            if el.is_visible(timeout=600):
                                                notes_input = el
                                                break
                                        except Exception:
                                            continue
                                    if notes_input:
                                        notes_input.fill(item.notes)
                                    else:
                                        logger.warning('[laffe] Item notes field not found for %s', item.name_snapshot)
                                        push_warnings.append(f'لم تُضف ملاحظة الصنف «{item.name_snapshot}»: {item.notes}')
                                except Exception:
                                    logger.warning('[laffe] Could not fill item notes for %s', item.name_snapshot)
                                    push_warnings.append(f'لم تُضف ملاحظة الصنف «{item.name_snapshot}»: {item.notes}')
                            btn.click()
                            page.wait_for_timeout(600)
                            break
                    except Exception:
                        continue

                if not modal_open and item.qty > 1:
                    # We're still in the menu where it was added — re-click it.
                    for _ in range(item.qty - 1):
                        if not _click_item(res['title'], res['price_text']):
                            break
                        page.wait_for_timeout(400)

                pick['ok'] = True

            except Exception:
                snap(f'4_item_failed_{search_name[:20]}')
                logger.warning('[laffe] Could not find item in Foodics menu: %s', item.name_snapshot)
                pick['ok'] = False
                failed_items.append(f'{item.name_snapshot}: خطأ أثناء إضافة الصنف في Foodics')
                continue
            logger.debug('[laffe] Added item: %s x%s', item.name_snapshot, item.qty)

        # Abort if any item was not found — navigate away without saving
        if failed_items:
            snap('4_abort_items_not_found')
            logger.warning('[laffe] Aborting order %s — items not found in menu: %s', oid, failed_items)
            try:
                page.goto(CALLCENTER_URL)
            except Exception:
                pass
            raise _ItemsNotFoundInMenu(failed_items, picks)

        # Kitchen notes
        from integrations.laffe.session import PLATFORM_CONFIG
        cfg          = PLATFORM_CONFIG.get(platform_slug, PLATFORM_CONFIG['toters'])
        source_label = cfg['source']
        id_digits    = cfg.get('id_digits')
        display_id   = oid[-id_digits:] if id_digits else oid
        kitchen_notes = f'{source_label} - {display_id}'
        if order.notes:
            kitchen_notes += f'\n{order.notes}'
        try:
            notes_field = None
            for notes_label in ['ملاحظات المطبخ*', 'ملاحظات المطبخ']:
                try:
                    f = page.get_by_role('textbox', name=notes_label, exact=True)
                    if f.first.is_visible(timeout=1_500):
                        notes_field = f.first
                        break
                except Exception:
                    continue
            if notes_field:
                notes_field.click()
                notes_field.fill(kitchen_notes)
            else:
                snap('5_notes_field_not_found')
                push_warnings.append(f'تعذّر إيجاد حقل ملاحظات المطبخ في Foodics — يرجى إضافتها يدوياً:\n{kitchen_notes}')
        except Exception:
            snap('5_notes_failed')
            logger.warning('[laffe] Could not fill notes for order %s', oid)
            push_warnings.append(f'تعذّر كتابة ملاحظات المطبخ في Foodics — يرجى إضافتها يدوياً:\n{kitchen_notes}')

        # Save the order
        try:
            _save_order(page, oid)
        except Exception as e:
            snap('6_final_save_failed')
            raise

        snap('7_done')
        pos_id = _extract_pos_id(page, oid)
        logger.info('[laffe] Order %s → Foodics ID: %s', oid, pos_id or '(unknown)')
        # Dry-run the same order through the Foodics API (creates nothing) so we
        # can compare its total with what we just entered by hand.
        shadow = _shadow_calculate(page, self._branch_name(order), items)
        return pos_id, failed_items, picks, push_warnings, shadow

    def update_order_status(self, order, new_status: str) -> POSResult:
        logger.info('[laffe] update_order_status stub: %s → %s', order.external_id, new_status)
        return POSResult(ok=True)

    def check_availability(self, item_names: list[str]) -> dict[str, bool]:
        logger.info('[laffe] check_availability stub for %d items', len(item_names))
        return {name: True for name in item_names}

    def sync_menu(self, items) -> POSResult:
        logger.info('[laffe] sync_menu stub')
        return POSResult(ok=True)

    def probe_menu(self, platform_slug='baly', terms=('ريزو', 'شاورما')):
        """DIAGNOSTIC ONLY — opens a new-order form, reaches the menu, inspects
        the search box and item cards, dumps the DOM, then navigates away WITHOUT
        saving any order. Returns a dict of findings."""
        from integrations.laffe.session import get_worker, setup_order_form, CALLCENTER_URL
        worker = get_worker(self.restaurant.id)

        def _probe(page):
            info = {}
            try:
                setup_order_form(page, platform_slug)
            except Exception as e:
                info['setup_error'] = str(e)
            branch_name = self._branch_name(None)
            try:
                page.evaluate("""() => {
                    const triggers = document.querySelectorAll('div.input.cursor-pointer');
                    for (const el of triggers) {
                        if (el.textContent.trim() === 'اختر') {
                            el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                            el.click();
                            el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                            break;
                        }
                    }
                }""")
                s = page.get_by_placeholder('ابدأ الكتابة للبحث')
                s.wait_for(state='visible', timeout=5_000)
                s.fill(branch_name)
                page.wait_for_timeout(800)
                opt = page.locator('#app-teleport a').filter(has_text=branch_name).first
                opt.wait_for(state='visible', timeout=5_000)
                opt.click()
                page.wait_for_timeout(500)
            except Exception as e:
                info['branch_error'] = str(e)
            try:
                page.get_by_role('button', name='حفظ').click(force=True)
                page.wait_for_selector('div.menu-category, [class*="category"], .item-category', timeout=8_000)
            except Exception as e:
                info['save_error'] = str(e)
            page.wait_for_timeout(1_800)
            info['cards_at_grid'] = len(page.query_selector_all('div.line-clamp-2[title]'))

            # Drill into the default menu so ITEMS (not category cards) show.
            try:
                menu = self._menu_category(None)
                page.get_by_text(menu, exact=True).first.click(timeout=4_000, force=True)
                page.wait_for_timeout(1_200)
                info['entered_menu'] = menu
                info['has_back'] = page.locator('[id="menu.back"]').count()
            except Exception as e:
                info['enter_error'] = str(e)

            sb = page.locator('input[type="search"], input[placeholder*="بحث"]')
            info['search_box_count'] = sb.count()
            try:
                info['all_inputs'] = page.eval_on_selector_all(
                    'input', 'els => els.map(e => ({ph: e.getAttribute("placeholder"), type: e.type, cls: e.className}))'
                )
            except Exception as e:
                info['inputs_error'] = str(e)
            info['cards_before'] = len(page.query_selector_all('div.line-clamp-2[title]'))
            res = {}
            for t in terms:
                try:
                    sb.first.fill('', timeout=2_000)
                    sb.first.fill(t, timeout=3_000)
                    page.wait_for_timeout(1_100)
                    cards = page.query_selector_all('div.line-clamp-2[title]')
                    res[t] = {'count': len(cards), 'titles': [c.get_attribute('title') for c in cards[:10]]}
                except Exception as e:
                    res[t] = {'error': str(e)}
            info['search_results'] = res

            # CLICK TEST — fresh-locator click (the real fix). Adds to a throwaway
            # draft only; we navigate away below WITHOUT saving any order.
            try:
                sb.first.fill('', timeout=2_000)
                sb.first.fill('بوكس كأس العالم', timeout=3_000)
                page.wait_for_timeout(1_100)
                title = 'بوكس كأس العالم (تطبيقات)'
                info['title_attr_count'] = page.locator(f'div.line-clamp-2[title="{title}"]').count()
                info['js_clicked'] = bool(page.evaluate(_CLICK_ITEM_JS, {'title': title, 'price': '24,500'}))
                page.wait_for_timeout(1_500)
                try:
                    page.screenshot(path=str(FAILURE_DIR / 'probe_click.png'))
                except Exception:
                    pass
                info['confirm_btns_after_click'] = page.locator(
                    'button:has-text("إضافة"), button:has-text("تأكيد"), button:has-text("تحديث")'
                ).count()
                try:
                    info['subtotal_area'] = page.get_by_text('المجموع الفرعي').first.locator('xpath=..').inner_text(timeout=1_500)
                except Exception:
                    pass
            except Exception as e:
                info['click_test_error'] = str(e)

            try:
                p = FAILURE_DIR / 'probe_menu.html'
                p.write_text(page.content(), encoding='utf-8')
                info['dump'] = str(p)
            except Exception as e:
                info['dump_error'] = str(e)
            try:
                page.goto(CALLCENTER_URL)  # discard the draft — no order saved
            except Exception:
                pass
            return info

        return worker.submit(_probe)

    def probe_find(self, platform_slug='toters', names=('تشيز بركر',)):
        """DIAGNOSTIC — walks every menu and reports, per name, every matching
        card + its menu + price. Navigates away without saving. Confirms where an
        exact-price variant lives across menus."""
        from integrations.laffe.session import get_worker, setup_order_form, CALLCENTER_URL
        import re as _re
        worker = get_worker(self.restaurant.id)

        def _probe(page):
            out = {'menus': [], 'found': {nm: [] for nm in names}}
            try:
                setup_order_form(page, platform_slug)
            except Exception as e:
                out['setup_error'] = str(e)
            branch_name = self._branch_name(None)
            try:
                page.evaluate("""() => { const t=document.querySelectorAll('div.input.cursor-pointer'); for (const el of t){ if(el.textContent.trim()==='اختر'){ el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); el.click(); el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); break; } } }""")
                s = page.get_by_placeholder('ابدأ الكتابة للبحث'); s.wait_for(state='visible', timeout=5_000)
                s.fill(branch_name); page.wait_for_timeout(800)
                page.locator('#app-teleport a').filter(has_text=branch_name).first.click(); page.wait_for_timeout(500)
            except Exception as e:
                out['branch_error'] = str(e)
            try:
                page.get_by_role('button', name='حفظ').click(force=True)
                page.wait_for_selector('div.line-clamp-2[title]', timeout=8_000)
            except Exception as e:
                out['save_error'] = str(e)
            page.wait_for_timeout(1_500)

            def norm(s):
                return _re.sub(r'\s+', ' ', (s or '').replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ـ', '')).strip()

            def goto_grid():
                for _ in range(4):
                    b = page.locator('[id="menu.back"]')
                    if b.count() == 0:
                        break
                    b.first.click(timeout=4_000, force=True); page.wait_for_timeout(500)

            goto_grid()
            menus = page.eval_on_selector_all('div.line-clamp-2[title]', "els=>els.map(e=>e.getAttribute('title')||'')") or []
            out['menus'] = menus
            for menu in menus:
                goto_grid()
                try:
                    page.evaluate(_CLICK_ITEM_JS, {'title': menu, 'price': ''}); page.wait_for_timeout(800)
                except Exception:
                    continue
                if page.locator('[id="menu.back"]').count() == 0:
                    continue
                cards = page.eval_on_selector_all('div.line-clamp-2[title]', "els=>els.map(e=>{const c=e.parentElement;const p=c&&c.querySelector('.font-bold');return {title:e.getAttribute('title')||'', price:p?p.textContent:''};})") or []
                for nm in names:
                    t = norm(nm)
                    for c in cards:
                        ct = norm(c.get('title'))
                        if ct == t or (t and (t in ct or ct in t)):
                            out['found'][nm].append({'menu': menu, 'title': c['title'], 'price': c['price']})
            try:
                page.goto(CALLCENTER_URL)
            except Exception:
                pass
            return out

        return worker.submit(_probe)

    def _screenshot(self, order_id: str) -> None:
        try:
            from integrations.laffe.session import _workers
            worker = _workers.get(self.restaurant.id)
            if worker:
                path = FAILURE_DIR / f'{order_id}.png'
                worker.submit(lambda page: page.screenshot(path=str(path)))
                logger.error('[laffe] Failure screenshot: %s', path)
        except Exception:
            pass
