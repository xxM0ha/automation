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
    """Custom user model — uses email as the unique identifier.

    Branch logins use a friendly `branch_username` (e.g. "ziraee") instead of a
    real email; a synthetic email is stored on `email` to satisfy the unique
    identifier, and login resolves the username back to that user.
    """
    username = None
    email = models.EmailField(unique=True)
    branch_username = models.CharField(max_length=150, unique=True, null=True, blank=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name']

    objects = UserManager()

    def __str__(self):
        return self.email

    @property
    def is_owner(self):
        return self.owned_orgs.exists()

    @property
    def accessible_restaurants(self):
        """Branches this user may view: ones they own (via their org) plus any
        they're a direct member of."""
        from django.db.models import Q
        return (
            Restaurant.objects
            .filter(Q(organization__owner=self) | Q(members__user=self))
            .distinct()
            .order_by('id')
        )

    def _resolve_active(self):
        """Active branch = the X-Branch header (if accessible), else the first
        accessible branch."""
        from .active_branch import get_active_branch
        qs = self.accessible_restaurants
        slug = get_active_branch()
        r = qs.filter(slug=slug).first() if slug else None
        if r is None:
            r = qs.first()
        return r

    @property
    def current_restaurant(self):
        """The branch this request operates on (follows the owner's selection)."""
        if not hasattr(self, '_current_restaurant'):
            self._current_restaurant = self._resolve_active()
        return self._current_restaurant

    @property
    def current_role(self):
        if not hasattr(self, '_current_role'):
            r = self.current_restaurant
            membership = self.memberships.filter(restaurant=r).first() if r else None
            if membership is not None:
                self._current_role = membership.role
            elif r is not None and self.owned_orgs.filter(id=r.organization_id).exists():
                # Org owners get admin rights on every branch even without a row.
                self._current_role = 'admin'
            else:
                self._current_role = None
        return self._current_role


class Organization(models.Model):
    """An owner's business — groups one or more branches (Restaurants).
    The owner has full control over every branch in the org."""
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='owned_orgs'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Restaurant(models.Model):
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    # The owning business. Null = a standalone/legacy account (pre-branches).
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='branches',
        null=True, blank=True,
    )
    is_active = models.BooleanField(default=True)
    # Foodics branch this account's orders are pushed to (e.g. الزراعي / المصارف).
    # Blank → adapter falls back to guessing from the order source text.
    foodics_branch = models.CharField(max_length=200, blank=True, default='')
    # When True, orders are queued for the local print agent (LAN thermal
    # printers) instead of being pushed to Foodics — for branches with no POS link.
    printing_enabled = models.BooleanField(default=False)
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
