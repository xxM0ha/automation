from django.urls import path, include
from .views import health_check

urlpatterns = [
    path('health/', health_check, name='health'),
    path('auth/', include('restaurants.auth_urls')),
    path('branches/', include('restaurants.branch_urls')),
    path('orders/', include('orders.urls')),
    path('menu/', include('menu.urls')),
    path('platforms/', include('integrations.urls')),
    path('reports/', include('orders.report_urls')),
    path('notifications/', include('notifications_app.urls')),
    path('webhooks/', include('integrations.webhook_urls')),
    path('devices/', include('integrations.device_urls')),
    path('pending-syncs/', include('integrations.pending_urls')),
    path('print-jobs/', include('integrations.print_urls')),
    path('printers/', include('integrations.printer_urls')),
    path('app-config/', include('automation.urls')),
    path('dev/', include('automation.dev_urls')),
]
