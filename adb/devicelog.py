"""Device-side error log for the host ADB runner.

The host-side twin of the Android app's ``DeviceLog.kt``. Every error that
happens on this terminal — a flow step that failed, an order that could not be
sent, adb losing the device — is recorded with the engine log lines that led up
to it and a text dump of the screen at that moment, then uploaded to the
backend's ``POST /api/device-logs/`` so it can be read on the dashboard's
developer page instead of only in this machine's terminal.

Reports are appended to a file first and uploaded from there, so one made while
the network is down is sent later instead of lost.

A failing flow retries every couple of seconds, so the same error is throttled:
reported once, then again after ``_THROTTLE_SECONDS`` carrying the number of
repeats in between.

Standard library only.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from datetime import datetime
from typing import Callable, Deque, Dict, List, Optional

from .backend import _request
from .device import AdbDevice
from .uihierarchy import Hierarchy

_QUEUE_DIR = os.path.join(os.path.expanduser("~"), ".ordo-adb")
_MAX_QUEUE = 200          # reports kept while offline
_TRAIL_SIZE = 40          # engine log lines kept as context
_MAX_SCREEN_TEXTS = 300
_MAX_TEXT = 300
_BATCH = 20
_THROTTLE_SECONDS = 10 * 60


class DeviceLog:
    """Collects, queues and uploads this terminal's errors.

    :param base_url: backend base URL.
    :param get_token: returns the current auth token (or ``None`` before login).
    :param device: the bound :class:`AdbDevice`, used for the screen dump and
        the device's model / Android version.
    """

    def __init__(
        self,
        base_url: str,
        get_token: Callable[[], Optional[str]],
        device: AdbDevice,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.get_token = get_token
        self.device = device

        self._lock = threading.Lock()        # trail + throttle
        self._io_lock = threading.Lock()     # queue file + uploads
        self._trail: Deque[str] = deque(maxlen=_TRAIL_SIZE)
        # key -> [last report time, repeats swallowed since]
        self._throttle: Dict[str, List[float]] = {}
        self._device_info: Optional[dict] = None

        name = "queue-{}.jsonl".format(device.serial or "default")
        self._queue_path = os.path.join(_QUEUE_DIR, name.replace(os.sep, "_").replace(":", "_"))

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def trail(self, level: str, message: str, depth: int = 0) -> None:
        """Remember one engine log line so a later error can show what led to it."""
        line = "{} [{}] {}{}".format(
            datetime.now().strftime("%H:%M:%S"),
            level,
            "  " * max(0, min(int(depth), 8)),
            str(message)[:_MAX_TEXT],
        )
        with self._lock:
            self._trail.append(line)

    def report(
        self,
        platform: str,
        message: str,
        kind: str = "flow",
        capture_screen: bool = True,
    ) -> None:
        """Record an error. Never raises.

        Call it at the moment of failure — the screen is dumped here, before any
        recovery step changes what is on it.
        """
        try:
            now = time.time()
            key = "{}|{}|{}".format(platform, kind, message)
            with self._lock:
                seen = self._throttle.get(key)
                if seen is not None and now - seen[0] < _THROTTLE_SECONDS:
                    seen[1] += 1
                    return
                repeats = int(seen[1]) + 1 if seen is not None else 1
                if len(self._throttle) > 500:
                    self._throttle.clear()
                self._throttle[key] = [now, 0]
                context = list(self._trail)

            entry = {
                "platform": platform or "",
                "kind": kind,
                "message": str(message)[:2000],
                "occurred_at": int(now * 1000),
                "count": repeats,
                "context": context,
            }
            if capture_screen:
                screen = self._snapshot()
                if screen is not None:
                    entry["screen"] = screen
            self._enqueue(entry)
            # Upload off-thread so a slow or dead network never stalls the flow.
            threading.Thread(target=self.flush, name="device-log-flush", daemon=True).start()
        except Exception:  # noqa: BLE001 - logging must never break the runner
            pass

    def flush(self) -> None:
        """Upload queued reports; a failed batch stays queued. Never raises."""
        try:
            with self._io_lock:
                while True:
                    token = self.get_token()
                    if not token:
                        return
                    lines = self._read_queue()
                    if not lines:
                        return
                    batch = lines[:_BATCH]
                    entries = []
                    for line in batch:
                        try:
                            entries.append(json.loads(line))
                        except ValueError:
                            pass  # skip a corrupt line
                    status, _ = _request(
                        "POST",
                        self.base_url + "/api/device-logs/",
                        token=token,
                        body={"source": "adb", "device": self._info(), "entries": entries},
                    )
                    # 2xx: stored. 400/413: the server will never accept this
                    # batch, so drop it rather than block the queue forever.
                    # Anything else (offline, 5xx): keep it and try again later.
                    if not (200 <= status < 300) and status not in (400, 413):
                        return
                    self._write_queue(self._read_queue()[len(batch):])
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #
    def _snapshot(self) -> Optional[dict]:
        """Foreground package + visible texts, or ``None`` if adb can't read it."""
        try:
            texts = Hierarchy.parse(self.device.dump_hierarchy()).texts()
        except Exception:  # noqa: BLE001 - e.g. the device is unplugged
            return None
        try:
            package = self.device.current_package() or ""
        except Exception:  # noqa: BLE001
            package = ""
        return {
            "package": package,
            "texts": [str(t)[:_MAX_TEXT] for t in texts[:_MAX_SCREEN_TEXTS]],
        }

    def _info(self) -> dict:
        """Device identity, read once (and retried while adb can't answer)."""
        if self._device_info is not None:
            return self._device_info
        info = {"id": self.device.serial or "", "app_version": "adb-runner"}
        try:
            info["model"] = self.device.shell("getprop", "ro.product.model")
            info["os"] = self.device.shell("getprop", "ro.build.version.release")
            if not info["id"]:
                info["id"] = self.device.shell("getprop", "ro.serialno")
            self._device_info = info
        except Exception:  # noqa: BLE001
            pass
        return info

    def _read_queue(self) -> List[str]:
        try:
            with open(self._queue_path, encoding="utf-8") as fh:
                return [ln for ln in fh.read().splitlines() if ln.strip()]
        except OSError:
            return []

    def _write_queue(self, lines: List[str]) -> None:
        if not lines:
            try:
                os.remove(self._queue_path)
            except OSError:
                pass
            return
        os.makedirs(_QUEUE_DIR, exist_ok=True)
        with open(self._queue_path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")

    def _enqueue(self, entry: dict) -> None:
        with self._io_lock:
            # Oldest reports are dropped first when the terminal stays offline.
            lines = self._read_queue() + [json.dumps(entry, ensure_ascii=False)]
            self._write_queue(lines[-_MAX_QUEUE:])
