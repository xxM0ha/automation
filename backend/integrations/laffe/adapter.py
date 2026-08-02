"""
Laffe Restaurant — Foodics POS adapter (Playwright-based).

Uses the singleton session from session.py.
One browser, one lock — orders are processed serially, never in parallel.
When Foodics provides a real API, replace _fill_order() with HTTP calls.
The BasePOSAdapter interface stays the same.
"""
import logging
import re
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

# Finds the menu item card by title (disambiguated by closest price among
# same-name cards) and fires a native click on its clickable ancestor. Used
# instead of a Playwright click because the card name is mirrored by a hidden
# line-clamp tooltip clone and the filtered list renders late, both of which
# break Playwright's actionability checks.
_CLICK_ITEM_JS = r"""(args) => {
  const norm = s => (s||'').replace(/[أإآ]/g,'ا').replace(/ـ/g,'').replace(/\s+/g,' ').trim();
  const pdig = s => { const d=(s||'').replace(/[^\d]/g,''); return d?parseInt(d,10):null; };
  const want = norm(args.title);
  const wp = pdig(args.price);
  const els = Array.from(document.querySelectorAll('div.line-clamp-2[title]'));
  let cands = els.filter(e => norm(e.getAttribute('title')) === want);
  if (!cands.length) cands = els.filter(e => { const n = norm(e.getAttribute('title')); return n && (n.includes(want) || want.includes(n)); });
  if (!cands.length) return false;
  let chosen = cands[0];
  if (cands.length > 1 && wp != null) {
    chosen = cands.map(e => { const c=e.parentElement; const p=c&&c.querySelector('.font-bold'); return {e, pv: pdig(p?p.textContent:'')}; })
                  .sort((a,b)=>Math.abs((a.pv==null?1e12:a.pv)-wp)-Math.abs((b.pv==null?1e12:b.pv)-wp))[0].e;
  }
  const card = chosen.closest('.cursor-pointer') || chosen.parentElement || chosen;
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
            worker = get_worker(self.restaurant.id)
            result = worker.submit(lambda page: self._fill_order(page, order, items))
            if isinstance(result, tuple):
                pos_id = result[0]
                failed_items = result[1] if len(result) > 1 else []
                picks = result[2] if len(result) > 2 else []
            else:
                pos_id, failed_items, picks = result, [], []
            return POSResult(
                ok=True, external_id=pos_id, failed_items=failed_items,
                raw={'method': 'search_price', 'picks': picks},
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

    def _fill_order(self, page, order, items=None) -> str:
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
        from difflib import SequenceMatcher

        _AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')

        def _norm(s: str) -> str:
            s = (s or '').replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ـ', '')
            return re.sub(r'\s+', ' ', s).strip()

        def _price_to_int(s):
            digits = re.sub(r'[^\d]', '', (s or '').translate(_AR_DIGITS))
            return int(digits) if digits else None

        # Channel/app tags Foodics appends to per-channel listings of the SAME
        # item (e.g. "… APP", "… - توترز", "… توصيل"). Stripping them lets a true
        # variant compare equal to the base name; a card that still differs after
        # stripping is a DIFFERENT product (e.g. "فنكر رز - توترز" vs "فنكر").
        _CHANNEL_TAGS = ('app', 'توترز', 'طلبات', 'بلي', 'توصيل', 'لزو', 'يمك', 'يماك')

        def _name_kind(s: str):
            """(match_base, had_channel_tag) for a normalised title — match_base is
            the title with trailing channel tags and flavour parentheticals removed,
            so per-channel listings of one item collapse to the same base."""
            def strip_ch(toks):
                had = False
                while toks and toks[-1].lower() in _CHANNEL_TAGS:
                    toks.pop()
                    had = True
                    if toks and toks[-1] in ('-', '–'):
                        toks.pop()
                return toks, had
            toks, had1 = strip_ch(s.split())
            base = re.sub(r'\([^)]*\)', ' ', ' '.join(toks))
            toks2, had2 = strip_ch(base.split())
            return re.sub(r'\s+', ' ', ' '.join(toks2)).strip(), (had1 or had2)

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

        def _candidates_tiered(cards, name: str):
            """Name-matching cards as [(tier, card)] — tier 0 = exact name,
            1 = suffix variant ("<name> …"), 2 = substring either way, 3 = fuzzy.
            Lower tier = better name match (used as the price tie-breaker)."""
            target = _norm(name)
            out = []
            for c in cards:
                t = _norm(c.get('title'))
                if t == target:
                    tier = 0
                elif t.startswith(target + ' '):
                    tier = 1
                elif target and (target in t or t in target):
                    tier = 2
                elif SequenceMatcher(None, target, t).ratio() >= 0.82:
                    tier = 3
                else:
                    continue
                out.append((tier, c))
            return out

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
            """From the grid, click into a menu by title. True if we entered it."""
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

        def _select_and_add(name: str, order_price):
            """Find the item ACROSS menus and click it. Ranks candidates by
            (different-product?, price distance, name-match tier):
              1. A DIFFERENT product — a card carrying a channel/app tag whose
                 identity still differs from the target after the tag is stripped
                 (e.g. "فنكر رز - توترز" for "فنكر") — is demoted below every
                 exact/true-variant match, so it can NEVER win on price alone.
              2. Among the rest, the closest PRICE wins; ties break to the closest
                 NAME tier — so a "… APP"/"… - توترز" listing of the SAME item still
                 beats a wrong-priced exact, and plain 'شاورما' vs 'لفي شاورما'
                 (no channel tag) is unchanged.
            Menus are cached per order; we stop early only on a perfect (exact name
            + exact price) match."""
            nonlocal _menu_order
            default = self._menu_category(order)
            if not _menu_order:
                _menu_order = [default] + [m for m in _menu_titles() if m and m != default]

            tgt_base = _name_kind(_norm(name))[0]

            pool = []   # (demote, price_diff, tier, n_in_menu, card, menu)
            for menu in _menu_order:
                tiered = _candidates_tiered(_cache_menu(menu), name)
                if not tiered:
                    continue
                n = len(tiered)
                perfect = False
                for tier, c in tiered:
                    diff = (abs((c['cp'] if c['cp'] is not None else 10**12) - order_price)
                            if order_price is not None else 0)
                    cbase, had_tag = _name_kind(_norm(c['title']))
                    demote = 1 if (had_tag and cbase != tgt_base) else 0
                    pool.append((demote, diff, tier, n, c, menu))
                    if order_price is not None and diff == 0 and tier == 0:
                        perfect = True
                if perfect:
                    break       # exact name + exact price — nothing can beat it
                if order_price is None:
                    break       # no price to match → first menu with a name match

            if not pool:
                return ({'matched': False, 'title': None, 'price_text': '', 'chosen': None,
                         'chosen_price': None, 'candidates': 0, 'by_price': False, 'exact': False}, False)

            pool.sort(key=lambda x: (x[0], x[1], x[2]))   # different-product, price, tier
            demote, diff, tier, n, card, menu = pool[0]
            exact = (order_price is not None and diff == 0)

            _goto_grid()
            _enter(menu)
            clicked = _click_item(card['title'], card['price'])
            logger.info('[laffe] "%s": picked %r @ %r (tier %d, %s) in menu %r',
                        name, card['title'], card['price'], tier,
                        'exact price' if exact else 'closest', menu)
            return ({'matched': True, 'title': card['title'], 'price_text': card['price'],
                     'chosen': card['title'], 'chosen_price': card['cp'],
                     'candidates': n, 'by_price': n > 1, 'exact': exact}, clicked)

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
            pick = {
                'item': item.name_snapshot, 'qty': item.qty, 'order_price': order_price,
                'candidates': 0, 'chosen': None, 'chosen_price': None,
                'by_price': False, 'ok': False,
            }
            picks.append(pick)

            try:
                # Search across menus for the item, preferring an EXACT price
                # match (the same item can exist in several menus at different
                # prices); clicks it. Falls back to the closest price.
                res, clicked = _select_and_add(search_name, order_price)
                pick.update({
                    'candidates': res.get('candidates', 0),
                    'chosen': res.get('chosen'),
                    'chosen_price': res.get('chosen_price'),
                    'by_price': res.get('by_price', False),
                })
                if not res.get('matched') or not clicked:
                    snap(f'4_item_failed_{search_name[:20]}')
                    logger.warning(
                        '[laffe] Item not added: %s (matched=%s, chosen=%r)',
                        item.name_snapshot, res.get('matched'), res.get('chosen'),
                    )
                    failed_items.append(item.name_snapshot)
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
                                except Exception:
                                    logger.warning('[laffe] Could not fill item notes for %s', item.name_snapshot)
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
                failed_items.append(item.name_snapshot)
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
                try:
                    from notifications_app.models import Notification
                    Notification.objects.create(
                        restaurant=order.restaurant,
                        title=f'تحذير — طلب #{oid} لم تُضف ملاحظات المطبخ',
                        body=f'تعذّر إيجاد حقل ملاحظات المطبخ في Foodics.\nيرجى إضافة الملاحظة يدوياً:\n\n{kitchen_notes}',
                        type='alert',
                        related_order=order,
                    )
                except Exception:
                    logger.exception('[laffe] Failed to create notes-missing notification for order %s', oid)
        except Exception:
            snap('5_notes_failed')
            logger.warning('[laffe] Could not fill notes for order %s', oid)

        # Save the order
        try:
            _save_order(page, oid)
        except Exception as e:
            snap('6_final_save_failed')
            raise

        snap('7_done')
        pos_id = _extract_pos_id(page, oid)
        logger.info('[laffe] Order %s → Foodics ID: %s', oid, pos_id or '(unknown)')
        return pos_id, failed_items, picks

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
