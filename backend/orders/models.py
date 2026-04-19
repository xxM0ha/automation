from django.db import models


class Order(models.Model):
    STATUS_NEW = 'new'
    STATUS_ACCEPTED = 'accepted'
    STATUS_PREPARING = 'preparing'
    STATUS_READY = 'ready'
    STATUS_DELIVERED = 'delivered'
    STATUS_CANCELLED = 'cancelled'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'جديد'),
        (STATUS_ACCEPTED, 'مقبول'),
        (STATUS_PREPARING, 'قيد التحضير'),
        (STATUS_READY, 'جاهز'),
        (STATUS_DELIVERED, 'مكتمل'),
        (STATUS_CANCELLED, 'ملغي'),
        (STATUS_REJECTED, 'مرفوض'),
    ]

    # Valid status transitions
    TRANSITIONS = {
        STATUS_NEW: [STATUS_ACCEPTED, STATUS_REJECTED],
        STATUS_ACCEPTED: [STATUS_PREPARING, STATUS_CANCELLED],
        STATUS_PREPARING: [STATUS_READY, STATUS_CANCELLED],
        STATUS_READY: [STATUS_DELIVERED],
        STATUS_DELIVERED: [],
        STATUS_CANCELLED: [],
        STATUS_REJECTED: [],
    }

    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='orders'
    )
    platform = models.ForeignKey(
        'integrations.Platform', on_delete=models.PROTECT, related_name='orders'
    )
    external_id = models.CharField(max_length=100)       # Platform's order ID
    pos_external_id = models.CharField(max_length=100, blank=True)  # Foodics order ID

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW)
    customer_name = models.CharField(max_length=200)
    customer_phone = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    rejection_reason = models.TextField(blank=True)
    raw_payload = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('platform', 'external_id')]
        indexes = [
            models.Index(fields=['restaurant', 'status', '-created_at']),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f'Order {self.external_id} ({self.get_status_display()})'

    def can_transition_to(self, new_status: str) -> bool:
        return new_status in self.TRANSITIONS.get(self.status, [])


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='order_items')
    menu_item = models.ForeignKey(
        'menu.MenuItem', null=True, blank=True, on_delete=models.SET_NULL
    )
    name_snapshot = models.CharField(max_length=200)
    qty = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f'{self.qty}x {self.name_snapshot}'
