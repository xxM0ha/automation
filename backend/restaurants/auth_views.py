import logging
from django.contrib.auth import authenticate
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.authentication import TokenAuthentication, SessionAuthentication
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authtoken.models import Token

logger = logging.getLogger('prime.auth')


def _user_response(user, token=None):
    data = {
        'id': user.id,
        'email': user.email,
        'name': f'{user.first_name} {user.last_name}'.strip(),
        'role': user.current_role,
        'restaurant': None,
    }
    if user.current_restaurant:
        r = user.current_restaurant
        data['restaurant'] = {'id': r.id, 'name': r.name, 'slug': r.slug}
    if token:
        data['token'] = token.key
    return data


@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def login_view(request):
    email = request.data.get('email', '').strip().lower()
    password = request.data.get('password', '')

    if not email or not password:
        return Response(
            {'detail': 'البريد الإلكتروني وكلمة المرور مطلوبان.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request, username=email, password=password)
    if user is None:
        logger.warning('[auth] Failed login attempt for %s', email)
        return Response(
            {'detail': 'بيانات الدخول غير صحيحة.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token, _ = Token.objects.get_or_create(user=user)
    logger.info('[auth] Login: %s', email)
    return Response(_user_response(user, token))


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
