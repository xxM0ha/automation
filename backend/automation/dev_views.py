import logging

from rest_framework import status
from rest_framework.decorators import (
    api_view,
    parser_classes,
    renderer_classes,
)
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from restaurants.models import Restaurant

from .models import GlobalAutomationConfig
from .views import DEFAULT_DOCUMENT

logger = logging.getLogger('prime.automation')


def _require_dev(request):
    """Return a 403 Response if the user is not a dev (superuser), else None."""
    if not request.user.is_superuser:
        return Response(
            {'detail': 'Dev access required.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET'])
def dev_restaurants(request):
    """List all active restaurants (dev only)."""
    denied = _require_dev(request)
    if denied is not None:
        return denied

    restaurants = Restaurant.objects.filter(is_active=True)
    return Response([
        {
            'id': r.id,
            'name': r.name,
            'slug': r.slug,
            'foodics_branch': r.foodics_branch,
            'printing_enabled': r.printing_enabled,
        }
        for r in restaurants
    ])


@api_view(['PATCH'])
def dev_set_printing(request, slug):
    """Toggle a restaurant's print-agent mode (dev only). When on, its orders go
    to the local print agent instead of Foodics."""
    denied = _require_dev(request)
    if denied is not None:
        return denied

    try:
        r = Restaurant.objects.get(slug=slug)
    except Restaurant.DoesNotExist:
        return Response({'detail': 'Restaurant not found.'}, status=status.HTTP_404_NOT_FOUND)

    r.printing_enabled = bool(request.data.get('enabled'))
    r.save(update_fields=['printing_enabled'])
    logger.info('[automation] %s printing_enabled=%s by %s', slug, r.printing_enabled, request.user.email)
    return Response({
        'id': r.id, 'name': r.name, 'slug': r.slug,
        'foodics_branch': r.foodics_branch, 'printing_enabled': r.printing_enabled,
    })


@api_view(['GET', 'PUT'])
# Bypass the project-wide camelCase render/parse so the config document
# round-trips verbatim — mirrors the phone-facing app_config view.
@renderer_classes([JSONRenderer])
@parser_classes([JSONParser])
def dev_app_config(request):
    """Serve and store the global automation config document (dev only).

    GET → the global document, or DEFAULT_DOCUMENT when none is stored.
    PUT → replace the global document with the request body (shared by all restaurants).
    """
    denied = _require_dev(request)
    if denied is not None:
        return denied

    cfg = GlobalAutomationConfig.load()

    if request.method == 'GET':
        return Response(cfg.document if cfg.document else DEFAULT_DOCUMENT)

    # PUT — store the document verbatim.
    cfg.document = request.data
    cfg.save()
    logger.info('[automation] global config updated by %s', request.user.email)
    return Response(cfg.document)


@api_view(['GET'])
def dev_orders(request):
    """Recent orders across ALL restaurants with parse + push diagnostics (dev only).
    ?platform=slug  ?problems=1 (only failed/rejected)  ?limit=N (max 300)."""
    denied = _require_dev(request)
    if denied is not None:
        return denied

    from orders.models import Order
    qs = Order.objects.select_related('restaurant', 'platform').prefetch_related('order_items')
    platform = request.query_params.get('platform')
    if platform:
        qs = qs.filter(platform__slug=platform)
    if request.query_params.get('problems') in ('1', 'true'):
        from django.db.models import Q
        from django.utils import timezone
        from datetime import timedelta
        # A "problem" is any order that never made it to the POS: an explicit
        # push error, a rejected order, OR one still stuck in 'new' (never
        # pushed — 'accepted' is the success signal). The 5-min guard avoids
        # flagging orders that are still in flight.
        cutoff = timezone.now() - timedelta(minutes=5)
        qs = qs.filter(
            Q(pos_error__gt='')
            | Q(status=Order.STATUS_REJECTED)
            | Q(status=Order.STATUS_NEW, created_at__lt=cutoff)
        )
    try:
        limit = min(int(request.query_params.get('limit', 100)), 300)
    except (TypeError, ValueError):
        limit = 100

    out = [{
        'id': o.id,
        'external_id': o.external_id,
        'platform': o.platform.slug if o.platform else None,
        'restaurant': o.restaurant.slug,
        'status': o.status,
        'customer_name': o.customer_name,
        'total': str(o.total),
        'pos_external_id': o.pos_external_id,
        'pos_error': o.pos_error,
        'created_at': o.created_at.isoformat(),
        'items': [{
            'name': it.name_snapshot,
            'qty': it.qty,
            'unit_price': str(it.unit_price),
            'notes': it.notes,
            'matched': it.menu_item_id is not None,
        } for it in o.order_items.all()],
        'raw_text': (o.raw_payload or {}).get('raw_text', ''),
        'push_meta': (o.raw_payload or {}).get('push_meta'),
    } for o in qs[:limit]]
    return Response(out)


