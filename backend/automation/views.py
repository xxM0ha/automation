import json
import logging
from pathlib import Path

from rest_framework import status
from rest_framework.decorators import (
    api_view,
    parser_classes,
    renderer_classes,
)
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from .models import GlobalAutomationConfig

logger = logging.getLogger('prime.automation')

# Seeded default config — the working document shipped with the app, served when
# a restaurant has no stored config yet.
DEFAULT_DOCUMENT = json.load(
    open(Path(__file__).resolve().parent / 'default_config.json', encoding='utf-8')
)


@api_view(['GET', 'PUT'])
# Bypass the project-wide camelCase render/parse so the config document
# round-trips verbatim — its keys (schemaVersion, selectors, flow step keys,
# etc.) are already the casing the app expects and must not be transformed.
@renderer_classes([JSONRenderer])
@parser_classes([JSONParser])
def app_config(request):
    """Serve the global automation config (shared by all restaurants).

    GET → the global document, or DEFAULT_DOCUMENT when none is stored yet.
    PUT → 403: editing happens via the dev endpoints (staff only).
    """
    if request.method == 'GET':
        cfg = GlobalAutomationConfig.load()
        return Response(cfg.document if cfg.document else DEFAULT_DOCUMENT)

    return Response(
        {'detail': 'Editing is restricted to dev accounts.'},
        status=status.HTTP_403_FORBIDDEN,
    )
