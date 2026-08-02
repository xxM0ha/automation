"""
Foodics POS — Playwright worker thread.

Architecture:
- ONE dedicated thread per restaurant owns the Playwright browser
- All other threads (django-q workers, etc.) submit work via a thread-safe queue
- Orders are processed serially — one at a time through one browser window
- submit() blocks the caller until the work is done (or fails)
- Auto-reconnects if the browser dies between orders

Why a dedicated thread?
  Playwright's sync API is NOT thread-safe. It must be called only from the
  thread that created it. This worker thread is the only one that ever touches
  Playwright objects.

Usage (in adapter):
    worker = get_worker(restaurant_id)
    result = worker.submit(lambda page: fill_order(page, order))
"""

import os
import json
import logging
import queue
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Any
from concurrent.futures import Future

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, Page

load_dotenv(Path(__file__).parent.parent.parent / ".env")

logger = logging.getLogger('prime.laffe.session')

# ─── Config ───────────────────────────────────────────────────────────────────

FOODICS_URL    = "https://console.foodics.com"
LOGIN_URL      = f"{FOODICS_URL}/login"
CALLCENTER_URL = f"{FOODICS_URL}/today-orders"

BUSINESS_REF  = os.getenv("FOODICS_BUSINESS_REF", "634335")
EMAIL         = os.getenv("FOODICS_EMAIL", "")
PASSWORD      = os.getenv("FOODICS_PASSWORD", "")
CUSTOMER_PHONE = os.getenv("FOODICS_CUSTOMER_PHONE", "")

SESSIONS_DIR = Path(__file__).parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

_SHUTDOWN = object()   # Sentinel to stop the worker thread

# ─── Worker ───────────────────────────────────────────────────────────────────

class PlaywrightWorker:
    """
    Owns a single Playwright browser in a dedicated thread.
    Accepts callables via submit() from any thread, runs them serially.
    """

    def __init__(self, restaurant_id: int):
        self.restaurant_id = restaurant_id
        self._queue: queue.Queue = queue.Queue()
        self._thread = threading.Thread(
            target=self._run,
            name=f'playwright-restaurant-{restaurant_id}',
            daemon=True,
        )
        self._thread.start()
        logger.info('[worker] Started Playwright thread for restaurant %s', restaurant_id)

    def submit(self, fn: Callable[[Page], Any], timeout: int = 280) -> Any:
        """
        Submit work from any thread. Blocks until fn(page) completes.
        Raises the exception if fn raised one.
        """
        future: Future = Future()
        self._queue.put((future, fn))
        return future.result(timeout=timeout)

    def stop(self) -> None:
        """Gracefully shut down the worker thread."""
        self._queue.put(_SHUTDOWN)
        self._thread.join(timeout=10)
        logger.info('[worker] Playwright thread stopped for restaurant %s', self.restaurant_id)

    def _run(self) -> None:
        """
        Main loop — runs entirely in the dedicated Playwright thread.
        Creates the browser once, processes jobs forever, reconnects on failure.
        """
        pw = None
        browser = None
        context = None
        page = None

        def boot():
            nonlocal pw, browser, context, page
            logger.info('[worker] Booting browser for restaurant %s', self.restaurant_id)
            pw = sync_playwright().start()
            browser = pw.chromium.launch(headless=True)
            session_file = SESSIONS_DIR / f'restaurant_{self.restaurant_id}.json'
            if session_file.exists():
                logger.debug('[worker] Loading saved cookies')
                context = browser.new_context(storage_state=str(session_file))
            else:
                logger.debug('[worker] Fresh context — no saved cookies')
                context = browser.new_context()
            page = context.new_page()
            _ensure_logged_in(page, context, self.restaurant_id)
            _navigate_to_idle(page)
            logger.info('[worker] Browser ready for restaurant %s', self.restaurant_id)

        def teardown():
            nonlocal pw, browser, context, page
            try:
                if context:
                    state = context.storage_state()
                    session_file = SESSIONS_DIR / f'restaurant_{self.restaurant_id}.json'
                    session_file.write_text(json.dumps(state))
                if context:  context.close()
                if browser:  browser.close()
                if pw:       pw.stop()
            except Exception as e:
                logger.warning('[worker] Teardown error: %s', e)
            pw = browser = context = page = None

        boot()

        while True:
            item = self._queue.get()

            if item is _SHUTDOWN:
                teardown()
                break

            future, fn = item

            # Reconnect if browser died between jobs
            try:
                page.title()
            except Exception:
                logger.warning('[worker] Browser died — reconnecting for restaurant %s', self.restaurant_id)
                teardown()
                try:
                    boot()
                except Exception as e:
                    future.set_exception(e)
                    continue

            # Execute the work
            try:
                result = fn(page)
                future.set_result(result)
            except Exception as e:
                logger.exception('[worker] Job failed for restaurant %s', self.restaurant_id)
                future.set_exception(e)
                # Try to recover back to idle state
                try:
                    _navigate_to_idle(page)
                except Exception:
                    # Can't recover — tear down so next job triggers a fresh boot
                    logger.warning('[worker] Cannot recover idle state — will reconnect on next job')
                    teardown()
                continue

            # Return to idle state for the next order
            try:
                _navigate_to_idle(page)
            except Exception as e:
                logger.warning('[worker] Failed to reset to idle: %s — will reconnect on next job', e)
                teardown()


