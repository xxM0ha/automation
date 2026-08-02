from django.contrib import admin
from .models import Order, OrderItem


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ['name_snapshot', 'qty', 'unit_price']


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ['external_id', 'restaurant', 'platform', 'customer_name', 'status', 'total', 'created_at']
    list_filter = ['status', 'platform', 'restaurant']
    search_fields = ['external_id', 'customer_name', 'customer_phone']
    date_hierarchy = 'created_at'
    readonly_fields = ['raw_payload', 'created_at', 'accepted_at', 'delivered_at']
    inlines = [OrderItemInline]
