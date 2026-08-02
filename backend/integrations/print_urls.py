from django.urls import path
from . import print_views

urlpatterns = [
    path('', print_views.print_jobs, name='print-jobs'),
    path('ack/', print_views.print_ack, name='print-ack'),
]
