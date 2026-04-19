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
from integrations.laffe.session import get_worker

logger = logging.getLogger('prime.laffe.adapter')

FAILURE_DIR = Path(__file__).parent.parent.parent / 'logs' / 'laffe-failures'
FAILURE_DIR.mkdir(parents=True, exist_ok=True)

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
            worker = get_worker(self.restaurant.id)
            pos_id = worker.submit(lambda page: self._fill_order(page, order))
            return POSResult(ok=True, external_id=pos_id)

        except Exception as e:
            self._screenshot(order.external_id)
            logger.exception('[laffe] push_order failed for %s', order.external_id)
            return POSResult(ok=False, error=str(e))

    def _fill_order(self, page, order) -> str:
        """
        Fill the order form in Foodics.
        At entry: page is at idle state (pickup selected, توترز chosen).
        At exit: order is saved, Foodics order ID returned.
        """
        # Select branch
        branch_name = self.credentials.get('branch_name', 'المصارف')
        page.locator("div").filter(has_text="اختر").nth(1).click()
        page.locator("a").filter(has_text=branch_name).first.click()
        logger.debug('[laffe] Branch selected: %s', branch_name)

        # Save the customer / order setup form
        page.get_by_role("button", name="حفظ").click()
        page.wait_for_timeout(1_000)

        # Open the menu
        page.locator("div").filter(has_text="منيو التطبيقات").nth(2).click()
        page.wait_for_timeout(500)

        # Add each item
        for item in order.order_items.all():
            try:
                page.get_by_text(item.name_snapshot, exact=True).click()
                page.wait_for_timeout(300)
                # Close item modifier modal if it appears
                try:
                    page.get_by_role("button", name="close").click()
                    page.wait_for_timeout(300)
                except Exception:
                    pass
                logger.debug('[laffe] Added item: %s x%s', item.name_snapshot, item.qty)
            except Exception:
                logger.warning('[laffe] Could not find item in Foodics menu: %s', item.name_snapshot)

        # Add kitchen notes if any
        if order.notes:
            try:
                notes_field = page.get_by_role("textbox", name="ملاحظات المطبخ*")
                notes_field.click()
                notes_field.fill(order.notes)
            except Exception:
                logger.warning('[laffe] Could not fill notes for order %s', order.external_id)

        # Save the order — tries known button labels until one works
        _save_order(page, order.external_id)

        # Extract Foodics order ID from the post-save page state
        pos_id = _extract_pos_id(page, order.external_id)
        logger.info('[laffe] Order %s → Foodics ID: %s', order.external_id, pos_id or '(unknown)')
        return pos_id

    def update_order_status(self, order, new_status: str) -> POSResult:
        logger.info('[laffe] update_order_status stub: %s → %s', order.external_id, new_status)
        return POSResult(ok=True)

    def check_availability(self, item_names: list[str]) -> dict[str, bool]:
        logger.info('[laffe] check_availability stub for %d items', len(item_names))
        return {name: True for name in item_names}

    def sync_menu(self, items) -> POSResult:
        logger.info('[laffe] sync_menu stub')
        return POSResult(ok=True)

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
