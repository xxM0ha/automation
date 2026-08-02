import secrets
from django.db import models


class Platform(models.Model):
    """Global catalog of delivery platforms — seeded, not user-editable."""
    slug = models.CharField(max_length=50, unique=True)  # toters, talabat, etc.
    name_ar = models.CharField(max_length=100)
    name_en = models.CharField(max_length=100)
    color = models.CharField(max_length=7)   # hex: #2563EB
    logo_path = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return self.name_ar


class RestaurantPlatform(models.Model):
    """Per-restaurant connection settings for a delivery platform."""
    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='platforms'
    )
    platform = models.ForeignKey(
        Platform, on_delete=models.PROTECT, related_name='restaurant_connections'
    )
    is_connected = models.BooleanField(default=False)
    webhook_secret = models.CharField(max_length=64, default=secrets.token_hex)
    auto_accept = models.BooleanField(default=False)
    menu_sync = models.BooleanField(default=True)
    # Default Foodics category for every order pushed from this platform.
    # Blank → fall back to the adapter's default (منيو التطبيقات / RIZ).
    pos_category = models.CharField(max_length=200, blank=True, default='')
    config = models.JSONField(default=dict)
    last_sync_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('restaurant', 'platform')]

    def __str__(self):
        return f'{self.restaurant.name} — {self.platform.name_ar}'


class PendingMenuSync(models.Model):
    """A queued menu-availability change for host-side (ADB / Raspberry Pi)
    runners that can't receive FCM. Enqueued alongside the FCM push whenever an
    item is toggled; the host polls GET /api/pending-syncs/ and consumes them."""
    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='pending_syncs'
    )
    platform = models.ForeignKey(Platform, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)        # the in-app item name to toggle
    available = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.platform.slug}: {self.name} → {self.available}'


class WebhookRejection(models.Model):
    """An incoming order the webhook could NOT accept (no parser, no items
    parsed, unmatched items, or unavailable items). These never become Orders,
    so we persist them here for the developer diagnostics page."""
    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='webhook_rejections'
    )
    platform = models.ForeignKey(Platform, on_delete=models.CASCADE)
    external_id = models.CharField(max_length=100, blank=True)
    reason = models.CharField(max_length=200)
    items = models.JSONField(default=list)   # offending item names, if any
    # Gemini-suggested matches for unmatched items: {name: {item_id, item_name,
    # confidence}}. Surfaced in the dashboard for a one-click confirm.
    suggestions = models.JSONField(default=dict, blank=True)
    raw_text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.platform.slug} rejected ({self.reason})'


class Printer(models.Model):
    """A thermal printer at a branch. A 'station' printer prints only the items
    routed to it (per-item, via MenuItem.printer); a 'cashier' printer prints
    every item of every order. Configured from the restaurant dashboard; the
    local print agent fetches these and prints per-printer tickets."""
    ROLE_STATION = 'station'
    ROLE_CASHIER = 'cashier'
    ROLE_CHOICES = [(ROLE_STATION, 'محطة'), (ROLE_CASHIER, 'كاشير')]

    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='printers'
    )
    name = models.CharField(max_length=100)
    ip = models.CharField(max_length=64)
    port = models.PositiveIntegerField(default=9100)
    paper_width = models.PositiveIntegerField(default=576)  # dots: 576=80mm, 384=58mm
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_STATION)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.role}) — {self.restaurant.slug}'


class PrintJob(models.Model):
    """A queued order ticket for the restaurant's local print agent. The Windows
    agent (on the branch LAN) polls GET /api/print-jobs/, prints to the thermal
    printer(s) over ESC/POS, then acks to consume them."""
    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='print_jobs'
    )
    order = models.ForeignKey(
        'orders.Order', on_delete=models.CASCADE, related_name='print_jobs'
    )
    printed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'PrintJob #{self.order_id} ({"printed" if self.printed else "pending"})'


class Device(models.Model):
    """A mobile device registered for FCM push (menu-sync, etc.)."""
    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='devices'
    )
    fcm_token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=20, default='android')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.restaurant.name} — {self.fcm_token[:12]}…'
