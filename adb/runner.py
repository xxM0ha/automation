"""Orchestrator for the host-side ADB automation runner.

This is the ADB-port equivalent of the mobile app's ``EngineController`` plus
its FCM-driven menu-sync queue. Given device credentials and the package this
terminal runs, it:

  1. logs in and fetches the same server-driven AutomationConfig the app uses;
  2. binds to the connected Android device over ADB;
  3. starts the continuous order-watching tasks for this terminal's app; and
  4. polls the backend for queued menu-sync jobs and runs them one-shot.

Everything is driven by the server config, so panel changes propagate without
code changes — that's why the config is re-fetched periodically.

ADB CONCURRENCY NOTE
====================
A single device is effectively serial: two threads issuing ``adb shell`` at the
same time would interleave taps/dumps on one screen and corrupt each other.
We therefore do NOT run multiple continuous tasks in parallel threads. Instead:

  * exactly one continuous task  -> its own worker thread running ``run_loop``;
  * more than one continuous task -> a single worker thread that round-robins
    one ``run_once`` per platform, so only one flow ever touches the device at
    a time.

The menu poller also touches the device, so it shares one lock with the order
worker — only one flow runs against the device at any instant.
"""

from __future__ import annotations

import argparse
import threading
import time
from datetime import datetime
from typing import Callable, Dict, List, Optional

from .backend import fetch_config, login, poll_pending
from .device import AdbDevice
from .interpreter import FlowInterpreter, StepFailure

# How often (seconds) to re-fetch the config so panel changes propagate.
_CONFIG_REFRESH_INTERVAL = 300

# Suffix that marks a platform as a push/poll-driven menu-sync task.
_MENU_SUFFIX = "_menu"


def _now() -> str:
    """Return a short local timestamp like ``12:34:56`` for log lines."""
    return datetime.now().strftime("%H:%M:%S")


