import logging
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import MenuItem, MenuCategory
from .serializers import MenuItemSerializer, MenuCategorySerializer
from api.base import TenantScopedViewSet

logger = logging.getLogger('prime.menu')


class MenuCategoryViewSet(TenantScopedViewSet):
    model = MenuCategory
    serializer_class = MenuCategorySerializer
    pagination_class = None


class MenuItemViewSet(TenantScopedViewSet):
    model = MenuItem
    serializer_class = MenuItemSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset().prefetch_related('platform_mappings__platform')
        if self.request.query_params.get('category'):
            qs = qs.filter(category__id=self.request.query_params['category'])
        if self.request.query_params.get('status'):
            qs = qs.filter(status=self.request.query_params['status'])
        return qs


@api_view(['PATCH'])
def toggle_availability(request, pk):
    restaurant = request.user.current_restaurant
    try:
        item = MenuItem.objects.get(pk=pk, restaurant=restaurant)
    except MenuItem.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    item.is_available = not item.is_available
    item.save(update_fields=['is_available'])
    logger.info('[menu] Item %s availability → %s', item.name, item.is_available)
    return Response(MenuItemSerializer(item).data)


@api_view(['POST'])
def sync_item(request, pk):
    restaurant = request.user.current_restaurant
    try:
        item = MenuItem.objects.get(pk=pk, restaurant=restaurant)
    except MenuItem.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    # Enqueue background sync job
    from django_q.tasks import async_task
    async_task('menu.jobs.sync_menu_item', item.id)
    logger.info('[menu] Sync job queued for item %s', item.name)
    return Response({'detail': 'تمت جدولة المزامنة.'})
