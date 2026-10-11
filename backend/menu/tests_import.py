"""Tests for importing menu items from one branch into another.

Runs on Django's temporary test database — never touches the live data.
    python manage.py test menu.tests_import
"""
from decimal import Decimal

from django.test import TestCase

from integrations.models import Platform
from menu.import_utils import import_items, source_listing
from menu.models import (
    MenuCategory, MenuItem, MenuItemPlatform, MenuItemPlatformAlias,
)
from restaurants.models import Restaurant


class ImportItemsTests(TestCase):
    def setUp(self):
        self.src = Restaurant.objects.create(name='الزراعي', slug='src-branch', is_active=True)
        self.dst = Restaurant.objects.create(name='المصارف', slug='dst-branch', is_active=True)
        self.toters = Platform.objects.create(slug='toters', name_ar='توترز')
        self.baly = Platform.objects.create(slug='baly', name_ar='بالي فود')
        self.cat = MenuCategory.objects.create(restaurant=self.src, name_ar='المشروبات', sort_order=2)

    def _make(self, name, foodics_price, app_name, platform=None, alias=None, restaurant=None):
        item = MenuItem.objects.create(
            restaurant=restaurant or self.src,
            category=self.cat if (restaurant or self.src) == self.src else None,
            name=name, price=Decimal('0'),
            foodics_price=None if foodics_price is None else Decimal(str(foodics_price)),
        )
        mapping = MenuItemPlatform.objects.create(
            menu_item=item, platform=platform or self.toters, platform_name=app_name,
        )
        if alias:
            MenuItemPlatformAlias.objects.create(mapping=mapping, name=alias)
        return item

    def test_imports_price_category_and_mappings(self):
        self._make('ببسي APP', 1000, 'بيبسي', alias='مشروبات غازية')
        src_item = MenuItem.objects.get(restaurant=self.src)

        result = import_items(self.src, self.dst, [src_item.id])

        self.assertEqual(result['created'], 1)
        self.assertEqual(result['categories'], 1)
        copied = MenuItem.objects.get(restaurant=self.dst)
        self.assertEqual(copied.name, 'ببسي APP')
        self.assertEqual(copied.foodics_price, Decimal('1000'))
        self.assertEqual(copied.category.name_ar, 'المشروبات')
        mapping = copied.platform_mappings.get()
        self.assertEqual(mapping.platform.slug, 'toters')
        self.assertEqual(mapping.platform_name, 'بيبسي')
        self.assertEqual(list(mapping.aliases.values_list('name', flat=True)), ['مشروبات غازية'])

    def test_twin_is_skipped_but_updated_on_request(self):
        src_item = self._make('ببسي APP', 1000, 'بيبسي')
        self._make('ببسي APP', 1000, '', restaurant=self.dst)

        skipped = import_items(self.src, self.dst, [src_item.id])
        self.assertEqual((skipped['created'], skipped['skipped']), (0, 1))
        self.assertEqual(MenuItem.objects.filter(restaurant=self.dst).count(), 1)

        updated = import_items(self.src, self.dst, [src_item.id], update_existing=True)
        self.assertEqual((updated['created'], updated['updated']), (0, 1))
        twin = MenuItem.objects.get(restaurant=self.dst)
        self.assertEqual(twin.platform_mappings.get(platform=self.toters).platform_name, 'بيبسي')

    def test_same_name_different_price_is_a_separate_copy(self):
        src_item = self._make('ببسي APP', 750, 'بيبسي')
        self._make('ببسي APP', 1000, 'بيبسي', restaurant=self.dst)

        result = import_items(self.src, self.dst, [src_item.id])

        self.assertEqual(result['created'], 1)
        prices = sorted(
            i.foodics_price for i in MenuItem.objects.filter(restaurant=self.dst)
        )
        self.assertEqual(prices, [Decimal('750'), Decimal('1000')])

    def test_import_never_removes_existing_app_names(self):
        src_item = self._make('ببسي APP', 1000, 'بيبسي')
        twin = self._make('ببسي APP', 1000, 'مشروب غازي', platform=self.baly, restaurant=self.dst)

        import_items(self.src, self.dst, [src_item.id], update_existing=True)

        names = {m.platform.slug: m.platform_name for m in twin.platform_mappings.all()}
        self.assertEqual(names, {'baly': 'مشروب غازي', 'toters': 'بيبسي'})

    def test_only_selected_items_are_imported(self):
        keep = self._make('ببسي APP', 1000, 'بيبسي')
        self._make('ميرندا APP', 1000, 'ميرندا')

        import_items(self.src, self.dst, [keep.id])

        self.assertEqual(
            list(MenuItem.objects.filter(restaurant=self.dst).values_list('name', flat=True)),
            ['ببسي APP'],
        )

    def test_listing_flags_what_the_target_already_has(self):
        self._make('ببسي APP', 1000, 'بيبسي')
        self._make('ميرندا APP', 750, 'ميرندا')
        self._make('ببسي APP', 1000, '', restaurant=self.dst)
        self._make('ميرندا APP', 1000, '', restaurant=self.dst)

        rows = {r['name']: r for r in source_listing(self.src, self.dst)}

        self.assertTrue(rows['ببسي APP']['exists'])
        self.assertFalse(rows['ميرندا APP']['exists'])
        self.assertTrue(rows['ميرندا APP']['same_name_different_price'])
        self.assertEqual(rows['ببسي APP']['apps'][0]['name'], 'بيبسي')

    def test_source_items_are_untouched(self):
        src_item = self._make('ببسي APP', 1000, 'بيبسي')

        import_items(self.src, self.dst, [src_item.id])

        src_item.refresh_from_db()
        self.assertEqual(src_item.foodics_price, Decimal('1000'))
        self.assertEqual(MenuItem.objects.filter(restaurant=self.src).count(), 1)
