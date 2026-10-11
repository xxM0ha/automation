"""Copy a branch's menu + platform connections into another branch.

Shared by the clone_restaurant management command's intent and the
"create branch → clone from existing" flow in the branches API.
"""
from collections import Counter, defaultdict

from integrations.models import RestaurantPlatform
from menu.models import (
    MenuCategory, MenuItem, MenuItemPlatform, MenuItemPlatformAlias,
)

# Item fields copied verbatim. `printer` is excluded — printers are per-branch
# hardware, so a cloned item starts unrouted (cashier-only).
_ITEM_FIELDS = (
    'name', 'price', 'description', 'image', 'tag',
    'status', 'is_available', 'stock_level', 'pos_category',
)


def clone_branch_contents(source, target):
    """Clone source → target. Skips if target already has items. Returns counts."""
    if MenuItem.objects.filter(restaurant=target).exists():
        return {'skipped': True}

    # Platform connections (each keeps its own webhook_secret default).
    for rp in RestaurantPlatform.objects.filter(restaurant=source):
        RestaurantPlatform.objects.get_or_create(
            restaurant=target, platform=rp.platform,
            defaults={
                'is_connected': rp.is_connected,
                'auto_accept': rp.auto_accept,
                'menu_sync': rp.menu_sync,
                'config': rp.config,
            },
        )

    cat_map = {}
    for c in MenuCategory.objects.filter(restaurant=source):
        cat_map[c.id] = MenuCategory.objects.create(
            restaurant=target, name_ar=c.name_ar, sort_order=c.sort_order,
        )

    n_items = n_maps = n_alias = 0
    for it in MenuItem.objects.filter(restaurant=source):
        ni = MenuItem.objects.create(
            restaurant=target,
            category=cat_map.get(it.category_id),
            **{f: getattr(it, f) for f in _ITEM_FIELDS},
        )
        n_items += 1
        for mp in MenuItemPlatform.objects.filter(menu_item=it):
            nmp = MenuItemPlatform.objects.create(
                menu_item=ni, platform=mp.platform,
                platform_name=mp.platform_name,
                platform_price=mp.platform_price,
                pos_category=mp.pos_category,
                is_synced=mp.is_synced,
            )
            n_maps += 1
            aliases = [
                MenuItemPlatformAlias(mapping=nmp, name=al.name)
                for al in MenuItemPlatformAlias.objects.filter(mapping=mp)
            ]
            if aliases:
                MenuItemPlatformAlias.objects.bulk_create(aliases)
                n_alias += len(aliases)

    return {'skipped': False, 'items': n_items, 'mappings': n_maps, 'aliases': n_alias}


# Item fields kept in sync (UPSERT). `name` is the match key, `printer` is
# per-branch hardware, so neither is overwritten here.
_SYNC_FIELDS = (
    'price', 'description', 'image', 'tag',
    'status', 'is_available', 'stock_level', 'pos_category',
)


def sync_branch_menu(source, target):
    """Upsert source's menu into target: add new categories/items, update
    existing ones (matched by name), and sync each item's per-platform mappings
    + aliases. Does NOT delete items the target has but the source lacks, and
    does NOT touch target printers. Returns a counts dict."""
    counts = {'created': 0, 'updated': 0, 'mappings': 0, 'aliases': 0, 'categories': 0}

    # Platform connections present in source.
    for rp in RestaurantPlatform.objects.filter(restaurant=source):
        RestaurantPlatform.objects.get_or_create(
            restaurant=target, platform=rp.platform,
            defaults={
                'is_connected': rp.is_connected,
                'auto_accept': rp.auto_accept,
                'menu_sync': rp.menu_sync,
                'config': rp.config,
            },
        )

    # Categories — match by name_ar, create if missing.
    tgt_cats = {c.name_ar: c for c in MenuCategory.objects.filter(restaurant=target)}
    for c in MenuCategory.objects.filter(restaurant=source):
        tc = tgt_cats.get(c.name_ar)
        if tc is None:
            tc = MenuCategory.objects.create(
                restaurant=target, name_ar=c.name_ar, sort_order=c.sort_order,
            )
            tgt_cats[c.name_ar] = tc
            counts['categories'] += 1
        elif tc.sort_order != c.sort_order:
            tc.sort_order = c.sort_order
            tc.save(update_fields=['sort_order'])

    # Items — matched by name. When the source has several items with the same
    # name (e.g. one per app, each priced for its own Foodics price list), each
    # copy is paired with the target item carrying the same app names, and a copy
    # with no counterpart is created — so the target keeps them apart instead of
    # folding them into one item.
    def app_names(item):
        return frozenset(
            (mp.platform_id, n)
            for mp in item.platform_mappings.all()
            for n in [mp.platform_name, *(al.name for al in mp.aliases.all())]
            if n
        )

    src_items = list(MenuItem.objects.filter(restaurant=source).prefetch_related('platform_mappings__aliases'))
    src_name_count = Counter(si.name for si in src_items)
    tgt_by_name = defaultdict(list)
    for it in MenuItem.objects.filter(restaurant=target).prefetch_related('platform_mappings__aliases'):
        tgt_by_name[it.name].append(it)
    claimed = set()

    for si in src_items:
        cat = tgt_cats.get(si.category.name_ar) if si.category_id else None
        same_name = tgt_by_name.get(si.name, [])
        if src_name_count[si.name] == 1:
            ti = same_name[-1] if same_name else None
        else:
            sig = app_names(si)
            ti = next((t for t in same_name if t.pk not in claimed and app_names(t) == sig), None)
        if ti is None:
            ti = MenuItem.objects.create(
                restaurant=target, category=cat, name=si.name,
                foodics_price=si.foodics_price,
                **{f: getattr(si, f) for f in _SYNC_FIELDS},
            )
            tgt_by_name[si.name].append(ti)
            counts['created'] += 1
        else:
            changed = False
            for f in _SYNC_FIELDS:
                if getattr(ti, f) != getattr(si, f):
                    setattr(ti, f, getattr(si, f))
                    changed = True
            # Copy the Foodics price, but never erase one the target already has.
            if si.foodics_price is not None and ti.foodics_price != si.foodics_price:
                ti.foodics_price = si.foodics_price
                changed = True
            if cat is not None and ti.category_id != cat.id:
                ti.category = cat
                changed = True
            if changed:
                ti.save()
                counts['updated'] += 1
        claimed.add(ti.pk)

        # Per-platform mappings + aliases.
        for mp in si.platform_mappings.all():
            tm, created = MenuItemPlatform.objects.get_or_create(
                menu_item=ti, platform=mp.platform,
                defaults={
                    'platform_name': mp.platform_name,
                    'platform_price': mp.platform_price,
                    'pos_category': mp.pos_category,
                    'is_synced': mp.is_synced,
                },
            )
            if not created:
                fields = []
                for f in ('platform_name', 'platform_price', 'pos_category', 'is_synced'):
                    if getattr(tm, f) != getattr(mp, f):
                        setattr(tm, f, getattr(mp, f))
                        fields.append(f)
                if fields:
                    tm.save(update_fields=fields)
            counts['mappings'] += 1
            existing = set(tm.aliases.values_list('name', flat=True))
            new_aliases = [
                MenuItemPlatformAlias(mapping=tm, name=al.name)
                for al in mp.aliases.all() if al.name not in existing
            ]
            if new_aliases:
                MenuItemPlatformAlias.objects.bulk_create(new_aliases)
                counts['aliases'] += len(new_aliases)

    return counts
