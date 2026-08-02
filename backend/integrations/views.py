import logging
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Platform, RestaurantPlatform, Device, PendingMenuSync
from .serializers import PlatformSerializer

logger = logging.getLogger('prime.integrations')


@api_view(['GET'])
def pending_syncs(request):
    """Host-side (ADB/Pi) menu-sync queue — the FCM replacement for runners that
    can't receive push. Returns pending availability changes for the caller's
    restaurant (optionally filtered by ?platforms=slug,slug) and consumes them.
    Jobs are merged per platform, latest state per item name winning."""
    restaurant = request.user.current_restaurant
    qs = (PendingMenuSync.objects
          .filter(restaurant=restaurant)
          .select_related('platform')
          .order_by('created_at'))
    platforms_param = request.query_params.get('platforms')
    if platforms_param:
        slugs = [s.strip() for s in platforms_param.split(',') if s.strip()]
        qs = qs.filter(platform__slug__in=slugs)

    rows = list(qs)
    consumed_ids = [r.id for r in rows]
    by_platform = {}
    for r in rows:
        by_platform.setdefault(r.platform.slug, {})[r.name] = r.available  # latest wins
    jobs = [
        {'platform': slug,
         'items': [{'name': n, 'available': a} for n, a in items.items()]}
        for slug, items in by_platform.items()
    ]
    PendingMenuSync.objects.filter(id__in=consumed_ids).delete()
    return Response(jobs)


@api_view(['GET'])
def list_platforms(request):
    restaurant = request.user.current_restaurant
    platforms = Platform.objects.all()
    return Response(PlatformSerializer(platforms, many=True, context={'restaurant': restaurant}).data)


@api_view(['GET'])
def platform_detail(request, slug):
    restaurant = request.user.current_restaurant
    try:
        platform = Platform.objects.get(slug=slug)
    except Platform.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(PlatformSerializer(platform, context={'restaurant': restaurant}).data)


@api_view(['PATCH'])
def connect_platform(request, slug):
    restaurant = request.user.current_restaurant
    try:
        platform = Platform.objects.get(slug=slug)
    except Platform.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    rp, _ = RestaurantPlatform.objects.get_or_create(
        restaurant=restaurant, platform=platform
    )
    val = request.data.get('isConnected', request.data.get('is_connected', rp.is_connected))
    rp.is_connected = val
    rp.save(update_fields=['is_connected'])
    logger.info('[integrations] %s → %s connected=%s', restaurant.slug, slug, rp.is_connected)
    return Response(PlatformSerializer(platform, context={'restaurant': restaurant}).data)


@api_view(['POST'])
def sync_platform(request, slug):
    restaurant = request.user.current_restaurant
    try:
        platform = Platform.objects.get(slug=slug)
        rp = RestaurantPlatform.objects.get(restaurant=restaurant, platform=platform)
    except (Platform.DoesNotExist, RestaurantPlatform.DoesNotExist):
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    from django_q.tasks import async_task
    async_task('integrations.jobs.sync_platform_menu', restaurant.id, platform.slug)
    rp.last_sync_at = timezone.now()
    rp.save(update_fields=['last_sync_at'])
    return Response({'detail': 'تمت جدولة المزامنة.'})


@api_view(['PATCH'])
def update_platform_settings(request, slug):
    restaurant = request.user.current_restaurant
    try:
        platform = Platform.objects.get(slug=slug)
        rp = RestaurantPlatform.objects.get(restaurant=restaurant, platform=platform)
    except (Platform.DoesNotExist, RestaurantPlatform.DoesNotExist):
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if 'autoAccept' in request.data:
        rp.auto_accept = request.data['autoAccept']
    if 'menuSync' in request.data:
        rp.menu_sync = request.data['menuSync']
    if 'posCategory' in request.data or 'pos_category' in request.data:
        rp.pos_category = (request.data.get('posCategory', request.data.get('pos_category')) or '').strip()
    if 'config' in request.data:
        rp.config.update(request.data['config'])
    rp.save()
    return Response(PlatformSerializer(platform, context={'restaurant': restaurant}).data)


@api_view(['POST'])
def register_device(request):
    """Register (or refresh) a mobile device's FCM token for the caller's restaurant."""
    restaurant = request.user.current_restaurant
    # The camelCase parser underscoreizes incoming keys, so accept both forms.
    token = (request.data.get('fcmToken') or request.data.get('fcm_token') or '').strip()
    if not token:
        return Response({'detail': 'fcmToken مطلوب.'}, status=status.HTTP_400_BAD_REQUEST)
    Device.objects.update_or_create(
        fcm_token=token,
        defaults={'restaurant': restaurant, 'platform': 'android'},
    )
    logger.info('[integrations] device registered for %s', restaurant.slug)
    return Response({'detail': 'registered'})
