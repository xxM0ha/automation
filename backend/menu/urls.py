from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('categories', views.MenuCategoryViewSet, basename='menu-category')
router.register('items', views.MenuItemViewSet, basename='menu-item')

urlpatterns = [
    path('import/source/', views.import_source, name='menu-import-source'),
    path('import/', views.import_items, name='menu-import'),
    path('items/availability/bulk/', views.bulk_availability, name='menu-items-availability-bulk'),
    path('items/<int:pk>/availability/', views.toggle_availability, name='menu-item-availability'),
    path('items/<int:pk>/sync/', views.sync_item, name='menu-item-sync'),
    *router.urls,
]
