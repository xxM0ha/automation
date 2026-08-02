from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Restaurant, RestaurantUser, RestaurantPOS


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    model = User
    list_display = ['email', 'first_name', 'is_staff', 'is_active']
    list_filter = ['is_staff', 'is_active']
    search_fields = ['email', 'first_name']
    ordering = ['email']
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
    )
    add_fieldsets = (
        (None, {'classes': ('wide',), 'fields': ('email', 'first_name', 'password1', 'password2')}),
    )


@admin.register(Restaurant)
class RestaurantAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_active', 'created_at']
    search_fields = ['name', 'slug']


@admin.register(RestaurantUser)
class RestaurantUserAdmin(admin.ModelAdmin):
    list_display = ['user', 'restaurant', 'role']
    list_filter = ['role', 'restaurant']


@admin.register(RestaurantPOS)
class RestaurantPOSAdmin(admin.ModelAdmin):
    list_display = ['restaurant', 'pos_type', 'last_session_at']
