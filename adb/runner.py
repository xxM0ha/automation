"""Orchestrator for the host-side ADB automation runner.

This is the ADB-port equivalent of the mobile app's ``EngineController`` plus
its FCM-driven menu-sync queue, for the terminals the app cannot be installed
on. One PC drives every Android device plugged into it over USB:

  1. it logs in with the branch account and fetches the same server-driven
     AutomationConfig the app uses (re-fetched every few seconds, so a config
     edited in the dashboard takes effect without touching this PC);
  2. it watches ``adb devices`` — each device that appears gets its own worker,
     and one that is unplugged is dropped, with no restart;
  3. for each device it works out which delivery app it runs by checking which
     of the config's ``targetPackage``s is installed on it, then runs that
     app's order task and its ``<platform>_menu`` task;
  4. it polls the backend for queued menu on/off jobs and hands each to the
     device that runs that app.

ONE SCREEN, ONE FLOW
====================
Two flows must never tap the same screen at once. Each device has one lock,
shared by its order task and its menu task (see ``FlowInterpreter``): a flow
holds it while acting and gives it up while it only watches for a new order.
So a menu on/off run waits for an order that is being handled, and an order
that arrives during a menu run is handled right after it.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import queue
import sys
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional

from .backend import fetch_config, login_account, poll_pending
from .device import AdbDevice, list_devices
from .devicelog import DeviceLog
from .interpreter import FlowInterpreter, FlowStopped, StepFailure
from .uihierarchy import Hierarchy

DEFAULT_BASE_URL = "https://api.3alijny.com"

# Login + per-device choices, saved after the first run so the launcher can be
# started with no arguments from then on.
SETTINGS_PATH = os.path.join(os.path.expanduser("~"), ".ordo-adb", "settings.json")

# How often (seconds) to re-fetch the config so dashboard edits propagate.
_CONFIG_REFRESH_INTERVAL = 20
# How often (seconds) to look for plugged / unplugged devices.
_DEVICE_SCAN_INTERVAL = 3
# Pause after a failed run before trying again.
_RETRY_DELAY = 2.0

# Suffix that marks a platform as a push/poll-driven menu-sync task.
_MENU_SUFFIX = "_menu"

_print_lock = threading.Lock()


def _now() -> str:
    """Return a short local timestamp like ``12:34:56`` for log lines."""
    return datetime.now().strftime("%H:%M:%S")


def _say(tag: str, message: str) -> None:
    with _print_lock:
        try:
            print("[{}] [{}] {}".format(_now(), tag, message), flush=True)
        except UnicodeEncodeError:
            # A Windows console that cannot show Arabic must not kill the run.
            safe = message.encode("ascii", "backslashreplace").decode("ascii")
            print("[{}] [{}] {}".format(_now(), tag, safe), flush=True)


# ---------------------------------------------------------------------- #
# Settings
# ---------------------------------------------------------------------- #
def load_settings() -> dict:
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(settings: dict) -> None:
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, ensure_ascii=False, indent=2)


def _is_menu(platform: dict) -> bool:
    return (platform.get("platform") or "").endswith(_MENU_SUFFIX)


def _selector_package(platform: dict) -> str:
    """The app a task drives: ``targetPackage``, else its ``package`` selector."""
    pkg = platform.get("targetPackage")
    if pkg:
        return pkg
    for sel in (platform.get("selectors") or {}).values():
        if isinstance(sel, dict) and sel.get("strategy") == "package" and sel.get("value"):
            return sel["value"]
    return ""


# ---------------------------------------------------------------------- #
# One device
# ---------------------------------------------------------------------- #
class DeviceWorker:
    """Runs the order task and the menu task of one plugged-in device."""

    def __init__(self, runner: "Runner", serial: str) -> None:
        self.runner = runner
        self.serial = serial
        self.tag = serial[-6:] if len(serial) > 6 else serial
        self.device = AdbDevice(serial=serial)
        self.device_log = DeviceLog(runner.base_url, lambda: runner.token, self.device)

        self.stop_event = threading.Event()
        # Set when the config changed or a menu run used the screen, so an
        # order task parked in a watch starts its flow over (new config / back
        # to the orders screen). Only honoured while watching, never mid-order.
        self._restart_orders = threading.Event()
        self.screen_lock = threading.Lock()
        self.menu_jobs: "queue.Queue[dict]" = queue.Queue()

        #: The delivery app this device runs (a ``targetPackage``), once known.
        self.app: Optional[str] = None
        self._installed: Optional[set] = None
        self._no_app_warned = False
        self._ran_once: set = set()

        self.order_interp = FlowInterpreter(
            self.device, runner.backend_block(), lock=self.screen_lock,
            should_stop=self.stop_event.is_set,
            should_restart=self._restart_orders.is_set,
        )
        self.menu_interp = FlowInterpreter(
            self.device, runner.backend_block(), lock=self.screen_lock,
            should_stop=self.stop_event.is_set,
        )
        self.order_interp.on_log = lambda lv, msg, d=0: self._on_log(self.order_interp, lv, msg, d)
        self.menu_interp.on_log = lambda lv, msg, d=0: self._on_log(self.menu_interp, lv, msg, d)

        self._threads = [
            threading.Thread(target=self._order_loop, name="order-" + self.tag, daemon=True),
            threading.Thread(target=self._menu_loop, name="menu-" + self.tag, daemon=True),
        ]

    # -- logging ------------------------------------------------------------
    def _on_log(self, interp: FlowInterpreter, level: str, message: str, depth: int = 0) -> None:
        """Print one engine line and feed the device error log.

        An ``error`` line is uploaded to the dashboard with the lines before it
        and a dump of the screen as it is right now.
        """
        _say("{} {}".format(self.tag, level), "  " * max(0, int(depth)) + str(message))
        self.device_log.trail(level, message, depth)
        if level == "error":
            self.device_log.report(getattr(interp, "_platform", "") or "", message)

    def say(self, message: str) -> None:
        _say(self.tag, message)

    def problem(self, message: str) -> None:
        """A device-level failure outside a flow: print it and report it."""
        self.say(message)
        self.device_log.report("", message, kind="app", capture_screen=False)

    # -- lifecycle ----------------------------------------------------------
    def start(self) -> None:
        self.say("device connected")
        # Send anything left queued from a previous run that ended offline.
        threading.Thread(target=self.device_log.flush, name="device-log-flush", daemon=True).start()
        for t in self._threads:
            t.start()

    def stop(self) -> None:
        self.stop_event.set()

    def config_changed(self) -> None:
        """Called by the runner after a config refresh that changed something."""
        backend = self.runner.backend_block()
        self.order_interp.backend = backend
        self.menu_interp.backend = backend
        self._ran_once.clear()
        self._no_app_warned = False
        self._restart_orders.set()

    # -- which app does this device run? ---------------------------------------
    def _resolve_app(self) -> Optional[str]:
        """Pick this device's app: the one forced on the command line or in the
        settings file, else the first config app that is installed on it."""
        forced = self.runner.forced_app(self.serial)
        if forced:
            return forced
        if self._installed is None:
            self._installed = self.device.installed_packages()
        candidates: List[str] = []
        for p in self.runner.platforms():
            pkg = _selector_package(p)
            if pkg and pkg in self._installed and pkg not in candidates:
                candidates.append(pkg)
        if not candidates:
            if not self._no_app_warned:
                self._no_app_warned = True
                self.say(
                    "none of the apps in the server config is installed on this device "
                    "— waiting (add its task in the dashboard, or install the app)"
                )
            # The app may be installed later; look again next time.
            self._installed = None
            return None
        if len(candidates) > 1 and not self._no_app_warned:
            self._no_app_warned = True
            self.say(
                "several configured apps are installed: {}. Using {} — a device shows one "
                "app at a time. To choose another: python -m adb setup".format(
                    ", ".join(candidates), candidates[0]
                )
            )
        return candidates[0]

    def menu_slugs(self) -> List[str]:
        """Bare platform slugs this device has a ``_menu`` task for."""
        if not self.app:
            return []
        return [
            p["platform"][: -len(_MENU_SUFFIX)]
            for p in self.runner.platforms()
            if _is_menu(p) and _selector_package(p) == self.app
        ]

    def _order_tasks(self) -> List[dict]:
        return [
            p for p in self.runner.platforms()
            if not _is_menu(p) and p.get("control") == "running"
            and _selector_package(p) == self.app
        ]

    def _menu_task(self, platform: str) -> Optional[dict]:
        wanted = platform + _MENU_SUFFIX
        for p in self.runner.platforms():
            if p.get("platform") == wanted and _selector_package(p) == self.app:
                return p
        return None

    def _wait(self, seconds: float) -> None:
        """Sleep, waking early on shutdown or a config change."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.stop_event.is_set() or self._restart_orders.is_set():
                return
            time.sleep(0.2)

    # -- order task ---------------------------------------------------------
    def _order_loop(self) -> None:
        announced: Optional[str] = None
        while not self.stop_event.is_set():
            self._restart_orders.clear()
            try:
                self.app = self._resolve_app()
            except Exception as exc:  # noqa: BLE001 - e.g. adb lost the device
                self.problem("cannot read the device's installed apps: {}".format(exc))
                self._wait(5)
                continue
            if not self.app:
                self._wait(10)
                continue

            tasks = [t for t in self._order_tasks() if t.get("platform") not in self._ran_once]
            names = ", ".join(t.get("platform", "?") for t in tasks) or "(none running)"
            state = "{} | {}".format(self.app, names)
            if state != announced:
                announced = state
                self.say("app {} — order tasks: {} — menu tasks: {}".format(
                    self.app, names, ", ".join(self.menu_slugs()) or "(none)"))
            if not tasks:
                # Nothing set to "running" for this app yet; the menu task (if
                # any) still works. Check again when the config changes.
                self._wait(10)
                continue

            for task in tasks:
                if self.stop_event.is_set() or self._restart_orders.is_set():
                    break
                ok = self._run_order(task)
                if (task.get("runMode") or "once") != "continuous":
                    self._ran_once.add(task.get("platform"))
                    continue
                params = task.get("parameters") or {}
                try:
                    interval = float(params.get("scanIntervalSec", 5) or 5)
                except (TypeError, ValueError):
                    interval = 5.0
                self._wait(interval if ok else _RETRY_DELAY)

    def _run_order(self, task: dict) -> bool:
        """One run of an order task. Returns False if it failed."""
        try:
            self.order_interp.run_once(task)
            return True
        except FlowStopped:
            return True
        except Exception:  # noqa: BLE001 - run_once logged it and backed out
            return False

    # -- menu task ----------------------------------------------------------
    def _menu_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                job = self.menu_jobs.get(timeout=1.0)
            except queue.Empty:
                continue
            platform = job.get("platform") or ""
            items = job.get("items") or []
            task = self._menu_task(platform)
            if task is None or not items:
                continue
            self.say("menu on/off for '{}' — {} item(s) in one run".format(platform, len(items)))
            try:
                # Blocks here while an order is being handled on this device.
                self.menu_interp.run_once(task, vars={"pushItems": items})
            except FlowStopped:
                return
            except Exception:  # noqa: BLE001
                # run_once logged the error (→ dashboard) and backed out of
                # whatever sheet was open.
                pass
            # The menu run left the app on some other screen: have the order
            # task start its flow over so it returns to the orders screen
            # instead of watching a menu page.
            self._restart_orders.set()


