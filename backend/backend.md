# Backend Architecture — 3alijny.com
> A reference guide for building a production-grade backend based on what we built and learned here.

---

## Stack Overview

| Layer | Technology |
|-------|-----------|
| Framework | Django 5.2 + Django REST Framework |
| WSGI Server | Gunicorn (gevent async workers) |
| Reverse Proxy | Nginx 1.24 |
| Database | MySQL (via mysqlclient) |
| Cache / Sessions | Redis (django-redis) |
| File Storage | AWS S3 + CloudFront CDN |
| SSL | Let's Encrypt (Certbot) |
| Notifications | Web Push (VAPID) + Telegram (Telethon) |
| Payments | TheWayl payment gateway (webhook-based) |
| Auth | DRF Token Authentication + Session Auth (admin) |
| AI | YOLO via Ultralytics (diagnosis images) |
| Process Manager | systemd |

---

## 1. Django Project Structure

```
backend/
├── backend/
│   ├── settings.py       # All config (env-driven)
│   ├── urls.py           # Root URL routing
│   └── wsgi.py
├── api/
│   ├── models.py         # All DB models
│   ├── views.py          # Main views (large file, split by domain)
│   ├── views_payments.py
│   ├── views_employee.py
│   ├── views_marketing.py
│   ├── views_notifications.py
│   ├── views_patients_dashboard.py
│   ├── serializers.py
│   ├── urls.py
│   ├── middleware.py     # Custom CSRF exemption for /api/
│   ├── points_system.py  # Feature-flagged business logic
│   ├── push_notifications.py
│   ├── telegram_notifications.py
│   ├── signals.py
│   └── migrations/
├── logs/
│   ├── django.log        # Rotating, 10MB max, 5 backups
│   └── django_errors.log
├── gunicorn_config.py
├── requirements.txt
└── manage.py
```

**Key principle:** Split views into domain-specific files (`views_payments.py`, `views_employee.py`, etc.) instead of one giant file. Each file owns its domain.

---

## 2. Gunicorn — Handling High Concurrency

This is what allows handling thousands of requests in a short burst.

```python
# gunicorn_config.py
workers = 3                    # Number of worker processes
worker_class = 'gevent'        # Async I/O — each worker handles 1000 concurrent connections
worker_connections = 1000      # Per worker
timeout = 120
keepalive = 5
graceful_timeout = 30
backlog = 2048                 # Queue size for incoming connections

# Prevent memory leaks (especially with YOLO/AI models loaded per worker)
max_requests = 500
max_requests_jitter = 50       # Stagger restarts so not all workers die at once

preload_app = False            # Must be False with gevent + DB connections
```

**Why gevent?**
- Each worker can handle 1000 concurrent connections (vs 1 for sync workers)
- 3 workers × 1000 connections = 3000 concurrent requests
- Ideal for I/O-bound workloads (DB queries, external API calls)

**Worker count formula:**
```
workers = (2 × CPU cores) + 1
```
But cap it based on RAM. If workers load heavy models (YOLO ~1GB each), 3 workers = ~3GB RAM used.

---

## 3. Nginx — Reverse Proxy, Rate Limiting & SSL

Nginx sits in front of Gunicorn and handles:

### Rate Limiting (per IP)
```nginx
limit_req_zone $binary_remote_addr zone=api_general:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=api_payment:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api_auth:10m rate=10r/m;
```

- **General API:** 30 requests/second with burst of 20
- **Payment endpoints:** 5 requests/minute (anti-fraud)
- **Auth endpoints:** 10 requests/minute (brute-force protection)

### Response Caching
```nginx
proxy_cache_path /tmp/nginx_cache levels=1:2 keys_zone=api_cache:10m max_size=100m inactive=5m;

# Cache session-check responses for 2 seconds
# Absorbs hundreds of simultaneous app-open pings after a push notification
location ~ ^/api/students/session-check/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 2s;
    proxy_cache_use_stale error timeout updating;
    proxy_cache_key "$request_uri|$http_authorization";
}
```

