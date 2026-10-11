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
    pos_category = models.CharField(max_length=200, blank=True, default='')
    # Exact price of this item's card on Foodics. When set, the Foodics adapter
    # picks the card with this price instead of the closest match to the app's
    # price — the same item is listed in several Foodics menus at different
    # prices, and paid addons inflate the app price. Null → match by app price.
    foodics_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Foodics product UUID. Once set, the POS push addresses the product by id
    # instead of matching its name and price on screen — so renaming a product
    # in Foodics (e.g. adding an "APP" suffix) can no longer break a push.
    foodics_product_id = models.CharField(max_length=64, blank=True, default='', db_index=True)
    # Station printer this item is routed to for local (non-Foodics) printing.
    # Null → only the cashier printer(s) print it. See integrations.Printer.
    printer = models.ForeignKey(
        'integrations.Printer', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='items'
    )
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
    # Foodics category this item is filed under when an order from THIS platform
    # is pushed. Blank → fall back to the item-level / adapter default.
    pos_category = models.CharField(max_length=200, blank=True, default='')
    is_synced = models.BooleanField(default=False)

    class Meta:
        unique_together = [('menu_item', 'platform')]

    def __str__(self):
        return f'{self.menu_item.name} @ {self.platform.name_ar}'


class MenuItemPlatformAlias(models.Model):
    """Extra platform name aliases for a menu item → platform mapping."""
    mapping = models.ForeignKey(
        MenuItemPlatform, on_delete=models.CASCADE, related_name='aliases'
    )
    name = models.CharField(max_length=200, db_index=True)

    class Meta:
        unique_together = [('mapping', 'name')]

    def __str__(self):
        return self.name