# ---------------------------------------------------------------------- #
# The PC
# ---------------------------------------------------------------------- #
class Runner:
    """Drives every ADB-connected device from the server config.

    :param base_url: backend base URL.
    :param email: branch account email (or branch username).
    :param password: its password.
    :param serial: only drive this device; ``None`` drives every device.
    :param app: force this ``targetPackage`` on every device instead of
        auto-detecting it.
    :param apps: per-device override, ``{serial: targetPackage}``.
    :param poll_interval: seconds between menu on/off polls.
    """

    def __init__(
        self,
        base_url: str,
        email: str,
        password: str,
        serial: Optional[str] = None,
        app: Optional[str] = None,
        apps: Optional[Dict[str, str]] = None,
        poll_interval: float = 5.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.serial = serial
        self.app = app
        self.apps = apps or {}
        self.poll_interval = poll_interval

        self.token: Optional[str] = None
        self.restaurant: str = ""
        self.config: Dict = {}
        self._config_fingerprint = ""
        self.workers: Dict[str, DeviceWorker] = {}
        self._warned: set = set()
        self._stop = threading.Event()

    # -- account + config -----------------------------------------------------
    def login(self) -> None:
        account = login_account(self.base_url, self.email, self.password)
        self.token = account["token"]
        self.restaurant = ((account.get("restaurant") or {}).get("slug")) or ""

    def backend_block(self) -> dict:
        """The config's backend block, pointed at THIS account.

        The config's ``restaurant`` is one global value shared by every branch,
        so it is replaced with the logged-in account's own branch — that is
        what routes this PC's orders to its branch — and ``baseUrl`` with the
        server we logged in to. Mirrors what the app does on start.
        """
        block = dict(self.config.get("backend") or {})
        block["baseUrl"] = self.base_url
        if self.restaurant:
            block["restaurant"] = self.restaurant
        return block

    def platforms(self) -> List[dict]:
        return [p for p in (self.config.get("platforms") or []) if isinstance(p, dict)]

    def forced_app(self, serial: str) -> Optional[str]:
        return self.app or self.apps.get(serial) or None

    def refresh_config(self) -> bool:
        """Fetch the config; returns True if it differs from the one we had."""
        assert self.token is not None
        try:
            config = fetch_config(self.base_url, self.token)
        except RuntimeError as exc:
            if "HTTP 401" not in str(exc):
                raise
            # The token was revoked (password changed / logged out elsewhere).
            self.login()
            config = fetch_config(self.base_url, self.token)
        fingerprint = json.dumps(config, sort_keys=True, ensure_ascii=False)
        changed = fingerprint != self._config_fingerprint
        self.config = config
        self._config_fingerprint = fingerprint
        return changed

    # -- devices ------------------------------------------------------------
    def _warn_once(self, key: str, message: str) -> None:
        if key not in self._warned:
            self._warned.add(key)
            _say("engine", message)

    def scan_devices(self) -> None:
        """Start a worker for each new usable device; drop unplugged ones."""
        try:
            seen = list_devices()
        except RuntimeError as exc:
            self._warn_once("adb", "{} — is adb installed? See adb/README.md".format(exc))
            return
        self._warned.discard("adb")

        usable = set()
        for serial, state in seen:
            if self.serial and serial != self.serial:
                continue
            if state == "device":
                usable.add(serial)
                self._warned.discard("state:" + serial)
            elif state == "unauthorized":
                self._warn_once(
                    "state:" + serial,
                    "device {} is waiting: unlock it and tap Allow on the "
                    "'Allow USB debugging?' dialog (tick 'Always allow')".format(serial),
                )
            else:
                self._warn_once("state:" + serial, "device {} is {}".format(serial, state))

        for serial in usable - set(self.workers):
            worker = DeviceWorker(self, serial)
            self.workers[serial] = worker
            worker.start()
        for serial in set(self.workers) - usable:
            self.workers.pop(serial).stop()
            _say("engine", "device {} disconnected".format(serial))
        if not self.workers:
            self._warn_once("none", "no device connected — plug one in with USB debugging on")
        else:
            self._warned.discard("none")

    def _problem(self, message: str) -> None:
        """A PC-level failure: print it, and report it through any device."""
        _say("engine", message)
        for worker in self.workers.values():
            worker.device_log.report("", message, kind="app", capture_screen=False)
            break

    def _poll_menu_jobs(self) -> None:
        """Fetch queued menu on/off jobs and hand each to the device(s) that
        run that app. Only platforms a connected device can serve are asked
        for, because fetching a job consumes it."""
        by_slug: Dict[str, List[DeviceWorker]] = {}
        for worker in self.workers.values():
            for slug in worker.menu_slugs():
                by_slug.setdefault(slug, []).append(worker)
        if not by_slug or self.token is None:
            return
        for job in poll_pending(self.base_url, self.token, platforms=sorted(by_slug)):
            for worker in by_slug.get(job.get("platform") or "", []):
                worker.menu_jobs.put(job)

    # -- lifecycle ----------------------------------------------------------
    def run(self) -> None:
        """Log in, then supervise devices until Ctrl-C."""
        _say("engine", "logging in to {} as {} ...".format(self.base_url, self.email))
        self.login()
        self.refresh_config()
        _say("engine", "logged in — branch '{}' — {} task(s) in the server config".format(
            self.restaurant or "?", len(self.platforms())))
        _say("engine", "running; press Ctrl-C to stop")

        next_scan = next_config = next_poll = 0.0
        try:
            while not self._stop.is_set():
                now = time.monotonic()
                if now >= next_scan:
                    next_scan = now + _DEVICE_SCAN_INTERVAL
                    self.scan_devices()
                if now >= next_config:
                    next_config = now + _CONFIG_REFRESH_INTERVAL
                    try:
                        if self.refresh_config():
                            _say("engine", "server config changed — applying")
                            for worker in self.workers.values():
                                worker.config_changed()
                    except Exception as exc:  # noqa: BLE001 - keep running on the last config
                        self._problem("config refresh failed: {}".format(exc))
                if now >= next_poll:
                    next_poll = now + self.poll_interval
                    try:
                        self._poll_menu_jobs()
                    except Exception as exc:  # noqa: BLE001 - never let polling kill the loop
                        self._problem("menu poll failed: {}".format(exc))
                self._stop.wait(0.5)
        except KeyboardInterrupt:
            _say("engine", "Ctrl-C received; shutting down ...")
        finally:
            self.stop()

    def stop(self) -> None:
        self._stop.set()
        for worker in self.workers.values():
            worker.stop()
        _say("engine", "stopped")


# ---------------------------------------------------------------------- #
# Helper commands (for writing and checking a new app's config)
# ---------------------------------------------------------------------- #
def _pick_device(serial: Optional[str]) -> AdbDevice:
    usable = [s for s, state in list_devices() if state == "device"]
    if serial:
        if serial not in usable:
            raise SystemExit("device {} is not connected (see: python -m adb devices)".format(serial))
        return AdbDevice(serial=serial)
    if not usable:
        raise SystemExit("no device connected (see: python -m adb devices)")
    if len(usable) > 1:
        raise SystemExit("several devices connected — pass --serial one of: {}".format(", ".join(usable)))
    return AdbDevice(serial=usable[0])


def cmd_devices(runner: Optional[Runner]) -> int:
    """List connected devices and, when logged in, the config apps on each."""
    devices = list_devices()
    if not devices:
        print("no device connected")
        return 1
    packages = []
    if runner is not None:
        for p in runner.platforms():
            pkg = _selector_package(p)
            if pkg and pkg not in packages:
                packages.append(pkg)
    for serial, state in devices:
        line = "{}  {}".format(serial, state)
        if state == "device":
            dev = AdbDevice(serial=serial)
            try:
                line += "  {}".format(dev.shell("getprop", "ro.product.model"))
                if packages:
                    installed = dev.installed_packages()
                    found = [p for p in packages if p in installed]
                    line += "  apps in config: {}".format(", ".join(found) or "(none installed)")
            except Exception as exc:  # noqa: BLE001
                line += "  (cannot query: {})".format(exc)
        print(line)
    return 0


def cmd_dump(serial: Optional[str], out: Optional[str]) -> int:
    """Print what is on the device's screen right now: the foreground package
    and every node's text / content-desc / view id — exactly the values a
    config selector can match. Open the screen you want on the device first."""
    device = _pick_device(serial)
    nodes = Hierarchy.parse(device.dump_hierarchy())
    package = device.current_package() or ""
    lines = ["package: {}".format(package)]
    count = 0
    for el in nodes._elements:  # noqa: SLF001 - diagnostic dump of every node
        n = nodes._node_of[el]
        if not (n.text.strip() or n.content_desc.strip() or n.resource_id):
            continue
        count += 1
        parts = []
        if n.text.strip():
            parts.append('text="{}"'.format(n.text.strip()))
        if n.content_desc.strip():
            parts.append('contentDesc="{}"'.format(n.content_desc.strip()))
        if n.resource_id:
            parts.append('viewId="{}"'.format(n.resource_id.split("/")[-1]))
        if n.clickable:
            parts.append("clickable")
        if n.package and n.package != package:
            parts.append("package={}".format(n.package))
        parts.append("bounds={}".format(list(n.bounds)))
        lines.append("  ".join(parts))
    lines.append("({} nodes)".format(count))
    text = "\n".join(lines)
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("screen written to {}".format(out))
    else:
        _say("dump", "\n" + text)
    return 0


def cmd_test(runner: Runner, platform: str, serial: Optional[str], items_json: Optional[str]) -> int:
    """Run ONE task's flow once on a device and show every step — for checking
    a config while writing it. A menu task gets ``--items`` as its pushItems."""
    task = next((p for p in runner.platforms() if p.get("platform") == platform), None)
    if task is None:
        names = ", ".join(p.get("platform", "?") for p in runner.platforms())
        raise SystemExit("no task '{}' in the server config. Tasks: {}".format(platform, names))
    device = _pick_device(serial)
    vars_: dict = {}
    if items_json:
        try:
            vars_["pushItems"] = json.loads(items_json)
        except ValueError as exc:
            raise SystemExit("--items is not valid JSON: {}".format(exc))
    interp = FlowInterpreter(
        device, runner.backend_block(),
        on_log=lambda lv, msg, d=0: _say(lv, "  " * max(0, int(d)) + str(msg)),
    )
    print("NOTE: this really runs the flow — an order it reads is sent to the server.")
    try:
        interp.run_once(task, vars=vars_)
    except StepFailure:
        return 1  # run_once already printed which step failed
    except KeyboardInterrupt:
        return 130
    return 0


# ---------------------------------------------------------------------- #
# CLI
# ---------------------------------------------------------------------- #
def _resolve_account(args, settings: dict, interactive: bool) -> dict:
    """Command line > saved settings > a prompt (first run). Saves what it asks."""
    base_url = args.base_url or settings.get("base_url") or ""
    email = args.email or settings.get("email") or ""
    password = args.password or settings.get("password") or ""
    asked = False
    if interactive and sys.stdin.isatty():
        if not base_url:
            base_url = input("Server [{}]: ".format(DEFAULT_BASE_URL)).strip() or DEFAULT_BASE_URL
            asked = True
        if not email:
            email = input("Branch account (email or username): ").strip()
            asked = True
        if not password:
            password = getpass.getpass("Password: ")
            asked = True
    base_url = base_url or DEFAULT_BASE_URL
    if not email or not password:
        raise SystemExit("no login saved — run:  python -m adb setup")
    account = {"base_url": base_url, "email": email, "password": password}
    if asked:
        save_settings({**settings, **account})
        print("saved to {}".format(SETTINGS_PATH))
    return account


def cmd_setup(args, settings: dict) -> int:
    """Ask for the server + branch login, check them, and save them."""
    settings = dict(settings)
    for key in ("base_url", "email", "password"):
        settings.pop(key, None)
    account = _resolve_account(args, settings, interactive=True)
    runner = Runner(account["base_url"], account["email"], account["password"])
    runner.login()
    runner.refresh_config()
    print("login ok — branch '{}'".format(runner.restaurant or "?"))

    # Optional: pin a device to an app when several configured apps are on it.
    apps = dict(settings.get("apps") or {})
    packages: List[str] = []
    for p in runner.platforms():
        pkg = _selector_package(p)
        if pkg and pkg not in packages:
            packages.append(pkg)
    try:
        devices = [s for s, state in list_devices() if state == "device"]
    except RuntimeError as exc:
        print("({})".format(exc))
        devices = []
    for serial in devices:
        installed = AdbDevice(serial=serial).installed_packages()
        found = [p for p in packages if p in installed]
        if len(found) > 1 and sys.stdin.isatty():
            print("device {} has several configured apps:".format(serial))
            for i, pkg in enumerate(found, start=1):
                print("  {}. {}".format(i, pkg))
            choice = input("which one does it run? [1]: ").strip() or "1"
            try:
                apps[serial] = found[int(choice) - 1]
            except (ValueError, IndexError):
                apps[serial] = found[0]
    save_settings({**settings, **account, "apps": apps})
    print("saved to {}".format(SETTINGS_PATH))
    print("now start it with:  python -m adb")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="python -m adb",
        description=(
            "Host-side ADB automation runner: drives Android devices plugged into "
            "this PC, using the same server config the mobile app uses."
        ),
    )
    parser.add_argument(
        "command", nargs="?", default="run",
        choices=["run", "setup", "devices", "dump", "test"],
        help="run (default) | setup: save the login | devices: list devices | "
             "dump: print the device's screen | test <task>: run one task once",
    )
    parser.add_argument("task", nargs="?", help="task name for 'test', e.g. lezzo or lezzo_menu")
    parser.add_argument("--serial", default=None, help="only this device (default: every device)")
    parser.add_argument("--base-url", default=None, help="backend URL (default: saved, else {})".format(DEFAULT_BASE_URL))
    parser.add_argument("--email", default=None, help="branch account (default: saved)")
    parser.add_argument("--password", default=None, help="its password (default: saved)")
    parser.add_argument("--app", default=None, help="force this targetPackage instead of auto-detecting")
    parser.add_argument("--poll-interval", type=float, default=5.0, help="seconds between menu on/off polls")
    parser.add_argument("--out", default=None, help="'dump': write to this file instead of the screen")
    parser.add_argument("--items", default=None, help="'test' of a menu task: JSON list of {name, available}")
    args = parser.parse_args(argv)
    settings = load_settings()

    if args.command == "dump":
        return cmd_dump(args.serial, args.out)
    if args.command == "setup":
        return cmd_setup(args, settings)

    if args.command == "devices":
        runner: Optional[Runner] = None
        try:
            account = _resolve_account(args, settings, interactive=False)
            runner = Runner(account["base_url"], account["email"], account["password"])
            runner.login()
            runner.refresh_config()
        except (SystemExit, RuntimeError):
            runner = None  # no login yet — still list the devices
        return cmd_devices(runner)

    account = _resolve_account(args, settings, interactive=True)
    runner = Runner(
        base_url=account["base_url"],
        email=account["email"],
        password=account["password"],
        serial=args.serial,
        app=args.app,
        apps=settings.get("apps") or {},
        poll_interval=args.poll_interval,
    )
    if args.command == "test":
        if not args.task:
            raise SystemExit("usage: python -m adb test <task>   e.g.  python -m adb test lezzo")
        runner.login()
        runner.refresh_config()
        return cmd_test(runner, args.task, args.serial, args.items)

    try:
        runner.run()
    except RuntimeError as exc:
        _say("engine", "cannot start: {}".format(exc))
        return 1
    return 0
