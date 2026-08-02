"""
Order business logic. All state transitions go through here.
Views and jobs must call these functions — never mutate Order.status directly.
"""
import logging
from django.utils import timezone
from .models import Order

logger = logging.getLogger('prime.orders')


def transition_order_status(order: Order, new_status: str, actor=None) -> Order:
    """
    Validates and applies a status transition.
    Raises ValueError if the transition is not allowed.
    """
    if not order.can_transition_to(new_status):
        raise ValueError(
            f'التحويل من {order.get_status_display()} إلى '
            f'{dict(Order.STATUS_CHOICES).get(new_status, new_status)} غير مسموح.'
        )

    old_status = order.status
    order.status = new_status

    if new_status == Order.STATUS_ACCEPTED:
        order.accepted_at = timezone.now()
    elif new_status == Order.STATUS_DELIVERED:
        order.delivered_at = timezone.now()

    order.save(update_fields=['status', 'accepted_at', 'delivered_at', 'rejection_reason'])

    logger.info(
        '[orders] Order %s: %s → %s (by %s)',
        order.external_id, old_status, new_status,
        actor.email if actor else 'system',
    )
    return order


def create_order_from_draft(
    *,
    external_id: str,
    customer_name: str,
    customer_phone: str,
    address: str,
    notes: str,
    total,
    raw_payload: dict,
    items: list,
    restaurant,
    platform,
) -> Order:
    """
    Persists a validated order draft to the DB.
    Each item dict should have: name_snapshot, qty, unit_price, notes, and
    optionally menu_item (a MenuItem instance).
    """
    order = Order.objects.create(
        restaurant=restaurant,
        platform=platform,
        external_id=external_id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        address=address,
        notes=notes,
        total=total,
        raw_payload=raw_payload,
        status=Order.STATUS_NEW,
    )
    from .models import OrderItem
    for item in items:
        OrderItem.objects.create(
            order=order,
            menu_item=item.get('menu_item'),
            name_snapshot=item.get('name_snapshot') or item.get('name', ''),
            qty=item.get('qty', 1),
            unit_price=item.get('unit_price', 0),
            notes=item.get('notes', ''),
        )
    logger.info('[orders] Created order %s from platform %s', order.external_id, platform.slug)
    return order
