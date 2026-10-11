"""Import selected menu items from one branch into another.

The owner picks items in another branch's menu and imports them into the branch
they are viewing, WITH the Foodics price and the per-app names/aliases. Same
copy logic as the whole-menu branch sync, but item by item.

An item already in the target — same name AND same Foodics price — is a twin and
is skipped (or refreshed when update_existing). Same name at a DIFFERENT Foodics
price is deliberate (one copy per Foodics price list), so it is imported as its
own item instead of overwriting. `printer` is per-branch hardware, never copied.
"""
from menu.models import (
    MenuCategory, MenuItem, MenuItemPlatform, MenuItemPlatformAlias,
)

_ITEM_FIELDS = (
    'price', 'description', 'image', 'tag',
    'status', 'is_available', 'stock_level', 'pos_category', 'foodics_price',
)


def _twin(item, targets):
    """The target item that is this same item: same name AND same Foodics price."""
    name = (item.name or '').strip()
    for t in targets:
        if (t.name or '').strip() == name and t.foodics_price == item.foodics_price:
            return t
    return None


def source_listing(source, target):
    """Every item of `source`, flagged with what the target already has."""
    tgt_items = list(MenuItem.objects.filter(restaurant=target))
    out = []
    qs = (MenuItem.objects.filter(restaurant=source)
          .select_related('category')
          .prefetch_related('platform_mappings__platform', 'platform_mappings__aliases'))
    for si in qs:
        name = (si.name or '').strip()
        out.append({
            'id': si.id,
            'name': si.name,
            'category_name': si.category.name_ar if si.category_id else '',
            'foodics_price': si.foodics_price,
            'apps': [
                {
                    'platform': mp.platform.slug,
                    'name': mp.platform_name,
                    'aliases': [al.name for al in mp.aliases.all()],
                }
                for mp in si.platform_mappings.all()
                if mp.platform_name or mp.aliases.all()
            ],
            'exists': _twin(si, tgt_items) is not None,
            'same_name_different_price': (
                _twin(si, tgt_items) is None
                and any((t.name or '').strip() == name for t in tgt_items)
            ),
        })
    return out


def import_items(source, target, item_ids, update_existing=False):
    """Copy the chosen source items into target. Returns counts + per-item result."""
    src_items = list(
        MenuItem.objects.filter(restaurant=source, id__in=item_ids)
        .select_related('category')
        .prefetch_related('platform_mappings__platform', 'platform_mappings__aliases')
    )
    tgt_items = list(MenuItem.objects.filter(restaurant=target))
    tgt_cats = {c.name_ar: c for c in MenuCategory.objects.filter(restaurant=target)}
    counts = {'created': 0, 'updated': 0, 'skipped': 0,
              'categories': 0, 'mappings': 0, 'aliases': 0}
    results = []

    for si in src_items:
        # Category — matched by name, created in the target when missing.
        cat = None
        if si.category_id:
            cat = tgt_cats.get(si.category.name_ar)
            if cat is None:
                cat = MenuCategory.objects.create(
                    restaurant=target,
                    name_ar=si.category.name_ar,
                    sort_order=si.category.sort_order,
                )
                tgt_cats[si.category.name_ar] = cat
                counts['categories'] += 1

        twin = _twin(si, tgt_items)
        if twin is not None and not update_existing:
            counts['skipped'] += 1
            results.append({'id': si.id, 'name': si.name, 'action': 'skipped'})
            continue

        if twin is None:
            ti = MenuItem.objects.create(
                restaurant=target, category=cat, name=(si.name or '').strip(),
                **{f: getattr(si, f) for f in _ITEM_FIELDS},
            )
            tgt_items.append(ti)
            counts['created'] += 1
            action = 'created'
        else:
            ti = twin
            for f in _ITEM_FIELDS:
                setattr(ti, f, getattr(si, f))
            if cat is not None:
                ti.category = cat
            ti.save()
            counts['updated'] += 1
            action = 'updated'

        n_maps, n_aliases = _copy_mappings(si, ti)
        counts['mappings'] += n_maps
        counts['aliases'] += n_aliases
        results.append({'id': si.id, 'name': si.name, 'action': action, 'target_id': ti.id})

    return {**counts, 'items': results}


def _copy_mappings(si, ti):
    """Copy the source item's per-app names and aliases onto the target item.
    Adds and updates; never removes an app name the target already carries."""
    n_maps = n_aliases = 0
    for mp in si.platform_mappings.all():
        tm, created = MenuItemPlatform.objects.get_or_create(
            menu_item=ti, platform=mp.platform,
            defaults={
                'platform_name': mp.platform_name,
                'platform_price': mp.platform_price,
                'pos_category': mp.pos_category,
                'is_synced': False,
            },
        )
        if not created:
            fields = []
            for f in ('platform_name', 'platform_price', 'pos_category'):
                if getattr(tm, f) != getattr(mp, f):
                    setattr(tm, f, getattr(mp, f))
                    fields.append(f)
            if fields:
                tm.save(update_fields=fields)
        n_maps += 1

        existing = set(tm.aliases.values_list('name', flat=True))
        new_aliases = [
            MenuItemPlatformAlias(mapping=tm, name=al.name)
            for al in mp.aliases.all() if al.name and al.name not in existing
        ]
        if new_aliases:
            MenuItemPlatformAlias.objects.bulk_create(new_aliases)
            n_aliases += len(new_aliases)
    return n_maps, n_aliases
