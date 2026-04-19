from django.contrib import admin
from .models import MenuCategory, MenuItem, MenuItemPlatform


class MenuItemPlatformInline(admin.TabularInline):
    model = MenuItemPlatform
    extra = 0


@admin.register(MenuCategory)
class MenuCategoryAdmin(admin.ModelAdmin):
    list_display = ['name_ar', 'restaurant', 'sort_order']
    list_filter = ['restaurant']


@admin.register(MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = ['name', 'restaurant', 'category', 'price', 'status', 'is_available']
    list_filter = ['status', 'is_available', 'restaurant', 'category']
    search_fields = ['name']
    inlines = [MenuItemPlatformInline]
