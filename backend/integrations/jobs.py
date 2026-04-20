import logging
from orders.models import Order

logger = logging.getLogger('prime.integrations')


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

    try:
        from integrations.laffe.adapter import LaffeAdapter
        adapter = LaffeAdapter(order.restaurant, {})
        result = adapter.push_order(order)
        if result.ok:
            # Persist the Foodics order ID before transitioning status
            order.pos_external_id = result.external_id or ''
            order.save(update_fields=['pos_external_id'])
            from orders.services import transition_order_status
            if order.status != Order.STATUS_ACCEPTED:
                transition_order_status(order, Order.STATUS_ACCEPTED, actor=None)
            logger.info(
                '[integrations] Order %s pushed to POS as %s',
                order.external_id, result.external_id,
            )
        else:
            logger.error(
                '[integrations] POS push failed for order %s: %s',
                order.external_id, result.error,
            )
            raise RuntimeError(result.error)
    except Exception:
        logger.exception('[integrations] push_order_to_pos error for order %s', order_id)
        raise  # Let django-q retry


def sync_platform_menu(restaurant_id: int, platform_slug: str):
    """Background job: sync menu to a platform."""
    logger.info('[integrations] Menu sync stub for restaurant %s → %s', restaurant_id, platform_slug)
    # TODO: implement when adapter.sync_menu is ready
