import logging
import re
from django.contrib.auth import authenticate
from django.db import transaction
from django.utils.text import slugify
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authtoken.models import Token

from .models import Restaurant, RestaurantUser, User, Organization

logger = logging.getLogger('prime.auth')

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


# ─── helpers ────────────────────────────────────────────────────────────────

def unique_slug(name, fallback='restaurant', model=Restaurant):
    """A unique slug for `model`. Arabic names slugify to empty → fall back."""
    base = slugify(name) or slugify(fallback) or 'x'
    slug, n = base, 2
    while model.objects.filter(slug=slug).exists():
        slug = f'{base}-{n}'
        n += 1
    return slug


def create_branch_login(branch, username, password, role='admin'):
    """Create a username/password login bound to one branch. Returns (user, error)."""
    username = (username or '').strip()
    if not username or not password:
        return None, 'اسم المستخدم وكلمة المرور مطلوبان.'
    if len(password) < 6:
        return None, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'
    if User.objects.filter(branch_username=username).exists():
        return None, f'اسم المستخدم «{username}» مستخدم بالفعل.'
    synthetic = f'{username}@branch.ordo'
    if User.objects.filter(email=synthetic).exists():
        return None, f'اسم المستخدم «{username}» مستخدم بالفعل.'
    user = User.objects.create_user(
        email=synthetic, password=password,
        first_name=branch.name, branch_username=username,
    )
    RestaurantUser.objects.update_or_create(
        restaurant=branch, user=user,
        defaults={'role': role if role in ('admin', 'kitchen') else 'admin'},
    )
    return user, None


def role_for(user, branch):
    m = user.memberships.filter(restaurant=branch).first()
    if m:
        return m.role
    if branch.organization_id and user.owned_orgs.filter(id=branch.organization_id).exists():
        return 'admin'
    return None


def _user_response(user, token=None):
    branches = list(user.accessible_restaurants)
    active = user.current_restaurant
    data = {
        'id': user.id,
        'email': user.email,
        'username': user.branch_username,
        'name': f'{user.first_name} {user.last_name}'.strip(),
        'role': user.current_role,
        'isDev': user.is_superuser,
        'isOwner': user.is_owner,
        'restaurant': None,
        'organization': None,
        'activeBranch': active.slug if active else None,
        'branches': [
            {'id': b.id, 'name': b.name, 'slug': b.slug, 'role': role_for(user, b)}
            for b in branches
        ],
    }
    if active:
        data['restaurant'] = {'id': active.id, 'name': active.name, 'slug': active.slug}
    org = user.owned_orgs.first()
    if org:
        data['organization'] = {'id': org.id, 'name': org.name, 'slug': org.slug}
    if token:
        data['token'] = token.key
    return data


# ─── views ──────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def login_view(request):
    # Single field accepts either an email or a branch username.
    identifier = (request.data.get('email') or request.data.get('username') or '').strip()
    password = request.data.get('password', '')

    if not identifier or not password:
        return Response(
            {'detail': 'البريد الإلكتروني/اسم المستخدم وكلمة المرور مطلوبان.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Username (no '@') → resolve to the user's synthetic email.
    login_email = identifier.lower()
    if '@' not in identifier:
        u = User.objects.filter(branch_username=identifier).first()
        if u:
            login_email = u.email

    user = authenticate(request, username=login_email, password=password)
    if user is None:
        logger.warning('[auth] Failed login attempt for %s', identifier)
        return Response(
            {'detail': 'بيانات الدخول غير صحيحة.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token, _ = Token.objects.get_or_create(user=user)
    logger.info('[auth] Login: %s', identifier)
    return Response(_user_response(user, token))


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def register_view(request):
    """Self-service signup: creates an owner + their Organization and one or more
    branches (each branch optionally gets its own username/password login)."""
    email = request.data.get('email', '').strip().lower()
    password = request.data.get('password', '')
    name = (request.data.get('name') or '').strip()
    business_name = (
        request.data.get('business_name')
        or request.data.get('businessName')
        or request.data.get('restaurant_name')
        or request.data.get('restaurantName')
        or ''
    ).strip()
    branches_in = request.data.get('branches') or []

    if not name or not email or not password:
        return Response({'detail': 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة.'}, status=400)
    if not EMAIL_RE.match(email):
        return Response({'detail': 'صيغة البريد الإلكتروني غير صحيحة.'}, status=400)
    if len(password) < 6:
        return Response({'detail': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'}, status=400)
    if User.objects.filter(email=email).exists():
        return Response({'detail': 'هذا البريد الإلكتروني مسجّل بالفعل.'}, status=400)

    if not business_name:
        business_name = name

    # No branches supplied → create one default branch named after the business.
    specs = branches_in if branches_in else [{'name': business_name}]

    # Pre-validate branch usernames so we don't half-create then fail.
    for spec in specs:
        un = (spec.get('username') or '').strip()
        if un and User.objects.filter(branch_username=un).exists():
            return Response({'detail': f'اسم المستخدم «{un}» مستخدم بالفعل.'}, status=400)

    try:
        with transaction.atomic():
            owner = User.objects.create_user(email=email, password=password, first_name=name)
            org = Organization.objects.create(
                name=business_name, slug=unique_slug(business_name, model=Organization), owner=owner,
            )
            for spec in specs:
                bname = (spec.get('name') or '').strip() or business_name
                branch = Restaurant.objects.create(
                    name=bname, slug=unique_slug(bname), organization=org, is_active=True,
                )
                # Owner is an admin member of every branch (so switching works).
                RestaurantUser.objects.create(restaurant=branch, user=owner, role='admin')
                un, pw = (spec.get('username') or '').strip(), spec.get('password') or ''
                if un and pw:
                    _, err = create_branch_login(branch, un, pw, spec.get('role') or 'admin')
                    if err:
                        raise ValueError(err)
    except ValueError as e:
        return Response({'detail': str(e)}, status=400)

    token, _ = Token.objects.get_or_create(user=owner)
    logger.info('[auth] Register: %s → org %s (%d branches)', email, org.slug, len(specs))
    return Response(_user_response(owner, token), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    try:
        request.user.auth_token.delete()
    except Exception:
        pass
    logger.info('[auth] Logout: %s', request.user.email)
    return Response({'detail': 'تم تسجيل الخروج.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response(_user_response(request.user))
