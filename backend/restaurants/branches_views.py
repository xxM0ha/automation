import logging
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Restaurant, RestaurantUser, User
from .auth_views import create_branch_login, unique_slug
from .branch_utils import clone_branch_contents, sync_branch_menu

logger = logging.getLogger('prime.branches')


def _owner_org(request):
    """The org this user owns, or None (only owners manage branches)."""
    return request.user.owned_orgs.first()


def _branch_dict(b, full=False):
    d = {
        'id': b.id,
        'name': b.name,
        'slug': b.slug,
        'foodics_branch': b.foodics_branch,
        'printing_enabled': b.printing_enabled,
        'is_active': b.is_active,
        'item_count': b.menu_items.count(),
    }
    if full:
        d['logins'] = [
            {'username': m.user.branch_username, 'role': m.role}
            for m in b.members.select_related('user')
            if m.user.branch_username
        ]
    return d


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def branches(request):
    if request.method == 'GET':
        is_owner = request.user.is_owner
        items = [_branch_dict(b, full=is_owner) for b in request.user.accessible_restaurants]
        return Response(items)

    # POST — create a branch (owner only)
    org = _owner_org(request)
    if not org:
        return Response({'detail': 'إنشاء الفروع متاح لصاحب الحساب فقط.'}, status=403)

    name = (request.data.get('name') or '').strip()
    if not name:
        return Response({'detail': 'اسم الفرع مطلوب.'}, status=400)

    mode = request.data.get('mode') or 'empty'           # 'empty' | 'clone'
    clone_from = (request.data.get('clone_from') or '').strip()
    un = (request.data.get('username') or '').strip()
    pw = request.data.get('password') or ''
    role = request.data.get('role') or 'admin'

    if un and User.objects.filter(branch_username=un).exists():
        return Response({'detail': f'اسم المستخدم «{un}» مستخدم بالفعل.'}, status=400)

    try:
        with transaction.atomic():
            branch = Restaurant.objects.create(
                name=name, slug=unique_slug(name), organization=org, is_active=True,
                foodics_branch=(request.data.get('foodics_branch') or '').strip(),
            )
            RestaurantUser.objects.create(restaurant=branch, user=request.user, role='admin')
            if mode == 'clone' and clone_from:
                src = org.branches.filter(slug=clone_from).first()
                if src:
                    clone_branch_contents(src, branch)
            if un and pw:
                _, err = create_branch_login(branch, un, pw, role)
                if err:
                    raise ValueError(err)
    except ValueError as e:
        return Response({'detail': str(e)}, status=400)

    logger.info('[branches] %s created branch %s', request.user.email, branch.slug)
    return Response(_branch_dict(branch, full=True), status=201)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def branch_detail(request, pk):
    org = _owner_org(request)
    if not org:
        return Response({'detail': 'إدارة الفروع متاحة لصاحب الحساب فقط.'}, status=403)
    branch = org.branches.filter(id=pk).first()
    if not branch:
        return Response({'detail': 'الفرع غير موجود.'}, status=404)

    if request.method == 'DELETE':
        if org.branches.count() <= 1:
            return Response({'detail': 'لا يمكن حذف الفرع الوحيد.'}, status=400)
        branch.delete()
        logger.info('[branches] %s deleted branch %s', request.user.email, branch.slug)
        return Response({'detail': 'تم حذف الفرع.'})

    # PATCH
    if 'name' in request.data:
        branch.name = (request.data.get('name') or branch.name).strip()
    if 'foodics_branch' in request.data:
        branch.foodics_branch = (request.data.get('foodics_branch') or '').strip()
    if 'is_active' in request.data:
        branch.is_active = bool(request.data.get('is_active'))
    branch.save()
    return Response(_branch_dict(branch, full=True))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def branch_login(request, pk):
    """Owner sets / updates a branch's username + password login."""
    org = _owner_org(request)
    if not org:
        return Response({'detail': 'هذه العملية متاحة لصاحب الحساب فقط.'}, status=403)
    branch = org.branches.filter(id=pk).first()
    if not branch:
        return Response({'detail': 'الفرع غير موجود.'}, status=404)

    un = (request.data.get('username') or '').strip()
    pw = request.data.get('password') or ''
    role = request.data.get('role') or 'admin'
    role = role if role in ('admin', 'kitchen') else 'admin'

    existing = next(
        (m for m in branch.members.select_related('user') if m.user.branch_username),
        None,
    )
    if existing:
        u = existing.user
        if un and un != u.branch_username:
            if User.objects.filter(branch_username=un).exclude(id=u.id).exists():
                return Response({'detail': f'اسم المستخدم «{un}» مستخدم بالفعل.'}, status=400)
            u.branch_username = un
            u.email = f'{un}@branch.ordo'
        if pw:
            if len(pw) < 6:
                return Response({'detail': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'}, status=400)
            u.set_password(pw)
        u.save()
        existing.role = role
        existing.save(update_fields=['role'])
        return Response(_branch_dict(branch, full=True))

    user, err = create_branch_login(branch, un, pw, role)
    if err:
        return Response({'detail': err}, status=400)
    return Response(_branch_dict(branch, full=True), status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def branch_sync(request):
    """Owner-only. Sync ONE branch's menu (items, prices, per-platform mappings
    & aliases, categories) into all the org's OTHER branches. Upsert — adds new
    items and updates existing ones; never deletes the targets' extra items."""
    org = _owner_org(request)
    if not org:
        return Response({'detail': 'مزامنة القوائم متاحة لصاحب الحساب فقط.'}, status=403)

    source_slug = (request.data.get('from') or request.data.get('source') or '').strip()
    source = org.branches.filter(slug=source_slug).first()
    if not source:
        return Response({'detail': 'فرع المصدر غير موجود.'}, status=400)

    results = []
    for target in org.branches.exclude(id=source.id).order_by('id'):
        try:
            with transaction.atomic():
                counts = sync_branch_menu(source, target)
            results.append({'branch': target.slug, 'name': target.name, **counts})
        except Exception as e:
            logger.exception('[branches] sync %s → %s failed', source.slug, target.slug)
            results.append({'branch': target.slug, 'name': target.name, 'error': str(e)})

    logger.info('[branches] %s synced menu from %s to %d branches',
                request.user.email, source.slug, len(results))
    return Response({'source': source.slug, 'results': results})
