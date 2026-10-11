"""Read-only client for the Foodics console's own API.

The console (console.foodics.com) drives itself through `/core-api/...` calls
using the logged-in session cookie. The Playwright bot already holds that
session, so we issue the SAME calls from inside a logged-in page instead of
clicking through the UI. Requests made from the page carry its cookies and its
Cloudflare clearance, which a plain HTTP client would not have.

Step 1 of replacing the UI automation: pull the product catalogue, so every ORDO
menu item can be pinned to a Foodics `product_id` instead of being matched by
name and price off the screen.

This module NEVER logs in and NEVER writes: if the saved session has expired it
raises SessionExpired and stops, so it cannot trigger Foodics' bot protection
the way repeated logins did.

Run standalone (no Django needed):
    venv/bin/python integrations/laffe/foodics_api.py --restaurant 1 \
        --out /tmp/foodics_products.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

FOODICS_URL = "https://console.foodics.com"
CALLCENTER_URL = f"{FOODICS_URL}/today-orders"
SESSIONS_DIR = Path(__file__).parent / "sessions"

# The listing endpoint the console uses; `url` selects the resource and the rest
# mirrors the console's own query so we get identical payloads.
_PRODUCTS_QUERY = (
    "/core-api/select-listing?url=/products"
    "&include[]=branches&include[]=category&include[]=groups&include[]=modifiers"
    "&include[]=tax_group&include[]=discounts&include[]=tags&include[]=ingredients"
    "&filters[is_deleted]=false&with_total=true&page={page}"
)
_BRANCHES_QUERY = (
    "/core-api/select-listing?url=/branches"
    "&include[]=delivery_zones&include[]=cities&filters[is_deleted]=false&with_total=true"
)

# Fetch executed INSIDE the page, exactly like the console's own XHRs.
_FETCH_JS = """async (path) => {
  const r = await fetch(path, {
    credentials: 'same-origin',
    headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = text.slice(0, 500); }
  return {status: r.status, body: body};
}"""


# POST executed inside the page, like the console's own writes. The CSRF token
# comes from the page's meta tag, falling back to the XSRF-TOKEN cookie.
_POST_JS = """async (args) => {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const cookie = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/) || [])[1];
  const token = (meta && meta.content) || (cookie ? decodeURIComponent(cookie) : '');
  const r = await fetch(args.path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': token,
    },
    body: JSON.stringify(args.body),
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = text.slice(0, 500); }
  return {status: r.status, body: body};
}"""


class SessionExpired(RuntimeError):
    """The saved Foodics session is no longer valid. We stop instead of logging
    in — a fresh login is what tripped Cloudflare before."""


def _get_json(page, path: str):
    res = page.evaluate(_FETCH_JS, path)
    if res["status"] != 200:
        raise RuntimeError(f"Foodics {path.split('?')[0]} → HTTP {res['status']}: {str(res['body'])[:200]}")
    return res["body"]


def _slim_product(p: dict) -> dict:
    """Keep the fields we need to pin items; drop the console's bulk."""
    cat = p.get("category") or {}
    return {
        "id": p.get("id"),
        "name": p.get("name"),
        "sku": p.get("sku"),
        "price": p.get("price"),
        "is_active": p.get("is_active"),
        "is_ready": p.get("is_ready"),
        "category": {"id": cat.get("id"), "name": cat.get("name")},
        "modifiers": [
            {"id": m.get("id"), "name": m.get("name"), "is_required": m.get("is_required")}
            for m in (p.get("modifiers") or [])
        ],
        # Per-branch overrides: pivot.price is that branch's price (null = base).
        "branches": [
            {
                "id": b.get("id"),
                "name": b.get("name"),
                "price": (b.get("pivot") or {}).get("price"),
                "is_active": (b.get("pivot") or {}).get("is_active"),
                "is_in_stock": (b.get("pivot") or {}).get("is_in_stock"),
            }
            for b in (p.get("branches") or [])
        ],
    }


