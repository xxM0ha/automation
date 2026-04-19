from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('list', views.OrderViewSet, basename='order')

urlpatterns = [
    path('live/', views.live_activity, name='orders-live'),
    path('stats/', views.order_stats, name='orders-stats'),
    path('<int:pk>/status/', views.update_status, name='order-status'),
    path('<int:pk>/reject/', views.reject_order, name='order-reject'),
    *router.urls,
]
