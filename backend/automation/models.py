from django.db import models


class GlobalAutomationConfig(models.Model):
    """The single automation config document shared by ALL restaurants.

    Stores the full AutomationConfig JSON (camelCase, verbatim). The mobile app
    fetches it from /api/app-config/; devs edit it via /api/dev/app-config/.
    Singleton — always row pk=1 via load().
    """
    document = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return 'global automation config'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class RestaurantAutomationConfig(models.Model):
    """The server-driven automation config document for a restaurant.

    Stores the full AutomationConfig JSON (camelCase, verbatim) the mobile app
    fetches from /api/app-config/.
    """
    restaurant = models.OneToOneField(
        'restaurants.Restaurant',
        on_delete=models.CASCADE,
        related_name='automation_config',
    )
    document = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.restaurant.name} — automation config'
