"""
Test script: runs the full Foodics order flow headlessly,
stops and screenshots just before _save_order().
"""
import os, sys, json, logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path('/root/PrimeAutomation/backend/.env'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('test')

FOODICS_URL     = 'https://console.foodics.com'
LOGIN_URL       = f'{FOODICS_URL}/login'
CALLCENTER_URL  = f'{FOODICS_URL}/today-orders'
BUSINESS_REF    = os.getenv('FOODICS_BUSINESS_REF', '634335')
EMAIL           = os.getenv('FOODICS_EMAIL', '')
PASSWORD        = os.getenv('FOODICS_PASSWORD', '')
CUSTOMER_PHONE  = os.getenv('FOODICS_CUSTOMER_PHONE', '077111111')
SESSIONS_DIR    = Path('/root/PrimeAutomation/backend/integrations/laffe/sessions')
SESSIONS_DIR.mkdir(exist_ok=True)
SCREENSHOT_PATH = Path('/root/PrimeAutomation/backend/logs/test_order_state.png')

TEST_ITEMS       = ['ريزو']
RESTAURANT_NAME  = 'zohor'  # options: 'zohor', 'riz', 'ziraee'

def get_branch(restaurant_name: str) -> str:
    n = restaurant_name.lower()
    if any(k in n for k in ('ziraee', 'زراعي', 'zira')):
        return 'الزراعي'
    return 'المصارف'  # zohor, riz, default

def get_menu_category(restaurant_name: str) -> str:
    n = restaurant_name.lower()
    if any(k in n for k in ('riz', 'رز', 'rice')):
        return 'منيو تطبيقات RIZ'
    return 'منيو التطبيقات'

BRANCH = get_branch(RESTAURANT_NAME)

from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        session_file = SESSIONS_DIR / 'restaurant_1.json'
        viewport = {'width': 1440, 'height': 900}
        if session_file.exists():
            log.info('Loading saved session...')
            context = browser.new_context(storage_state=str(session_file), viewport=viewport)
        else:
            context = browser.new_context(viewport=viewport)
        page = context.new_page()

        # ── Login if needed ───────────────────────────────────────────────
        page.goto(CALLCENTER_URL)
        page.wait_for_load_state('domcontentloaded')
        if '/login' in page.url:
            log.info('Logging in...')
            page.goto(LOGIN_URL)
            page.wait_for_load_state('networkidle')
            page.get_by_role('textbox', name='123456').fill(BUSINESS_REF)
            page.get_by_role('textbox', name='address@foodics.com').fill(EMAIL)
            page.locator("input[name='password']").fill(PASSWORD)
            page.locator("input[name='password']").press('Enter')
            page.wait_for_url(lambda url: '/login' not in url, timeout=30_000)
            state = context.storage_state()
            session_file.write_text(json.dumps(state))
            log.info('Login OK, session saved.')
        else:
            log.info('Session still valid.')

        # ── Navigate to idle state ────────────────────────────────────────
        log.info('Navigating to idle state...')
        if CALLCENTER_URL not in page.url:
            page.goto(CALLCENTER_URL)
            page.wait_for_load_state('domcontentloaded')

        page.get_by_role('button', name='headset_mic').click()
        page.wait_for_selector('#decorated-modal-body', timeout=10_000)
        phone_input = page.locator('#decorated-modal-body').get_by_role('textbox')
        phone_input.wait_for(state='visible', timeout=10_000)
        phone_input.fill(CUSTOMER_PHONE)
        page.locator('a').filter(has_text='توترز').first.wait_for(state='visible', timeout=10_000)
        page.locator('a').filter(has_text='توترز').first.click()
        try:
            btn = page.get_by_role('button', name='البدء بطلب جديد')
            btn.wait_for(state='visible', timeout=5_000)
            btn.click()
        except Exception:
            pass
        order_type = page.get_by_label('نوع الطلب**')
        order_type.wait_for(state='visible', timeout=10_000)
        order_type.select_option('2')
        log.info('Idle state reached.')

        # ── Screenshot idle state for debugging ──────────────────────────
        page.screenshot(path='/root/PrimeAutomation/backend/logs/idle_state.png')
        log.info('Idle state screenshot saved.')

        # ── Select branch ─────────────────────────────────────────────────
        log.info('Selecting branch: %s', BRANCH)
        page.wait_for_timeout(1_000)
        # Use JS to click the branch trigger (Vue component won't respond to force click)
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
        page.wait_for_timeout(1_500)
        page.screenshot(path='/root/PrimeAutomation/backend/logs/branch_dropdown.png')
        log.info('Branch dropdown screenshot saved.')
        # Type in the dropdown search box, then click the option inside #app-teleport
        search = page.get_by_placeholder('ابدأ الكتابة للبحث')
        search.wait_for(state='visible', timeout=5_000)
        search.fill(BRANCH)
        page.wait_for_timeout(800)
        # Options render as <a> tags inside #app-teleport — click the first match
        option = page.locator('#app-teleport a').filter(has_text=BRANCH).first
        option.wait_for(state='visible', timeout=5_000)
        option.click()
        page.wait_for_timeout(500)
        log.info('Branch selected.')
        page.screenshot(path='/root/PrimeAutomation/backend/logs/after_branch.png')
        log.info('After-branch screenshot saved. URL: %s', page.url)

        # ── Save customer/order setup ─────────────────────────────────────
        log.info('Saving order setup...')
        page.wait_for_timeout(600)
        page.get_by_role('button', name='حفظ').click(force=True)
        log.info('Clicked حفظ.')
        page.wait_for_timeout(3_000)

        # ── Open correct menu category for this restaurant ────────────────
        menu_category = get_menu_category(RESTAURANT_NAME)
        log.info('Opening menu category: %s', menu_category)
        page.wait_for_timeout(1_500)
        page.screenshot(path='/root/PrimeAutomation/backend/logs/after_save.png')
        log.info('Current URL: %s', page.url)
        # Try multiple selectors for the menu category tile
        clicked_cat = False
        for attempt in [
            lambda: page.get_by_text(menu_category, exact=True).first.click(timeout=8_000, force=True),
            lambda: page.locator('div').filter(has_text=menu_category).nth(2).click(timeout=8_000, force=True),
            lambda: page.locator(f'text={menu_category}').first.click(timeout=8_000, force=True),
        ]:
            try:
                attempt()
                clicked_cat = True
                log.info('Menu category clicked.')
                break
            except Exception as ex:
                log.warning('Category click attempt failed: %s', ex)
        if not clicked_cat:
            page.screenshot(path='/root/PrimeAutomation/backend/logs/menu_not_found.png')
            log.error('Could not click menu category — screenshot saved.')
        page.wait_for_timeout(500)

        # ── Add test items ────────────────────────────────────────────────
        for item_name in TEST_ITEMS:
            try:
                log.info('Adding item: %s', item_name)
                page.get_by_text(item_name, exact=True).first.click()
                page.wait_for_timeout(600)
                # If a modifier/options modal appeared, confirm it to add the item
                for confirm_label in ['إضافة', 'إضافة إلى الطلب', 'تأكيد', 'موافق']:
                    try:
                        btn = page.get_by_role('button', name=confirm_label)
                        if btn.first.is_visible(timeout=1_000):
                            btn.first.click()
                            page.wait_for_timeout(400)
                            log.info('Confirmed item via "%s"', confirm_label)
                            break
                    except Exception:
                        continue
            except Exception as e:
                log.warning('Could not add item %s: %s', item_name, e)

        # ── Screenshot BEFORE save (the step we are skipping) ────────────
        log.info('Taking screenshot before save step...')
        page.screenshot(path=str(SCREENSHOT_PATH), full_page=False)
        log.info('Screenshot saved to: %s', SCREENSHOT_PATH)
        log.info('TEST COMPLETE — save step was intentionally skipped.')

        context.close()
        browser.close()

if __name__ == '__main__':
    run()
