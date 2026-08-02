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


def push_item_availability(item):
    """Push one menu item's current availability to every connected platform.

    The automation toggles the item *inside the delivery app*, so it must search
    by the item's name as it appears in that app — never the panel's canonical
    name. For each connected platform we therefore use the platform-specific
    name: the mapping's ``platform_name``, else its first alias. The panel name
    (``item.name``) is only a last resort when no in-app name was configured.
    """
    from .models import RestaurantPlatform

    restaurant = item.restaurant
    results = {}
    mappings = item.platform_mappings.select_related('platform').prefetch_related('aliases').all()
    for m in mappings:
        platform = m.platform
        connected = RestaurantPlatform.objects.filter(
            restaurant=restaurant, platform=platform, is_connected=True
        ).exists()
        if not connected:
            continue
        alias_names = list(m.aliases.values_list('name', flat=True))
        in_app_name = m.platform_name or (alias_names[0] if alias_names else '')
        if not in_app_name:
            logger.warning(
                '[fcm] item %s has no in-app name for %s; falling back to panel name "%s"',
                item.id, platform.slug, item.name,
            )
        name = in_app_name or item.name
        results[platform.slug] = send_menu_sync(
            restaurant, platform.slug,
            [{'name': name, 'available': item.is_available}],
        )
        # Also enqueue for host-side (ADB/Pi) runners that can't get FCM. They
        # poll GET /api/pending-syncs/ and consume these.
        try:
            from .models import PendingMenuSync
            PendingMenuSync.objects.create(
                restaurant=restaurant, platform=platform,
                name=name, available=item.is_available,
            )
        except Exception:
            logger.exception('[fcm] failed to enqueue pending sync for %s', platform.slug)
    return results
