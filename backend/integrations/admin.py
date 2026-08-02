from django.contrib import admin
from .models import Platform, RestaurantPlatform


@admin.register(Platform)
class PlatformAdmin(admin.ModelAdmin):
    list_display = ['slug', 'name_ar', 'name_en', 'color']
    search_fields = ['slug', 'name_ar']


@admin.register(RestaurantPlatform)
class RestaurantPlatformAdmin(admin.ModelAdmin):
    list_display = ['restaurant', 'platform', 'is_connected', 'auto_accept', 'last_sync_at']
    list_filter = ['is_connected', 'platform', 'restaurant']