class Runner:
    """Drives one ADB-connected terminal from the server config.

    :param serial: adb serial (``adb -s <serial>``); ``None`` for the only device.
    :param base_url: backend base URL, e.g. ``https://api.3alijny.com``.
    :param email: backend account email.
    :param password: backend account password.
    :param app: the ``targetPackage`` this terminal runs, e.g.
        ``com.fastwares.lezzoo.eats.merchant``. Only platforms whose
        ``targetPackage`` equals this are handled here.
    :param poll_interval: seconds between menu-sync poll attempts.
    """

    def __init__(
        self,
        serial: Optional[str],
        base_url: str,
        email: str,
        password: str,
        app: str,
        poll_interval: float = 5.0,
    ) -> None:
        self.serial = serial
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.app = app
        self.poll_interval = poll_interval

        self.token: Optional[str] = None
        self.config: Dict = {}
        self.device: Optional[AdbDevice] = None
        self.interp: Optional[FlowInterpreter] = None

        # Signals all loops to wind down (Ctrl-C / shutdown).
        self._stop = threading.Event()
        # One device == one flow at a time; the order worker and menu poller
        # both acquire this before touching the device.
        self._device_lock = threading.Lock()
        self._threads: List[threading.Thread] = []
        # When the config was last fetched (monotonic), for periodic refresh.
        self._last_config_fetch = 0.0

    # ------------------------------------------------------------------ #
    # Logging
    # ------------------------------------------------------------------ #
    def on_log(self, level: str, message: str, depth: int = 0) -> None:
        """Print a timestamped, depth-indented engine log line.

        Matches the app's ``[engine:<platform>] ...`` console style. ``depth``
        nests sub-steps under their parent. The interpreter calls this for every
        step it runs.
        """
        indent = "  " * max(0, int(depth))
        print("[{}] [{}] {}{}".format(_now(), level, indent, message), flush=True)

    def _engine_log(self, message: str) -> None:
        """Top-level runner log (depth 0, no level noise)."""
        print("[{}] [engine] {}".format(_now(), message), flush=True)

    # ------------------------------------------------------------------ #
    # Startup
    # ------------------------------------------------------------------ #
    def start(self) -> None:
        """Log in, fetch config, build the device + interpreter."""
        self._engine_log(
            "logging in to {} as {} ...".format(self.base_url, self.email)
        )
        self.token = login(self.base_url, self.email, self.password)
        self._engine_log("login ok; fetching config ...")
        self._refresh_config(force=True)

        self.device = AdbDevice(serial=self.serial)
        # The shared backend block (baseUrl/restaurant) lets the interpreter
        # resolve request steps (e.g. the order webhook), mirroring how the app
        # merges config.backend into each task.
        backend_block = self.config.get("backend", {})
        self.interp = FlowInterpreter(self.device, backend_block, self.on_log)
        self._engine_log(
            "device bound (serial={}); driving app {}".format(
                self.serial or "<default>", self.app
            )
        )

    def _refresh_config(self, force: bool = False) -> None:
        """(Re)fetch the config if it's stale, so panel changes propagate."""
        now = time.monotonic()
        if not force and (now - self._last_config_fetch) < _CONFIG_REFRESH_INTERVAL:
            return
        assert self.token is not None
        self.config = fetch_config(self.base_url, self.token)
        self._last_config_fetch = now
        # Keep the interpreter's backend block in sync after a refresh.
        if self.interp is not None:
            self.interp.backend = self.config.get("backend", {})

    # ------------------------------------------------------------------ #
    # Platform selection
    # ------------------------------------------------------------------ #
    def _my_platforms(self) -> List[dict]:
        """All config platforms whose ``targetPackage`` is this terminal's app."""
        return [
            p
            for p in self.config.get("platforms", [])
            if p.get("targetPackage") == self.app
        ]

    def _order_tasks(self) -> List[dict]:
        """Continuous order tasks for this app (not ``_menu``, control running)."""
        tasks = []
        for p in self._my_platforms():
            name = p.get("platform", "")
            if name.endswith(_MENU_SUFFIX):
                continue
            if p.get("control") == "running":
                tasks.append(p)
        return tasks

    def _menu_platform_slugs(self) -> List[str]:
        """Bare platform slugs this terminal has a ``_menu`` flow for (e.g.
        ``["lezzo"]`` for a ``*_menu`` task named ``"lezzo_menu"``). Passed to the
        backend so this terminal only consumes its own pending-sync jobs."""
        slugs = []
        for p in self._my_platforms():
            name = p.get("platform", "")
            if name.endswith(_MENU_SUFFIX):
                slugs.append(name[: -len(_MENU_SUFFIX)])
        return slugs

    def _menu_task_for(self, platform: str) -> Optional[dict]:
        """Find the ``<platform>_menu`` task for this app, or ``None``.

        A pending-sync job names a bare platform (e.g. ``"lezzo"``); the menu
        flow that fulfils it is configured as ``"lezzo_menu"``.
        """
        wanted = platform + _MENU_SUFFIX
        for p in self._my_platforms():
            if p.get("platform") == wanted:
                return p
        return None

    # ------------------------------------------------------------------ #
    # Continuous order tasks
    # ------------------------------------------------------------------ #
    def _start_order_worker(self) -> None:
        """Spin up the single worker thread for this terminal's order tasks."""
        tasks = self._order_tasks()
        if not tasks:
            self._engine_log("no continuous order tasks for this app")
            return

        if len(tasks) == 1:
            # Simple case: one continuous task gets its own run_loop thread.
            task = tasks[0]
            self._engine_log(
                "starting continuous task '{}' (run_loop)".format(
                    task.get("platform")
                )
            )
            t = threading.Thread(
                target=self._run_single_loop,
                args=(task,),
                name="order-{}".format(task.get("platform")),
                daemon=True,
            )
        else:
            # Multiple continuous tasks share one device, so we cannot run them
            # in parallel without corrupting the screen. Round-robin one
            # run_once per task in a single thread instead.
            names = ", ".join(t.get("platform", "?") for t in tasks)
            self._engine_log(
                "starting {} continuous tasks round-robin ({})".format(
                    len(tasks), names
                )
            )
            t = threading.Thread(
                target=self._run_round_robin,
                args=(tasks,),
                name="order-roundrobin",
                daemon=True,
            )
        t.start()
        self._threads.append(t)

    def _run_single_loop(self, task: dict) -> None:
        """Run one continuous task's ``run_loop`` under the device lock."""
        assert self.interp is not None
        platform = task.get("platform", "?")
        # Hold the device for the lifetime of the loop: with a single continuous
        # task there's nothing else competing except the menu poller, which will
        # simply wait its turn. run_loop is expected to block until stopped.
        with self._device_lock:
            try:
                self.interp.run_loop(task)
            except StepFailure as exc:
                self.on_log("error", "task '{}' failed: {}".format(platform, exc))
            except Exception as exc:  # noqa: BLE001 - keep the runner alive
                self.on_log(
                    "error", "task '{}' crashed: {}".format(platform, exc)
                )

    def _run_round_robin(self, tasks: List[dict]) -> None:
        """Round-robin ``run_once`` across multiple continuous tasks.

        Each iteration runs exactly one flow against the device while holding
        the lock, then yields so the menu poller (or the next task) can take a
        turn. Repeats until shutdown.
        """
        assert self.interp is not None
        while not self._stop.is_set():
            for task in tasks:
                if self._stop.is_set():
                    return
                platform = task.get("platform", "?")
                with self._device_lock:
                    try:
                        self.interp.run_once(task, vars={})
                    except StepFailure as exc:
                        self.on_log(
                            "error",
                            "task '{}' iteration failed: {}".format(platform, exc),
                        )
                    except Exception as exc:  # noqa: BLE001
                        self.on_log(
                            "error",
                            "task '{}' iteration crashed: {}".format(platform, exc),
                        )
                # Brief yield between tasks so we don't pin the CPU / device.
                self._stop.wait(0.5)

    # ------------------------------------------------------------------ #
    # Menu-sync poll loop
    # ------------------------------------------------------------------ #
    def _run_menu_poller(self) -> None:
        """Poll for menu-sync jobs and run the matching ``_menu`` flow once.

        Mirrors the app's FCM handler, which injects the pushed items as the
        ``pushItems`` flow variable. Each job is ``{"platform", "items"}``; we
        map ``platform`` to its ``<platform>_menu`` task and run it one-shot.

        TODO(backend): this depends on a ``GET /api/pending-syncs/`` endpoint
        (or equivalent) that does not exist yet. Until it ships, ``poll_pending``
        returns ``[]`` and this loop is a harmless no-op. When the endpoint
        lands it should return a list of
        ``{"platform": "lezzo", "items": [...]}`` jobs for this restaurant.
        """
        assert self.interp is not None and self.token is not None
        while not self._stop.is_set():
            # Periodic config refresh keeps menu-task definitions current.
            try:
                self._refresh_config()
            except Exception as exc:  # noqa: BLE001
                self._engine_log("config refresh failed: {}".format(exc))

            try:
                jobs = poll_pending(self.base_url, self.token, platforms=self._menu_platform_slugs())
            except Exception as exc:  # noqa: BLE001 - never let polling kill the loop
                self._engine_log("poll_pending failed: {}".format(exc))
                jobs = []

            for job in jobs:
                if self._stop.is_set():
                    break
                platform = job.get("platform")
                items = job.get("items", [])
                if not platform:
                    continue
                task = self._menu_task_for(platform)
                if task is None:
                    # No menu flow for this platform on this terminal — skip.
                    continue
                self._engine_log(
                    "menu-sync job for '{}' ({} items)".format(platform, len(items))
                )
                # Serialize against the order worker — one flow per device.
                with self._device_lock:
                    try:
                        self.interp.run_once(task, vars={"pushItems": items})
                    except StepFailure as exc:
                        self.on_log(
                            "error",
                            "menu sync '{}' failed: {}".format(platform, exc),
                        )
                    except Exception as exc:  # noqa: BLE001
                        self.on_log(
                            "error",
                            "menu sync '{}' crashed: {}".format(platform, exc),
                        )

            # Sleep until the next poll, but wake immediately on shutdown.
            self._stop.wait(self.poll_interval)

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def run(self) -> None:
        """Start workers and block until Ctrl-C, then shut down cleanly."""
        self.start()
        self._start_order_worker()

        poller = threading.Thread(
            target=self._run_menu_poller, name="menu-poller", daemon=True
        )
        poller.start()
        self._threads.append(poller)

        self._engine_log("runner up; press Ctrl-C to stop")
        try:
            # Idle the main thread; daemon workers do the work.
            while not self._stop.is_set():
                self._stop.wait(1.0)
        except KeyboardInterrupt:
            self._engine_log("Ctrl-C received; shutting down ...")
        finally:
            self.stop()

    def stop(self) -> None:
        """Signal all loops to stop and wait briefly for them to wind down."""
        self._stop.set()
        for t in self._threads:
            if t.is_alive():
                t.join(timeout=5.0)
        self._engine_log("stopped")


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point. Parses args, builds a :class:`Runner`, and runs it."""
    parser = argparse.ArgumentParser(
        prog="python -m adb",
        description=(
            "Host-side ADB automation runner: drives a locked Android POS over "
            "ADB using the same server config the mobile app uses."
        ),
    )
    parser.add_argument(
        "--serial",
        default=None,
        help="adb device serial (adb -s <serial>); omit for the single device",
    )
    parser.add_argument(
        "--base-url",
        default="https://api.3alijny.com",
        help="backend base URL (default: %(default)s)",
    )
    parser.add_argument("--email", required=True, help="backend account email")
    parser.add_argument(
        "--password", required=True, help="backend account password"
    )
    parser.add_argument(
        "--app",
        required=True,
        help=(
            "targetPackage this terminal runs, e.g. "
            "com.fastwares.lezzoo.eats.merchant"
        ),
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=5.0,
        help="seconds between menu-sync poll attempts (default: %(default)s)",
    )
    args = parser.parse_args(argv)

    runner = Runner(
        serial=args.serial,
        base_url=args.base_url,
        email=args.email,
        password=args.password,
        app=args.app,
        poll_interval=args.poll_interval,
    )
    runner.run()
    return 0
