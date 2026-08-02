import django
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.conf import settings


@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({
        'status': 'ok',
        'version': '1.0.0',
        'env': 'dev' if settings.DEBUG else 'prod',
        'django': django.VERSION,
    })