# ─── Registry ─────────────────────────────────────────────────────────────────

_workers: dict[int, PlaywrightWorker] = {}
_registry_lock = threading.Lock()


def get_worker(restaurant_id: int) -> PlaywrightWorker:
    """Get the worker for this restaurant, creating it if it doesn't exist."""
    with _registry_lock:
        if restaurant_id not in _workers:
            _workers[restaurant_id] = PlaywrightWorker(restaurant_id)
        return _workers[restaurant_id]


def warm_up(restaurant_id: int) -> None:
    """Pre-create the worker so the first order doesn't wait for browser boot."""
    get_worker(restaurant_id)


def shutdown_all() -> None:
    with _registry_lock:
        workers = list(_workers.values())
        _workers.clear()
    for w in workers:
        w.stop()


# ─── Playwright helpers (run only inside the worker thread) ───────────────────

def _ensure_logged_in(page: Page, context, restaurant_id: int) -> None:
    page.goto(CALLCENTER_URL)
    page.wait_for_load_state("domcontentloaded")

    if "/login" in page.url:
        logger.info('[worker] Logging in to Foodics...')
        page.goto(LOGIN_URL)
        page.wait_for_load_state("networkidle")
        page.get_by_role("textbox", name="123456").fill(BUSINESS_REF)
        page.get_by_role("textbox", name="address@foodics.com").fill(EMAIL)
        page.locator("input[name='password']").fill(PASSWORD)
        page.locator("input[name='password']").press("Enter")

        try:
            page.wait_for_url(lambda url: "/login" not in url, timeout=30_000)
        except Exception:
            page.screenshot(path=str(SESSIONS_DIR / f'login_failed_{restaurant_id}.png'))
            raise RuntimeError(f'[worker] Login failed — see sessions/login_failed_{restaurant_id}.png')

        # Save cookies
        state = context.storage_state()
        (SESSIONS_DIR / f'restaurant_{restaurant_id}.json').write_text(json.dumps(state))
        logger.info('[worker] Login successful, session saved.')
    else:
        logger.debug('[worker] Session still valid, skipping login.')


# Per-platform phone number and Foodics source name
PLATFORM_CONFIG = {
    'toters': {'phone': CUSTOMER_PHONE, 'source': 'توترز',  'id_digits': None},
    'yammak': {'phone': '07711111114',  'source': 'يمك',    'id_digits': 3},
    'tiptop': {'phone': '07711111111',  'source': 'تب توب', 'id_digits': 3},
    'lezzo':  {'phone': '07711111112',  'source': 'ليزو',   'id_digits': 3},
    'baly':   {'phone': '07711111115',  'source': 'بلي',    'id_digits': 3},
}


def _dismiss_popups(page: Page) -> None:
    """
    Close any blocking modal/announcement that overlays today-orders and would
    otherwise intercept the click on the call-center button.

    The current culprit is Foodics' "تذكير بتجديد الاشتراك" (subscription-renewal
    reminder) whose CTA is id='alert.confirm' ("بالتأكيد، سأفعل ذلك"). We try the
    known confirm button, then a generic modal close, then Escape — all
    best-effort, so a clean page is a harmless no-op.
    """
    # The modal renders ~2-3s AFTER load (async), so we must WAIT for it to
    # appear rather than checking once immediately. First pass waits up to 4s
    # for the mask; a short second pass catches a stacked modal.
    timeout = 4_000
    for _ in range(2):
        try:
            page.locator('.modal-mask').first.wait_for(state='visible', timeout=timeout)
        except Exception:
            return  # no (further) modal appeared — page is clear
        clicked = False
        for sel in (
            "[id='alert.confirm']",
            "button:has-text('بالتأكيد، سأفعل ذلك')",
        ):
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1_000):
                    btn.click(timeout=2_500)
                    clicked = True
                    logger.debug('[worker] Dismissed popup via %s', sel)
                    break
            except Exception:
                continue
        if not clicked:
            # Generic fallback: close button, then Escape.
            try:
                close = page.locator(
                    "[role='dialog'] button[aria-label*='close' i], "
                    ".modal-mask button[aria-label*='إغلاق']"
                ).first
                if close.is_visible(timeout=600):
                    close.click(timeout=1_500)
                else:
                    page.keyboard.press('Escape')
            except Exception:
                try: page.keyboard.press('Escape')
                except Exception: pass
        # Wait for the mask to actually go away before proceeding.
        try:
            page.locator('.modal-mask').first.wait_for(state='hidden', timeout=4_000)
        except Exception:
            pass
        timeout = 1_000  # a stacked modal would already be present


