import logging
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Platform, RestaurantPlatform
from .serializers import PlatformSerializer

logger = logging.getLogger('prime.integrations')


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
    if 'config' in request.data:
        rp.config.update(request.data['config'])
    rp.save()
    return Response(PlatformSerializer(platform, context={'restaurant': restaurant}).data)
