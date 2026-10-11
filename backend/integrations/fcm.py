"""Firebase Cloud Messaging sender.

We deliberately send FCM **data** messages (not `notification` messages) so the
mobile app handles every payload in its own code rather than the OS rendering a
tray notification. This lets the app react silently (e.g. update local menu
availability) even when backgrounded.

FCM data payloads must be a flat map of string→string. Anything structured —
like the menu items list — therefore has to be JSON-encoded into a single
string field and decoded again on the device.

Menu-sync contract (data keys):
    type     -> "menuSync"
    platform -> the platform slug (e.g. "toters")
    items    -> json.dumps([{ "name": str, "available": bool }, ...])
"""
import json
import logging

import firebase_admin
from firebase_admin import credentials, messaging
from django.conf import settings

logger = logging.getLogger('prime.integrations')


def _ensure_app():
    """Lazily initialise the default Firebase app exactly once."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred)


def send_menu_sync(restaurant, platform_slug, items):
    """Push a menu-sync data message to every registered device of a restaurant.

    items: list of {"name": str, "available": bool}.
    Returns a summary dict: {"sent": int, "failures": int}.
    """
    from .models import Device

    tokens = list(
        Device.objects.filter(restaurant=restaurant).values_list('fcm_token', flat=True)
    )
    if not tokens:
        return {'sent': 0, 'failures': 0}

    _ensure_app()

    data = {
        'type': 'menuSync',
        'platform': platform_slug,
        'items': json.dumps(items),
    }

    # High priority so Android delivers these data-only messages immediately
    # even when the app is backgrounded or the device is in Doze. Without it,
    # data messages are "normal" priority and get deferred/dropped in the
    # background — which silently breaks the automation.
    android = messaging.AndroidConfig(priority='high')

    sent = 0
    failures = 0
    for token in tokens:
        try:
            messaging.send(messaging.Message(token=token, data=data, android=android))
            sent += 1
        except Exception as e:  # invalid/expired token, transport error, etc.
            failures += 1
            logger.warning('[fcm] failed to send to %s…: %s', token[:12], e)

    logger.info(
        '[fcm] menuSync %s/%s → sent=%s failures=%s',
        restaurant.slug, platform_slug, sent, failures,
    )
    return {'sent': sent, 'failures': failures}


# FCM caps a data message at 4 KB. Item names are Arabic (escaped to \uXXXX in
# JSON), so a long list is split into several messages; the app queues them and
# runs them as one batch.
_MAX_ITEMS_JSON = 2800


def _chunks(items):
    """Split [{name, available}] so each chunk's JSON fits one FCM message."""
    chunk, size = [], 2
    for it in items:
        n = len(json.dumps(it)) + 2
        if chunk and size + n > _MAX_ITEMS_JSON:
            yield chunk
            chunk, size = [], 2
        chunk.append(it)
        size += n
    if chunk:
        yield chunk


def push_items_availability(items):
    """Push the current availability of several menu items (all of one
    restaurant) to every connected platform — ONE message per platform
    carrying the whole list, so the device toggles them in a single run instead
    of one run per item.

    The automation toggles each item *inside the delivery app*, so it must
    search by the item's name as it appears in that app — never the panel's
    canonical name. For each connected platform we therefore use the
    platform-specific name: the mapping's ``platform_name``, else its first
    alias. The panel name (``item.name``) is only a last resort when no in-app
    name was configured.
    """
    from .models import PendingMenuSync, RestaurantPlatform

    items = list(items)
    if not items:
        return {}
    restaurant = items[0].restaurant
    connected = {
        rp.platform_id: rp.platform
        for rp in RestaurantPlatform.objects
        .filter(restaurant=restaurant, is_connected=True).select_related('platform')
    }

    by_platform = {}   # slug -> (platform, [{name, available}])
    for item in items:
        for m in item.platform_mappings.all():
            platform = connected.get(m.platform_id)
            if platform is None:
                continue
            alias_names = [a.name for a in m.aliases.all()]
            in_app_name = m.platform_name or (alias_names[0] if alias_names else '')
            if not in_app_name:
                logger.warning(
                    '[fcm] item %s has no in-app name for %s; falling back to panel name "%s"',
                    item.id, platform.slug, item.name,
                )
            entry = {'name': in_app_name or item.name, 'available': item.is_available}
            by_platform.setdefault(platform.slug, (platform, []))[1].append(entry)

    results = {}
    for slug, (platform, entries) in by_platform.items():
        sent = failures = 0
        for chunk in _chunks(entries):
            r = send_menu_sync(restaurant, slug, chunk)
            sent += r['sent']
            failures += r['failures']
        results[slug] = {'sent': sent, 'failures': failures, 'items': len(entries)}
        # Also enqueue for host-side (ADB/Pi) runners that can't get FCM. They
        # poll GET /api/pending-syncs/ and consume these (merged per platform).
        try:
            PendingMenuSync.objects.bulk_create([
                PendingMenuSync(restaurant=restaurant, platform=platform,
                                name=e['name'], available=e['available'])
                for e in entries
            ])
        except Exception:
            logger.exception('[fcm] failed to enqueue pending sync for %s', slug)
    return results


def push_item_availability(item):
    """Push one menu item's current availability to every connected platform."""
    from menu.models import MenuItem
    return push_items_availability(
        MenuItem.objects.filter(pk=item.pk)
        .select_related('restaurant')
        .prefetch_related('platform_mappings__platform', 'platform_mappings__aliases')
    )
