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
    config = models.JSONField(default=dict)
    last_sync_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('restaurant', 'platform')]

    def __str__(self):
        return f'{self.restaurant.name} — {self.platform.name_ar}'
