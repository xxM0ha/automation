from django.urls import path
from . import report_views

urlpatterns = [
    path('summary/', report_views.summary, name='reports-summary'),
    path('velocity/', report_views.velocity, name='reports-velocity'),
    path('platforms/', report_views.platforms, name='reports-platforms'),
    path('top-items/', report_views.top_items, name='reports-top-items'),
]
