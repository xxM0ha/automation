"""Host-side ADB automation runner for locked Android POS terminals.

This package is the ADB-port equivalent of the mobile app's ``EngineController``
plus its FCM-driven menu-sync queue. It runs on a host machine (Raspberry Pi or
a mini-PC) that is physically connected to a locked Android POS terminal — a
device that forbids app installs, so every action is performed through
``adb shell`` primitives rather than an on-device helper app.

It reuses the *same* server-driven automation config the mobile app consumes
(fetched from the Django backend), so panel changes propagate to both the app
and this runner without code changes. A platform whose name ends in ``_menu`` is
a push/poll-driven menu-sync task (``runMode == "once"``); every other platform
is a continuous order-watching task that autostarts when its ``control`` is
``"running"``.

Layout:

* :mod:`adb.device`      — :class:`AdbDevice`, the ``adb shell`` driver.
* :mod:`adb.backend`     — backend client (login / fetch_config / send / poll).
* :mod:`adb.interpreter` — :class:`FlowInterpreter`, runs a platform's flow.
* :mod:`adb.runner`      — :class:`Runner`, the orchestrator wired up here.
* :mod:`adb.devicelog`   — the device error log uploaded to the dashboard.

One PC drives every device plugged into it: each device runs the tasks of the
delivery app installed on it, and the login is saved after the first run. Run
it as a module (see README.md for setup and the helper commands)::

    python -m adb
"""

from __future__ import annotations

from .device import AdbDevice
from .interpreter import FlowInterpreter
from .runner import Runner, main

__all__ = ["Runner", "AdbDevice", "FlowInterpreter", "main"]