### HTTP/2 + SSL
```nginx
listen 443 ssl http2;
ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
include /etc/letsencrypt/options-ssl-nginx.conf;
ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
```

- **Let's Encrypt** via Certbot — free, auto-renews every 90 days
- **HTTP/2** multiplexes multiple requests over one connection (big mobile app win)
- **HSTS** header forces browsers to always use HTTPS

### Security Headers
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### Block IP-Direct Access
```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    server_name _;
    return 444;  # Drop connection silently — no response
}
```
Prevents bots from hitting your server by IP.

### Block Common Attack Paths
```nginx
location ~* ^/(wp-admin|wp-login|phpmyadmin|xmlrpc\.php|...) {
    return 403;
}
```

### Static Files — 1 Year Cache
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### Upstream Keepalive
```nginx
upstream django_backend {
    server 127.0.0.1:8000;
    keepalive 8;  # Reuse 8 connections to Gunicorn — avoids TCP handshake per request
}
```

---

## 4. Database — MySQL + Connection Pooling

```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'OPTIONS': {
            'charset': 'utf8mb4',                              # Full Unicode (emoji, Arabic)
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        },
        'CONN_MAX_AGE': 600,  # Reuse DB connections for 10 minutes
    }
}
```

**`CONN_MAX_AGE`** is the most impactful single setting for performance. Without it, Django opens a new DB connection for every request (50–100ms overhead). With it, connections are reused across requests.

---

## 5. Redis — Caching & Sessions

```python
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://127.0.0.1:6379/1',
        'OPTIONS': {
            'CONNECTION_POOL_KWARGS': {'max_connections': 50},
            'COMPRESSOR': 'django_redis.compressors.zlib.ZlibCompressor',  # Compress cached values
            'IGNORE_EXCEPTIONS': True,   # Don't crash if Redis goes down
        },
        'TIMEOUT': 300,  # 5 minutes default TTL
    }
}

# Store sessions in Redis instead of DB
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
SESSION_COOKIE_AGE = 2592000  # 30 days
```

**What to cache:**
- User profiles, settings, static lookup data
- Short-lived high-traffic responses (session checks, app version)

**What NOT to cache:**
- Real-time data (available patients, patient selections) — must always be fresh

---

## 6. SSL Setup with Let's Encrypt

```bash
# Install certbot
apt install certbot python3-certbot-nginx

# Issue certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal (certbot adds this to cron automatically)
certbot renew --dry-run
```

Certbot edits your nginx config automatically and sets up a cron job to renew before expiry.

---

## 7. systemd Service

```ini
[Unit]
Description=My Django App
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/path/to/backend
Environment="DJANGO_SETTINGS_MODULE=backend.settings"
Environment="PYTHONUNBUFFERED=1"
ExecStart=/path/to/venv/bin/gunicorn backend.wsgi:application --config gunicorn_config.py
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable myapp
systemctl start myapp
systemctl restart myapp
journalctl -u myapp -f   # Live logs
```

`Restart=always` + `RestartSec=10` means it auto-recovers from crashes.

---

## 8. Authentication

Two auth layers running side by side:

| Who | Method | Use Case |
|-----|--------|----------|
| Mobile app users | `TokenAuthentication` | Stateless, no CSRF needed |
| Admin panel | `SessionAuthentication` | Cookie-based, CSRF protected |

```python
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
}
```

Custom middleware exempts `/api/` from CSRF (tokens handle security there) while keeping CSRF on the admin panel.

---

## 9. DRF Rate Limiting

```python
REST_FRAMEWORK = {
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '1000/hour',
    },
}
```

Combined with Nginx rate limiting = two layers of protection.

---

## 10. Security Settings (Django)

