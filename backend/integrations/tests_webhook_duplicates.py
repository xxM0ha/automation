"""Tests for the webhook's duplicate detection.

Two customers ordering the exact same items must both become orders; the same
order captured twice must not.

Runs on Django's temporary test database — never touches the live data.
    python manage.py test integrations.tests_webhook_duplicates
"""
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from integrations.models import Platform, RestaurantPlatform
from menu.models import MenuItem, MenuItemPlatform
from orders.models import Order
from restaurants.models import Restaurant


def _toters(order_id, with_id=True):
    """A Toters capture: one ريزو كلاسيك, no customer name."""
    head = f'#{order_id} موجود الآن في صفحة التحضير.,' if with_id else ''
    return (f'فتح لائحة التنقل,الطلبات الحالية,{head}ملف ١,الريزو,١x,ريزو كلاسيك,'
            'IQD ٦٬٢٥٠ / عنصر,IQD ٦٬٢٥٠,حاصل الجمع,IQD ٦٬٢٥٠,أكد الطلب')


@patch('django_q.tasks.async_task')
class WebhookDuplicateTests(TestCase):
    def setUp(self):
        self.toters = Platform.objects.create(slug='toters', name_ar='توترز', name_en='Toters', color='#000000')
        self.a = self._branch('branch-a')
        self.b = self._branch('branch-b')
        self.client = APIClient()

    def _branch(self, slug):
        r = Restaurant.objects.create(name=slug, slug=slug, is_active=True, printing_enabled=False)
        RestaurantPlatform.objects.create(restaurant=r, platform=self.toters, is_connected=True, auto_accept=True)
        item = MenuItem.objects.create(restaurant=r, name='ريزو كلاسيك', price=Decimal('6250'))
        MenuItemPlatform.objects.create(menu_item=item, platform=self.toters, platform_name='ريزو كلاسيك')
        return r

    def _send(self, restaurant, raw_text):
        return self.client.post('/api/webhooks/', {
            'platform': 'toters', 'restaurant': restaurant.slug, 'raw_text': raw_text,
        }, format='json')

    def test_same_items_from_two_customers_are_two_orders(self, _task):
        first = self._send(self.a, _toters(220))
        second = self._send(self.a, _toters(221))

        self.assertNotIn('duplicate', first.json())
        self.assertNotIn('duplicate', second.json())
        self.assertEqual(
            sorted(Order.objects.filter(restaurant=self.a).values_list('external_id', flat=True)),
            ['220', '221'],
        )

    def test_same_order_captured_twice_is_one_order(self, _task):
        self._send(self.a, _toters(220))
        again = self._send(self.a, _toters(220))

        self.assertTrue(again.json()['duplicate'])
        self.assertEqual(Order.objects.filter(restaurant=self.a).count(), 1)

    def test_recapture_without_a_readable_number_is_still_a_duplicate(self, _task):
        self._send(self.a, _toters(220))
        again = self._send(self.a, _toters(220, with_id=False))

        self.assertTrue(again.json()['duplicate'])
        self.assertEqual(Order.objects.filter(restaurant=self.a).count(), 1)

    def test_same_order_number_in_two_branches_are_two_orders(self, _task):
        self._send(self.a, _toters(220))
        other = self._send(self.b, _toters(220))

        self.assertNotIn('duplicate', other.json())
        self.assertEqual(Order.objects.filter(restaurant=self.a).count(), 1)
        self.assertEqual(Order.objects.filter(restaurant=self.b).count(), 1)
