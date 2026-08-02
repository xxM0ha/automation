from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('list', views.OrderViewSet, basename='order')

urlpatterns = [
    path('live/', views.live_activity, name='orders-live'),
    path('stats/', views.order_stats, name='orders-stats'),
    path('<int:pk>/', views.order_detail, name='order-detail'),
    path('<int:pk>/status/', views.update_status, name='order-status'),
    path('<int:pk>/reject/', views.reject_order, name='order-reject'),
    path('<int:pk>/items/', views.order_add_item, name='order-add-item'),
    path('<int:pk>/items/<int:item_id>/', views.order_item_detail, name='order-item-detail'),
    *router.urls,
]
