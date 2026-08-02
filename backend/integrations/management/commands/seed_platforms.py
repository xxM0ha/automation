from django.core.management.base import BaseCommand
from integrations.models import Platform

PLATFORMS = [
    {'slug': 'toters',   'name_ar': 'توترز',    'name_en': 'Toters',    'color': '#2563EB'},
    {'slug': 'tiptop',   'name_ar': 'تيب توب',  'name_en': 'TipTop',    'color': '#FEC63B'},
    {'slug': 'talabat',  'name_ar': 'طلبات',    'name_en': 'Talabat',   'color': '#FF5900'},
    {'slug': 'talabaty', 'name_ar': 'طلباتي',   'name_en': 'Talabaty',  'color': '#22C55E'},
    {'slug': 'yammak',   'name_ar': 'يمّاك',    'name_en': 'Yammak',    'color': '#EF4444'},
    {'slug': 'lezzo',    'name_ar': 'ليزو',     'name_en': 'Lezzo',     'color': '#A855F7'},
    {'slug': 'baly',     'name_ar': 'بالي فود', 'name_en': 'Baly Food', 'color': '#EC4899'},
]


class Command(BaseCommand):
    help = 'Seed the 7 delivery platforms into the database.'

    def handle(self, *args, **kwargs):
        created = 0
        for p in PLATFORMS:
            _, is_new = Platform.objects.update_or_create(slug=p['slug'], defaults=p)
            if is_new:
                created += 1
        self.stdout.write(self.style.SUCCESS(
            f'Platforms seeded: {created} created, {len(PLATFORMS) - created} updated.'
        ))
