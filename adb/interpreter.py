"""Host-side ADB port of the Kotlin ``FlowInterpreter``.

This is the standard-library twin of
``App/modules/prime-native/.../FlowInterpreter.kt``. It executes the same
server-driven automation flows (see ``App/src/automation/local-config.json``),
but instead of an on-device accessibility service it drives the device over
ADB:

  * the screen is read with ``AdbDevice.dump_hierarchy()`` + ``Hierarchy.parse``,
  * elements are matched with the same :class:`Selector` semantics,
  * actions (tap/swipe/text/back/home) go through :class:`AdbDevice`,
  * the order webhook is fired through :func:`backend.send_request`.

Step semantics, ``{{interpolation}}``, condition evaluation, ``forEach``,
``scrollUntil`` and ``recoverToMain`` are mirrored from the Kotlin engine so a
config that runs on-device behaves identically here.

Standard library only.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

from .device import AdbDevice
from .uihierarchy import Hierarchy, Selector, selector_from_dict
from .backend import send_request


# Matches {{ path }} tokens; mirrors INTERP_REGEX in the Kotlin engine.
_INTERP_REGEX = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")

# Polling cadence (seconds) for waitFor / tapInRow, mirroring the Kotlin ~200ms
# native poll but relaxed here because each ADB dump is expensive.
_WAIT_POLL = 0.4

# How long tapInRow keeps re-dumping while the row has not yet appeared,
# mirroring the Kotlin polling tapInRow (~6s).
_TAP_IN_ROW_TIMEOUT = 6.0

# Default swipe duration (ms).
_SWIPE_MS = 300

# Fallback screen geometry used to translate a swipe "direction" into
# coordinates when we have no better information. uiautomator dumps report
# real bounds, but a swipe gesture only needs a sane span on the active screen.
_DEFAULT_WIDTH = 1080
_DEFAULT_HEIGHT = 1920


class StepFailure(Exception):
    """Raised when a step cannot complete (missing element, launch failed…).

    Mirrors the Kotlin ``FlowInterpreter.StepFailure``: a continuous run catches
    it, logs, recovers, and retries; a one-shot run lets it propagate.
    """


class FlowInterpreter:
    """Executes one automation flow over ADB.

    :param device: an :class:`AdbDevice` bound to the target device.
    :param backend: the config's ``"backend"`` block, e.g.
        ``{"baseUrl": "https://api.3alijny.com", "restaurant": "laffe"}``.
    :param on_log: optional ``on_log(level, message, depth)`` callback. ``level``
        is one of ``"step" | "info" | "success" | "error"``. Defaults to a simple
        indented ``print``.
    """

    def __init__(self, device: AdbDevice, backend: dict, on_log=None) -> None:
        self.device = device
        self.backend = backend or {}
        self.on_log = on_log if on_log is not None else self._default_log

        # Per-iteration state, reset at the start of each run.
        self._scope: Dict[str, Any] = {}
        self._orders: List[Dict[str, str]] = []
        self._selector_defs: Dict[str, dict] = {}
        self._target_package: str = ""
        self._platform: str = ""

    # ------------------------------------------------------------------ #
    # Logging
    # ------------------------------------------------------------------ #
    @staticmethod
    def _default_log(level: str, message: str, depth: int) -> None:
        print("{}[{}] {}".format("  " * depth, level, message))

    def _log(self, level: str, message: str, depth: int) -> None:
        try:
            self.on_log(level, message, depth)
        except Exception:  # noqa: BLE001 - logging must never break a run
            pass

    # ------------------------------------------------------------------ #
    # Public entry points
    # ------------------------------------------------------------------ #
    def run_once(self, platform_config: dict, vars: Optional[dict] = None) -> dict:
        """Run the flow array once.

        Seeds a fresh scope from ``platform_config["vars"]`` + ``parameters``
        (plus any ``vars`` override passed in), then runs each step in order.

        :returns: ``{"ok": True, "orders": [...]}`` on success.
        :raises StepFailure: if any step fails.
        """
        label = platform_config.get("label") or platform_config.get("platform") or "?"
        self._platform = platform_config.get("platform", "") or ""
        self._target_package = platform_config.get("targetPackage", "") or ""
        self._selector_defs = platform_config.get("selectors", {}) or {}

        parameters = platform_config.get("parameters", {}) or {}
        flow = platform_config.get("flow", []) or []

        # Fresh scope per iteration so old values don't bleed across runs
        # (mirrors runFlowOnce clearing the scope).
        self._scope = {}
        self._scope["scanIntervalSec"] = parameters.get("scanIntervalSec", 5)
        self._scope["autoConfirm"] = bool(parameters.get("autoConfirm", False))
        # Seed config-level vars (e.g. pushItems pushed via FCM) then any
        # caller override, so forEach / {{interpolation}} can read them.
        for k, v in (platform_config.get("vars", {}) or {}).items():
            self._scope[k] = v
        if vars:
            for k, v in vars.items():
                self._scope[k] = v
        self._orders = []

        self._log("info", 'بدء تدفق "{}" · {} خطوة'.format(label, len(flow)), 0)
        for step in flow:
            self._run_step(step, 0)
        self._log("success", "اكتمل التدفق · {} طلب".format(len(self._orders)), 0)
        return {"ok": True, "orders": list(self._orders)}

    def run_loop(self, platform_config: dict) -> None:
        """Run the flow once, or repeatedly when ``runMode == "continuous"``.

        Continuous mode mirrors the Kotlin ``runLoop``: on a :class:`StepFailure`
        (or any unexpected error) it logs, calls :meth:`recover_to_main`, waits a
        short retry delay, and runs again; on success it waits ``scanIntervalSec``.
        Loops until interrupted (Ctrl-C).
        """
        run_mode = platform_config.get("runMode", "once") or "once"
        parameters = platform_config.get("parameters", {}) or {}
        try:
            scan_interval = float(parameters.get("scanIntervalSec", 5) or 5)
        except (TypeError, ValueError):
            scan_interval = 5.0
        retry_delay = 2.0

        if run_mode != "continuous":
            self.run_once(platform_config)
            return

        while True:
            try:
                self.run_once(platform_config)
                ok = True
            except StepFailure as exc:
                self._log("error", "فشل التدفق · {}".format(exc), 0)
                self.recover_to_main()
                ok = False
            except KeyboardInterrupt:
                raise
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                self._log("error", "خطأ غير متوقّع · {}".format(exc), 0)
                self.recover_to_main()
                ok = False
            time.sleep(scan_interval if ok else retry_delay)

    def recover_to_main(self) -> None:
        """Best-effort recovery after a failed flow.

        Presses BACK three times with small delays to dismiss any dialog/sheet
        left open and return toward the app's main screen, so the next run
        starts clean instead of stranded mid-screen. Mirrors Kotlin
        ``recoverToMain``.
        """
        self._log("info", "تعذّر — محاولة العودة للشاشة الرئيسية", 0)
        for _ in range(3):
            try:
                self.device.back()
            except Exception:  # noqa: BLE001 - best effort
                pass
            time.sleep(0.5)

    # ------------------------------------------------------------------ #
    # Selector / interpolation / scope helpers
    # ------------------------------------------------------------------ #
    def _resolve_selector(self, key: str) -> Selector:
        """Look up a selector by key, interpolate ``{{var}}``, auto-scope it.

        Mirrors Kotlin ``resolveSelector``: an empty packageScope is filled with
        ``targetPackage`` for every strategy except ``package``.
        """
        raw = self._selector_defs.get(key)
        if raw is None:
            raise StepFailure("المُحدِّد غير موجود: {}".format(key))

        strategy = raw.get("strategy", "") or ""
        raw_value = raw.get("value", "") or ""
        value = self._interpolate(raw_value) if "{{" in raw_value else raw_value
        match = raw.get("match", "exact") or "exact"
        package_scope = raw.get("packageScope", "") or ""
        if not package_scope and self._target_package and strategy != "package":
            package_scope = self._target_package

        return selector_from_dict(
            {
                "strategy": strategy,
                "value": value,
                "match": match,
                "packageScope": package_scope,
            }
        )

    def _interpolate(self, template: str) -> str:
        """Replace ``{{path}}`` tokens against the live scope.

        Mirrors Kotlin ``interpolate``: a missing path renders as the empty
        string.
        """

        def repl(m: "re.Match") -> str:
            value = self._read_path(self._scope, m.group(1).strip())
            return "" if value is None else str(value)

        return _INTERP_REGEX.sub(repl, template)

    @staticmethod
    def _read_path(root: dict, path: str) -> Any:
        """Read an ``a.b.c`` dotted path from a nested dict; None if any segment
        is missing. Mirrors Kotlin ``readPath``."""
        if not path:
            return None
        parts = path.split(".")
        if not isinstance(root, dict):
            return None
        cursor: Any = root.get(parts[0])
        for part in parts[1:]:
            if not isinstance(cursor, dict):
                return None
            cursor = cursor.get(part)
        return cursor

    @staticmethod
    def _eval_condition(value: Any, op: str, expected: Any) -> bool:
        """Evaluate a condition op; mirrors Kotlin ``evalCondition``."""
        def is_empty(v: Any) -> bool:
            return v is None or v == "" or (isinstance(v, list) and len(v) == 0)

        if op == "isEmpty":
            return is_empty(value)
        if op == "notEmpty":
            return not is_empty(value)
        if op == "equals":
            return value == expected
        if op == "notEquals":
            return value != expected
        return False

    @staticmethod
    def _extract_raw_text(body: Any) -> str:
        """Build raw_text from a readScreen snapshot: comma-join its ``texts``.

        Mirrors Kotlin ``extractRawText``.
        """
        if isinstance(body, dict):
            texts = body.get("texts")
            if isinstance(texts, list):
                return ",".join(t for t in texts if isinstance(t, str))
        return "" if body is None else str(body)

    # ------------------------------------------------------------------ #
    # Screen helpers
    # ------------------------------------------------------------------ #
    def _hierarchy(self) -> Hierarchy:
        """Dump the current screen fresh and parse it (never cache stale)."""
        xml = self.device.dump_hierarchy()
        if not xml:
            # An empty dump means we have no screen to match against; parse a
            # trivial empty tree so find()/texts() simply return nothing.
            return Hierarchy.parse("<hierarchy></hierarchy>")
        return Hierarchy.parse(xml)

    def _swipe_for_direction(self, direction: str) -> None:
        """Issue one swipe gesture in ``direction``.

        A "down" scroll reveals lower content, which on Android means swiping the
        finger UP (mirroring the engine's scroll semantics). "up" swipes down,
        and left/right scroll horizontally.
        """
        cx = _DEFAULT_WIDTH // 2
        cy = _DEFAULT_HEIGHT // 2
        far = _DEFAULT_HEIGHT // 4
        far_x = _DEFAULT_WIDTH // 4
        if direction == "up":
            # Reveal content above: finger moves down.
            self.device.swipe(cx, cy, cx, cy + far, _SWIPE_MS)
        elif direction == "left":
            self.device.swipe(cx, cy, cx + far_x, cy, _SWIPE_MS)
        elif direction == "right":
            self.device.swipe(cx, cy, cx - far_x, cy, _SWIPE_MS)
        else:  # "down" (default): reveal content below, finger moves up.
            self.device.swipe(cx, cy, cx, cy - far, _SWIPE_MS)

    # ------------------------------------------------------------------ #
    # Step dispatch
    # ------------------------------------------------------------------ #
    def _run_step(self, step: dict, depth: int) -> None:
        step_type = step.get("type")
        if not step_type:
            raise StepFailure("نوع خطوة غير محدّد")

        handler = getattr(self, "_step_" + step_type, None)
        if handler is None:
            self._log("error", "خطوة غير معروفة: {}".format(step_type), depth)
            return
        handler(step, depth)

    # -- lifecycle ----------------------------------------------------------
    def _step_launchApp(self, step: dict, depth: int) -> None:
        sel = self._resolve_selector(step["selector"])
        self._log("step", "تشغيل التطبيق · {}".format(sel.value), depth)
        ok = self.device.launch_app(sel.value)
        if not ok:
            raise StepFailure(
                "تعذّر تشغيل التطبيق: {} — تحقّق من اسم الحزمة وأنّ التطبيق مُثبَّت.".format(
                    sel.value
                )
            )

    def _step_waitForApp(self, step: dict, depth: int) -> None:
        sel = self._resolve_selector(step["selector"])
        timeout_ms = step.get("timeoutMs", 8000) or 8000
        self._log("step", "انتظار التطبيق · {}".format(sel.value), depth)
        deadline = time.monotonic() + timeout_ms / 1000.0
        while time.monotonic() < deadline:
            if self.device.current_package() == sel.value:
                return
            time.sleep(0.2)
        raise StepFailure("لم يصبح التطبيق في المقدّمة: {}".format(sel.value))

    # -- waiting / watching -------------------------------------------------
    def _step_waitFor(self, step: dict, depth: int) -> None:
        key = step["selector"]
        sel = self._resolve_selector(key)
        timeout_ms = step.get("timeoutMs", 5000) or 5000
        self._log("step", "انتظار ظهور · {}".format(key), depth)
        deadline = time.monotonic() + timeout_ms / 1000.0
        while True:
            if self._hierarchy().find(sel) is not None:
                return
            if time.monotonic() >= deadline:
                break
            time.sleep(_WAIT_POLL)
        raise StepFailure("لم يظهر العنصر: {}".format(key))

    def _step_watchFor(self, step: dict, depth: int) -> None:
        key = step["selector"]
        sel = self._resolve_selector(key)
        interval_ms = step.get("intervalMs", 500) or 500
        interval = interval_ms / 1000.0
        self._log("step", "مراقبة الشاشة لـ · {}".format(key), depth)
        # Forever-watch for the new-order trigger. Heartbeat every ~5s so the
        # log shows it's still alive (mirrors the Kotlin heartbeat).
        next_heartbeat = time.monotonic() + 5.0
        elapsed = 0
        while True:
            if self._hierarchy().find(sel) is not None:
                self._log("success", "ظهر · {}".format(key), depth)
                return
            now = time.monotonic()
            if now >= next_heartbeat:
                elapsed += 5
                self._log("info", "لا يزال يراقب · {}ث".format(elapsed), depth)
                next_heartbeat = now + 5.0
            time.sleep(interval)

    def _step_wait(self, step: dict, depth: int) -> None:
        duration_ms = step.get("durationMs", 0) or 0
        self._log("step", "تأخير · {} ملّي".format(duration_ms), depth)
        time.sleep(duration_ms / 1000.0)

    # -- tapping ------------------------------------------------------------
    def _step_tap(self, step: dict, depth: int) -> None:
        key = step["selector"]
        sel = self._resolve_selector(key)
        self._log("step", "نقر · {}".format(key), depth)
        node = self._hierarchy().find(sel)
        if node is None:
            self._log("info", "تعذّر العثور على {} للنقر".format(key), depth)
            raise StepFailure("تعذّر العثور على العنصر للنقر: {}".format(key))
        x, y = node.center
        self.device.tap(x, y)

    def _step_tapInRow(self, step: dict, depth: int) -> None:
        anchor_key = step["anchor"]
        target_key = step["target"]
        anchor = self._resolve_selector(anchor_key)
        target = self._resolve_selector(target_key)
        self._log(
            "step", "نقر في صف · {} ← {}".format(anchor_key, target_key), depth
        )
        # Poll: the row may not be rendered yet (mirrors the polling tapInRow).
        deadline = time.monotonic() + _TAP_IN_ROW_TIMEOUT
        while True:
            node = self._hierarchy().find_in_row(anchor, target)
            if node is not None:
                x, y = node.center
                self.device.tap(x, y)
                return
            if time.monotonic() >= deadline:
                break
            time.sleep(_WAIT_POLL)
        self._log("info", "تعذّر إيجاد صف · {}".format(anchor_key), depth)
        raise StepFailure("تعذّر إيجاد صف · {}".format(anchor_key))

    def _step_tapAt(self, step: dict, depth: int) -> None:
        x = int(step.get("x", 0) or 0)
        y = int(step.get("y", 0) or 0)
        self._log("step", "نقر عند · {},{}".format(x, y), depth)
        self.device.tap(x, y)

    # -- scrolling / swiping ------------------------------------------------
    def _step_scroll(self, step: dict, depth: int) -> None:
        direction = step.get("direction", "down") or "down"
        self._log(
            "step",
            "تمرير · {}".format("لأسفل" if direction == "down" else "لأعلى"),
            depth,
        )
        self._swipe_for_direction(direction)

    def _step_scrollUntil(self, step: dict, depth: int) -> None:
        until_key = step["until"]
        until = self._resolve_selector(until_key)
        direction = step.get("direction", "down") or "down"
        max_passes = step.get("maxScrollPasses", 10) or 10
        self._log("step", "تمرير حتى يظهر · {}".format(until_key), depth)
        # Check first (it may already be visible), then scroll up to maxPasses.
        for _ in range(int(max_passes) + 1):
            if self._hierarchy().find(until) is not None:
                self._log("success", "ظهر بعد التمرير · {}".format(until_key), depth)
                return
            self._swipe_for_direction(direction)
            time.sleep(0.3)
        if self._hierarchy().find(until) is not None:
            self._log("success", "ظهر بعد التمرير · {}".format(until_key), depth)
            return
        raise StepFailure("لم يظهر العنصر بعد التمرير: {}".format(until_key))

    def _step_swipe(self, step: dict, depth: int) -> None:
        direction = step.get("direction", "down") or "down"
        self._log("step", "سحب · {}".format(direction), depth)
        self._swipe_for_direction(direction)

    # -- text ---------------------------------------------------------------
    def _step_setText(self, step: dict, depth: int) -> None:
        key = step["selector"]
        sel = self._resolve_selector(key)
        raw_text = step.get("text", "") or ""
        text = self._interpolate(raw_text) if "{{" in raw_text else raw_text
        self._log("step", "إدخال نص · {}".format(key), depth)
        node = self._hierarchy().find(sel)
        if node is None:
            raise StepFailure("تعذّر العثور على الحقل لإدخال النص: {}".format(key))
        x, y = node.center
        self.device.tap(x, y)  # focus the field
        self.device.input_text(text)

    def _step_clearText(self, step: dict, depth: int) -> None:
        key = step["selector"]
        sel = self._resolve_selector(key)
        self._log("step", "مسح النص · {}".format(key), depth)
        node = self._hierarchy().find(sel)
        if node is None:
            raise StepFailure("تعذّر العثور على الحقل لمسح النص: {}".format(key))
        x, y = node.center
        self.device.tap(x, y)  # focus the field
        self.device.clear_field()

    # -- inspection ---------------------------------------------------------
    def _step_exists(self, step: dict, depth: int) -> None:
        key = step["selector"]
        save_as = step["saveAs"]
        sel = self._resolve_selector(key)
        found = self._hierarchy().find(sel) is not None
        self._scope[save_as] = found
        self._log("step", "موجود؟ · {} = {}".format(key, found), depth)

    def _step_readField(self, step: dict, depth: int) -> None:
        key = step["selector"]
        save_as = step["saveAs"]
        sel = self._resolve_selector(key)
        node = self._hierarchy().find(sel)
        if node is None:
            text = ""
        else:
            text = node.text if node.text else (node.content_desc or "")
        self._scope[save_as] = text
        self._log("step", 'قراءة · {} = "{}"'.format(save_as, text), depth)

    def _step_readScreen(self, step: dict, depth: int) -> None:
        save_as = step["saveAs"]
        self._log("step", "قراءة الشاشة الكاملة → {}".format(save_as), depth)
        texts = self._hierarchy().texts()
        snapshot = {"texts": texts}
        self._scope[save_as] = snapshot
        self._log("success", "{} نص".format(len(texts)), depth)
        if texts:
            joined = " · ".join(texts)
            if len(joined) > 400:
                joined = joined[:400] + "…"
            self._log("info", "النصوص: {}".format(joined), depth)

    # -- navigation ---------------------------------------------------------
    def _step_back(self, step: dict, depth: int) -> None:
        self._log("step", "زر الرجوع", depth)
        self.device.back()

    def _step_home(self, step: dict, depth: int) -> None:
        self._log("step", "زر الرئيسية", depth)
        self.device.home()

    def _step_recents(self, step: dict, depth: int) -> None:
        self._log("step", "قائمة التطبيقات", depth)
        self.device.keyevent("KEYCODE_APP_SWITCH")

    def _step_openNotifications(self, step: dict, depth: int) -> None:
        self._log("step", "فتح الإشعارات", depth)
        self.device.keyevent("KEYCODE_NOTIFICATION")

    # -- control flow -------------------------------------------------------
    def _step_forEach(self, step: dict, depth: int) -> None:
        items_path = step.get("items", "") or ""
        as_name = step.get("as", "item") or "item"
        raw_list = self._read_path(self._scope, items_path)
        items = raw_list if isinstance(raw_list, list) else []
        body = step.get("do", []) or []
        self._log("step", "تكرار · {} ({})".format(items_path, len(items)), depth)

        had = as_name in self._scope
        prev = self._scope.get(as_name)
        try:
            for i, element in enumerate(items):
                self._scope[as_name] = element
                self._log("info", "عنصر {}/{}".format(i + 1, len(items)), depth)
                for child in body:
                    self._run_step(child, depth + 1)
        finally:
            if had:
                self._scope[as_name] = prev
            else:
                self._scope.pop(as_name, None)

    def _step_if(self, step: dict, depth: int) -> None:
        condition = step.get("condition", {}) or {}
        var_path = condition.get("var", "") or ""
        op = condition.get("op", "") or ""
        expected = condition.get("value")
        passed = self._eval_condition(
            self._read_path(self._scope, var_path), op, expected
        )
        self._log(
            "step",
            "شرط · {} ← {}".format(var_path, "تحقّق" if passed else "لم يتحقّق"),
            depth,
        )
        branch = (step.get("then") if passed else step.get("else")) or []
        for child in branch:
            self._run_step(child, depth + 1)

    # -- backend ------------------------------------------------------------
    def _step_sendRequest(self, step: dict, depth: int) -> None:
        endpoint = step.get("endpoint", "") or ""
        body_var = step.get("body")
        save_as = step.get("saveAs")
        body = self._scope.get(body_var) if body_var else None
        raw_text = self._extract_raw_text(body)
        self._log(
            "step",
            "إرسال طلب · {}{}".format(
                endpoint, " → {}".format(save_as) if save_as else ""
            ),
            depth,
        )
        response = send_request(self.backend, self._platform, endpoint, raw_text)
        if save_as:
            self._scope[save_as] = response
        self._log("info", "الردّ: {}".format(response), depth)
