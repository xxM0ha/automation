# -*- coding: utf-8 -*-
"""Gemini-assisted matching for UNMATCHED platform item names.

Called only on the reject path (strict exact-matching already failed), to suggest
which of our menu items an unknown platform name most likely maps to. Design:

- Fails safe: any error / quota / missing key → returns {} so order handling is
  never broken (falls back to today's reject + notify).
- Never auto-applies: suggestions are surfaced for a one-click operator confirm.
  Confirming stores the name as an alias → that name never calls Gemini again.
- Economical: one batched call per set of unknown names; disables "thinking";
  a per-day cap is a hard quota backstop.
"""
import os
import json
import logging
import datetime
import urllib.request
from pathlib import Path

logger = logging.getLogger('prime.menu')

MODEL     = os.environ.get('GEMINI_MODEL', 'gemini-flash-latest')
DAILY_CAP = int(os.environ.get('GEMINI_DAILY_CAP', '300'))
_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent'
_COUNTER  = Path(__file__).resolve().parents[1] / 'logs' / 'gemini_calls.json'


def _read_counter():
    try:
        return json.loads(_COUNTER.read_text()) if _COUNTER.exists() else {}
    except Exception:
        return {}


def _under_cap():
    d = _read_counter()
    if d.get('date') != datetime.date.today().isoformat():
        return True
    return d.get('count', 0) < DAILY_CAP


def _bump_counter():
    today = datetime.date.today().isoformat()
    d = _read_counter()
    if d.get('date') != today:
        d = {'date': today, 'count': 0}
    d['count'] = d.get('count', 0) + 1
    try:
        _COUNTER.write_text(json.dumps(d))
    except Exception:
        pass


def suggest_matches(names, restaurant, min_conf=55):
    """names: list of unmatched platform item names for `restaurant`.

    Returns {name: {'item_id', 'item_name', 'confidence'}} for confident matches
    only. Empty dict on any failure/quota — callers must treat {} as "no
    suggestion" and keep the normal reject behaviour.
    """
    key = (os.environ.get('GEMINI_API_KEY') or '').strip()
    names = [n for n in dict.fromkeys((n or '').strip() for n in names) if n]
    if not key or not names:
        return {}
    if not _under_cap():
        logger.warning('[gemini] daily cap (%d) reached — skipping suggestion', DAILY_CAP)
        return {}

    from menu.models import MenuItem
    items = list(
        MenuItem.objects.filter(restaurant=restaurant).order_by('name').values_list('id', 'name')
    )
    if not items:
        return {}

    menu_lines = "\n".join("%d. %s" % (i + 1, n) for i, (_id, n) in enumerate(items))
    want_lines = "\n".join("%d) %s" % (i + 1, n) for i, n in enumerate(names))
    prompt = (
        "أنت نظام مطابقة أصناف مطعم. هذه قائمة الأصناف الرسمية (رقم. اسم):\n"
        + menu_lines
        + "\n\nلكل اسم وارد من تطبيق توصيل بالأسفل، اختر رقم أفضل صنف مطابق من القائمة أعلاه "
          "(الاسم قد يختلف لفظاً لكن نفس الصنف)، أو 0 إن لم يوجد مطابق واضح. وأعطِ درجة ثقة 0-100.\n"
        "الأسماء الواردة:\n" + want_lines
        + '\n\nأعد JSON فقط بالشكل: [{"i":<رقم السطر الوارد>,"item":<رقم الصنف أو 0>,"confidence":<0-100>}]'
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
        },
    }).encode()

    req = urllib.request.Request(
        _ENDPOINT % MODEL, data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        _bump_counter()
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read())
        txt = data["candidates"][0]["content"]["parts"][-1]["text"]
        rows = json.loads(txt)
    except Exception as ex:
        logger.warning('[gemini] suggest_matches failed: %r', ex)
        return {}

    out = {}
    for row in rows if isinstance(rows, list) else []:
        try:
            ni = int(row.get("i"))
            mi = int(row.get("item"))
            conf = int(row.get("confidence") or 0)
        except Exception:
            continue
        if not (1 <= ni <= len(names)) or not (1 <= mi <= len(items)) or conf < min_conf:
            continue
        name = names[ni - 1]
        iid, iname = items[mi - 1]
        out[name] = {"item_id": iid, "item_name": iname, "confidence": conf}
    return out