@api_view(['GET'])
def dev_rejections(request):
    """Recent webhook rejections (orders that never became Orders) — dev only."""
    denied = _require_dev(request)
    if denied is not None:
        return denied

    from integrations.models import WebhookRejection
    qs = WebhookRejection.objects.select_related('restaurant', 'platform')
    platform = request.query_params.get('platform')
    if platform:
        qs = qs.filter(platform__slug=platform)
    try:
        limit = min(int(request.query_params.get('limit', 100)), 300)
    except (TypeError, ValueError):
        limit = 100

    out = [{
        'id': r.id,
        'external_id': r.external_id,
        'platform': r.platform.slug,
        'restaurant': r.restaurant.slug,
        'reason': r.reason,
        'items': r.items,
        'raw_text': r.raw_text,
        'created_at': r.created_at.isoformat(),
    } for r in qs[:limit]]
    return Response(out)


@api_view(['POST'])
def dev_parse_preview(request):
    """Run a platform parser on pasted raw text and return the result (dev only).
    Body: { platform, rawText, restaurant? }. If restaurant is given, also reports
    which items match its menu."""
    denied = _require_dev(request)
    if denied is not None:
        return denied

    platform = (request.data.get('platform') or '').strip()
    raw_text = (request.data.get('rawText') or request.data.get('raw_text') or '').strip()
    if not platform or not raw_text:
        return Response({'detail': 'platform و rawText مطلوبان.'}, status=status.HTTP_400_BAD_REQUEST)

    from integrations.webhook_views import _parse
    draft = _parse(platform, raw_text)
    if draft is None:
        return Response({'parsed': False, 'detail': f'لا يوجد محلل للتطبيق {platform}.'})

    result = {'parsed': True, 'draft': draft}
    rest_slug = (request.data.get('restaurant') or '').strip()
    if rest_slug:
        try:
            from restaurants.models import Restaurant
            from integrations.models import Platform
            from menu.matcher import resolve as resolve_one
            restaurant = Restaurant.objects.get(slug=rest_slug)
            plat = Platform.objects.get(slug=platform)

            # Adapter's default Foodics category (mirrors LaffeAdapter._menu_category).
            slug_l = (restaurant.slug or '').lower()
            default_cat = 'منيو تطبيقات RIZ' if any(
                k in slug_l for k in ('riz', 'رز', 'rice')
            ) else 'منيو التطبيقات'

            item_results = []
            matched_names, unmatched = [], []
            for it in draft.get('items', []):
                nm = (it.get('name') or '').strip()
                mi = resolve_one(nm, plat, restaurant)
                if mi is None:
                    unmatched.append(nm)
                    item_results.append({
                        'parsed_name': nm, 'qty': it.get('qty', 1), 'matched': False,
                    })
                    continue
                # Foodics category resolution — same precedence the push uses:
                # per-app (MenuItemPlatform.pos_category) → item-level → default.
                cat, source = '', 'default'
                m = mi.platform_mappings.filter(platform=plat).first()
                if m and (m.pos_category or '').strip():
                    cat, source = m.pos_category.strip(), 'per-app'
                if not cat and (mi.pos_category or '').strip():
                    cat, source = mi.pos_category.strip(), 'item'
                if not cat:
                    cat = default_cat
                matched_names.append(mi.name)
                item_results.append({
                    'parsed_name': nm, 'qty': it.get('qty', 1), 'matched': True,
                    'menu_name': mi.name, 'pos_category': cat, 'category_source': source,
                })
            result['item_results'] = item_results
            result['matched'] = matched_names
            result['unmatched'] = unmatched
        except Exception as ex:
            result['matchError'] = str(ex)
    return Response(result)
