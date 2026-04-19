from django.contrib import admin
from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ['title', 'restaurant', 'type', 'is_read', 'created_at']
    list_filter = ['type', 'is_read', 'restaurant']
    search_fields = ['title', 'body']
    date_hierarchy = 'created_at'
