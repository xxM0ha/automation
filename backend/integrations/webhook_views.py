"""
Webhook receiver — single endpoint for all delivery platform order notifications.

POST /api/webhooks/
{
    "platform":   "toters",
    "restaurant": "laffe",
    "raw_text":   "<raw order string from the platform>"
}

Pipeline:
  1. Validate required fields
  2. Resolve restaurant + platform + connection
  3. Parse raw_text → structured draft
  4. Idempotency check (skip duplicate external IDs)
  5. Match items via MenuItemPlatform.platform_name (strict, exact only)
  6. Check availability of matched items
  7. Persist Order + OrderItems
  8. Enqueue POS push (Foodics)
  9. Create notification
"""
import logging

from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from restaurants.models import Restaurant
from .models import Platform, RestaurantPlatform
from orders.models import Order

logger = logging.getLogger('prime.webhooks')

MAX_RAW_BYTES = 100 * 1024  # 100 KB — raw text orders are tiny


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def receive_webhook(request):
    # ── Size guard ────────────────────────────────────────────────────────────
    if len(request.body) > MAX_RAW_BYTES:
        logger.warning('[webhook] Payload too large (%d bytes)', len(request.body))
        return Response({'detail': 'Payload too large.'}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    # ── Required fields ───────────────────────────────────────────────────────
    platform_slug   = (request.data.get('platform') or '').strip()
    restaurant_slug = (request.data.get('restaurant') or '').strip()
    raw_text        = (request.data.get('raw_text') or '').strip()

    if not platform_slug or not restaurant_slug:
        return Response(
            {'detail': 'platform and restaurant are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not raw_text:
        return Response(
            {'detail': 'raw_text is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── Restaurant alias mapping (zohor/riz/ziraee → laffe) ──────────────────
    RESTAURANT_ALIASES = {'zohor': 'laffe', 'riz': 'laffe', 'ziraee': 'laffe'}
    source_restaurant = restaurant_slug  # preserve original for branch/menu mapping
    restaurant_slug   = RESTAURANT_ALIASES.get(restaurant_slug, restaurant_slug)

    # ── Resolve restaurant + platform ─────────────────────────────────────────
    try:
        restaurant = Restaurant.objects.get(slug=restaurant_slug, is_active=True)
        platform   = Platform.objects.get(slug=platform_slug)
        RestaurantPlatform.objects.get(restaurant=restaurant, platform=platform, is_connected=True)
    except Restaurant.DoesNotExist:
        logger.warning('[webhook] Unknown restaurant: %s', restaurant_slug)
        return Response({'detail': 'Restaurant not found.'}, status=status.HTTP_404_NOT_FOUND)
    except Platform.DoesNotExist:
        logger.warning('[webhook] Unknown platform: %s', platform_slug)
        return Response({'detail': 'Platform not found.'}, status=status.HTTP_404_NOT_FOUND)
    except RestaurantPlatform.DoesNotExist:
        logger.warning('[webhook] %s not connected to %s', platform_slug, restaurant_slug)
        return Response({'detail': 'Platform not connected.'}, status=status.HTTP_403_FORBIDDEN)

    logger.info(
        '[webhook] %s → %s received, raw_text length=%d',
        platform_slug, restaurant_slug, len(raw_text),
    )

    # ── Parse raw_text ────────────────────────────────────────────────────────
    draft = _parse(platform_slug, raw_text)
    if draft is None:
        logger.warning(
            '[webhook] %s: no parser available, order stored as pending',
            platform_slug,
        )
        _create_alert_notification(
            restaurant, platform,
            f'التطبيق: {platform.name_ar}\n'
            f'السبب: فشل في قراءة الطلب (لا يوجد محلل للتطبيق)\n\n'
            f'يرجى إدخال الطلب يدوياً.'
        )
        return Response({'status': 'received', 'parsed': False})

    # ── Idempotency ───────────────────────────────────────────────────────────
    ext_id = draft.get('external_id', '').strip()
    if not ext_id:
        # Platform didn't expose an order ID — generate one so the unique
        # constraint (platform, external_id) is always satisfied.
        import uuid
        ext_id = f'auto-{uuid.uuid4().hex[:12]}'

    if Order.objects.filter(platform=platform, external_id=ext_id).exists():
        logger.info('[webhook] %s duplicate order %s, ignoring', platform_slug, ext_id)
        return Response({'status': 'received', 'parsed': True, 'duplicate': True})

    # ── Match items to menu ───────────────────────────────────────────────────
    from menu.matcher import resolve_items
    resolved_items, unmatched = resolve_items(draft.get('items', []), platform, restaurant)

    if unmatched:
        logger.info(
            '[webhook] %s order rejected — unmatched items: %s | raw_text: %s',
            platform_slug, unmatched, raw_text,
        )
        items_list = '\n'.join(f'• {name}' for name in unmatched)
        _create_alert_notification(
            restaurant, platform,
            f'التطبيق: {platform.name_ar}\n'
            f'السبب: أصناف غير مرتبطة بالقائمة\n\n'
            f'{items_list}\n\n'
            f'يرجى إدخال الطلب يدوياً.'
        )
        return Response({
            'status':         'rejected',
            'reason':         'بعض الأصناف غير مرتبطة بالقائمة.',
            'unmatchedItems': unmatched,
        }, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    # ── Availability check ────────────────────────────────────────────────────
    unavailable = [
        it['name_snapshot']
        for it in resolved_items
        if not it['menu_item'].is_available or it['menu_item'].status == 'hidden'
    ]
    if unavailable:
        logger.info('[webhook] %s order rejected — unavailable: %s', platform_slug, unavailable)
        items_list = '\n'.join(f'• {name}' for name in unavailable)
        _create_alert_notification(
            restaurant, platform,
            f'التطبيق: {platform.name_ar}\n'
            f'السبب: أصناف غير متاحة\n\n'
            f'{items_list}\n\n'
            f'يرجى إدخال الطلب يدوياً.'
        )
        return Response({
            'status':           'rejected',
            'reason':           'بعض العناصر غير متاحة.',
            'unavailableItems': unavailable,
        }, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    # ── Persist order ─────────────────────────────────────────────────────────
    from orders.services import create_order_from_draft

    order = create_order_from_draft(
        external_id=ext_id,
        customer_name=draft.get('customer_name', ''),
        customer_phone=draft.get('customer_phone', ''),
        address=draft.get('address', ''),
        notes=draft.get('notes', ''),
        total=draft.get('total', 0),
        raw_payload={'platform': platform_slug, 'restaurant': restaurant_slug, 'source_restaurant': source_restaurant, 'raw_text': raw_text},
        items=resolved_items,
        restaurant=restaurant,
        platform=platform,
    )

    # ── Enqueue POS push ──────────────────────────────────────────────────────
    try:
        from django_q.tasks import async_task
        async_task('integrations.jobs.push_order_to_pos', order.id)
    except Exception:
        logger.exception('[webhook] Failed to enqueue POS push for order %s', order.id)

    _create_order_notification(restaurant, platform, order)

    logger.info('[webhook] %s order %s created, POS push queued', platform_slug, order.external_id)
    return Response({'status': 'received'})


# ── Parser dispatch ────────────────────────────────────────────────────────────

def _parse(platform_slug: str, raw_text: str) -> dict | None:
    """
    Import integrations/parsers/{platform_slug}.py and call parse(raw_text).
    Returns None if no parser module exists yet.
    """
    try:
        import importlib
        mod = importlib.import_module(f'integrations.parsers.{platform_slug}')
        return mod.parse(raw_text)
    except ModuleNotFoundError:
        return None
    except Exception:
        logger.exception('[webhook] Parser error for platform %s', platform_slug)
        return None


# ── Notifications ─────────────────────────────────────────────────────────────

def _create_order_notification(restaurant, platform, order):
    try:
        from notifications_app.models import Notification
        Notification.objects.create(
            restaurant=restaurant,
            title=f'طلب جديد — {platform.name_ar}',
            body=f'طلب #{order.external_id} من {order.customer_name} بقيمة {order.total}',
            type='order',
            related_order=order,
        )
    except Exception:
        logger.exception('[webhook] Failed to create order notification')


def _create_alert_notification(restaurant, platform, message: str):
    try:
        from notifications_app.models import Notification
        Notification.objects.create(
            restaurant=restaurant,
            title=f'تنبيه — {platform.name_ar}',
            body=message,
            type='alert',
        )
    except Exception:
        logger.exception('[webhook] Failed to create alert notification')
