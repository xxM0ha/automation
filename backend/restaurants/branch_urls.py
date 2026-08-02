from django.urls import path
from . import branches_views

urlpatterns = [
    path('', branches_views.branches, name='branches'),
    path('sync/', branches_views.branch_sync, name='branch-sync'),
    path('<int:pk>/', branches_views.branch_detail, name='branch-detail'),
    path('<int:pk>/login/', branches_views.branch_login, name='branch-login'),
]
