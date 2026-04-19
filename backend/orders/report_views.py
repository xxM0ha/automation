import logging
from django.utils import timezone
from django.db.models import Count, Sum
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Order, OrderItem

logger = logging.getLogger('prime.reports')


def _get_range_filter(range_param):
    today = timezone.now().date()
    if range_param == '7d':
        from datetime import timedelta
        return {'created_at__date__gte': today - timedelta(days=7)}
    elif range_param == '30d':
        from datetime import timedelta
        return {'created_at__date__gte': today - timedelta(days=30)}
    return {'created_at__date': today}  # default: today


@api_view(['GET'])
def summary(request):
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response({})
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    qs = Order.objects.filter(restaurant=restaurant, **range_filter)
    completed = qs.filter(status=Order.STATUS_DELIVERED)
    total_revenue = completed.aggregate(t=Sum('total'))['t'] or 0
    return Response({
        'totalOrders': qs.count(),
        'completedOrders': completed.count(),
        'totalRevenue': float(total_revenue),
        'avgOrderValue': float(total_revenue / completed.count()) if completed.count() else 0,
    })


@api_view(['GET'])
def velocity(request):
    """Orders over time — hourly buckets for today, daily for longer ranges."""
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response([])
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    qs = Order.objects.filter(restaurant=restaurant, **range_filter).order_by('created_at')
    # Build hourly buckets in Python (DB-agnostic)
    buckets: dict = {}
    for order in qs.values('created_at'):
        hour = order['created_at'].strftime('%H:00')
        buckets[hour] = buckets.get(hour, 0) + 1
    return Response([{'time': h, 'orders': c} for h, c in sorted(buckets.items())])


@api_view(['GET'])
def platforms(request):
    """Platform breakdown — orders and revenue per platform."""
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response([])
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    data = (
        Order.objects.filter(restaurant=restaurant, **range_filter)
        .values('platform__slug', 'platform__name_ar', 'platform__color')
        .annotate(orders=Count('id'), revenue=Sum('total'))
        .order_by('-orders')
    )
    return Response([
        {
            'name': row['platform__name_ar'],
            'slug': row['platform__slug'],
            'color': row['platform__color'],
            'value': row['orders'],
            'revenue': float(row['revenue'] or 0),
        }
        for row in data
    ])


@api_view(['GET'])
def top_items(request):
    """Top-selling menu items."""
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response([])
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    order_ids = Order.objects.filter(restaurant=restaurant, **range_filter).values_list('id', flat=True)
    data = (
        OrderItem.objects.filter(order_id__in=order_ids)
        .values('name_snapshot')
        .annotate(units=Sum('qty'))
        .order_by('-units')[:10]
    )
    items = list(data)
    max_units = items[0]['units'] if items else 1
    return Response([
        {
            'name': row['name_snapshot'],
            'units': row['units'],
            'progress': round((row['units'] / max_units) * 100),
        }
        for row in items
    ])
