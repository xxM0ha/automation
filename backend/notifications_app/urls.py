from django.urls import path
from . import views

urlpatterns = [
    path('', views.list_notifications, name='notifications-list'),
    path('<int:pk>/read/', views.mark_read, name='notification-read'),
    path('read-all/', views.mark_all_read, name='notifications-read-all'),
]
