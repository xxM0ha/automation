from django.urls import path
from . import views

urlpatterns = [
    path('', views.list_notifications, name='notifications-list'),
    path('unlinked-items/', views.unlinked_items, name='notifications-unlinked-items'),
    path('link-item/', views.link_item, name='notifications-link-item'),
    path('<int:pk>/read/', views.mark_read, name='notification-read'),
    path('read-all/', views.mark_all_read, name='notifications-read-all'),
]
