from rest_framework import serializers
from django.utils import timezone
from .models import Platform, RestaurantPlatform
from orders.models import Order


class PlatformSerializer(serializers.ModelSerializer):
    is_connected = serializers.SerializerMethodField()
    auto_accept = serializers.SerializerMethodField()
    menu_sync = serializers.SerializerMethodField()
    orders_today = serializers.SerializerMethodField()
    last_sync_at = serializers.SerializerMethodField()

    class Meta:
        model = Platform
        fields = [
            'id', 'slug', 'name_ar', 'name_en', 'color', 'logo_path',
            'is_connected', 'auto_accept', 'menu_sync', 'orders_today', 'last_sync_at',
        ]

    def _get_rp(self, obj):
        restaurant = self.context.get('restaurant')
        if not restaurant:
            return None
        try:
            return RestaurantPlatform.objects.get(restaurant=restaurant, platform=obj)
        except RestaurantPlatform.DoesNotExist:
            return None

    def get_is_connected(self, obj):
        rp = self._get_rp(obj)
        return rp.is_connected if rp else False

    def get_auto_accept(self, obj):
        rp = self._get_rp(obj)
        return rp.auto_accept if rp else False

    def get_menu_sync(self, obj):
        rp = self._get_rp(obj)
        return rp.menu_sync if rp else True

    def get_orders_today(self, obj):
        restaurant = self.context.get('restaurant')
        if not restaurant:
            return 0
        today = timezone.now().date()
        return Order.objects.filter(
            restaurant=restaurant, platform=obj, created_at__date=today
        ).count()

    def get_last_sync_at(self, obj):
        rp = self._get_rp(obj)
        return rp.last_sync_at.isoformat() if rp and rp.last_sync_at else None
