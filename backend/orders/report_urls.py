from django.urls import path
from . import report_views

urlpatterns = [
    path('summary/', report_views.summary, name='reports-summary'),
    path('velocity/', report_views.velocity, name='reports-velocity'),
    path('platforms/', report_views.platforms, name='reports-platforms'),
    path('top-items/', report_views.top_items, name='reports-top-items'),
    path('peak-forecast/', report_views.peak_forecast, name='reports-peak-forecast'),
    path('daily-summary/', report_views.daily_summary, name='reports-daily-summary'),
    path('automation-health/', report_views.automation_health, name='reports-automation-health'),
    path('fulfillment/', report_views.fulfillment, name='reports-fulfillment'),
    path('peak-heatmap/', report_views.peak_heatmap, name='reports-peak-heatmap'),
]