```python
SECURE_SSL_REDIRECT = True               # Force HTTPS
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')  # Trust nginx
SESSION_COOKIE_SECURE = True             # Cookies only over HTTPS
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000           # 1 year HSTS
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
X_FRAME_OPTIONS = 'DENY'
SECURE_CONTENT_TYPE_NOSNIFF = True
```

---

## 11. File Storage — S3 + CloudFront

```python
USE_S3 = os.environ.get('USE_S3', 'false').lower() == 'true'

if USE_S3:
    STORAGES = {
        'default': {'BACKEND': 'storages.backends.s3boto3.S3Boto3Storage'},
        'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
    }
    AWS_DEFAULT_ACL = 'private'          # Private files
    AWS_S3_FILE_OVERWRITE = False        # Never overwrite uploaded files
    CLOUDFRONT_DOMAIN = 'xxx.cloudfront.net'  # CDN for fast delivery
```

- Use **S3** for storage (cheap, durable, scalable)
- Use **CloudFront** in front of S3 for CDN delivery (fast globally)
- Keep `USE_S3=false` locally with SQLite for development

---

## 12. Logging

```python
'file': {
    'class': 'logging.handlers.RotatingFileHandler',
    'filename': BASE_DIR / 'logs' / 'django.log',
    'maxBytes': 1024 * 1024 * 10,   # 10MB per file
    'backupCount': 5,               # Keep 5 rotated files = max 50MB
    'formatter': 'verbose',
},
```

- Separate `django.log` (INFO+) and `django_errors.log` (ERROR+)
- `RotatingFileHandler` prevents disk from filling up
- Use `logger.info(f"[my_feature] ...")` with prefixes so you can grep by feature

---

## 13. CORS

```python
CORS_ALLOW_ALL_ORIGINS = True       # Mobile apps come from anywhere
CORS_ALLOW_CREDENTIALS = False      # Tokens used, not cookies
CORS_URLS_REGEX = r'^/api/.*$'      # Only apply to API, not admin
```

---

## 14. Environment Variables Pattern

Never hardcode secrets. Use environment variables with safe fallbacks for dev:

```python
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-only-insecure-key')
DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
DB_PASSWORD = os.environ.get('DB_PASSWORD', '')
```

In production, set these in the systemd service file:
```ini
[Service]
Environment="SECRET_KEY=your-real-key"
Environment="DB_PASSWORD=your-real-password"
Environment="USE_S3=true"
```

---

## 15. Feature Flags via DB Settings

For business logic that needs to be toggled without redeployment:

```python
# In a Settings model (key/value table)
# points_system_enabled = true/false
# free_case_types = class 1,class 2,perio
# points_beta_students = 12,45,99

def get_setting(key, default=None):
    try:
        return Settings.objects.get(key=key).value
    except Settings.DoesNotExist:
        return default
```

Change behavior at runtime from the admin panel or DB — no code deploy needed.

---

## 16. Handling Race Conditions

For operations where two users might select the same resource simultaneously:

```python
from django.db import transaction

with transaction.atomic():
    # Lock the row — other requests wait until this block completes
    item = MyModel.objects.select_for_update().get(pk=pk, is_active=True)
    
    # Safe to modify — no other request can touch this row right now
    item.is_active = False
    item.save()
```

`select_for_update()` + `atomic()` = database-level locking, no race conditions.

---

## Summary — What Made It Handle High Traffic

| Technique | Impact |
|-----------|--------|
| Gunicorn gevent workers | 3000 concurrent connections |
| Nginx rate limiting | Protects against burst abuse |
| Nginx response caching (2s) | Absorbs post-notification traffic spikes |
| Nginx upstream keepalive | Removes TCP overhead per request |
| `CONN_MAX_AGE=600` | Removes DB connection overhead (50–100ms/req) |
| Redis sessions & cache | DB queries replaced with microsecond lookups |
| HTTP/2 | Multiple requests per connection on mobile |
| Worker recycling (`max_requests`) | Prevents memory leak degradation over time |
