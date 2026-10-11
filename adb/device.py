"""ADB device driver for the host-side Android automation engine.

This module drives a locked Android POS terminal purely over ADB. Because the
terminal blocks app installs, we cannot push a helper app (e.g. ADBKeyBoard)
onto the device; we are limited to ``adb shell`` primitives:

* ``uiautomator dump`` to read the current screen hierarchy, and
* ``input`` / ``am`` / ``monkey`` to perform actions.

IMPORTANT LIMITATION -- NON-ASCII / ARABIC TEXT INPUT
=====================================================
Android's ``input text`` command does NOT support non-ASCII characters
(Arabic, emoji, accented Latin, etc.). It silently drops or mangles them.

For non-ASCII text :meth:`AdbDevice.input_text` makes a best-effort attempt via
the system clipboard (``cmd clipboard set-text`` + ``KEYCODE_PASTE``), but this
is unreliable: ``cmd clipboard`` is missing or restricted on many devices/OEM
builds, and pasting requires a focused, paste-capable field. If that route
fails a clear warning is logged. Robust non-ASCII entry fundamentally requires
an on-device IME (such as ADBKeyBoard) which we cannot install here, so callers
must not rely on non-ASCII input succeeding.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from typing import List, Optional, Set, Tuple

# Default timeout (seconds) for every adb invocation.
_TIMEOUT = 20

# Remote path used to stage the uiautomator hierarchy dump.
_DUMP_PATH = "/sdcard/prime_dump.xml"

# Shell characters that must be escaped inside an `input text "..."` argument.
_SHELL_SPECIAL = set('\\"\'`$&|;<>()*?![]{}~#')


def adb_binary() -> str:
    """Path of the ``adb`` executable to use.

    Order: the ``ORDO_ADB`` environment variable, then a copy shipped next to
    this script (``adb/platform-tools/adb[.exe]`` or ``adb/adb[.exe]`` — so a
    branch PC needs nothing installed but Python), then whatever is on PATH.
    """
    override = os.environ.get("ORDO_ADB")
    if override:
        return override
    here = os.path.dirname(os.path.abspath(__file__))
    exe = "adb.exe" if os.name == "nt" else "adb"
    for candidate in (os.path.join(here, "platform-tools", exe), os.path.join(here, exe)):
        if os.path.isfile(candidate):
            return candidate
    return shutil.which("adb") or "adb"


def list_devices() -> List[Tuple[str, str]]:
    """Devices adb currently sees, as ``[(serial, state)]``.

    ``state`` is ``"device"`` when usable, ``"unauthorized"`` when the
    "Allow USB debugging?" dialog has not been accepted on the device, or
    ``"offline"``. Raises ``RuntimeError`` if adb itself cannot be run.
    """
    try:
        proc = subprocess.run(
            [adb_binary(), "devices"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError("cannot run adb: {}".format(exc))
    out = []
    for line in (proc.stdout or "").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            out.append((parts[0], parts[1]))
    return out


class AdbDevice:
    """Thin wrapper around ``adb`` for one device.

    All actions are issued through ``adb [-s <serial>] shell ...``.
    """

    def __init__(self, serial: Optional[str] = None) -> None:
        """Bind to a device.

        :param serial: Device serial for ``adb -s <serial>``. ``None`` targets
            the single/default device.
        """
        self.serial = serial

    # ------------------------------------------------------------------ #
    # Low-level command execution
    # ------------------------------------------------------------------ #
    def _base(self) -> List[str]:
        """Return the adb command prefix, including ``-s <serial>`` if set."""
        cmd = [adb_binary()]
        if self.serial:
            cmd += ["-s", self.serial]
        return cmd

    def _run(self, *args: str) -> str:
        """Run a raw ``adb`` command and return its stripped stdout.

        Raises :class:`RuntimeError` on non-zero exit (adb failure).
        """
        cmd = self._base() + list(args)
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_TIMEOUT,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "adb command failed ({}): {}".format(
                    proc.returncode, (proc.stderr or proc.stdout or "").strip()
                )
            )
        return (proc.stdout or "").strip()

    def shell(self, *args: str) -> str:
        """Run ``adb [-s serial] shell <args...>`` and return stripped stdout.

        Raises on adb failure.
        """
        return self._run("shell", *args)

    # ------------------------------------------------------------------ #
    # Screen state
    # ------------------------------------------------------------------ #
    def dump_hierarchy(self) -> str:
        """Dump the current UI hierarchy and return the XML string.

        Runs ``uiautomator dump`` to a file on the device, reads it back with
        ``cat``, and strips any trailing non-XML noise. Retries once if the
        result comes back empty.
        """
        for attempt in range(2):
            # uiautomator prints e.g. "UI hierchary dumped to: <path>" to stdout.
            self.shell("uiautomator", "dump", _DUMP_PATH)
            xml = self.shell("cat", _DUMP_PATH)
            xml = self._strip_xml_noise(xml)
            if xml:
                return xml
            if attempt == 0:
                time.sleep(0.5)
        return ""

    @staticmethod
    def _strip_xml_noise(text: str) -> str:
        """Trim anything before the first '<' and after the last '>'."""
        if not text:
            return ""
        start = text.find("<")
        end = text.rfind(">")
        if start == -1 or end == -1 or end < start:
            return ""
        return text[start : end + 1].strip()

    # ------------------------------------------------------------------ #
    # Pointer / gesture actions
    # ------------------------------------------------------------------ #
    def tap(self, x: int, y: int) -> None:
        """Tap at screen coordinates ``(x, y)``."""
        self.shell("input", "tap", str(x), str(y))

    def swipe(
        self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300
    ) -> None:
        """Swipe from ``(x1, y1)`` to ``(x2, y2)`` over ``duration_ms`` ms."""
        self.shell(
            "input",
            "swipe",
            str(x1),
            str(y1),
            str(x2),
            str(y2),
            str(duration_ms),
        )

    # ------------------------------------------------------------------ #
    # Text input
    # ------------------------------------------------------------------ #
    def input_text(self, text: str) -> None:
        """Type ``text`` into the focused field.

        ASCII text is sent via ``input text`` (spaces become ``%s`` and
        shell-special characters are escaped). Non-ASCII text is attempted via
        the clipboard (``cmd clipboard set-text`` + KEYCODE_PASTE); see the
        module docstring for why this is unreliable.
        """
        if text == "":
            return

        if text.isascii():
            self.shell("input", "text", self._escape_ascii(text))
            return

        # Non-ASCII: best-effort clipboard paste.
        try:
            self.shell("cmd", "clipboard", "set-text", text)
            self.keyevent("279")  # KEYCODE_PASTE
        except Exception as exc:  # noqa: BLE001 - report any failure path
            print(
                "WARNING: non-ASCII input_text({!r}) failed via clipboard "
                "({}). Android `input text` cannot type non-ASCII and no "
                "on-device IME is available; this text was NOT entered.".format(
                    text, exc
                )
            )

    @staticmethod
    def _escape_ascii(text: str) -> str:
        """Escape an ASCII string for use as an ``input text`` argument."""
        out = []
        for ch in text:
            if ch == " ":
                out.append("%s")
            elif ch in _SHELL_SPECIAL:
                out.append("\\" + ch)
            else:
                out.append(ch)
        return "".join(out)

    def clear_field(self) -> None:
        """Clear the focused text field.

        Moves the cursor to the end then sends a run of delete key events.
        """
        self.keyevent("KEYCODE_MOVE_END")
        for _ in range(50):
            self.keyevent("KEYCODE_DEL")

    # ------------------------------------------------------------------ #
    # Key events / navigation
    # ------------------------------------------------------------------ #
    def keyevent(self, key: str) -> None:
        """Send a key event, e.g. ``"KEYCODE_BACK"`` or a numeric code ``"67"``."""
        self.shell("input", "keyevent", key)

    def back(self) -> None:
        """Press the global BACK button."""
        self.keyevent("KEYCODE_BACK")

    def home(self) -> None:
        """Press the HOME button."""
        self.keyevent("KEYCODE_HOME")

    # ------------------------------------------------------------------ #
    # App lifecycle
    # ------------------------------------------------------------------ #
    def launch_app(self, package: str) -> bool:
        """Bring ``package`` to the front via the monkey launcher intent.

        :returns: ``True`` on success, ``False`` if adb/monkey reported an error.
        """
        try:
            out = self.shell(
                "monkey",
                "-p",
                package,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            )
        except RuntimeError:
            return False
        # monkey prints this when it cannot find a launchable activity.
        if "No activities found" in out or "Error" in out:
            return False
        return True

    def installed_packages(self) -> Set[str]:
        """Package names installed on the device (``pm list packages``)."""
        out = self.shell("pm", "list", "packages")
        return {ln.split(":", 1)[1].strip() for ln in out.splitlines() if ln.startswith("package:")}

    def current_package(self) -> Optional[str]:
        """Return the package name of the foreground app, or ``None``.

        Parses ``dumpsys activity activities`` (resumed activity) first, then
        falls back to ``dumpsys window`` (current focus). The parse is done in
        Python so it works even when the device shell lacks ``grep``.
        """
        try:
            activities = self.shell("dumpsys", "activity", "activities")
        except RuntimeError:
            activities = ""
        pkg = self._parse_package(
            activities, ("mResumedActivity", "topResumedActivity")
        )
        if pkg:
            return pkg

        try:
            window = self.shell("dumpsys", "window")
        except RuntimeError:
            window = ""
        return self._parse_package(window, ("mCurrentFocus",))

    @staticmethod
    def _parse_package(dump: str, markers) -> Optional[str]:
        """Extract a package name from ``package/activity`` tokens on marker lines."""
        if not dump:
            return None
        # Matches tokens like "com.example.app/.MainActivity" or
        # "com.example.app/com.example.app.MainActivity".
        token = re.compile(r"([A-Za-z][A-Za-z0-9_.]+)/[A-Za-z0-9_.$]+")
        for line in dump.splitlines():
            if any(m in line for m in markers):
                match = token.search(line)
                if match:
                    return match.group(1)
        return None
