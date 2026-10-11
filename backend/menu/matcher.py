"""
Strict item matcher — no fuzzy logic, no auto-learning.

Each parsed item has a `name` field that is the platform's display name for
that item (e.g. "ريزو كلاسيك" as it appears in the Toters app).

The restaurant operator enters this name in MenuItemPlatform.platform_name.
We do an exact-match lookup. If no mapping exists → the item is "unmatched"
and the order is rejected so the operator can fix the mapping.
"""
from __future__ import annotations

from menu.models import MenuItemPlatform, MenuItemPlatformAlias, MenuItem


def resolve(platform_name: str, platform, restaurant, unit_price=None) -> MenuItem | None:
    """
    Return the MenuItem whose primary platform_name or any alias equals
    `platform_name` for the given platform + restaurant, or None.

    Several items may share one platform name. Copies of the same item at the
    same Foodics price are interchangeable; otherwise the item the operator
    set a Foodics price for wins. The app's own price (`unit_price`) is never
    compared. Several items with different Foodics prices → None, so the order
    is rejected and the branch is notified (see unmatched_reason). Primary
    names take precedence over aliases.
    """
    items = _candidates(platform_name, platform, restaurant)
    if not items:
        return None
    return _pick(items)


def unmatched_reason(platform_name: str, platform, restaurant, unit_price=None) -> str:
    """Why `platform_name` did not resolve — shown in the branch's notification."""
    items = _candidates(platform_name, platform, restaurant)
    if not items:
        return 'غير مرتبط بأي صنف'
    listed = '، '.join(f'{m.name} ({_fmt(m.foodics_price)})' for m in items)
    if not any(m.foodics_price is not None for m in items):
        return f'مرتبط بعدة أصناف ولم يُحدَّد سعر Foodics لأي منها: {listed}'
    return f'مرتبط بعدة أصناف بأسعار Foodics مختلفة: {listed}'


def _candidates(platform_name: str, platform, restaurant) -> list[MenuItem]:
    if not platform_name or not platform_name.strip():
        return []
    # Normalise Arabic-script variants so Farsi ی (U+06CC) matches Arabic ي (U+064A)
    pname = platform_name.strip().replace('ی', 'ي')

    items = [
        m.menu_item for m in
        MenuItemPlatform.objects
        .filter(platform=platform, platform_name=pname, menu_item__restaurant=restaurant)
        .select_related('menu_item')
        .order_by('pk')
    ]
    if not items:
        items = [
            a.mapping.menu_item for a in
            MenuItemPlatformAlias.objects
            .filter(name=pname, mapping__platform=platform, mapping__menu_item__restaurant=restaurant)
            .select_related('mapping__menu_item')
            .order_by('pk')
        ]
    unique = {}
    for m in items:
        unique.setdefault(m.pk, m)
    return list(unique.values())


def _fmt(price) -> str:
    return 'بدون سعر' if price is None else f'{price:,.0f}'


def _pick(items: list[MenuItem]) -> MenuItem | None:
    # One item, or copies of the same item at the same Foodics price.
    if len({(m.name, m.foodics_price) for m in items}) == 1:
        return items[0]
    # The item(s) the operator priced for Foodics — must still be one product.
    priced = [m for m in items if m.foodics_price is not None]
    if priced and len({(m.name, m.foodics_price) for m in priced}) == 1:
        return priced[0]
    return None


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
        menu_item = resolve(name, platform, restaurant, item.get('unit_price'))

        if menu_item is None:
            unmatched.append(name)
        else:
            resolved.append({
                **item,
                'menu_item':     menu_item,
                'name_snapshot': menu_item.name,  # internal canonical name
            })

    return resolved, unmatched