def _navigate_to_idle(page: Page) -> None:
    """
    Bring the page to modal-ready state: headset modal open, default توترز phone filled.
    Does NOT click البدء — _fill_order() handles platform switching + البدء + pickup.
    """
    # Navigate away from any order form — go back to today-orders
    page.goto(CALLCENTER_URL)
    page.wait_for_load_state("domcontentloaded")

    # Close any blocking modal (e.g. subscription-renewal reminder) first, or it
    # intercepts the call-center click and the whole push times out.
    _dismiss_popups(page)

    # Open headset modal
    page.get_by_role("button", name="headset_mic").click()
    page.wait_for_selector("#decorated-modal-body", timeout=10_000)

    # Pre-fill default phone
    phone_input = page.locator("#decorated-modal-body").get_by_role("textbox")
    phone_input.wait_for(state="visible", timeout=10_000)
    phone_input.fill(CUSTOMER_PHONE)

    # Pre-select توترز as default
    page.locator("a").filter(has_text="توترز").first.wait_for(state="visible", timeout=10_000)
    page.locator("a").filter(has_text="توترز").first.click()
    logger.debug('[worker] Idle state reached — modal open, توترز pre-selected.')


def setup_order_form(page: Page, platform_slug: str = 'toters') -> None:
    """
    Switch phone/platform in the open modal if needed, then click البدء and set pickup.
    Must be called while the headset modal is still open (i.e. right after _navigate_to_idle).
    """
    config = PLATFORM_CONFIG.get(platform_slug, PLATFORM_CONFIG['toters'])
    phone       = config['phone']
    source_name = config['source']

    # Switch phone + platform only if not the default
    if platform_slug != 'toters':
        phone_input = page.locator("#decorated-modal-body").get_by_role("textbox")
        phone_input.fill(phone)
        page.locator("a").filter(has_text=source_name).first.wait_for(state="visible", timeout=10_000)
        page.locator("a").filter(has_text=source_name).first.click()
        logger.debug('[worker] Switched to %s / %s', source_name, phone)

    # Click البدء بطلب جديد
    try:
        btn = page.get_by_role("button", name="البدء بطلب جديد")
        btn.wait_for(state="visible", timeout=5_000)
        btn.click()
        logger.debug('[worker] Clicked البدء بطلب جديد.')
    except Exception:
        pass

    # Set order type to pickup
    order_type = page.get_by_label("نوع الطلب**")
    order_type.wait_for(state="visible", timeout=10_000)
    order_type.select_option("2")
    logger.debug('[worker] Order form ready — pickup selected.')


# ─── CLI test ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import time
    logging.basicConfig(level=logging.DEBUG)

    RESTAURANT_ID = 1

    print("[test] Starting worker (boots browser)...")
    warm_up(RESTAURANT_ID)
    time.sleep(2)  # Let boot finish

    print("[test] Submitting two orders from different threads...")
    results = {}

    def fake_order(order_num: int):
        print(f"[test] Order {order_num}: queued, waiting for browser...")
        worker = get_worker(RESTAURANT_ID)
        def work(page: Page):
            print(f"[test] Order {order_num}: has the browser — simulating 3s of form filling...")
            page.wait_for_timeout(3_000)
            print(f"[test] Order {order_num}: done.")
            return f"pos-id-{order_num}"
        result = worker.submit(work)
        results[order_num] = result
        print(f"[test] Order {order_num}: result = {result}")

    t1 = threading.Thread(target=fake_order, args=(1,))
    t2 = threading.Thread(target=fake_order, args=(2,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    print(f"\n[test] Both done. Results: {results}")
    print("[test] Browser staying open. Press Ctrl+C to exit.")

    try:
        worker = get_worker(RESTAURANT_ID)
        # Keep alive
        while worker._thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[test] Shutting down...")
        shutdown_all()
