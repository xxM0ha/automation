from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('categories', views.MenuCategoryViewSet, basename='menu-category')
router.register('items', views.MenuItemViewSet, basename='menu-item')

urlpatterns = [
    path('items/<int:pk>/availability/', views.toggle_availability, name='menu-item-availability'),
    path('items/<int:pk>/sync/', views.sync_item, name='menu-item-sync'),
    *router.urls,
]
