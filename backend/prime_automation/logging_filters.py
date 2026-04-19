import logging
import re

_SECRET_PATTERN = re.compile(
    r'("?(?:password|secret|token|key|credential|auth)["\s]*:?\s*["\']?)([^"\',\s]{4,})',
    re.IGNORECASE,
)


class RedactSecretsFilter(logging.Filter):
    """Redacts sensitive keys from log messages before writing."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _SECRET_PATTERN.sub(r'\1[REDACTED]', str(record.msg))
        return True
