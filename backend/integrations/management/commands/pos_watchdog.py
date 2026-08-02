"""POS pipeline watchdog — self-heal for a wedged Foodics push worker.

The Foodics adapter drives ONE persistent Playwright browser thread. If a single
push hangs, that thread stays blocked and every later order times out — the whole
pipeline wedges until the qcluster worker is restarted (this is exactly the
midnight-to-morning outage we hit).

This command detects that wedge and restarts the worker automatically. Run it
from cron every few minutes. A wedge is: orders sitting unpushed for a while AND
the pipeline having accepted nothing recently (so it's stalled, not merely busy).
A cooldown prevents restart-thrashing while a fresh worker drains the backlog;
the stale-order guard in jobs.py ensures the recovered pipeline never flushes old
orders late into Foodics.
"""
import time
import subprocess
import logging
from datetime import timedelta
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

logger = logging.getLogger('prime.integrations')

UNIT         = 'prime_automation_qcluster.service'
STUCK_MIN    = 10          # an order unpushed this long with no progress = wedge
RECENT_HRS   = 2           # ignore ancient orphaned 'new' orders older than this
COOLDOWN_MIN = 8           # don't restart again within this window (let it drain)
STAMP        = Path(__file__).resolve().parents[3] / 'logs' / '.watchdog_last_restart'


class Command(BaseCommand):
    help = 'Detect a wedged Foodics POS pipeline and restart the qcluster worker.'

    def handle(self, *args, **opts):
        from orders.models import Order

        now = timezone.now()

        # Cooldown — a recent restart is still draining; don't pile on.
        if STAMP.exists() and (time.time() - STAMP.stat().st_mtime) < COOLDOWN_MIN * 60:
            return

        # Genuinely-pending orders: recent, unpushed, not already flagged.
        waiting = Order.objects.filter(
            status=Order.STATUS_NEW,
            pos_error='',
            created_at__lt=now - timedelta(minutes=STUCK_MIN),
            created_at__gt=now - timedelta(hours=RECENT_HRS),
        )
        n = waiting.count()
        if n == 0:
            return

        # Is the pipeline making progress? (something accepted recently)
        last = Order.objects.filter(accepted_at__isnull=False).order_by('-accepted_at').first()
        if last and (now - last.accepted_at) < timedelta(minutes=STUCK_MIN):
            return  # busy but healthy — not wedged

        # ── Wedge detected ──
        logger.error(
            '[watchdog] POS pipeline WEDGED: %d order(s) waiting >%dmin, no accept in %dmin. Restarting %s',
            n, STUCK_MIN, STUCK_MIN, UNIT,
        )
        try:
            subprocess.run(['systemctl', 'restart', UNIT], check=True, timeout=90)
            STAMP.write_text(str(time.time()))
            logger.error('[watchdog] Restarted %s', UNIT)
            try:
                from notifications_app.models import Notification
                for rid in waiting.values_list('restaurant_id', flat=True).distinct():
                    Notification.objects.create(
                        restaurant_id=rid,
                        title='تمت إعادة تشغيل الأتمتة تلقائياً',
                        body=('توقّف إرسال الطلبات إلى Foodics مؤقتاً وأعاد النظام '
                              'تشغيل نفسه تلقائياً. الطلبات الحديثة ستُرسل الآن؛ '
                              'يرجى مراجعة أي طلبات معلّقة قديمة يدوياً.'),
                        type='alert',
                    )
            except Exception:
                logger.exception('[watchdog] notify failed')
        except Exception as e:
            logger.exception('[watchdog] restart failed: %s', e)
