# PrimeAutomation Backend — Implementation Plan

> **For the implementing agent (Sonnet):** Read this entire file before writing any code. Read `backend.md` (reference architecture from a previous project) and `api.md` (reference endpoint pattern) in this same folder. Read the frontend at `../frontend/src/types/index.ts` and `../frontend/src/data/mockData.ts` — the backend data shapes MUST match the frontend types exactly. The Playwright-based Foodics integration already exists at `integrations/laffe/session.py` — do not rewrite it, build on top of it.

---

## Critical Context (read first)

### What this product is
- **Multi-tenant SaaS** — one backend serves many restaurants. Every DB query must be scoped by `restaurant_id`. Never return another tenant's data.
- **Middleman between delivery platforms and restaurant POS systems.** Orders flow: `Toters/Talabat/etc → Our API → POS (Foodics via Playwright, for now)`.
- Must support bi-directional communication — we reject orders (out of stock, restaurant closed) before they hit the POS, and we push accepted orders to the POS.
- Starting restaurant: **Laffe** (brand: توترز). Starting POS: **Foodics** (scraped via Playwright until their API is available).

### What lives where
- `frontend/` — React 19 + TS + Vite. Uses mock data today. Will replace mock imports with API calls. Arabic RTL throughout.
- `backend/` — Django 6 + DRF (what you're building).
- `backend/integrations/laffe/session.py` — working Playwright session for Foodics. Persists via `session_state.json`. Has `get_ready_page()` and `teardown()`. Reuse it.

### Non-negotiable rules
1. **Match frontend types exactly.** Fields like `customer_name`, `status` enums (`'جديد' | 'مقبول' | 'قيد التحضير' | 'مكتمل'`), `platformId`, etc. must serialize to the shapes in `frontend/src/types/index.ts`. Don't invent new field names.
2. **Tenant isolation at the base level** — every ViewSet filters `queryset.filter(restaurant=request.user.restaurant)`. Don't rely on developers remembering; enforce in a base class.
3. **Never log credentials.** Logger must redact `password`, `secret`, `token` keys.
4. **Webhooks are the endpoints that mutate reality** (POS orders, platform notifications). Treat them with more care than normal API calls — they're idempotent, signed, and logged verbatim.
5. **Don't block HTTP requests on Playwright.** Webhook returns fast; POS push happens in a background worker.

---

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Django 6.0 + Django REST Framework 3.17 |
| DB | SQLite (dev) → PostgreSQL (prod), toggled via `USE_POSTGRES` env |
| Auth | DRF TokenAuth (frontend) + SessionAuth (admin panel) |
| Scraping | Playwright (Chromium) — already set up |
| Background jobs | `django-q2` (simpler than Celery, works with SQLite) |
| Env config | `python-dotenv` — already installed |
| Real-time | HTTP polling in v1; Django Channels later |
| Credential encryption | `cryptography.fernet`, key in env |

**Install commands** to run when you reach phases that need them:
```bash
pip install django-q2 django-cors-headers cryptography
```

---

## Phase 0 — Foundation

**Goal:** bootable project, clean config, logs, CORS, auth plumbing ready.

### 0.1 `prime_automation/settings.py`
- Load `.env` at top of file via `python-dotenv`
- `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS` from env with safe dev defaults
- `INSTALLED_APPS` additions: `rest_framework`, `rest_framework.authtoken`, `corsheaders`, `django_q`, plus our apps: `restaurants`, `integrations`, `orders`, `menu`, `notifications`
- Middleware order: `corsheaders.middleware.CorsMiddleware` first, then Django defaults, then our custom `ApiCsrfExemptMiddleware` (exempts `/api/` paths)
- `DATABASES` — SQLite by default, PostgreSQL if `USE_POSTGRES=true`. Set `CONN_MAX_AGE=600` on both.
- `REST_FRAMEWORK` config:
  - `DEFAULT_AUTHENTICATION_CLASSES`: Token + Session
  - `DEFAULT_PERMISSION_CLASSES`: `IsAuthenticated`
  - `DEFAULT_THROTTLE_RATES`: `anon: 100/hour`, `user: 1000/hour`, `webhook: 500/min`
  - Pagination: PageNumberPagination, page_size=50
- `CORS_ALLOWED_ORIGINS` from env (dev: `http://localhost:5173`)
- Logging: rotating file handler at `logs/django.log` (10MB × 5), error log at `logs/errors.log`, verbose formatter, prefix convention: use `logger = logging.getLogger('prime.<app>')` and always tag messages like `[orders] new order received`

### 0.2 `.env` additions
Extend existing `.env.example` with:
```
SECRET_KEY=...
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
USE_POSTGRES=False
CORS_ALLOWED_ORIGINS=http://localhost:5173
FERNET_KEY=               # generated at setup, used to encrypt POS credentials
```
Ship a `scripts/generate_fernet_key.py` one-liner for dev convenience.

### 0.3 Root URL routing
- `prime_automation/urls.py` → `path('admin/', admin.site.urls)` + `path('api/', include('api.urls'))`
- Create a thin `api/urls.py` that `include`s each app's urls under its prefix.

### 0.4 Health check
- `GET /api/health/` → `{"status": "ok", "version": "...", "env": "dev|prod"}`
- Unauthenticated, for load balancers and sanity checks.

### 0.5 Custom CSRF-exempt middleware
- Exempts `/api/**` from CSRF (Token auth handles security)
- Keeps `/admin/` fully CSRF-protected
- Mirror pattern from `backend.md` section about `api/middleware.py`

**Verification:** `python manage.py runserver` boots without errors. `curl http://localhost:8000/api/health/` returns 200.

---

## Phase 1 — Core Data Models

**Goal:** schema that matches frontend types + supports multi-tenancy from day one.

> **Read first:** `frontend/src/types/index.ts` and `frontend/src/data/mockData.ts`. The `Order`, `MenuItem`, `LiveActivityItem`, `Notification` shapes there are the contract.

### 1.1 `restaurants` app
```python
class Restaurant(models.Model):
    name        = CharField(max_length=200)
    slug        = SlugField(unique=True)
    is_active   = BooleanField(default=True)
    created_at  = DateTimeField(auto_now_add=True)
    # timezone, locale, currency if ever needed — don't add until used

class RestaurantUser(models.Model):
    restaurant  = FK(Restaurant, on_delete=CASCADE, related_name='members')
    user        = FK(settings.AUTH_USER_MODEL, on_delete=CASCADE)
    role        = CharField(choices=[('admin','admin'),('kitchen','kitchen')])
    class Meta: unique_together = [('restaurant', 'user')]

class RestaurantPOS(models.Model):
    restaurant            = OneToOne(Restaurant, on_delete=CASCADE)
    pos_type              = CharField(choices=[('foodics','foodics'), ...])
    credentials_encrypted = BinaryField()   # Fernet-encrypted JSON
    last_session_at       = DateTimeField(null=True)
```

Helper on `User`: `user.current_restaurant` — from `RestaurantUser` lookup; cache on request.

### 1.2 `integrations` app (platforms)
```python
class Platform(models.Model):          # Global catalog — seeded, read-only
    slug       = CharField(unique=True)  # toters, talabat, tiptop, talabaty, yammak, lezzo, baly
    name_ar    = CharField(...)
    color      = CharField(...)          # hex
    logo_path  = CharField(...)

class RestaurantPlatform(models.Model):  # Per-restaurant connection
    restaurant      = FK(Restaurant, on_delete=CASCADE)
    platform        = FK(Platform, on_delete=PROTECT)
    is_connected    = BooleanField(default=False)
    webhook_secret  = CharField(...)     # auto-generated, for HMAC verification
    auto_accept     = BooleanField(default=False)
    menu_sync       = BooleanField(default=True)
    config          = JSONField(default=dict)   # platform-specific opaque config
    last_sync_at    = DateTimeField(null=True)
    class Meta: unique_together = [('restaurant', 'platform')]
```

### 1.3 `orders` app
```python
class Order(models.Model):
    STATUS = [('new','جديد'),('accepted','مقبول'),('preparing','قيد التحضير'),
              ('ready','جاهز'),('delivered','مكتمل'),('cancelled','ملغي'),('rejected','مرفوض')]

    restaurant       = FK(Restaurant, on_delete=CASCADE)
    platform         = FK(Platform, on_delete=PROTECT)
    external_id      = CharField(...)         # Platform's order ID
    pos_external_id  = CharField(null=True)   # Foodics' order ID after push
    status           = CharField(choices=STATUS, default='new')
    customer_name    = CharField(...)
    customer_phone   = CharField(...)
    address          = TextField(blank=True)
    notes            = TextField(blank=True)
    total            = DecimalField(max_digits=10, decimal_places=2)
    rejection_reason = TextField(blank=True)
    raw_payload      = JSONField()            # Original webhook body for audit
    created_at       = DateTimeField(auto_now_add=True)
    accepted_at      = DateTimeField(null=True)
    delivered_at     = DateTimeField(null=True)
    class Meta:
        unique_together = [('platform', 'external_id')]   # idempotency
        indexes = [Index(fields=['restaurant','status','-created_at'])]

class OrderItem(models.Model):
    order          = FK(Order, related_name='items', on_delete=CASCADE)
    menu_item      = FK('menu.MenuItem', null=True, on_delete=SET_NULL)
    name_snapshot  = CharField(...)     # Frozen at order time
    qty            = PositiveIntegerField()
    unit_price     = DecimalField(...)
    notes          = TextField(blank=True)
```

### 1.4 `menu` app
```python
class MenuCategory(models.Model):
    restaurant = FK(Restaurant, on_delete=CASCADE)
    name_ar    = CharField(...)
    sort_order = IntegerField(default=0)

class MenuItem(models.Model):
    STATUS = [('active','نشط'),('hidden','مخفي')]
    restaurant    = FK(Restaurant, on_delete=CASCADE)
    category      = FK(MenuCategory, null=True, on_delete=SET_NULL)
    name          = CharField(...)
    price         = DecimalField(...)
    description   = TextField(blank=True)
    image         = CharField(blank=True)     # URL or base64 path — start with URL
    tag           = CharField(blank=True)     # "الأكثر مبيعاً" etc.
    status        = CharField(choices=STATUS, default='active')
    is_available  = BooleanField(default=True)
    stock_level   = IntegerField(null=True)   # null = unlimited
    created_at    = DateTimeField(auto_now_add=True)

class MenuItemPlatform(models.Model):         # Per-platform override
    menu_item      = FK(MenuItem, related_name='platform_mappings', on_delete=CASCADE)
    platform       = FK(Platform, on_delete=PROTECT)
    platform_name  = CharField(blank=True)    # Override display name on that platform
    platform_price = DecimalField(null=True)  # Override price
    is_synced      = BooleanField(default=False)
    class Meta: unique_together = [('menu_item','platform')]
```

### 1.5 `notifications` app
```python
class Notification(models.Model):
    TYPE = [('order','order'),('alert','alert'),('system','system')]
    restaurant     = FK(Restaurant, on_delete=CASCADE)
    user           = FK(settings.AUTH_USER_MODEL, null=True, on_delete=CASCADE)  # null = broadcast
    title          = CharField(...)
    body           = TextField()
    type           = CharField(choices=TYPE)
    is_read        = BooleanField(default=False)
    related_order  = FK('orders.Order', null=True, on_delete=SET_NULL)
    created_at     = DateTimeField(auto_now_add=True)
```

### 1.6 Seeds & fixtures
- Management command: `python manage.py seed_platforms` — inserts the 7 platforms with matching slugs, colors, and `name_ar` from `frontend/src/data/platforms.ts`.
- Management command: `python manage.py seed_demo` — creates one demo restaurant, one admin user, one kitchen user, connects all platforms, loads the menu items from `mockData.ts` so the frontend can hit a working backend immediately.

**Verification:** `python manage.py migrate` + `seed_platforms` + `seed_demo` → Django admin shows populated tables.

---

## Phase 2 — Authentication

### 2.1 Login / logout / me
- `POST /api/auth/login/` → body `{email, password}` → `{token, user: {id, email, name}, role, restaurant: {id, name, slug}}`
- `POST /api/auth/logout/` → deletes token
- `GET /api/auth/me/` → same shape as login response minus token

Use email as username. Either override `authenticate()` or extend `AbstractUser` with unique email. Decision: extend `AbstractUser`, override `USERNAME_FIELD = 'email'`, set `REQUIRED_FIELDS = ['first_name']`. Do this before any migrations run on the default User model, so a fresh project is fine.

### 2.2 Base permission + ViewSet
Create `api/base.py`:
```python
class TenantScopedViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    def get_queryset(self):
        return super().get_queryset().filter(restaurant=self.request.user.current_restaurant)
    def perform_create(self, serializer):
        serializer.save(restaurant=self.request.user.current_restaurant)
```
Every resource ViewSet inherits from this. **No manual filtering anywhere else.**

### 2.3 Role permissions
- `IsRestaurantAdmin` — `request.user.current_restaurant_role == 'admin'`
- `IsRestaurantMember` — any role in that restaurant
- Apply `IsRestaurantAdmin` to reports, platform settings, menu mutations. `IsRestaurantMember` to order reads/status updates.

**Verification:** Two users from two restaurants cannot see each other's orders. Write one test for this — it's the most important invariant in the system.

---

## Phase 3 — Read API

All endpoints return data **serialized to match frontend types exactly**. Keep `platformId` (camelCase) where the frontend uses it — DRF has `source=` for this. Or apply a global camelCase renderer — decide once, stick with it. Recommendation: use `djangorestframework-camel-case` installed globally.

### 3.1 Orders
- `GET /api/orders/` — filter: `status`, `platform`, `search` (customer name/phone/id), `date_from/date_to`. Paginated.
- `GET /api/orders/:id/`
- `GET /api/orders/live/` — last 20 orders, for dashboard activity feed. Match `LiveActivityItem` shape.
- `GET /api/orders/stats/` — `{active: N, preparing: N, completed_today: N, avg_prep_minutes: X}`

### 3.2 Menu
- `GET /api/menu/` — items with nested `platform_mappings`
- `GET /api/menu/categories/`
- `GET /api/menu/:id/`

### 3.3 Platforms
- `GET /api/platforms/` — all platforms + `is_connected` + per-platform stats (orders today, last sync)
- `GET /api/platforms/:slug/` — details + config

### 3.4 Reports
- `GET /api/reports/summary/?range=today|7d|30d` — KPIs
- `GET /api/reports/velocity/?range=today|7d` — time series for charts
- `GET /api/reports/platforms/` — breakdown for pie chart (matches `OrderSourceItem` shape)
- `GET /api/reports/top-items/` — matches `topSellingItems` in mockData

### 3.5 Notifications
- `GET /api/notifications/` — for current user + broadcasts, with `unread_count`
- `PATCH /api/notifications/:id/read/`
- `POST /api/notifications/read-all/`

---

## Phase 4 — Write API

### 4.1 Orders
- `PATCH /api/orders/:id/status/` — body `{status}`. Validates transitions via a state machine:
  - `new → accepted | rejected`
  - `accepted → preparing | cancelled`
  - `preparing → ready | cancelled`
  - `ready → delivered`
  - Anything else → 400
- `POST /api/orders/:id/reject/` — body `{reason}`. Sets status=rejected, notifies platform (see Phase 6).

### 4.2 Menu
- `POST /api/menu/` — matches the Add Item modal's submit shape (name, category_id, image, platforms list, platform_names map)
- `PATCH /api/menu/:id/`
- `PATCH /api/menu/:id/availability/` — toggle
- `DELETE /api/menu/:id/`
- `POST /api/menu/:id/sync/` — trigger push to connected platforms (background job)

### 4.3 Platforms
- `PATCH /api/platforms/:slug/connect/` — body `{is_connected}`
- `POST /api/platforms/:slug/sync/` — manual menu resync
- `PATCH /api/platforms/:slug/settings/` — update auto_accept, menu_sync, config

---

## Phase 5 — Integration Layer

**Goal:** isolate each POS/platform's quirks behind a common interface.

### 5.1 Base adapter
`integrations/base/pos_adapter.py`:
```python
class BasePOSAdapter(ABC):
    def __init__(self, restaurant: Restaurant, credentials: dict): ...
    @abstractmethod
    def push_order(self, order: Order) -> 'POSResult': ...
    @abstractmethod
    def update_order_status(self, order: Order, status: str) -> 'POSResult': ...
    @abstractmethod
    def check_availability(self, item_names: list[str]) -> dict[str, bool]: ...
    @abstractmethod
    def sync_menu(self, items: QuerySet['MenuItem']) -> 'POSResult': ...

@dataclass
class POSResult:
    ok: bool
    external_id: str | None = None
    error: str | None = None
    raw: dict | None = None
```

### 5.2 Laffe (Foodics) adapter
- `integrations/laffe/adapter.py` implements `BasePOSAdapter`
- Methods **reuse** `session.py`'s `get_ready_page()` for the Playwright page object
- `push_order` flow (mirror the codegen recording but parameterized):
  1. `get_ready_page()` — already navigated to today-orders + phone modal + phone filled + توترز selected + البدء بطلب جديد + نوع الطلب pickup
  2. Open branch selector → select branch (from config)
  3. Save customer form
  4. Open menu, for each `OrderItem`: find item, click add, handle modifiers/notes
  5. Save order
  6. Extract Foodics order ID from URL or page → return as `external_id`
- Any step fails → screenshot to `logs/laffe-failures/{order_id}.png`, return `POSResult(ok=False)`

### 5.3 Session management
- **One Playwright browser per restaurant**, lived in a module-level singleton (`LAFFE_SESSIONS: dict[restaurant_id, SessionHandle]`). Warm-up on first use.
- Background health check job every 10 min pings the session; if dead, relogin.
- All adapter calls use a `threading.Lock` per session — Playwright is single-threaded per context.
- Session state file `session_state.json` stays in `integrations/laffe/sessions/{restaurant_slug}.json`.

### 5.4 Factory
```python
def get_adapter(restaurant: Restaurant) -> BasePOSAdapter:
    pos = restaurant.restaurantpos
    creds = decrypt(pos.credentials_encrypted)
    registry = {'foodics': LaffeAdapter}   # extend here as new POS come online
    return registry[pos.pos_type](restaurant, creds)
```

---

## Phase 6 — Webhook Receivers (Platforms → Us)

### 6.1 Endpoints
```
POST /api/webhooks/<platform_slug>/<restaurant_slug>/
```
One route, polymorphic dispatch by `platform_slug`.

### 6.2 Security
- Header `X-Webhook-Signature: <hmac-sha256 of body, keyed with RestaurantPlatform.webhook_secret>`
- Reject with 401 if signature missing or wrong
- Rate limit: 500/min per IP (DRF throttle class)
- Max body: 10MB (not 100MB — orders aren't that large; reject larger as suspicious)

### 6.3 Pipeline
```
receive()
  verify signature
  log raw payload with [{platform}:{restaurant}] prefix, redact any card/token fields
  dispatch to platform serializer:
    → parse into normalized OrderDraft
  validate:
    → every item maps to an active, available MenuItem? 
    → stock levels sufficient?
  if invalid:
    return 200 {"status":"rejected", "reason": "...", "items": [...]}
    DO NOT create an Order row. Do create a Notification (type=alert).
  if valid:
    create Order(status=new, raw_payload=body) — use unique_together (platform, external_id) for idempotency
    create OrderItems
    enqueue push_to_pos job
    create Notification (type=order)
    return 200 {"status":"accepted", "order_id": external_id}
```

### 6.4 Platform serializers
- `integrations/toters/serializer.py`, `integrations/talabat/serializer.py`, etc.
- Each exports `parse_webhook(payload: dict, restaurant: Restaurant) -> OrderDraft`
- `OrderDraft` is a dataclass, not a Django model — parsing produces a draft, validation checks it, only then do we persist.

### 6.5 Sending responses back to platforms
Separate from webhook receive. When a kitchen accepts/rejects/completes an order, the adapter calls the platform's API to update status. Not all platforms have this yet — stub it per platform, make it a no-op where unknown, log clearly.

---

## Phase 7 — Background Jobs (django-q2)

### 7.1 Setup
- Add `django_q` to INSTALLED_APPS, run `python manage.py migrate`
- Config: ORM broker (uses same DB, no Redis dependency early on)
- Start worker: `python manage.py qcluster` (and document in README)

### 7.2 Jobs
| Job | Trigger | Behavior |
|-----|---------|----------|
| `push_order_to_pos(order_id)` | Queued from webhook | Calls adapter.push_order; on success updates order.pos_external_id + status=accepted; on failure retries 3× with exponential backoff, then marks order rejected + notifies |
| `sync_menu_to_platform(restaurant_id, platform_slug)` | Queued from menu sync button | Walks menu items, calls adapter.sync_menu |
| `keepalive_laffe_sessions()` | Scheduled every 10 min | Touches every active Laffe session |
| `poll_pos_for_orders(restaurant_id)` | Scheduled (optional) | Fallback when webhooks unreliable |

### 7.3 Idempotency
Every job must be safe to run twice. Use the order's `pos_external_id` as the "already pushed" flag.

---

## Phase 8 — Real-time to Frontend

**v1: polling.** Frontend polls `/api/orders/live/` every 5s. Backend returns `ETag` / `Last-Modified` so client can skip unchanged responses.

**v2 (only when needed):** Django Channels + WebSockets, one channel group per restaurant. New order → broadcast to that restaurant's connected clients. Don't build this yet.

---

## Phase 9 — Admin & Ops

### 9.1 Django admin
- Register every model with `list_display`, `list_filter`, `search_fields`, `date_hierarchy`
- Custom admin actions:
  - Orders: "Push to POS", "Mark delivered", "Export CSV"
  - MenuItem: "Mark out of stock", "Resync to platforms"

### 9.2 Runtime feature flags
```python
class Setting(models.Model):
    restaurant = FK(Restaurant, null=True)    # null = global
    key        = CharField(db_index=True)
    value      = JSONField()
    class Meta: unique_together = [('restaurant','key')]
```
Helper: `get_setting('auto_accept_enabled', restaurant=r, default=False)`

### 9.3 Audit log
- `AuditLog(restaurant, user, action, target_model, target_id, before, after, at)`
- Hook via signals: Order status changes, MenuItem edits, RestaurantPlatform connect/disconnect

---

## Phase 10 — Security hardening

- Encrypt all POS credentials with Fernet (`FERNET_KEY` in env)
- Webhook HMAC verification (6.2)
- DRF throttling (configured in 0.1)
- Django security settings from `backend.md` §10 — enable when `DEBUG=False`
- CORS restricted to frontend domain in prod
- Redact sensitive keys in logger — custom filter

---

## Build order (do this exactly)

1. Phase 0 — bootable, health check works
2. Phase 1.1 + 1.2 + 1.3 (models only; skip menu and notifications until phase 3)
3. Phase 2 — auth, custom user model, TenantScopedViewSet, **write the cross-tenant isolation test**
4. Phase 1.4 + 1.5 + seeds (1.6)
5. Phase 3.1 — Orders list/detail. Point the frontend at it. Verify OrdersPage renders real data end-to-end.
6. Phase 3.2–3.5 — remaining reads, each paired with the frontend page it unblocks.
7. Phase 4 — writes.
8. Phase 5.1 + 5.2 — Laffe adapter. Test push_order manually via Django shell.
9. Phase 6 — webhook for Toters only, end-to-end: webhook → validate → order created → job queued → adapter pushes to Foodics → status updated.
10. Phase 6 expanded to remaining 6 platforms (each is a new serializer).
11. Phase 7 jobs fully wired.
12. Phase 9 admin polish.
13. Phase 10 hardening when moving to prod.

---

## Implementation conventions (for Sonnet)

- **Small commits.** One phase sub-section per commit. Never bundle "models + views + tests" in one commit.
- **Tests:** minimum one test per endpoint, **plus** the cross-tenant isolation test in Phase 2 — that one is required. Use `pytest-django` or Django's TestCase — either is fine; pick one and stick.
- **Serializers:** one serializer per use case (`OrderListSerializer`, `OrderDetailSerializer`, `OrderCreateSerializer`). Don't overload a single serializer with many contexts.
- **No business logic in views or serializers.** Views orchestrate; business logic lives in service functions (`orders/services.py`, `menu/services.py`). This is what makes swapping HTTP for job workers easy later.
- **Transitions go through `orders/services.py::transition_status(order, new_status, actor)`** — one place that enforces the state machine, creates audit log, fires notification.
- **Don't modify `session.py`.** Consume it. If you need changes, add a new function beside it and explain why.
- **Don't hardcode restaurant or platform slugs in Python.** Resolve via DB lookups.
- **Arabic strings in the DB, not in code.** Status enums store English codes; display labels come from a mapping or from the model's `get_status_display()` using `choices`.
- **Ask before:** adding a dependency not listed in the Stack table, changing the URL structure, or introducing a new app beyond the 5 listed (`restaurants`, `integrations`, `orders`, `menu`, `notifications`).
- **When stuck on Playwright selectors**, run `session.py` manually, open DevTools, inspect. Don't guess.
- **When the frontend and the plan disagree**, frontend wins — that's the actual contract. Update this doc to match what you built.

---

## Reference files (read these before you start)

- `backend/backend.md` — reference architecture from a prior project (Gunicorn/Nginx/Redis stack). We're not using that prod stack yet, but the patterns (domain-split views, CONN_MAX_AGE, rate limiting, feature flags, logging conventions, security settings, `select_for_update` for races) all apply.
- `backend/api.md` — reference endpoint pattern with CSRF exemption and logging.
- `frontend/src/types/index.ts` — **the contract.**
- `frontend/src/data/mockData.ts` — sample shapes + seed data.
- `frontend/src/data/platforms.ts` — the 7 platforms.
- `backend/integrations/laffe/session.py` — existing Playwright session, reuse as-is.

---

## Done definition

Phase N is "done" when:
- Code is committed with a clear message referencing the phase number
- Endpoints touched in that phase are callable via `curl` and return the expected shapes
- The frontend page that depends on it works end-to-end (or, for non-UI phases, a test proves the behavior)
- This document is updated if any contract changed during implementation
