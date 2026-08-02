import logging
from datetime import timedelta
from django.utils import timezone
from django.db.models import Count, Sum, F, ExpressionWrapper, DecimalField
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Order, OrderItem

logger = logging.getLogger('prime.reports')

# Reason string the webhook records when an order is rejected for unmapped items.
UNLINKED_REASON = 'أصناف غير مرتبطة بالقائمة'


def _report_restaurants(request):
    """Restaurants a report should cover. An owner can pass
    ?branches=slug1,slug2 (validated against the branches they can access) to
    aggregate across branches; otherwise it's just the active branch."""
    user = request.user
    slugs = [s.strip() for s in (request.query_params.get('branches') or '').split(',') if s.strip()]
    if slugs:
        rs = list(user.accessible_restaurants.filter(slug__in=slugs))
        if rs:
            return rs
    r = user.current_restaurant
    return [r] if r else []


def _get_range_filter(range_param):
    today = timezone.now().date()
    if range_param == '7d':
        return {'created_at__date__gte': today - timedelta(days=7)}
    elif range_param == '30d':
        return {'created_at__date__gte': today - timedelta(days=30)}
    elif range_param == '90d':
        return {'created_at__date__gte': today - timedelta(days=90)}
    return {'created_at__date': today}  # default: today


def _get_prev_range_filter(range_param):
    """The period immediately BEFORE the selected one — for period-over-period
    deltas. Mirrors the window length of _get_range_filter."""
    today = timezone.now().date()
    spans = {'7d': 7, '30d': 30, '90d': 90}
    if range_param in spans:
        n = spans[range_param]
        return {'created_at__date__gte': today - timedelta(days=2 * n),
                'created_at__date__lt': today - timedelta(days=n)}
    return {'created_at__date': today - timedelta(days=1)}  # default today → yesterday


def _summary_for(qs):
    # Orders in this flow auto-accept and push to Foodics; they don't get a
    # 'delivered' transition. So "revenue" is every accepted order (i.e. not
    # cancelled/rejected) — consistent with the platform breakdown — rather than
    # delivered-only, which would always read 0.
    valid = qs.exclude(status__in=[Order.STATUS_CANCELLED, Order.STATUS_REJECTED])
    vc = valid.count()
    rev = float(valid.aggregate(t=Sum('total'))['t'] or 0)
    return {
        'totalOrders': qs.count(),
        'completedOrders': vc,
        'totalRevenue': rev,
        'avgOrderValue': (rev / vc) if vc else 0.0,
    }


def _pct_delta(cur, prev):
    if not prev:
        return None  # no baseline → frontend shows a neutral dash
    return round((cur - prev) / prev * 100, 1)


@api_view(['GET'])
def summary(request):
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response({})
    range_param = request.query_params.get('range', 'today')
    cur = _summary_for(Order.objects.filter(restaurant__in=restaurants, **_get_range_filter(range_param)))
    prev = _summary_for(Order.objects.filter(restaurant__in=restaurants, **_get_prev_range_filter(range_param)))
    cur['deltas'] = {k: _pct_delta(cur[k], prev[k]) for k in
                     ('totalOrders', 'completedOrders', 'totalRevenue', 'avgOrderValue')}
    return Response(cur)


@api_view(['GET'])
def velocity(request):
    """Orders over time — hourly for today, daily for longer ranges."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response([])
    range_param = request.query_params.get('range', 'today')
    range_filter = _get_range_filter(range_param)
    qs = Order.objects.filter(restaurant__in=restaurants, **range_filter).order_by('created_at')
    buckets: dict = {}
    for order in qs.values('created_at'):
        local_dt = timezone.localtime(order['created_at'])
        key = local_dt.strftime('%H:00') if range_param == 'today' else local_dt.strftime('%m/%d')
        buckets[key] = buckets.get(key, 0) + 1
    return Response([{'time': k, 'orders': c} for k, c in sorted(buckets.items())])


@api_view(['GET'])
def platforms(request):
    """Platform breakdown — orders and revenue per platform."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response([])
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    data = (
        Order.objects.filter(restaurant__in=restaurants, **range_filter)
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
            'avgOrderValue': float((row['revenue'] or 0) / row['orders']) if row['orders'] else 0.0,
        }
        for row in data
    ])


