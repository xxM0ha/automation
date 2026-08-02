import math

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
        return Response({'results': [], 'unreadCount': 0, 'count': 0, 'page': 1, 'numPages': 1})
    # Broadcast (user=null) OR specific to this user
    qs = Notification.objects.filter(
        restaurant=restaurant
    ).filter(
        Q(user__isnull=True) | Q(user=request.user)
    )
    unread = qs.filter(is_read=False).count()
    total = qs.count()

    # The bell dropdown omits ?page and just wants the most-recent slice; the
    # full notifications page passes ?page to walk through the whole history.
    page_param = request.query_params.get('page')
    if page_param:
        try:
            page = max(1, int(page_param))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(100, max(1, int(request.query_params.get('page_size', 20))))
        except (TypeError, ValueError):
            page_size = 20
        num_pages = max(1, math.ceil(total / page_size))
        page = min(page, num_pages)
        start = (page - 1) * page_size
        results = qs[start:start + page_size]
    else:
        page, num_pages = 1, 1
        results = qs[:50]

    return Response({
        'results': NotificationSerializer(results, many=True).data,
        'unreadCount': unread,
        'count': total,
        'page': page,
        'numPages': num_pages,
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


# Reason string written by the webhook when an order is rejected because some
# of its items have no menu mapping (see integrations/webhook_views.py).
UNLINKED_REASON = 'أصناف غير مرتبطة بالقائمة'


@api_view(['GET'])
def unlinked_items(request):
    """Distinct order items that arrived but have no menu mapping yet, for the
    current restaurant. Aggregated from the webhook rejections so the operator
    can see exactly which platform names still need linking to the menu."""
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response({'results': [], 'count': 0})

    from integrations.models import WebhookRejection
    qs = (
        WebhookRejection.objects
        .filter(restaurant=restaurant, reason=UNLINKED_REASON)
        .select_related('platform')
        .order_by('-created_at')[:200]
    )

    # Collapse repeated sightings of the same (name, platform) into one row,
    # attaching the newest Gemini suggestion seen for that name.
    agg: dict[tuple, dict] = {}
    for r in qs:
        iso = r.created_at.isoformat()
        sug_map = r.suggestions or {}
        for name in (r.items or []):
            name = (name or '').strip()
            if not name:
                continue
            key = (name, r.platform.slug)
            sug = sug_map.get(name)
            suggestion = None
            if sug:
                suggestion = {
                    'itemId': sug.get('item_id'),
                    'itemName': sug.get('item_name'),
                    'confidence': sug.get('confidence'),
                }
            entry = agg.get(key)
            if entry is None:
                agg[key] = {
                    'name': name,
                    'platform': r.platform.slug,
                    'platformName': r.platform.name_ar,
                    'count': 1,
                    'lastSeen': iso,
                    'suggestion': suggestion,
                }
            else:
                entry['count'] += 1
                if iso > entry['lastSeen']:
                    entry['lastSeen'] = iso
                    if suggestion:
                        entry['suggestion'] = suggestion
                elif suggestion and not entry.get('suggestion'):
                    entry['suggestion'] = suggestion

    results = sorted(agg.values(), key=lambda e: e['lastSeen'], reverse=True)
    return Response({'results': results, 'count': len(results)})


@api_view(['POST'])
def link_item(request):
    """Map a platform item name to one of our menu items (from the unlinked-items
    panel — usually confirming a Gemini suggestion), then re-run any held orders
    that were rejected only because of that name so they push to Foodics.

    Body: { platform: slug, name: str, menuItemId: int }
    """
    restaurant = request.user.current_restaurant
    if not restaurant:
        return Response({'detail': 'لا يوجد فرع نشط.'}, status=status.HTTP_400_BAD_REQUEST)

    from integrations.models import Platform, WebhookRejection
    from menu.models import MenuItem, MenuItemPlatform, MenuItemPlatformAlias

    platform_slug = (request.data.get('platform') or '').strip()
    name = (request.data.get('name') or '').strip().replace('ی', 'ي')
    # The global CamelCaseJSONParser rewrites incoming 'menuItemId' → 'menu_item_id'.
    item_id = request.data.get('menu_item_id') or request.data.get('menuItemId')
    if not platform_slug or not name or not item_id:
        return Response({'detail': 'platform و name و menuItemId مطلوبة.'},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        platform = Platform.objects.get(slug=platform_slug)
        item = MenuItem.objects.get(pk=item_id, restaurant=restaurant)
    except (Platform.DoesNotExist, MenuItem.DoesNotExist):
        return Response({'detail': 'صنف أو تطبيق غير موجود.'}, status=status.HTTP_404_NOT_FOUND)

    # Create the mapping (primary platform_name) or, if the item already has one
    # for this platform, add this name as an alias — mirrors matcher.resolve().
    mapping, created = MenuItemPlatform.objects.get_or_create(
        menu_item=item, platform=platform, defaults={'platform_name': name},
    )
    if not created:
        if not (mapping.platform_name or '').strip():
            mapping.platform_name = name
            mapping.save(update_fields=['platform_name'])
        elif mapping.platform_name.strip() != name:
            MenuItemPlatformAlias.objects.get_or_create(mapping=mapping, name=name)

    # Re-run held orders that included this name and are still unmatched.
    reprocessed = 0
    held = (WebhookRejection.objects
            .filter(restaurant=restaurant, platform=platform, reason=UNLINKED_REASON)
            .order_by('created_at'))
    for rej in held:
        if name in (rej.items or []):
            if _reprocess_rejection(rej):
                rej.delete()
                reprocessed += 1

    return Response({'mapped': True, 'item_name': item.name, 'reprocessed': reprocessed})


def _reprocess_rejection(rej):
    """Re-submit a held order's raw_text through the webhook pipeline. Returns
    True if it was accepted (order created / already exists) so the caller can
    clear the rejection."""
    try:
        from rest_framework.test import APIRequestFactory
        from integrations.webhook_views import receive_webhook
        rf = APIRequestFactory()
        req = rf.post('/api/webhooks/', {
            'platform': rej.platform.slug,
            'restaurant': rej.restaurant.slug,
            'raw_text': rej.raw_text,
        }, format='json')
        resp = receive_webhook(req)
        return getattr(resp, 'status_code', 500) == 200
    except Exception:
        import logging
        logging.getLogger('prime.notifications').exception('[link] reprocess failed')
        return False
