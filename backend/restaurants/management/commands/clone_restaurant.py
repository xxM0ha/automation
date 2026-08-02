"""Clone a restaurant's full menu (categories, items, per-platform mappings and
aliases) plus its platform connections into one or more new restaurant accounts,
each with its own admin login.

Used to stand up per-branch accounts (e.g. لافي - المصارف, ريز) that share the
master menu of an existing restaurant (laffe). Foodics-branch assignment is a
separate, later step — this command only sets up the account + menu.

Usage:
    python manage.py clone_restaurant --source laffe --plan /path/to/plan.json

plan.json (UTF-8) is a list of target accounts:
[
  {
    "slug": "laffe-masaref",
    "name": "لافي - المصارف",
    "email": "masaref@laffe.com",
    "password": "....",
    "first_name": "المصارف",
    "role": "admin"
  },
  ...
]

Idempotent: a target whose menu is already populated is skipped (unless --force,
which wipes that target's menu first). The source is never modified.
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from restaurants.models import Restaurant, RestaurantUser, User
from integrations.models import RestaurantPlatform
from menu.models import (
    MenuCategory, MenuItem, MenuItemPlatform, MenuItemPlatformAlias,
)

# Fields copied verbatim for each MenuItem. pos_category is intentionally
# omitted — it is part of the (later) Foodics-branch routing work and is not
# present on every deployment yet.
_ITEM_FIELDS = (
    'name', 'price', 'description', 'image', 'tag',
    'status', 'is_available', 'stock_level',
)


class Command(BaseCommand):
    help = 'Clone a restaurant menu + platform connections into new branch accounts.'

    def add_arguments(self, parser):
        parser.add_argument('--source', required=True, help='Source restaurant slug.')
        parser.add_argument('--plan', required=True, help='Path to UTF-8 JSON plan file.')
        parser.add_argument(
            '--force', action='store_true',
            help='Wipe an existing target menu before cloning instead of skipping.',
        )

    def handle(self, *args, **opts):
        source = Restaurant.objects.filter(slug=opts['source']).first()
        if not source:
            raise CommandError(f"Source restaurant '{opts['source']}' not found.")

        with open(opts['plan'], encoding='utf-8') as fh:
            plan = json.load(fh)
        if not isinstance(plan, list):
            raise CommandError('Plan must be a JSON list of target accounts.')

        src_items = MenuItem.objects.filter(restaurant=source).count()
        self.stdout.write(f"Source: {source.slug} ({source.name}) — {src_items} items")

        for entry in plan:
            self._clone_one(source, entry, force=opts['force'])

    @transaction.atomic
    def _clone_one(self, source, entry, force):
        slug = entry['slug']
        target, created = Restaurant.objects.get_or_create(
            slug=slug,
            defaults={'name': entry.get('name', slug), 'is_active': True},
        )
        if not created and entry.get('name'):
            target.name = entry['name']
            target.save(update_fields=['name'])

        # ── Admin login ───────────────────────────────────────────────────────
        email = entry['email']
        user, u_created = User.objects.get_or_create(
            email=email,
            defaults={'first_name': entry.get('first_name', slug), 'is_staff': True},
        )
        if u_created and entry.get('password'):
            user.set_password(entry['password'])
            user.save()
        RestaurantUser.objects.get_or_create(
            restaurant=target, user=user,
            defaults={'role': entry.get('role', 'admin')},
        )

        # ── Platform connections (each gets its own fresh webhook_secret) ──────
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

        # ── Menu ──────────────────────────────────────────────────────────────
        existing = MenuItem.objects.filter(restaurant=target).count()
        if existing and not force:
            self.stdout.write(self.style.WARNING(
                f"  {slug}: already has {existing} items — skipped menu clone "
                f"(use --force to overwrite). Login: {email}"
            ))
            return
        if existing and force:
            MenuItem.objects.filter(restaurant=target).delete()
            MenuCategory.objects.filter(restaurant=target).delete()

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

        self.stdout.write(self.style.SUCCESS(
            f"  {slug} ({target.name}): {n_items} items, {n_maps} mappings, "
            f"{n_alias} aliases. Login: {email}"
            + ("" if not u_created else " (new user)")
        ))
