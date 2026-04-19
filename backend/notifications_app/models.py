from django.db import models
from django.conf import settings


class Notification(models.Model):
    TYPE_CHOICES = [
        ('order', 'order'),
        ('alert', 'alert'),
        ('system', 'system'),
    ]

    restaurant = models.ForeignKey(
        'restaurants.Restaurant', on_delete=models.CASCADE, related_name='notifications'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='notifications'
    )  # null = broadcast to whole restaurant
    title = models.CharField(max_length=300)
    body = models.TextField()
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='order')
    is_read = models.BooleanField(default=False)
    related_order = models.ForeignKey(
        'orders.Order', null=True, blank=True, on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title
