from django.urls import path
from . import webhook_views

urlpatterns = [
    path('', webhook_views.receive_webhook, name='webhook-receive'),
]
