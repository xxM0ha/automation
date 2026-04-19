from django.db import models


class MenuCategory(models.Model):
    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='categories'
    )
    name_ar = models.CharField(max_length=200)
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name_ar']

    def __str__(self):
        return self.name_ar


class MenuItem(models.Model):
    STATUS_ACTIVE = 'active'
    STATUS_HIDDEN = 'hidden'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'نشط'),
        (STATUS_HIDDEN, 'مخفي'),
    ]

    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='menu_items'
    )
    category = models.ForeignKey(
        MenuCategory, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='items'
    )
    name = models.CharField(max_length=200)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    image = models.CharField(max_length=500, blank=True)
    tag = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    is_available = models.BooleanField(default=True)
    stock_level = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category__sort_order', 'name']

    def __str__(self):
        return self.name


class MenuItemPlatform(models.Model):
    """Per-platform name/price overrides for a menu item."""
    menu_item = models.ForeignKey(
        MenuItem, on_delete=models.CASCADE, related_name='platform_mappings'
    )
    platform = models.ForeignKey(
        'integrations.Platform', on_delete=models.PROTECT
    )
    platform_name = models.CharField(max_length=200, blank=True)
    platform_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    is_synced = models.BooleanField(default=False)

    class Meta:
        unique_together = [('menu_item', 'platform')]

    def __str__(self):
        return f'{self.menu_item.name} @ {self.platform.name_ar}'
