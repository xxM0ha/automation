from django.urls import path
from . import views

urlpatterns = [
    path('', views.pending_syncs, name='pending-syncs'),
]
