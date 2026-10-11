"""Read-only Foodics menu dump for the items report.

Runs ON the qcluster worker (enqueue with async_task) so it uses the same browser
session as order pushes and never opens a second Foodics login. Opens a new-order
form, walks every menu (and one level of sub-menus), reads each card's title and
price, and leaves without saving — the worker resets itself to idle after every
job. Never raises, so django-q won't retry it.
"""
import json
import logging
import time
from pathlib import Path

logger = logging.getLogger('prime.integrations')

_READ_CARDS = (
    "els => els.map(e => { const c = e.parentElement; const p = c && c.querySelector('.font-bold');"
    " return {title: (e.getAttribute('title') || '').trim(), price: p ? p.textContent.trim() : ''}; })"
)

# Click a card only when exactly one card has this exact title. Never substring:
# a menu name can be contained in an item name (see order 852).
_CLICK_EXACT = """(t) => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const els = [...document.querySelectorAll('div.line-clamp-2[title]')]
    .filter(e => norm(e.getAttribute('title')) === norm(t));
  if (els.length !== 1) return els.length;
  const card = els[0].closest('.cursor-pointer') || els[0].parentElement || els[0];
  card.click();
  return 1;
}"""


def run_dump(restaurant_slug, out_path, platform_slug='toters'):
    result = {'restaurant': restaurant_slug, 'started': time.strftime('%Y-%m-%d %H:%M:%S')}
    try:
        from restaurants.models import Restaurant
        from integrations.laffe.adapter import LaffeAdapter
        from integrations.laffe.session import get_worker, setup_order_form, _dismiss_popups
        restaurant = Restaurant.objects.get(slug=restaurant_slug)
        branch_name = LaffeAdapter(restaurant, {})._branch_name(None)
        result['branch'] = branch_name
        result.update(get_worker(restaurant.id).submit(
            lambda page: _walk(page, platform_slug, branch_name, setup_order_form, _dismiss_popups),
            timeout=540,
        ))
    except Exception as e:
        result['error'] = repr(e)
        logger.exception('[menu-dump] failed for %s', restaurant_slug)
    result['finished'] = time.strftime('%Y-%m-%d %H:%M:%S')
    try:
        Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    except Exception:
        logger.exception('[menu-dump] failed to write %s', out_path)
    return out_path


def _walk(page, platform_slug, branch_name, setup_order_form, dismiss_popups):
    out = {'menus': [], 'problems': []}

    # Same entry path as an order push / probe_find: platform → branch → save setup.
    setup_order_form(page, platform_slug)
    page.evaluate("""() => { const t = document.querySelectorAll('div.input.cursor-pointer');
      for (const el of t) { if (el.textContent.trim() === 'اختر') {
        el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); el.click();
        el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true})); break; } } }""")
    search = page.get_by_placeholder('ابدأ الكتابة للبحث')
    search.wait_for(state='visible', timeout=5_000)
    search.fill(branch_name)
    page.wait_for_timeout(800)
    page.locator('#app-teleport a').filter(has_text=branch_name).first.click()
    page.wait_for_timeout(500)
    page.get_by_role('button', name='حفظ').click(force=True)
    page.wait_for_selector('div.line-clamp-2[title]', timeout=8_000)
    page.wait_for_timeout(1_500)
    dismiss_popups(page)  # the renewal reminder renders after this save

    back = page.locator('[id="menu.back"]')

    def read():
        return page.eval_on_selector_all('div.line-clamp-2[title]', _READ_CARDS) or []

    def titles():
        return [c['title'] for c in read()]

    def close_stray_modal():
        """An unpriced card that was really an item opens its item window.
        Close it without adding anything."""
        modal = page.locator('#decorated-modal-body')
        if modal.count() and modal.first.is_visible():
            page.keyboard.press('Escape')
            page.wait_for_timeout(500)
            if modal.count() and modal.first.is_visible():
                try:
                    page.locator('button:has-text("إغلاق")').last.click(timeout=2_000)
                    page.wait_for_timeout(500)
                except Exception:
                    pass
            return True
        return False

    def go_top():
        for _ in range(6):
            if back.count() == 0:
                return True
            back.first.click(timeout=4_000, force=True)
            page.wait_for_timeout(600)
        return back.count() == 0

    def enter(title):
        before = titles()
        n = page.evaluate(_CLICK_EXACT, title)
        if n != 1:
            return f'no unique card ({n})'
        page.wait_for_timeout(900)
        if close_stray_modal():
            return 'is an item, not a menu'
        return 'ok' if titles() != before else 'nothing changed'

    if not go_top():
        out['problems'].append('could not reach the top menu grid')
        return out
    top = titles()
    out['top_grid'] = top

    for menu in top:
        if not go_top():
            out['problems'].append(f'{menu}: could not return to the menu grid')
            continue
        state = enter(menu)
        if state != 'ok':
            out['problems'].append(f'{menu}: {state}')
            continue
        cards = read()
        entry = {'menu': menu, 'items': [c for c in cards if c['price']], 'submenus': []}
        for sub in [c['title'] for c in cards if not c['price']]:
            st = enter(sub)
            if st == 'ok':
                sc = read()
                entry['submenus'].append({
                    'name': sub,
                    'items': [c for c in sc if c['price']],
                    'unpriced': [c['title'] for c in sc if not c['price']],
                })
                back.first.click(timeout=4_000, force=True)
                page.wait_for_timeout(700)
            else:
                entry['submenus'].append({'name': sub, 'state': st})
        out['menus'].append(entry)
    return out