@api_view(['GET'])
def peak_forecast(request):
    """
    Historical average orders per hour for the same weekday over the past N weeks.
    Returns 24 buckets (00–23) with the mean order count so the frontend can
    predict tonight's (or any future) peak based on past same-weekday patterns.
    """
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response([])

    weeks_back = int(request.query_params.get('weeks', 8))
    today = timezone.now().date()
    weekday = today.weekday()  # 0=Mon … 6=Sun

    # Collect the dates of the past `weeks_back` occurrences of the same weekday
    same_weekday_dates = []
    d = today - timedelta(days=7)  # start from last week (exclude today — partial data)
    while len(same_weekday_dates) < weeks_back:
        if d.weekday() == weekday:
            same_weekday_dates.append(d)
        d -= timedelta(days=1)

    if not same_weekday_dates:
        return Response([{'hour': h, 'avg': 0} for h in range(24)])

    qs = Order.objects.filter(
        restaurant__in=restaurants,
        created_at__date__in=same_weekday_dates,
    )

    # Bucket by hour in Python (SQLite-safe, timezone-aware)
    day_buckets: dict[str, dict[int, int]] = {}  # date → {hour: count}
    for row in qs.values('created_at'):
        local_dt = timezone.localtime(row['created_at'])
        date_key = str(local_dt.date())
        hour = local_dt.hour
        day_buckets.setdefault(date_key, {})
        day_buckets[date_key][hour] = day_buckets[date_key].get(hour, 0) + 1

    num_days = len(day_buckets) or 1
    hour_totals: dict[int, int] = {}
    for hours in day_buckets.values():
        for h, c in hours.items():
            hour_totals[h] = hour_totals.get(h, 0) + c

    return Response([
        {'hour': h, 'avg': round(hour_totals.get(h, 0) / num_days, 2)}
        for h in range(24)
    ])


@api_view(['GET'])
def top_items(request):
    """Top-selling menu items — ranked by units (default) or revenue (?by=revenue)."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response([])
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    by = request.query_params.get('by', 'units')
    order_ids = Order.objects.filter(restaurant__in=restaurants, **range_filter).values_list('id', flat=True)
    revenue_expr = ExpressionWrapper(
        F('qty') * F('unit_price'), output_field=DecimalField(max_digits=12, decimal_places=2)
    )
    data = (
        OrderItem.objects.filter(order_id__in=order_ids)
        .values('name_snapshot')
        .annotate(units=Sum('qty'), revenue=Sum(revenue_expr))
        .order_by('-revenue' if by == 'revenue' else '-units')[:10]
    )
    items = list(data)
    key = 'revenue' if by == 'revenue' else 'units'
    max_val = float(items[0][key] or 0) if items else 1
    return Response([
        {
            'name': row['name_snapshot'],
            'units': row['units'],
            'revenue': float(row['revenue'] or 0),
            'progress': round((float(row[key] or 0) / (max_val or 1)) * 100),
        }
        for row in items
    ])


@api_view(['GET'])
def daily_summary(request):
    """Per-day order count and revenue for the selected range."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response([])
    range_param = request.query_params.get('range', '7d')
    range_filter = _get_range_filter(range_param)
    qs = Order.objects.filter(restaurant__in=restaurants, **range_filter)

    day_data: dict = {}
    for order in qs.values('created_at', 'total', 'status'):
        local_dt = timezone.localtime(order['created_at'])
        date_str = str(local_dt.date())
        if date_str not in day_data:
            day_data[date_str] = {'orders': 0, 'revenue': 0.0, 'completed': 0}
        day_data[date_str]['orders'] += 1
        if order['status'] not in (Order.STATUS_CANCELLED, Order.STATUS_REJECTED):
            day_data[date_str]['revenue'] += float(order['total'] or 0)
            day_data[date_str]['completed'] += 1

    return Response([
        {
            'date': date,
            'orders': data['orders'],
            'revenue': data['revenue'],
            'completed': data['completed'],
        }
        for date, data in sorted(day_data.items(), reverse=True)
    ])


