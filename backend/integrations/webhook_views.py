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

# If a parser reports the screen's items subtotal (حاصل الجمع) and the parsed
# items fall short of it by more than this, the capture was incomplete (a long
# item list that wasn't fully scrolled) → flag, don't push. Set above normal
# paid-modifier noise (~≤1000 IQD) so complete orders aren't false-flagged.
INCOMPLETE_GAP_IQD = 2000


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

    # ── Restaurant alias mapping ─────────────────────────────────────────────
    # 'riz' is now its own account (do NOT funnel it into laffe). Legacy
    # zohor/ziraee still alias to the laffe (الزراعي) account.
    RESTAURANT_ALIASES = {'zohor': 'laffe', 'ziraee': 'laffe'}
    source_restaurant = restaurant_slug  # preserve original for branch/menu mapping
    restaurant_slug   = RESTAURANT_ALIASES.get(restaurant_slug, restaurant_slug)

    # ── Resolve restaurant + platform ─────────────────────────────────────────
    try:
        restaurant = Restaurant.objects.get(slug=restaurant_slug, is_active=True)
        platform   = Platform.objects.get(slug=platform_slug)
        rp = RestaurantPlatform.objects.get(restaurant=restaurant, platform=platform, is_connected=True)
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
        _record_rejection(restaurant, platform, '', 'لا يوجد محلل للتطبيق', raw_text)
        return Response({'status': 'received', 'parsed': False, 'confirm': False})

    # ── Idempotency ───────────────────────────────────────────────────────────
    ext_id = draft.get('external_id', '').strip()
    if not ext_id:
        import uuid
        ext_id = f'auto-{uuid.uuid4().hex[:12]}'

    # Windowed duplicate check: same platform+ID within 30 min → resend, ignore.
    # 30 min is long enough to catch the ~14-second Toters double-webhook,
    # but short enough to allow IDs that reset hourly to come through fresh.
    if not ext_id.startswith('auto-'):
        from django.utils import timezone
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(minutes=30)
        if Order.objects.filter(platform=platform, external_id=ext_id,
                                created_at__gte=cutoff).exists():
            logger.info('[webhook] %s duplicate order %s within 30min, ignoring',
                        platform_slug, ext_id)
            # Valid order, already ingested — still tell the app whether to
            # confirm on the platform (auto-accept gates the tap).
            return Response({'status': 'received', 'parsed': True, 'duplicate': True,
                             'confirm': rp.auto_accept})

    # ── Content-based idempotency ─────────────────────────────────────────────
    # The app captures the same order screen several times. A capture whose order
    # ID didn't parse gets a fresh auto- id and would otherwise create a duplicate
    # order on every repeat. Collapse repeats (auto- ids and re-sends alike) by a
    # hash of the parsed content within a 30-min window.
    from django.utils import timezone as _tz
    from datetime import timedelta as _td
    content_hash = _content_hash(platform_slug, restaurant_slug, draft)
    _win = _tz.now() - _td(minutes=30)
    for _o in Order.objects.filter(platform=platform, restaurant=restaurant,
                                   created_at__gte=_win).only('raw_payload'):
        if (_o.raw_payload or {}).get('content_hash') == content_hash:
            logger.info('[webhook] %s duplicate-by-content, ignoring', platform_slug)
            return Response({'status': 'received', 'parsed': True, 'duplicate': True,
                             'confirm': rp.auto_accept})

    # ── Completeness check ────────────────────────────────────────────────────
    # The captured screen must be whole. If the parsed items fall well short of
    # the screen's own subtotal (حاصل الجمع), the item list was truncated — a long
    # order that wasn't fully scrolled into view. Don't auto-push a partial order
    # (and don't confirm it on the platform); flag it for manual entry.
    claimed_subtotal = draft.get('subtotal') or 0
    if claimed_subtotal:
        items_sum = sum((it.get('qty') or 1) * (it.get('unit_price') or 0)
                        for it in draft.get('items', []))
        if claimed_subtotal - items_sum > INCOMPLETE_GAP_IQD:
            logger.warning(
                '[webhook] %s order %s INCOMPLETE: items=%.0f subtotal=%.0f | raw_text: %s',
                platform_slug, ext_id, items_sum, claimed_subtotal, raw_text,
            )
            _inc_reason = 'طلب غير مكتمل (لم تُقرأ الشاشة بالكامل)'
            _inc_items = [it.get('name', '') for it in draft.get('items', [])]
            if not _recent_rejection(restaurant, platform, _inc_reason, _inc_items):
                _create_alert_notification(
                    restaurant, platform,
                    f'التطبيق: {platform.name_ar}\n'
                    f'السبب: الطلب غير مكتمل — لم تُقرأ الشاشة بالكامل '
                    f'(مجموع الأصناف {items_sum:.0f} لا يطابق حاصل الجمع {claimed_subtotal:.0f})\n\n'
                    f'يرجى إدخال الطلب يدوياً.'
                )
                _record_rejection(restaurant, platform, ext_id, _inc_reason, raw_text, _inc_items)
            return Response(
                {'status': 'rejected', 'reason': 'الطلب غير مكتمل', 'confirm': False},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

    # ── Match items to menu ───────────────────────────────────────────────────
    from menu.matcher import resolve_items
    resolved_items, unmatched = resolve_items(draft.get('items', []), platform, restaurant)

    if not resolved_items and not unmatched:
        logger.info('[webhook] %s order rejected — no items parsed | raw_text: %s', platform_slug, raw_text)
        if not _recent_rejection(restaurant, platform, 'لم يُقرأ أي صنف', []):
            _create_alert_notification(
                restaurant, platform,
                f'التطبيق: {platform.name_ar}\n'
                f'السبب: لم يتم قراءة أي أصناف من الطلب\n\n'
                f'يرجى إدخال الطلب يدوياً.'
            )
            _record_rejection(restaurant, platform, ext_id, 'لم يُقرأ أي صنف', raw_text)
        return Response({'status': 'rejected', 'reason': 'no items parsed'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    if unmatched:
        logger.info(
            '[webhook] %s order rejected — unmatched items: %s | raw_text: %s',
            platform_slug, unmatched, raw_text,
        )
        if not _recent_rejection(restaurant, platform, 'أصناف غير مرتبطة بالقائمة', unmatched):
            suggestions = _suggest_unmatched(unmatched, platform, restaurant)
            items_list = '\n'.join(f'• {name}' for name in unmatched)
            _create_alert_notification(
                restaurant, platform,
                f'التطبيق: {platform.name_ar}\n'
                f'السبب: أصناف غير مرتبطة بالقائمة\n\n'
                f'{items_list}\n\n'
                f'يرجى إدخال الطلب يدوياً.'
            )
            _record_rejection(restaurant, platform, ext_id, 'أصناف غير مرتبطة بالقائمة',
                              raw_text, unmatched, suggestions)
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
        if not _recent_rejection(restaurant, platform, 'أصناف غير متاحة', unavailable):
            items_list = '\n'.join(f'• {name}' for name in unavailable)
            _create_alert_notification(
                restaurant, platform,
                f'التطبيق: {platform.name_ar}\n'
                f'السبب: أصناف غير متاحة\n\n'
                f'{items_list}\n\n'
                f'يرجى إدخال الطلب يدوياً.'
            )
            _record_rejection(restaurant, platform, ext_id, 'أصناف غير متاحة', raw_text, unavailable)
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
        raw_payload={'platform': platform_slug, 'restaurant': restaurant_slug, 'source_restaurant': source_restaurant, 'raw_text': raw_text, 'content_hash': content_hash},
        items=resolved_items,
        restaurant=restaurant,
        platform=platform,
    )

    # ── Route the order: local print agent OR Foodics push ────────────────────
    if restaurant.printing_enabled:
        # Branch has no POS link — queue the ticket for the local print agent.
        try:
            from .models import PrintJob
            PrintJob.objects.create(restaurant=restaurant, order=order)
            logger.info('[webhook] order %s queued for print agent', order.external_id)
        except Exception:
            logger.exception('[webhook] Failed to queue print job for order %s', order.id)
    else:
        try:
            from django_q.tasks import async_task
            async_task('integrations.jobs.push_order_to_pos', order.id)
        except Exception:
            logger.exception('[webhook] Failed to enqueue POS push for order %s', order.id)

    _create_order_notification(restaurant, platform, order)

    logger.info('[webhook] %s order %s created, POS push queued', platform_slug, order.external_id)
    # confirm tells the app whether to tap "أكد الطلب" on the platform: only
    # when the order is valid (we're here) AND auto-accept is enabled for this
    # restaurant+platform (toggled from the panel).
    return Response({'status': 'received', 'confirm': rp.auto_accept})


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


def _record_rejection(restaurant, platform, external_id, reason, raw_text, items=None, suggestions=None):
    """Persist a webhook rejection for the developer diagnostics page."""
    try:
        from .models import WebhookRejection
        WebhookRejection.objects.create(
            restaurant=restaurant,
            platform=platform,
            external_id=external_id or '',
            reason=reason,
            items=items or [],
            suggestions=suggestions or {},
            raw_text=raw_text or '',
        )
    except Exception:
        logger.exception('[webhook] Failed to record rejection')


def _content_hash(platform_slug, restaurant_slug, draft):
    """Stable fingerprint of a parsed order's content — independent of the raw
    capture text (which varies between captures, e.g. the countdown timer). Used
    to collapse the same order captured/sent multiple times."""
    import hashlib
    items = sorted((str(it.get('name') or ''), it.get('qty') or 1) for it in draft.get('items', []))
    basis = '|'.join([
        platform_slug, restaurant_slug,
        (draft.get('customer_name') or '').strip(),
        str(round(float(draft.get('total') or 0))),
        repr(items),
    ])
    return hashlib.md5(basis.encode('utf-8')).hexdigest()


def _recent_rejection(restaurant, platform, reason, items):
    """True if an identical rejection (same reason + item set) was recorded in the
    last 30 min — suppresses duplicate alerts from the app's repeated captures."""
    try:
        from django.utils import timezone
        from datetime import timedelta
        from .models import WebhookRejection
        cut = timezone.now() - timedelta(minutes=30)
        key = sorted(items or [])
        for r in (WebhookRejection.objects
                  .filter(restaurant=restaurant, platform=platform, reason=reason, created_at__gte=cut)
                  .only('items')[:300]):
            if sorted(r.items or []) == key:
                return True
    except Exception:
        logger.exception('[webhook] rejection-dedup check failed')
    return False


def _suggest_unmatched(unmatched, platform, restaurant):
    """Gemini match suggestions for unmatched item names — but reuse any already
    computed for the same (platform, name) in a recent rejection so we don't spend
    an API call on a name we've already asked about. Fails safe → {}."""
    try:
        from django.utils import timezone
        from datetime import timedelta
        from .models import WebhookRejection

        cached = {}
        recent = (WebhookRejection.objects
                  .filter(restaurant=restaurant, platform=platform,
                          created_at__gte=timezone.now() - timedelta(days=14))
                  .exclude(suggestions={})
                  .order_by('-created_at')[:100])
        for r in recent:
            for name, sug in (r.suggestions or {}).items():
                cached.setdefault(name, sug)

        need = [n for n in unmatched if n not in cached]
        fresh = {}
        if need:
            from menu.gemini_matcher import suggest_matches
            fresh = suggest_matches(need, restaurant)

        return {n: (cached.get(n) or fresh.get(n)) for n in unmatched if (cached.get(n) or fresh.get(n))}
    except Exception:
        logger.exception('[webhook] suggestion step failed')
        return {}
