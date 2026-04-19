from django.urls import path, include
from .views import health_check

urlpatterns = [
    path('health/', health_check, name='health'),
    path('auth/', include('restaurants.auth_urls')),
    path('orders/', include('orders.urls')),
    path('menu/', include('menu.urls')),
    path('platforms/', include('integrations.urls')),
    path('reports/', include('orders.report_urls')),
    path('notifications/', include('notifications_app.urls')),
    path('webhooks/', include('integrations.webhook_urls')),
]
