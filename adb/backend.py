"""
Backend client for the host-side ADB automation runner.

This module is the host-side twin of the mobile app's networking layer. It
talks to the existing Django backend (default ``https://api.3alijny.com``) over
plain HTTP using only the Python standard library — no third-party deps — so it
can be dropped onto any machine that drives devices via ADB.

It exposes four operations:

  * ``login``         — exchange credentials for an auth token.
  * ``fetch_config``  — load the same AutomationConfig the mobile app consumes.
  * ``send_request``  — fire a logical endpoint (currently the order webhook),
                        mirroring ``FlowInterpreter.resolveRequest`` on Android.
  * ``poll_pending``  — pull queued menu-sync jobs (planned FCM replacement).

``login`` raises on failure so the runner fails fast on bad credentials.
``send_request`` and ``poll_pending`` never raise — they return an error dict /
empty list so the run loop can keep going.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

# Network timeout (seconds) for every request. Short enough that a dead backend
# doesn't wedge the runner loop, long enough for a slow mobile-grade link.
_TIMEOUT = 15


def _request(
    method: str,
    url: str,
    token: Optional[str] = None,
    body: Optional[dict] = None,
) -> Tuple[int, Any]:
    """Perform a single JSON HTTP request.

    Sends/receives UTF-8 JSON. Sets ``Content-Type: application/json`` and, when
    ``token`` is given, ``Authorization: Token <token>``.

    Returns a ``(status_code, parsed_data)`` tuple. On an HTTP error status the
    code is captured from the ``HTTPError`` and the body is still parsed (as JSON
    when possible, otherwise the raw text). On a transport-level failure
    (``URLError``) the status is ``0`` and the data is an ``{"error": ...}`` dict.

    This helper never raises for network/HTTP failures — callers decide whether
    a non-2xx status is fatal.
    """
    data: Optional[bytes] = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Token " + token

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, _parse_json(raw)
    except urllib.error.HTTPError as exc:
        # Server responded with a non-2xx status. Capture the code and try to
        # read/parse the error body so callers can surface a useful message.
        try:
            raw = exc.read().decode("utf-8")
        except Exception:
            raw = ""
        return exc.code, _parse_json(raw)
    except urllib.error.URLError as exc:
        # Could not reach the server at all (DNS, connection refused, timeout).
        return 0, {"error": str(exc.reason)}


def _parse_json(text: str) -> Any:
    """Parse a JSON string, returning the raw text if it isn't valid JSON."""
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text


def login(base_url: str, email: str, password: str) -> str:
    """Authenticate and return the auth token.

    POSTs ``{email, password}`` to ``{base_url}/api/auth/login/`` and returns the
    ``"token"`` field from the response.

    Raises ``RuntimeError`` on any non-200 status or if the response has no
    token, so the runner fails fast on bad credentials.
    """
    url = base_url.rstrip("/") + "/api/auth/login/"
    status, data = _request("POST", url, body={"email": email, "password": password})

    if status != 200:
        raise RuntimeError("login failed (HTTP {}): {}".format(status, data))

    if not isinstance(data, dict) or not data.get("token"):
        raise RuntimeError("login response missing token: {}".format(data))

    return data["token"]


def fetch_config(base_url: str, token: str) -> dict:
    """Fetch the AutomationConfig the mobile app loads.

    GETs ``{base_url}/api/app-config/`` with ``Authorization: Token <token>`` and
    returns the config dict, shaped like
    ``{ schemaVersion, backend, platforms: [...] }``.

    Raises ``RuntimeError`` on any non-200 status.
    """
    url = base_url.rstrip("/") + "/api/app-config/"
    status, data = _request("GET", url, token=token)

    if status != 200:
        raise RuntimeError("fetch_config failed (HTTP {}): {}".format(status, data))

    if not isinstance(data, dict):
        raise RuntimeError("fetch_config returned non-dict: {}".format(data))

    return data


def send_request(backend: dict, platform: str, endpoint: str, raw_text: str) -> dict:
    """Fire a logical endpoint against the backend.

    ``backend`` is the config's ``"backend"`` block, e.g.
    ``{ "baseUrl": "https://api.3alijny.com", "restaurant": "laffe" }``.

    The only endpoint currently supported is ``"tayf.orders.create"``, which maps
    to ``POST {baseUrl}/api/webhooks/`` with body
    ``{ "platform": platform, "restaurant": backend["restaurant"], "raw_text": raw_text }``
    — the contract the Django webhook receiver expects. This mirrors
    ``FlowInterpreter.resolveRequest`` on Android.

    Returns the parsed JSON response (e.g.
    ``{"status": "received", "confirm": true}``). Never raises: on any error it
    returns ``{"ok": False, "error": "..."}``. An unknown endpoint is a harmless
    no-op returning ``{"ok": False, "error": "unknown endpoint"}``.
    """
    if endpoint != "tayf.orders.create":
        return {"ok": False, "error": "unknown endpoint"}

    base_url = (backend.get("baseUrl") or "").rstrip("/")
    if not base_url:
        return {"ok": False, "error": "missing baseUrl in backend config"}

    url = base_url + "/api/webhooks/"
    payload = {
        "platform": platform,
        "restaurant": backend.get("restaurant", ""),
        "raw_text": raw_text,
    }

    status, data = _request("POST", url, body=payload)

    if status == 0:
        # Transport failure — _request put the reason in {"error": ...}.
        reason = data.get("error") if isinstance(data, dict) else str(data)
        return {"ok": False, "error": "request failed: {}".format(reason)}

    if not (200 <= status < 300):
        return {"ok": False, "error": "HTTP {}: {}".format(status, data)}

    if isinstance(data, dict):
        return data

    # 2xx but the body wasn't a JSON object — wrap it so the caller still gets a dict.
    return {"ok": True, "data": data}


def poll_pending(base_url: str, token: str, platforms: "list | None" = None) -> list:
    """Pull (and consume) queued menu-sync jobs for the host runner.

    GETs ``{base_url}/api/pending-syncs/`` and returns a list of pending jobs,
    each shaped like
    ``{ "platform": "lezzo", "items": [ {"name": "...", "available": false}, ... ] }``.
    The backend deletes the returned jobs, so each call consumes them.

    This is the polling trigger that replaces FCM push for the host-side runner.
    Pass ``platforms`` (a list of platform slugs this terminal handles, e.g.
    ``["lezzo"]``) so a terminal only consumes its own jobs — important when one
    restaurant has several host terminals each running a different app.

    Returns ``[]`` on any error (incl. a 404 if the endpoint isn't deployed) and
    never raises.
    """
    from urllib.parse import urlencode

    url = base_url.rstrip("/") + "/api/pending-syncs/"
    if platforms:
        url += "?" + urlencode({"platforms": ",".join(platforms)})
    status, data = _request("GET", url, token=token)

    if status != 200 or not isinstance(data, list):
        return []

    return data
