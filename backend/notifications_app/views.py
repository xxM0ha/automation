from django.db.models import Q
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Notification
from .serializers import NotificationSerializer


@api_view(['GET'])
def list_notifications(request):
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response({'results': [], 'unread_count': 0})
    # Broadcast (user=null) OR specific to this user
    qs = Notification.objects.filter(
        restaurant=restaurant
    ).filter(
        Q(user__isnull=True) | Q(user=request.user)
    )
    unread = qs.filter(is_read=False).count()
    return Response({
        'results': NotificationSerializer(qs[:50], many=True).data,
        'unreadCount': unread,
    })


@api_view(['PATCH'])
def mark_read(request, pk):
    restaurant = request.user.current_restaurant
    try:
        n = Notification.objects.get(pk=pk, restaurant=restaurant)
    except Notification.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    n.is_read = True
    n.save(update_fields=['is_read'])
    return Response(NotificationSerializer(n).data)


@api_view(['POST'])
def mark_all_read(request):
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response({'detail': 'ok'})
    Notification.objects.filter(restaurant=restaurant, is_read=False).update(is_read=True)
    return Response({'detail': 'تم تعليم الكل كمقروء.'})
