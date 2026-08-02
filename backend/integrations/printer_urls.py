from django.urls import path
from . import printer_views

urlpatterns = [
    path('', printer_views.printers),
    path('routing/', printer_views.routing),
    path('routing/bulk/', printer_views.routing_bulk),
    path('<int:pk>/', printer_views.printer_detail),
]
