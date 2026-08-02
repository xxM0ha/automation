from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()


class Command(BaseCommand):
    help = 'Create or update a dev (staff) user with the given email and password.'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('password')

    def handle(self, *args, **options):
        email = User.objects.normalize_email(options['email'].strip().lower())
        password = options['password']

        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(email=email, password=password)
            created = True
        else:
            user.set_password(password)
            created = False

        user.is_staff = True
        user.is_superuser = True  # dev tier is gated on is_superuser
        user.is_active = True
        user.save()

        verb = 'Created' if created else 'Updated'
        self.stdout.write(self.style.SUCCESS(f'{verb} dev user: {email}'))
