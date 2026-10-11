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


def _import_branches(request):
    """(source, target, error_response) for an import request."""
    target = request.user.current_restaurant
    if target is None:
        return None, None, Response({'detail': 'لا يوجد فرع نشط.'}, status=status.HTTP_400_BAD_REQUEST)
    slug = (request.query_params.get('branch') or request.data.get('branch') or '').strip()
    source = next((b for b in request.user.accessible_restaurants if b.slug == slug), None)
    if source is None:
        return None, None, Response({'detail': 'الفرع غير موجود أو غير متاح لك.'}, status=status.HTTP_404_NOT_FOUND)
    if source.id == target.id:
        return None, None, Response({'detail': 'اختر فرعاً آخر غير الفرع الحالي.'}, status=status.HTTP_400_BAD_REQUEST)
    return source, target, None


@api_view(['GET'])
def import_source(request):
    """Items of another branch, flagged with what this branch already has."""
    source, target, err = _import_branches(request)
    if err:
        return err
    from .import_utils import source_listing
    return Response({
        'branch': source.slug,
        'name': source.name,
        'items': source_listing(source, target),
    })


@api_view(['POST'])
def import_items(request):
    """Copy the chosen items from another branch into the current one, with
    their Foodics price, category and per-app names/aliases."""
    source, target, err = _import_branches(request)
    if err:
        return err
    raw_ids = request.data.get('item_ids') or request.data.get('itemIds') or []
    try:
        ids = [int(i) for i in raw_ids]
    except (TypeError, ValueError):
        return Response({'detail': 'قائمة الأصناف غير صحيحة.'}, status=status.HTTP_400_BAD_REQUEST)
    if not ids:
        return Response({'detail': 'لم يتم اختيار أي صنف.'}, status=status.HTTP_400_BAD_REQUEST)

    update_existing = bool(request.data.get('update_existing') or request.data.get('updateExisting'))
    from django.db import transaction
    from .import_utils import import_items as run_import
    with transaction.atomic():
        result = run_import(source, target, ids, update_existing)
    logger.info(
        '[menu] %s imported %d item(s) %s → %s (created %d, updated %d, skipped %d)',
        request.user.email, len(ids), source.slug, target.slug,
        result['created'], result['updated'], result['skipped'],
    )
    return Response(result)


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
    # Auto-push the change to the restaurant's device(s) so the automation app
    # toggles it on each connected platform. Never let a push failure break the
    # toggle response.
    try:
        from integrations.fcm import push_item_availability
        push_item_availability(item)
    except Exception:
        logger.exception('[menu] availability push failed for item %s', item.id)
    return Response(MenuItemSerializer(item).data)


@api_view(['POST'])
def bulk_availability(request):
    """Turn several items on or off at once. The devices get ONE message per
    app with the whole list (see push_items_availability), not one per item.

    Body: { itemIds: [int, ...], available: bool }"""
    restaurant = request.user.current_restaurant
    if restaurant is None:
        return Response({'detail': 'لا يوجد فرع نشط.'}, status=status.HTTP_400_BAD_REQUEST)
    raw_ids = request.data.get('item_ids') or request.data.get('itemIds') or []
    available = request.data.get('available')
    try:
        ids = [int(i) for i in raw_ids]
    except (TypeError, ValueError):
        return Response({'detail': 'قائمة الأصناف غير صحيحة.'}, status=status.HTTP_400_BAD_REQUEST)
    if not ids or not isinstance(available, bool):
        return Response({'detail': 'itemIds و available مطلوبان.'}, status=status.HTTP_400_BAD_REQUEST)

    # Only items that actually change are saved and pushed — re-sending an item
    # already in that state would make the device open it for nothing.
    changing = list(
        MenuItem.objects.filter(restaurant=restaurant, id__in=ids)
        .exclude(is_available=available).values_list('id', flat=True)
    )
    MenuItem.objects.filter(id__in=changing).update(is_available=available)
    logger.info('[menu] %d item(s) availability → %s (bulk)', len(changing), available)

    qs = (MenuItem.objects.filter(id__in=changing)
          .select_related('restaurant', 'category')
          .prefetch_related('platform_mappings__platform', 'platform_mappings__aliases'))
    items = list(qs)
    try:
        from integrations.fcm import push_items_availability
        push_items_availability(items)
    except Exception:
        logger.exception('[menu] bulk availability push failed')
    return Response({'updated': len(items), 'items': MenuItemSerializer(items, many=True).data})


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
