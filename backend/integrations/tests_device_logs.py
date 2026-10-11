"""Tests for the device-side error log intake and its dev-only listing.

Runs on Django's temporary test database — never touches the live data.
    python manage.py test integrations.tests_device_logs
"""
import time

from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from integrations.models import DeviceLog
from restaurants.models import Restaurant, RestaurantUser, User


# Production runs with DEBUG=False, which redirects plain-http requests to https;
# the test client speaks http, so switch that off here or every request is a 301.
@override_settings(SECURE_SSL_REDIRECT=False)
class DeviceLogTests(TestCase):
    def setUp(self):
        self.branch = Restaurant.objects.create(name='الزراعي', slug='ziraee-test', is_active=True)
        self.other = Restaurant.objects.create(name='المصارف', slug='masarif-test', is_active=True)
        self.user = User.objects.create_user(email='branch@test.ordo', password='secret123', first_name='b')
        RestaurantUser.objects.create(restaurant=self.branch, user=self.user, role='admin')
        self.dev = User.objects.create_superuser(email='dev@test.ordo', password='secret123', first_name='d')

        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {Token.objects.create(user=self.user).key}')
        self.dev_client = APIClient()
        self.dev_client.credentials(HTTP_AUTHORIZATION=f'Token {Token.objects.create(user=self.dev).key}')

    def _body(self, **entry):
        base = {
            'platform': 'toters', 'kind': 'flow', 'message': 'لم يظهر العنصر: order_card',
            'occurred_at': int(time.time() * 1000), 'count': 3,
            'context': ['12:00:01 [step] نقر · order_card'],
            'screen': {'package': 'com.toters.totersmerchant', 'texts': ['الطلبات الحالية']},
        }
        base.update(entry)
        return {
            'source': 'app',
            'device': {'id': 'abc123', 'model': 'Samsung A15', 'os': '14', 'app_version': '1.0.0'},
            'entries': [base],
        }

    def test_stores_error_with_context_under_the_callers_branch(self):
        res = self.client.post('/api/device-logs/', self._body(), format='json')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['stored'], 1)
        log = DeviceLog.objects.get()
        self.assertEqual(log.restaurant, self.branch)
        self.assertEqual(log.source, 'app')
        self.assertEqual(log.platform, 'toters')
        self.assertEqual(log.message, 'لم يظهر العنصر: order_card')
        self.assertEqual(log.count, 3)
        self.assertEqual(log.context, ['12:00:01 [step] نقر · order_card'])
        self.assertEqual(log.screen_package, 'com.toters.totersmerchant')
        self.assertEqual(log.screen_texts, ['الطلبات الحالية'])
        self.assertEqual(log.device_model, 'Samsung A15')
        self.assertEqual(log.app_version, '1.0.0')

    def test_requires_authentication(self):
        res = APIClient().post('/api/device-logs/', self._body(), format='json')

        self.assertEqual(res.status_code, 401)
        self.assertEqual(DeviceLog.objects.count(), 0)

    def test_skips_blank_messages_and_caps_long_input(self):
        body = self._body(message='x' * 5000, context=[f'line {i}' for i in range(200)])
        body['entries'].append({'message': '   '})

        res = self.client.post('/api/device-logs/', body, format='json')

        self.assertEqual(res.json()['stored'], 1)
        log = DeviceLog.objects.get()
        self.assertEqual(len(log.message), 2000)
        self.assertEqual(len(log.context), 80)
        self.assertEqual(log.context[-1], 'line 199')  # the lines nearest the error are kept

    def test_bad_timestamp_falls_back_to_receive_time(self):
        res = self.client.post('/api/device-logs/', self._body(occurred_at='not-a-number'), format='json')

        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(DeviceLog.objects.get().occurred_at)

    def test_listing_is_dev_only_and_filters_by_restaurant(self):
        self.client.post('/api/device-logs/', self._body(), format='json')
        DeviceLog.objects.create(
            restaurant=self.other, source='adb', message='adb: device offline',
            occurred_at=DeviceLog.objects.get().occurred_at,
        )

        self.assertEqual(self.client.get('/api/dev/device-logs/').status_code, 403)

        rows = self.dev_client.get('/api/dev/device-logs/').json()
        self.assertEqual(len(rows), 2)
        only = self.dev_client.get('/api/dev/device-logs/?restaurant=ziraee-test').json()
        self.assertEqual([r['restaurant'] for r in only], ['ziraee-test'])
        self.assertEqual(only[0]['screenTexts'], ['الطلبات الحالية'])
        adb = self.dev_client.get('/api/dev/device-logs/?source=adb').json()
        self.assertEqual([r['message'] for r in adb], ['adb: device offline'])
