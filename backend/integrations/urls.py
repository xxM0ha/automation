from django.urls import path
from . import views

urlpatterns = [
    path('', views.list_platforms, name='platforms-list'),
    path('<slug:slug>/', views.platform_detail, name='platform-detail'),
    path('<slug:slug>/connect/', views.connect_platform, name='platform-connect'),
    path('<slug:slug>/sync/', views.sync_platform, name='platform-sync'),
    path('<slug:slug>/settings/', views.update_platform_settings, name='platform-settings'),
]
