# PrimeAutomation API Reference

**Base URL:** `https://api.3alijny.com`  
**Format:** JSON (camelCase)  
**Timezone:** Asia/Baghdad

---

## Authentication

All endpoints require a token except `/api/health/`, `/api/auth/login/`, and `/api/webhooks/`.

```
Authorization: Token <token>
```

Obtain a token via [Login](#post-apiauthlogin).

---

## Health

### GET /api/health/
Returns server status. No auth required.

**Response `200`**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "env": "production",
  "django": [6, 0, 4]
}
```

---

## Auth

### POST /api/auth/login/
Authenticate and receive a token.

**Request**
```json
{
  "email": "admin@restaurant.com",
  "password": "secret"
}
```

**Response `200`**
```json
{
  "id": 1,
  "email": "admin@restaurant.com",
  "name": "Ahmed",
  "role": "admin",
  "restaurant": {
    "id": 1,
    "name": "توترز",
    "slug": "toters-laffe"
  },
  "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b"
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing `email` or `password` |
| `401` | Invalid credentials |

---

### POST /api/auth/logout/
Revoke the current token.

**Response `200`**
```json
{ "detail": "تم تسجيل الخروج." }
```

---

### GET /api/auth/me/
Get the authenticated user's profile.

**Response `200`**
```json
{
  "id": 1,
  "email": "admin@restaurant.com",
  "name": "Ahmed",
  "role": "admin",
  "restaurant": {
    "id": 1,
    "name": "توترز",
    "slug": "toters-laffe"
  }
}
```

---

## Orders

### GET /api/orders/list/
List orders for the authenticated restaurant. Paginated (50 per page).

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Search by customer name, phone, or external ID |
| `status` | string | Filter by status (see [Status Values](#order-status-values)) |
| `platform` | string | Filter by platform slug |
| `dateFrom` | YYYY-MM-DD | Start date filter |
| `dateTo` | YYYY-MM-DD | End date filter |
| `ordering` | string | Sort by `created_at`, `total`, or `status` (prefix `-` for descending) |
| `page` | int | Page number |

**Response `200`**
```json
{
  "count": 120,
  "next": "https://api.3alijny.com/api/orders/list/?page=2",
  "previous": null,
  "results": [
    {
      "id": 55,
      "platformId": "toters",
      "externalId": "TT-99123",
      "status": "preparing",
      "statusDisplay": "قيد التحضير",
      "customerName": "محمد علي",
      "customerPhone": "07901234567",
      "address": "بغداد، المنصور",
      "notes": "بدون بصل",
      "total": "18500.00",
      "items": "برغر كلاسيك × 2، بطاطا × 1",
      "createdAt": "2026-04-19T14:30:00+03:00"
    }
  ]
}
```

---

### GET /api/orders/list/{id}/
Get full order details.

**Response `200`**
```json
{
  "id": 55,
  "platformId": "toters",
  "platformName": "توترز",
  "externalId": "TT-99123",
  "posExternalId": "POS-44",
  "status": "preparing",
  "statusDisplay": "قيد التحضير",
  "customerName": "محمد علي",
  "customerPhone": "07901234567",
  "address": "بغداد، المنصور",
  "notes": "بدون بصل",
  "total": "18500.00",
  "rejectionReason": null,
  "orderItems": [
    {
      "id": 1,
      "nameSnapshot": "برغر كلاسيك",
      "qty": 2,
      "unitPrice": "7500.00",
      "notes": ""
    },
    {
      "id": 2,
      "nameSnapshot": "بطاطا مقلية",
      "qty": 1,
      "unitPrice": "3500.00",
      "notes": ""
    }
  ],
  "createdAt": "2026-04-19T14:30:00+03:00",
  "acceptedAt": "2026-04-19T14:31:00+03:00",
  "deliveredAt": null
}
```

---

### PATCH /api/orders/{id}/status/
Transition an order to a new status.

**Request**
```json
{ "status": "accepted" }
```

**Response `200`** — Full order detail (same as above)

**Errors**
| Code | Reason |
|------|--------|
| `400` | Invalid status transition |
| `404` | Order not found |

#### Order Status Values

| Value | Display | Allowed Next States |
|-------|---------|---------------------|
| `new` | جديد | `accepted`, `rejected` |
| `accepted` | مقبول | `preparing`, `cancelled` |
| `preparing` | قيد التحضير | `ready`, `cancelled` |
| `ready` | جاهز | `delivered` |
| `delivered` | تم التوصيل | — (terminal) |
| `cancelled` | ملغي | — (terminal) |
| `rejected` | مرفوض | — (terminal) |

---

### POST /api/orders/{id}/reject/
Reject an order with an optional reason.

**Request**
```json
{ "reason": "المطعم مغلق" }
```

**Response `200`** — Full order detail

---

### GET /api/orders/live/
Get the last 20 orders for the live dashboard feed.

**Response `200`** — Array of order list objects (same shape as `/list/` results)

---

### GET /api/orders/stats/
Get today's order statistics.

**Response `200`**
```json
{
  "active": 3,
  "preparing": 5,
  "completedToday": 42,
  "avgPrepMinutes": 18
}
```

---

## Menu

### GET /api/menu/categories/
List all menu categories.

**Response `200`**
```json
[
  { "id": 1, "nameAr": "برغر", "sortOrder": 1 },
  { "id": 2, "nameAr": "مشروبات", "sortOrder": 2 }
]
```

---

### POST /api/menu/categories/
Create a category.

**Request**
```json
{ "nameAr": "بيتزا", "sortOrder": 3 }
```

**Response `201`** — Created category object

---

### PUT/PATCH /api/menu/categories/{id}/
Update a category. **Response `200`**

### DELETE /api/menu/categories/{id}/
Delete a category. **Response `204`**

---

### GET /api/menu/items/
List all menu items.

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `category` | int | Filter by category ID |
| `status` | string | `active` or `hidden` |

**Response `200`**
```json
[
  {
    "id": 10,
    "name": "برغر كلاسيك",
    "price": "7500.00",
    "priceDisplay": "7500 ر.س",
    "description": "برغر لحم مع الخس والطماطم",
    "image": "https://...",
    "tag": "الأكثر مبيعاً",
    "status": "active",
    "statusDisplay": "متاح",
    "isAvailable": true,
    "stockLevel": null,
    "category": 1,
    "categoryName": "برغر",
    "platforms": ["toters", "talabat"],
    "platformMappings": [
      {
        "platformId": "toters",
        "platformNameAr": "توترز",
        "platformName": "Classic Burger",
        "platformPrice": "7500.00",
        "isSynced": true
      }
    ],
    "createdAt": "2026-03-01T10:00:00+03:00"
  }
]
```

---

### POST /api/menu/items/
Create a menu item.

**Request**
```json
{
  "name": "برغر مزدوج",
  "price": "9500.00",
  "description": "...",
  "category": 1,
  "status": "active",
  "isAvailable": true,
  "platforms": ["toters"],
  "platformNames": { "toters": "Double Burger" }
}
```

**Response `201`** — Full item object

---

### PUT/PATCH /api/menu/items/{id}/
Update a menu item. **Response `200`**

### DELETE /api/menu/items/{id}/
Delete a menu item. **Response `204`**

---

### PATCH /api/menu/items/{id}/availability/
Toggle item availability on/off.

**Response `200`** — Updated item object

---

### POST /api/menu/items/{id}/sync/
Enqueue an async job to sync this item across all connected platforms.

**Response `200`**
```json
{ "detail": "تمت جدولة المزامنة." }
```

---

## Platforms

### GET /api/platforms/
List all delivery platforms with connection status.

**Response `200`**
```json
[
  {
    "id": 1,
    "slug": "toters",
    "nameAr": "توترز",
    "nameEn": "Toters",
    "color": "#E63946",
    "logoPath": "/static/logos/toters.svg",
    "isConnected": true,
    "autoAccept": false,
    "menuSync": true,
    "ordersToday": 14,
    "lastSyncAt": "2026-04-19T12:00:00+03:00"
  }
]
```

---

### GET /api/platforms/{slug}/
Get a single platform. Same response shape as above.

---

### PATCH /api/platforms/{slug}/connect/
Connect or disconnect a platform.

**Request**
```json
{ "isConnected": true }
```

**Response `200`** — Updated platform object

---

### PATCH /api/platforms/{slug}/settings/
Update platform settings.

**Request**
```json
{
  "autoAccept": true,
  "menuSync": false,
  "config": { "webhookSecret": "abc123" }
}
```

**Response `200`** — Updated platform object

---

### POST /api/platforms/{slug}/sync/
Enqueue a full menu sync from this platform.

**Response `200`**
```json
{ "detail": "تمت جدولة المزامنة." }
```

---

## Reports

All report endpoints accept a `range` query param: `today` (default), `7d`, `30d`.

### GET /api/reports/summary/

**Response `200`**
```json
{
  "totalOrders": 120,
  "completedOrders": 108,
  "totalRevenue": 1850000.00,
  "avgOrderValue": 15416.67
}
```

---

### GET /api/reports/velocity/
Orders over time — hourly buckets for `today`, daily for `7d`/`30d`.

**Response `200`**
```json
[
  { "time": "09:00", "orders": 3 },
  { "time": "10:00", "orders": 7 }
]
```

---

### GET /api/reports/platforms/
Revenue and order count per platform.

**Response `200`**
```json
[
  { "name": "توترز", "slug": "toters", "color": "#E63946", "value": 55, "revenue": 825000.00 },
  { "name": "طلبات", "slug": "talabat", "color": "#FF6B00", "value": 40, "revenue": 620000.00 }
]
```

---

### GET /api/reports/top-items/
Top 10 selling items by quantity.

**Response `200`**
```json
[
  { "name": "برغر كلاسيك", "units": 88, "progress": 100 },
  { "name": "بطاطا مقلية", "units": 72, "progress": 82 }
]
```

---

## Notifications

### GET /api/notifications/
List the latest 50 notifications.

**Response `200`**
```json
{
  "unreadCount": 3,
  "results": [
    {
      "id": 9,
      "title": "طلب جديد",
      "body": "وصل طلب جديد من توترز",
      "type": "order",
      "isRead": false,
      "createdAt": "2026-04-19T14:30:00+03:00",
      "relatedOrder": 55
    }
  ]
}
```

**Notification types:** `order`, `alert`, `system`

---

### PATCH /api/notifications/{id}/read/
Mark a single notification as read.

**Response `200`** — Updated notification object

---

### POST /api/notifications/read-all/
Mark all notifications as read.

**Response `200`**
```json
{ "detail": "تم تعليم الكل كمقروء." }
```

---

## Webhooks (Inbound Orders)

### POST /api/webhooks/
Receive an incoming order from a delivery platform. No auth required.

**Request**
```json
{
  "platform": "toters",
  "restaurant": "toters-laffe",
  "raw_text": "<raw order payload as received from the platform app>"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `platform` | string | Platform slug (e.g. `toters`, `talabat`) |
| `restaurant` | string | Restaurant slug |
| `raw_text` | string | The raw order text/payload copied from the platform |

**Response `200` — Accepted**
```json
{
  "status": "accepted",
  "orderId": "TT-99123"
}
```

**Response `200` — Parse failure (stored for review)**
```json
{
  "status": "received",
  "parsed": false
}
```

**Error Responses**
| Code | Body | Reason |
|------|------|--------|
| `400` | `{ "detail": "..." }` | Missing required fields |
| `403` | `{ "detail": "..." }` | Platform not connected to this restaurant |
| `404` | `{ "detail": "..." }` | Unknown restaurant or platform slug |
| `413` | `{ "detail": "..." }` | Payload exceeds 100 KB |
| `422` | `{ "status": "rejected", "reason": "...", "unmatchedItems": [...] }` | Order items not found in menu |
| `422` | `{ "status": "rejected", "reason": "...", "unavailableItems": [...] }` | Order items are marked unavailable |

**What happens on success:**
1. Order is parsed and saved to the database
2. An async job pushes the order to the Foodics POS
3. A notification is created for the restaurant staff

**`confirm` flag (for the automation app):**
Every `200` response includes a boolean `confirm`. The app taps the platform's
"accept order" button only when `confirm` is `true`:
- Valid order **and** the restaurant+platform has `autoAccept` on → `confirm: true`
- Parse failure, or `autoAccept` off → `confirm: false`
Rejected orders (`422`) are never confirmed.

---

## Bulk item on/off

### POST /api/menu/items/availability/bulk/
Turn several menu items on or off in one request. Devices receive **one**
menu-sync message per connected app carrying the whole list (and host-side ADB
runners one job per app from `/api/pending-syncs/`), so the items are toggled
in a single run. Items already in the requested state are not re-sent.

**Request** `{ "itemIds": [12, 15, 19], "available": false }`

**Response `200`** `{ "updated": 3, "items": [ ...menu items... ] }`

---

## Device Error Logs

Errors that happen **on a device** (the Android app or the host-side ADB
runner) never reach the server on their own — a flow step that failed, an order
that could not be sent, the accessibility service stopping, a crash. The device
uploads them here, with the engine log lines that led up to the error and a text
dump of the screen at that moment. A repeating error is throttled on the device:
it is sent once, then again after 10 minutes with `count` = repeats in between.
Reports made while offline are queued on the device and sent later.

### POST /api/device-logs/
Token-authenticated as the branch account; entries are stored under that branch.

**Request** (snake_case)
```json
{
  "source": "app",
  "device": { "id": "a1b2c3", "model": "samsung SM-A155F", "os": "14", "app_version": "1.0.0" },
  "entries": [
    {
      "platform": "toters",
      "kind": "flow",
      "message": "فشل التدفق · لم يظهر العنصر: order_card",
      "occurred_at": 1760000000000,
      "count": 1,
      "context": ["12:00:01 [step] نقر · order_card"],
      "screen": { "package": "com.toters.totersmerchant", "texts": ["الطلبات الحالية"] }
    }
  ]
}
```
`source` is `app` or `adb`. `kind` is `flow`, `accessibility`, `crash` or `app`.
At most 50 entries per request; entries older than 30 days are pruned.

**Response `200`** `{ "stored": 1 }`

### GET /api/dev/device-logs/
Dev (superuser) only. Newest first, across all restaurants.
Query: `restaurant=<slug>`, `source=app|adb`, `platform=<task slug>`, `limit=N` (max 300).

---

## Common Error Format

```json
{ "detail": "وصف الخطأ." }
```

Field-level validation errors:
```json
{
  "email": ["This field is required."],
  "password": ["This field may not be blank."]
}
```

---

## Pagination

Paginated endpoints return:
```json
{
  "count": 200,
  "next": "https://api.3alijny.com/api/orders/list/?page=3",
  "previous": "https://api.3alijny.com/api/orders/list/?page=1",
  "results": [...]
}
```

Default page size: **50**. Use `?page=N` to navigate.
