import logging
from django.utils import timezone
from rest_framework import filters, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Order
from .serializers import OrderListSerializer, OrderDetailSerializer
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
    qs = Order.objects.filter(restaurant=restaurant)
    active = [Order.STATUS_NEW, Order.STATUS_ACCEPTED, Order.STATUS_PREPARING]
    return Response({
        'active': qs.filter(status__in=active).count(),
        'preparing': qs.filter(status=Order.STATUS_PREPARING).count(),
        'completedToday': qs.filter(status=Order.STATUS_DELIVERED, delivered_at__date=today).count(),
        'avgPrepMinutes': _avg_prep_minutes(qs),
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
