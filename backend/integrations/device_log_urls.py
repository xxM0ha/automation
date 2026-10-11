from django.urls import path
from . import device_log_views

urlpatterns = [
    path('', device_log_views.device_logs, name='device-logs'),
]
