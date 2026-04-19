from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError('Email is required')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    """Custom user model — uses email as the unique identifier."""
    username = None
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name']

    objects = UserManager()

    def __str__(self):
        return self.email

    @property
    def current_restaurant(self):
        """Returns the first restaurant this user belongs to."""
        if not hasattr(self, '_current_restaurant'):
            membership = self.memberships.select_related('restaurant').first()
            self._current_restaurant = membership.restaurant if membership else None
        return self._current_restaurant

    @property
    def current_role(self):
        if not hasattr(self, '_current_role'):
            membership = self.memberships.first()
            self._current_role = membership.role if membership else None
        return self._current_role


class Restaurant(models.Model):
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class RestaurantUser(models.Model):
    ROLE_CHOICES = [('admin', 'admin'), ('kitchen', 'kitchen')]

    restaurant = models.ForeignKey(
        Restaurant, on_delete=models.CASCADE, related_name='members'
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='memberships'
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='kitchen')

    class Meta:
        unique_together = [('restaurant', 'user')]

    def __str__(self):
        return f'{self.user.email} @ {self.restaurant.name} ({self.role})'


class RestaurantPOS(models.Model):
    POS_CHOICES = [('foodics', 'Foodics')]

    restaurant = models.OneToOneField(
        Restaurant, on_delete=models.CASCADE, related_name='pos'
    )
    pos_type = models.CharField(max_length=50, choices=POS_CHOICES, default='foodics')
    credentials_encrypted = models.BinaryField()
    last_session_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'{self.restaurant.name} — {self.pos_type}'
