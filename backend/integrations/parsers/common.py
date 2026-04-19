"""
Shared utilities for all platform parsers.
"""
import re

# ── Arabic digit conversion ───────────────────────────────────────────────────
_AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
_AR_TO_EN  = str.maketrans(_AR_DIGITS, '0123456789')


def ar_to_en_digits(text: str) -> str:
    """Convert Eastern Arabic-Indic digits to ASCII digits."""
    return text.translate(_AR_TO_EN)


# ── Parsing helpers ───────────────────────────────────────────────────────────

_PRICE_JUNK = re.compile(r'[^\d.]')


def parse_price(text: str) -> float:
    """
    Extract a float from strings like:
      'IQD ٦٬٢٥٠ / عنصر'  →  6250.0
      '20,250 د.ع'          →  20250.0
      '1,750'               →  1750.0
    """
    text = ar_to_en_digits(text)
    # Remove thousands separators (comma, Arabic comma, Arabic decimal sep)
    text = text.replace(',', '').replace('،', '').replace('٬', '')
    # Strip everything except digits and dot
    text = _PRICE_JUNK.sub('', text)
    try:
        return float(text) if text else 0.0
    except ValueError:
        return 0.0


_QTY_PAT = re.compile(r'^(\d+)[xX×]?$')


def parse_qty(token: str) -> int | None:
    """
    Return integer quantity if token looks like '3x', '٣x', '1', etc.
    Returns None if the token is not a quantity.
    """
    token = ar_to_en_digits(token.strip())
    m = _QTY_PAT.match(token)
    return int(m.group(1)) if m else None


# ── Arabic text normalisation (for display / logging only, NOT for matching) ──

_DIACRITICS = re.compile(r'[\u0610-\u061A\u064B-\u065F]')
_TATWEEL    = re.compile(r'\u0640')


def normalize_ar(text: str) -> str:
    """Strip diacritics, tatweel, and homoglyph-normalise ي/ى, ه/ة."""
    text = _DIACRITICS.sub('', text)
    text = _TATWEEL.sub('', text)
    text = text.replace('ى', 'ي').replace('ة', 'ه')
    return text.strip()
