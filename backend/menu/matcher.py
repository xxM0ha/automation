"""
Strict item matcher — no fuzzy logic, no auto-learning.

Each parsed item has a `name` field that is the platform's display name for
that item (e.g. "ريزو كلاسيك" as it appears in the Toters app).

The restaurant operator enters this name in MenuItemPlatform.platform_name.
We do an exact-match lookup. If no mapping exists → the item is "unmatched"
and the order is rejected so the operator can fix the mapping.
"""
from __future__ import annotations
from menu.models import MenuItemPlatform, MenuItem


def resolve(platform_name: str, platform, restaurant) -> MenuItem | None:
    """
    Return the MenuItem whose platform_name equals `platform_name`
    for the given platform + restaurant, or None.
    """
    if not platform_name or not platform_name.strip():
        return None

    mapping = (
        MenuItemPlatform.objects
        .filter(
            platform=platform,
            platform_name=platform_name.strip(),
            menu_item__restaurant=restaurant,
        )
        .select_related('menu_item')
        .first()
    )
    return mapping.menu_item if mapping else None


def resolve_items(
    parsed_items: list[dict],
    platform,
    restaurant,
) -> tuple[list[dict], list[str]]:
    """
    Resolve a list of parsed-item dicts to DB MenuItems.

    Returns:
        resolved  — list of enriched item dicts (with 'menu_item' key added)
        unmatched — list of platform_name strings that had no mapping
    """
    resolved:  list[dict] = []
    unmatched: list[str]  = []

    for item in parsed_items:
        name = (item.get('name') or '').strip()
        menu_item = resolve(name, platform, restaurant)

        if menu_item is None:
            unmatched.append(name)
        else:
            resolved.append({
                **item,
                'menu_item':     menu_item,
                'name_snapshot': menu_item.name,  # internal canonical name
            })

    return resolved, unmatched
