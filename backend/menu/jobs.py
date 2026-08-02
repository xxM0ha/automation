import logging
from .models import MenuItem

logger = logging.getLogger('prime.menu')


def sync_menu_item(item_id: int):
    """Background job: sync a menu item to all connected platforms."""
    try:
        item = MenuItem.objects.select_related('restaurant').get(pk=item_id)
    except MenuItem.DoesNotExist:
        logger.error('[menu] sync_menu_item: item %s not found', item_id)
        return
    # TODO: call POS adapter sync_menu when implemented
    logger.info('[menu] Synced item %s (stub)', item.name)
