import logging
from django.utils import timezone
from rest_framework import filters, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from django.db.models import Sum
from .models import Order, OrderItem
from .serializers import OrderListSerializer, OrderDetailSerializer, OrderItemSerializer
from .services import transition_order_status
from api.base import TenantScopedViewSet

logger = logging.getLogger('prime.orders')


def _avg_prep_minutes(qs):
    from django.db.models import Avg, ExpressionWrapper, F, DurationField
    result = (
        qs.filter(
            status=Order.STATUS_DELIVERED,
            accepted_at__isnull=False,
            delivered_at__isnull=False,
        )
        .annotate(
            prep_duration=ExpressionWrapper(
                F('delivered_at') - F('accepted_at'),
                output_field=DurationField(),
            )
        )
        .aggregate(avg=Avg('prep_duration'))
    )
    avg = result.get('avg')
    if avg is None:
        return 0
    return round(avg.total_seconds() / 60)


class OrderViewSet(TenantScopedViewSet):
    model = Order
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['customer_name', 'customer_phone', 'external_id']
    ordering_fields = ['created_at', 'total', 'status']

    def get_queryset(self):
        qs = super().get_queryset().select_related('platform')
        params = self.request.query_params
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        if params.get('platform'):
            qs = qs.filter(platform__slug=params['platform'])
        if params.get('date_from'):
            qs = qs.filter(created_at__date__gte=params['date_from'])
        if params.get('date_to'):
            qs = qs.filter(created_at__date__lte=params['date_to'])
        return qs

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return OrderDetailSerializer
        return OrderListSerializer


@api_view(['GET'])
def live_activity(request):
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response([])
    orders = Order.objects.filter(restaurant=restaurant).select_related('platform')[:20]
    return Response(OrderListSerializer(orders, many=True).data)


@api_view(['GET'])
def order_stats(request):
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response({})
    today = timezone.now().date()
    qs_all   = Order.objects.filter(restaurant=restaurant)
    qs_today = qs_all.filter(created_at__date=today)
    active = [Order.STATUS_NEW, Order.STATUS_ACCEPTED, Order.STATUS_PREPARING]
    return Response({
        'active': qs_today.filter(status__in=active).count(),
        'preparing': qs_today.filter(status=Order.STATUS_PREPARING).count(),
        'completedToday': qs_today.filter(status=Order.STATUS_DELIVERED).count(),
        'avgPrepMinutes': _avg_prep_minutes(qs_all),
    })


@api_view(['PATCH'])
def update_status(request, pk):
    restaurant = request.user.current_restaurant
    try:
        order = Order.objects.get(pk=pk, restaurant=restaurant)
    except Order.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    new_status = request.data.get('status')
    if not new_status:
        return Response({'detail': 'status مطلوب.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        transition_order_status(order, new_status, request.user)
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(OrderDetailSerializer(order).data)


def _recalc_total(order):
    total = order.order_items.aggregate(
        t=Sum('unit_price' if False else '__total')
    )['t']
    # Recalculate manually
    s = sum(i.unit_price * i.qty for i in order.order_items.all())
    order.total = s
    order.save(update_fields=['total'])


@api_view(['GET'])
def order_detail(request, pk):
    restaurant = request.user.current_restaurant
    try:
        order = Order.objects.select_related('platform').prefetch_related('order_items__menu_item').get(pk=pk, restaurant=restaurant)
    except Order.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(OrderDetailSerializer(order).data)


@api_view(['POST'])
def order_add_item(request, pk):
    """Add an item to an existing order."""
    restaurant = request.user.current_restaurant
    try:
        order = Order.objects.prefetch_related('order_items').get(pk=pk, restaurant=restaurant)
    except Order.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    name       = (request.data.get('name') or '').strip()
    qty        = int(request.data.get('qty') or 1)
    unit_price = float(request.data.get('unit_price') or 0)
    notes      = (request.data.get('notes') or '').strip()
    menu_item_id = request.data.get('menu_item_id')

    if not name:
        return Response({'detail': 'name مطلوب.'}, status=status.HTTP_400_BAD_REQUEST)

    menu_item = None
    if menu_item_id:
        from menu.models import MenuItem
        try:
            menu_item = MenuItem.objects.get(pk=menu_item_id, restaurant=restaurant)
            if not name:
                name = menu_item.name
            if unit_price == 0:
                unit_price = float(menu_item.price)
        except MenuItem.DoesNotExist:
            pass

    item = OrderItem.objects.create(
        order=order,
        menu_item=menu_item,
        name_snapshot=name,
        qty=qty,
        unit_price=unit_price,
        notes=notes,
    )
    _recalc_total(order)
    order.refresh_from_db()
    return Response(OrderDetailSerializer(order).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def order_item_detail(request, pk, item_id):
    """Update qty/notes or delete a single order item."""
    restaurant = request.user.current_restaurant
    try:
        order = Order.objects.get(pk=pk, restaurant=restaurant)
        item  = OrderItem.objects.get(pk=item_id, order=order)
    except (Order.DoesNotExist, OrderItem.DoesNotExist):
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        item.delete()
        _recalc_total(order)
        order.refresh_from_db()
        return Response(OrderDetailSerializer(order).data)

    # PATCH — update qty and/or notes
    if 'qty' in request.data:
        qty = int(request.data['qty'])
        if qty < 1:
            return Response({'detail': 'qty يجب أن يكون 1 على الأقل.'}, status=status.HTTP_400_BAD_REQUEST)
        item.qty = qty
    if 'notes' in request.data:
        item.notes = request.data['notes']
    item.save()
    _recalc_total(order)
    order.refresh_from_db()
    return Response(OrderDetailSerializer(order).data)


@api_view(['POST'])
def reject_order(request, pk):
    restaurant = request.user.current_restaurant
    try:
        order = Order.objects.get(pk=pk, restaurant=restaurant)
    except Order.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    order.rejection_reason = request.data.get('reason', '')
    try:
        transition_order_status(order, Order.STATUS_REJECTED, request.user)
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(OrderDetailSerializer(order).data)
