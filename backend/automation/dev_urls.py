from django.urls import path
from . import dev_views

urlpatterns = [
    path('restaurants/', dev_views.dev_restaurants, name='dev-restaurants'),
    path('restaurants/<slug:slug>/printing/', dev_views.dev_set_printing, name='dev-set-printing'),
    path('app-config/', dev_views.dev_app_config, name='dev-app-config'),
    path('orders/', dev_views.dev_orders, name='dev-orders'),
    path('rejections/', dev_views.dev_rejections, name='dev-rejections'),
    path('parse-preview/', dev_views.dev_parse_preview, name='dev-parse-preview'),
]