def fetch_catalogue(restaurant_id: int = 1, headless: bool = True) -> dict:
    """Pull branches + every product using restaurant_id's saved session."""
    session_file = SESSIONS_DIR / f"restaurant_{restaurant_id}.json"
    if not session_file.exists():
        raise SessionExpired(f"no saved session at {session_file}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        context = browser.new_context(storage_state=str(session_file))
        page = context.new_page()
        try:
            page.goto(CALLCENTER_URL, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_timeout(1_500)
            if "/login" in page.url:
                raise SessionExpired(
                    "Foodics redirected to the login page — the saved session has expired. "
                    "Not logging in automatically; a fresh login needs your go-ahead."
                )

            branches = (_get_json(page, _BRANCHES_QUERY) or {}).get("data") or []

            products, page_no, last_page = [], 1, 1
            while page_no <= last_page:
                payload = _get_json(page, _PRODUCTS_QUERY.format(page=page_no)) or {}
                products += payload.get("data") or []
                meta = payload.get("meta") or {}
                last_page = meta.get("last_page") or 1
                page_no += 1

            return {
                "fetched_at": datetime.now().isoformat(timespec="seconds"),
                "session_used": session_file.name,
                "branches": [
                    {"id": b.get("id"), "name": b.get("name"), "reference": b.get("reference")}
                    for b in branches
                ],
                "product_count": len(products),
                "products": [_slim_product(p) for p in products],
            }
        finally:
            context.close()
            browser.close()


def branch_id(page, branch_name: str):
    """Foodics UUID of a branch, by its display name."""
    target = (branch_name or '').strip()
    for b in (_get_json(page, _BRANCHES_QUERY) or {}).get('data') or []:
        if (b.get('name') or '').strip() == target:
            return b.get('id')
    return None


def order_products(lines):
    """Order lines as the console sends them.

    `lines` is [(product_id, quantity, unit_price)]. `item_unique_id` mirrors
    the console: the product id with the line's position appended, which keeps
    two lines of the same product distinct.
    """
    return [
        {
            'product_id': pid,
            'item_unique_id': f'{pid}{i}',
            'quantity': qty,
            'unit_price': price,
            'options': [],
        }
        for i, (pid, qty, price) in enumerate(lines, start=1)
    ]


def calculate(page, branch, lines):
    """Price an order through Foodics WITHOUT creating it.

    `/orders_calculator` returns the totals Foodics would apply. Nothing is
    written — this is the dry run we compare against the browser push.
    """
    payload = {
        'type': '2',
        'branch_id': branch,
        'status': 1,
        'charges': [],
        'products': order_products(lines),
        'combos': [],
    }
    return page.evaluate(_POST_JS, {
        'path': '/core-api/creating',
        'body': {'url': '/orders_calculator', 'payload': payload},
    })


def customer_id(page, phone: str):
    """Customer UUID for an app's phone. The console queries WITHOUT the leading
    zero (07711111113 → 7711111113); the padded form matches nothing."""
    for variant in dict.fromkeys([(phone or '').strip().lstrip('0'), (phone or '').strip()]):
        if not variant:
            continue
        rows = (_get_json(page, f'/core-api/select-listing?url=/customers&filters[phone]={variant}&page=1')
                or {}).get('data') or []
        exact = [c for c in rows if (c.get('phone') or '') == variant]
        if len(exact) == 1:
            return exact[0]['id']
        if len(rows) == 1:
            return rows[0]['id']
    return None


def user_id_by_email(page, email: str):
    """UUID of the Foodics user we are logged in as. There is no /users/me
    endpoint (404), so we match our login's email in the user list."""
    target = (email or '').strip().lower()
    for pg in range(1, 8):
        rows = (_get_json(page, f'/core-api/select-listing?url=/users&page={pg}') or {}).get('data') or []
        if not rows:
            return None
        for u in rows:
            if (u.get('email') or '').strip().lower() == target:
                return u['id']
    return None


def new_order_id(page):
    return (_get_json(page, '/generate-uuid') or {}).get('uuid')


def order_payload(*, order_id, idempotency_key, branch, customer, creator,
                  lines, kitchen_notes, opened_at):
    """The create-order body, field for field as the console sends it.

    `lines` is [(product_id, quantity, unit_price, item_notes)]. We carry no
    discounts or charges — no captured order has ever used them.
    """
    products, subtotal = [], 0
    for i, (pid, qty, price, notes) in enumerate(lines, start=1):
        total = qty * price
        subtotal += total
        line = {
            'product_id': pid,
            'item_unique_id': f'{pid}{i}',
            'quantity': qty,
            'unit_price': price,
            'discount_amount': 0,
            'tax_exclusive_discount_amount': 0,
            'tax_exclusive_total_price': total,
            'total_price': total,
            'tax_exclusive_unit_price': price,
            'is_non_revenue': False,
            'status': 1,
            'added_at': opened_at,
        }
        if notes:
            line['kitchen_notes'] = notes
        products.append(line)

    return {
        'id': order_id,
        'idempotency_key': idempotency_key,
        'type': '2',            # pickup — constant in every captured order
        'guests': 1,
        'status': 1,
        'source': 3,            # call centre
        'opened_at': opened_at,
        'kitchen_notes': kitchen_notes,
        'customer_notes': '',
        'creator_id': creator,
        'tax_exclusive_discount_amount': 0,
        'discount_amount': 0,
        'total_price': subtotal,
        'subtotal_price': subtotal,
        'rounding_amount': 0,
        'branch_id': branch,
        'customer_id': customer,
        'products': products,
        'meta': {'foodics': {'device_id': None}},
    }


def create_order(page, payload):
    """Create the order in Foodics. Returns the raw {status, body} response."""
    return page.evaluate(_POST_JS, {
        'path': '/core-api/creating',
        'body': {'url': '/orders', 'payload': payload},
    })


def order_exists(page, order_id):
    """True if an order with this UUID is already in Foodics.

    Checked before any fallback: if a create call times out or errors after the
    order was actually written, re-entering it through the browser would give
    the branch the same order twice.
    """
    try:
        res = _get_json(page, f'/core-api/select-getting?url=/orders&id={order_id}')
        data = (res or {}).get('data') or {}
        return bool(data.get('id')), data.get('reference')
    except Exception:
        return False, None


def main() -> int:
    ap = argparse.ArgumentParser(description="Pull the Foodics product catalogue (read-only).")
    ap.add_argument("--restaurant", type=int, default=1, help="whose saved session to use (1/2/3)")
    ap.add_argument("--out", default="/tmp/foodics_catalogue.json")
    args = ap.parse_args()

    try:
        data = fetch_catalogue(args.restaurant)
    except SessionExpired as e:
        print(f"SESSION EXPIRED — nothing fetched, nothing changed.\n   {e}")
        return 2

    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"branches: {[b['name'] for b in data['branches']]}")
    print(f"products: {data['product_count']} → {args.out}")

    active = sum(1 for p in data["products"] if p["is_active"])
    with_mods = sum(1 for p in data["products"] if p["modifiers"])
    required_mods = sum(1 for p in data["products"] if any(m["is_required"] for m in p["modifiers"]))
    print(f"active: {active} | with modifiers: {with_mods} | with a REQUIRED modifier: {required_mods}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
