"""Device-side error log intake.

The Android app and the host-side ADB runner upload the errors that happen on
the device — a flow step that failed, a webhook that could not be sent, the
accessibility service stopping, a crash — together with the engine log lines
that led up to it and what was on screen. Read back on the developer page via
GET /api/dev/device-logs/.

  POST /api/device-logs/
  {
    "source": "app" | "adb",
    "device": {"id": str, "model": str, "os": str, "app_version": str},
    "entries": [
      {"platform": str, "kind": str, "message": str, "occurred_at": <epoch ms>,
       "count": int, "context": [str, ...],
       "screen": {"package": str, "texts": [str, ...]}}
    ]
  }

NOTE: the global CamelCase parser is active, so bodies arrive underscoreized —
devices send snake_case and it is read as snake_case here.
"""
import logging
from datetime import datetime, timedelta, timezone as dt_timezone

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import DeviceLog

logger = logging.getLogger('prime.integrations')

MAX_ENTRIES = 50          # per request
MAX_MESSAGE = 2000
MAX_CONTEXT_LINES = 80
MAX_SCREEN_TEXTS = 400
MAX_LINE = 500
RETENTION_DAYS = 30


def _text(value, limit):
    return str(value if value is not None else '').strip()[:limit]


def _lines(value, max_lines, keep_tail=False):
    if not isinstance(value, list):
        return []
    value = value[-max_lines:] if keep_tail else value[:max_lines]
    return [str(v)[:MAX_LINE] for v in value if v is not None]


def _occurred_at(value, now):
    """Epoch milliseconds from the device → aware datetime. A missing, garbled
    or future timestamp (wrong device clock) falls back to the receive time."""
    try:
        ts = datetime.fromtimestamp(float(value) / 1000.0, tz=dt_timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return now
    return now if ts > now + timedelta(minutes=5) else ts


@api_view(['POST'])
def device_logs(request):
    restaurant = request.user.current_restaurant
    if restaurant is None:
        return Response({'detail': 'no restaurant'}, status=status.HTTP_400_BAD_REQUEST)

    entries = request.data.get('entries')
    if not isinstance(entries, list):
        return Response({'detail': 'entries must be a list.'}, status=status.HTTP_400_BAD_REQUEST)

    source = request.data.get('source')
    if source not in (DeviceLog.SOURCE_APP, DeviceLog.SOURCE_ADB):
        source = DeviceLog.SOURCE_APP
    device = request.data.get('device')
    if not isinstance(device, dict):
        device = {}

    now = timezone.now()
    rows = []
    for e in entries[:MAX_ENTRIES]:
        if not isinstance(e, dict):
            continue
        message = _text(e.get('message'), MAX_MESSAGE)
        if not message:
            continue
        screen = e.get('screen') if isinstance(e.get('screen'), dict) else {}
        try:
            count = max(1, int(e.get('count') or 1))
        except (TypeError, ValueError):
            count = 1
        rows.append(DeviceLog(
            restaurant=restaurant,
            source=source,
            device_id=_text(device.get('id'), 100),
            device_model=_text(device.get('model'), 120),
            os_version=_text(device.get('os'), 40),
            app_version=_text(device.get('app_version'), 40),
            platform=_text(e.get('platform'), 60),
            kind=_text(e.get('kind'), 20) or 'flow',
            message=message,
            # The lines closest to the error matter most → keep the tail.
            context=_lines(e.get('context'), MAX_CONTEXT_LINES, keep_tail=True),
            screen_package=_text(screen.get('package'), 200),
            screen_texts=_lines(screen.get('texts'), MAX_SCREEN_TEXTS),
            count=count,
            occurred_at=_occurred_at(e.get('occurred_at'), now),
        ))

    if rows:
        DeviceLog.objects.bulk_create(rows)
        logger.info('[device-log] %s/%s: stored %d error(s)', restaurant.slug, source, len(rows))
        DeviceLog.objects.filter(created_at__lt=now - timedelta(days=RETENTION_DAYS)).delete()

    return Response({'stored': len(rows)})
