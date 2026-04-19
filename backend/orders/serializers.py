from rest_framework import serializers
from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ['id', 'name_snapshot', 'qty', 'unit_price', 'notes']


class OrderListSerializer(serializers.ModelSerializer):
    platform_id = serializers.CharField(source='platform.slug', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    items = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            'id', 'platform_id', 'external_id', 'status', 'status_display',
            'customer_name', 'customer_phone', 'address', 'notes',
            'total', 'items', 'created_at',
        ]

    def get_items(self, obj):
        return ', '.join(
            f'{i.qty}x {i.name_snapshot}' for i in obj.order_items.all()
        )


class OrderDetailSerializer(serializers.ModelSerializer):
    platform_id = serializers.CharField(source='platform.slug', read_only=True)
    platform_name = serializers.CharField(source='platform.name_ar', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    order_items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            'id', 'platform_id', 'platform_name', 'external_id', 'pos_external_id',
            'status', 'status_display', 'customer_name', 'customer_phone',
            'address', 'notes', 'total', 'rejection_reason',
            'order_items', 'created_at', 'accepted_at', 'delivered_at',
        ]