@api_view(['GET'])
def automation_health(request):
    """How cleanly incoming orders flowed through automation: pushed to Foodics
    OK vs. failed push (Order.pos_error) vs. rejected before becoming an order
    (WebhookRejection). Plus rejection reasons and the most-frequent unmapped
    item names."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response({})
    from integrations.models import WebhookRejection
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))

    orders = Order.objects.filter(restaurant__in=restaurants, **range_filter)
    total_orders = orders.count()
    push_failed = orders.exclude(pos_error='').count()
    pushed_ok = total_orders - push_failed

    rej = WebhookRejection.objects.filter(restaurant__in=restaurants, **range_filter)
    rejected = rej.count()
    incoming = total_orders + rejected
    success_rate = round(pushed_ok / incoming * 100, 1) if incoming else 0.0

    reasons = [
        {'reason': r['reason'], 'count': r['count']}
        for r in rej.values('reason').annotate(count=Count('id')).order_by('-count')
    ]

    agg: dict[str, int] = {}
    for items in rej.filter(reason=UNLINKED_REASON).values_list('items', flat=True):
        for name in (items or []):
            name = (name or '').strip()
            if name:
                agg[name] = agg.get(name, 0) + 1
    top_unmatched = sorted(
        ({'name': k, 'count': v} for k, v in agg.items()),
        key=lambda x: x['count'], reverse=True,
    )[:8]

    return Response({
        'incoming': incoming,
        'pushedOk': pushed_ok,
        'pushFailed': push_failed,
        'rejected': rejected,
        'successRate': success_rate,
        'reasons': reasons,
        'topUnmatched': top_unmatched,
    })


@api_view(['GET'])
def fulfillment(request):
    """Order funnel + timing: counts per status, cancel/reject rate, and the
    average minutes to accept (created→accepted) and to fulfil (accepted→
    delivered)."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response({})
    range_filter = _get_range_filter(request.query_params.get('range', 'today'))
    qs = Order.objects.filter(restaurant__in=restaurants, **range_filter)
    total = qs.count()

    status_counts = {row['status']: row['c'] for row in qs.values('status').annotate(c=Count('id'))}
    cancelled = status_counts.get('cancelled', 0) + status_counts.get('rejected', 0)
    cancel_rate = round(cancelled / total * 100, 1) if total else 0.0

    accept_secs, fulfil_secs = [], []
    for o in qs.values('created_at', 'accepted_at', 'delivered_at'):
        if o['accepted_at']:
            accept_secs.append((o['accepted_at'] - o['created_at']).total_seconds())
        if o['accepted_at'] and o['delivered_at']:
            fulfil_secs.append((o['delivered_at'] - o['accepted_at']).total_seconds())

    def avg_min(xs):
        return round(sum(xs) / len(xs) / 60, 1) if xs else None

    return Response({
        'total': total,
        'avgAcceptMinutes': avg_min(accept_secs),
        'avgFulfilMinutes': avg_min(fulfil_secs),
        'cancelRate': cancel_rate,
        'statusCounts': status_counts,
    })


@api_view(['GET'])
def peak_heatmap(request):
    """Order counts bucketed by weekday × hour over the selected range, for a
    busy-times heatmap. weekday: 0=Mon … 6=Sun (the frontend orders the rows)."""
    restaurants = _report_restaurants(request)
    if not restaurants:
        return Response([])
    range_filter = _get_range_filter(request.query_params.get('range', '30d'))
    qs = Order.objects.filter(restaurant__in=restaurants, **range_filter)
    grid: dict[tuple[int, int], int] = {}
    for o in qs.values('created_at'):
        lt = timezone.localtime(o['created_at'])
        key = (lt.weekday(), lt.hour)
        grid[key] = grid.get(key, 0) + 1
    return Response([{'day': d, 'hour': h, 'count': c} for (d, h), c in grid.items()])
