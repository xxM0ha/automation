import os
import logging
from datetime import timedelta

from django.utils import timezone

from orders.models import Order

logger = logging.getLogger('prime.integrations')

# If an order sits unpushed longer than this (e.g. the POS pipeline was wedged),
# do NOT flush it late into Foodics — by then the branch has almost certainly
# entered it manually, so an automatic push would double-enter it. We skip and
# flag it for manual reconciliation instead. Tunable via env.
STALE_PUSH_MINUTES = int(os.getenv('STALE_PUSH_MINUTES', '30'))


def push_order_to_pos(order_id: int):
    """
    Background job: push a new order to the restaurant's POS via the adapter.
    Retried up to 3 times by django-q on failure.
    """
    try:
        order = Order.objects.select_related('restaurant', 'platform').get(pk=order_id)
    except Order.DoesNotExist:
        logger.error('[integrations] push_order_to_pos: order %s not found', order_id)
        return

    # Skip if already past 'new' — order was already pushed
    if order.status != Order.STATUS_NEW:
        logger.info('[integrations] Order %s status=%s, skipping POS push', order.external_id, order.status)
        return

    # Stale-order guard — never auto-push an order that waited too long.
    age_min = int((timezone.now() - order.created_at).total_seconds() // 60)
    if age_min >= STALE_PUSH_MINUTES and not order.pos_error:
        logger.warning(
            '[integrations] Order %s is %d min old (>= %d) — skipping stale POS push',
            order.external_id, age_min, STALE_PUSH_MINUTES,
        )
        order.pos_error = f'لم يُرسل تلقائياً — مرّ {age_min} دقيقة على الطلب. يرجى التحقق يدوياً.'
        order.save(update_fields=['pos_error'])
        try:
            from notifications_app.models import Notification
            Notification.objects.create(
                restaurant=order.restaurant,
                title=f'طلب #{order.external_id} لم يُرسل (قديم)',
                body=(f'مرّ {age_min} دقيقة على الطلب دون إرساله إلى Foodics.\n'
                      f'لم يُرسل تلقائياً لتفادي الإدخال المكرر. يرجى التحقق يدوياً.'),
                type='alert',
                related_order=order,
            )
        except Exception:
            logger.exception('[integrations] stale-skip notification failed for %s', order.external_id)
        return  # do NOT raise → no django-q retry, no late flush

    try:
        from integrations.laffe.adapter import LaffeAdapter
        adapter = LaffeAdapter(order.restaurant, {})
        result = adapter.push_order(order)
        # Stash push diagnostics (method used + per-item picks) for the dev page.
        try:
            if result.raw:
                order.raw_payload = {**(order.raw_payload or {}), 'push_meta': {**result.raw, 'ok': result.ok}}
                order.save(update_fields=['raw_payload'])
        except Exception:
            logger.exception('[integrations] Failed to store push_meta for order %s', order_id)
        if result.ok:
            # Persist the Foodics order ID before transitioning status
            order.pos_external_id = result.external_id or ''
            order.pos_error = ''
            order.save(update_fields=['pos_external_id', 'pos_error'])
            from orders.services import transition_order_status
            if order.status != Order.STATUS_ACCEPTED:
                transition_order_status(order, Order.STATUS_ACCEPTED, actor=None)
            logger.info(
                '[integrations] Order %s pushed to POS as %s',
                order.external_id, result.external_id,
            )
            if result.failed_items:
                try:
                    from notifications_app.models import Notification
                    items_list = '\n'.join(f'• {name}' for name in result.failed_items)
                    Notification.objects.create(
                        restaurant=order.restaurant,
                        title=f'تحذير — طلب #{order.external_id} أصناف غير موجودة في Foodics',
                        body=f'تم إرسال الطلب لكن الأصناف التالية لم تُضف:\n\n{items_list}\n\nيرجى إضافتها يدوياً.',
                        type='alert',
                        related_order=order,
                    )
                except Exception:
                    logger.exception('[integrations] Failed to create failed-items notification for order %s', order.external_id)
        elif result.failed_items:
            # Items not found in Foodics menu — notify and stop, don't retry
            logger.warning(
                '[integrations] Order %s aborted — items not in Foodics menu: %s',
                order.external_id, result.failed_items,
            )
            order.pos_error = 'أصناف غير موجودة في Foodics: ' + '، '.join(result.failed_items)
            order.save(update_fields=['pos_error'])
            try:
                from notifications_app.models import Notification
                items_list = '\n'.join(f'• {name}' for name in result.failed_items)
                Notification.objects.create(
                    restaurant=order.restaurant,
                    title=f'تحذير — طلب #{order.external_id} أصناف غير موجودة في Foodics',
                    body=f'لم يتم إرسال الطلب.\nالأصناف التالية غير موجودة في القائمة:\n\n{items_list}\n\nيرجى إدخال الطلب يدوياً.',
                    type='alert',
                    related_order=order,
                )
            except Exception:
                logger.exception('[integrations] Failed to create failed-items notification for order %s', order.external_id)
        else:
            logger.error(
                '[integrations] POS push failed for order %s: %s',
                order.external_id, result.error,
            )
            raise RuntimeError(result.error)
    except Exception as e:
        try:
            order.pos_error = str(e)[:1000]
            order.save(update_fields=['pos_error'])
        except Exception:
            pass
        logger.exception('[integrations] push_order_to_pos error for order %s', order_id)
        raise  # Let django-q retry


def sync_platform_menu(restaurant_id: int, platform_slug: str):
    """Background job: sync menu to a platform."""
    logger.info('[integrations] Menu sync stub for restaurant %s → %s', restaurant_id, platform_slug)
    # TODO: implement when adapter.sync_menu is ready
