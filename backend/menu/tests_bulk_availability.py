"""Tests for turning several menu items on/off at once.

Runs on Django's temporary test database — never touches the live data.
    python manage.py test menu.tests_bulk_availability
"""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from integrations.fcm import _chunks
from integrations.models import PendingMenuSync, Platform, RestaurantPlatform
from menu.models import MenuItem, MenuItemPlatform
from restaurants.models import Restaurant, RestaurantUser, User


class BulkAvailabilityTests(TestCase):
    def setUp(self):
        self.branch = Restaurant.objects.create(name='الزراعي', slug='bulk-branch', is_active=True)
        self.other = Restaurant.objects.create(name='المصارف', slug='bulk-other', is_active=True)
        self.toters = Platform.objects.create(slug='toters', name_ar='توترز', name_en='Toters', color='#000000')
        self.baly = Platform.objects.create(slug='baly', name_ar='بلي', name_en='Baly', color='#000000')
        RestaurantPlatform.objects.create(restaurant=self.branch, platform=self.toters, is_connected=True)
        RestaurantPlatform.objects.create(restaurant=self.branch, platform=self.baly, is_connected=False)
        user = User.objects.create_user(email='bulk@test.ordo', password='secret123', first_name='b')
        RestaurantUser.objects.create(restaurant=self.branch, user=user, role='admin')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {Token.objects.create(user=user).key}')

    def _item(self, name, app_name, available=True, restaurant=None):
        item = MenuItem.objects.create(
            restaurant=restaurant or self.branch, name=name, price=Decimal('0'), is_available=available,
        )
        MenuItemPlatform.objects.create(menu_item=item, platform=self.toters, platform_name=app_name)
        MenuItemPlatform.objects.create(menu_item=item, platform=self.baly, platform_name=app_name)
        return item

    @patch('integrations.fcm.send_menu_sync', return_value={'sent': 1, 'failures': 0})
    def test_one_message_per_connected_app_with_every_changed_item(self, send):
        a = self._item('ببسي APP', 'بيبسي')
        b = self._item('ميرندا APP', 'ميرندا')
        already_off = self._item('سفن APP', 'سفن', available=False)

        res = self.client.post('/api/menu/items/availability/bulk/', {
            'itemIds': [a.id, b.id, already_off.id], 'available': False,
        }, format='json')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['updated'], 2)
        self.assertFalse(MenuItem.objects.get(pk=a.id).is_available)
        self.assertFalse(MenuItem.objects.get(pk=b.id).is_available)
        # One push, to the connected app only, carrying both items; the item
        # that was already off is not re-sent.
        send.assert_called_once()
        restaurant, slug, items = send.call_args.args
        self.assertEqual((restaurant, slug), (self.branch, 'toters'))
        self.assertEqual(
            sorted(items, key=lambda i: i['name']),
            [{'name': 'بيبسي', 'available': False}, {'name': 'ميرندا', 'available': False}],
        )
        # Host-side (ADB) runners get the same two items from the poll queue.
        self.assertEqual(PendingMenuSync.objects.filter(restaurant=self.branch).count(), 2)

    @patch('integrations.fcm.send_menu_sync', return_value={'sent': 1, 'failures': 0})
    def test_other_branches_items_are_never_touched(self, send):
        theirs = self._item('ببسي APP', 'بيبسي', restaurant=self.other)

        res = self.client.post('/api/menu/items/availability/bulk/', {
            'itemIds': [theirs.id], 'available': False,
        }, format='json')

        self.assertEqual(res.json()['updated'], 0)
        self.assertTrue(MenuItem.objects.get(pk=theirs.id).is_available)
        send.assert_not_called()

    def test_rejects_a_request_without_a_boolean(self):
        a = self._item('ببسي APP', 'بيبسي')
        res = self.client.post('/api/menu/items/availability/bulk/', {'itemIds': [a.id]}, format='json')
        self.assertEqual(res.status_code, 400)

    @patch('integrations.fcm.send_menu_sync', return_value={'sent': 1, 'failures': 0})
    def test_single_toggle_still_pushes_one_item(self, send):
        a = self._item('ببسي APP', 'بيبسي')

        res = self.client.patch(f'/api/menu/items/{a.id}/availability/')

        self.assertEqual(res.status_code, 200)
        send.assert_called_once()
        self.assertEqual(send.call_args.args[2], [{'name': 'بيبسي', 'available': False}])

    def test_a_long_list_is_split_to_fit_fcm(self):
        items = [{'name': f'صنف طويل الاسم رقم {i}', 'available': False} for i in range(120)]
        chunks = list(_chunks(items))
        self.assertGreater(len(chunks), 1)
        self.assertEqual(sum(len(c) for c in chunks), 120)
