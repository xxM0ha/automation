# `adb` — host-side automation runner for locked Android POS terminals

This package drives a **locked Android POS terminal over ADB** from a host
machine (a Raspberry Pi or a small mini-PC sitting next to the terminal). It is
the ADB-port equivalent of the mobile app's automation engine: it reuses the
**same server-driven config** the app loads and runs the same step-script flows,
but executes them through `adb shell` instead of the on-device native engine.

## Why ADB from a host?

The POS terminals are **locked down** — they do not allow installing apps. We
therefore cannot deploy the mobile app (or any helper such as ADBKeyBoard) onto
the terminal itself. The only thing we *can* do is connect a host machine over
USB and issue `adb shell` commands: `uiautomator dump` to read the screen, and
`input` / `am` / `monkey` to tap, type, and launch apps. This package is the
orchestrator that turns the server config into those ADB actions.

It mirrors the app in two ways:

* **`EngineController` equivalent** — it starts the continuous order-watching
  tasks for this terminal's app (those whose `control` is `"running"`).
* **FCM menu queue equivalent** — it polls the backend for queued menu-sync
  jobs and runs the matching `<platform>_menu` flow one-shot, injecting the
  pushed items as the `pushItems` flow variable (exactly as the app's FCM
  handler does).

## How it reuses the server config

On startup the runner logs in to the backend and calls `fetch_config`, getting
the **identical** `AutomationConfig` the mobile app consumes:

```jsonc
{
  "backend":   { "baseUrl": "https://api.3alijny.com", "restaurant": "laffe" },
  "platforms": [
    {
      "platform": "toters", "label": "Toters",
      "targetPackage": "com.toters.merchant",
      "control": "running",          // continuous task → autostarts
      "runMode": "loop",
      "selectors": { ... }, "flow": [ ... ], "vars": { ... }
    },
    {
      "platform": "lezzo_menu",      // name ends in _menu → menu-sync task
      "targetPackage": "com.fastwares.lezzoo.eats.merchant",
      "runMode": "once",
      "flow": [ ... ]
    }
  ]
}
```

Because it's the same config, **changing the panel updates both the app and this
runner** — no code change needed. The runner re-fetches the config every few
minutes so edits propagate while it's running.

* A platform whose name **ends in `_menu`** is a push/poll-driven menu-sync task
  (`runMode: "once"`).
* Every other platform is a **continuous order task** that autostarts when its
  `control` is `"running"`.

The runner only handles platforms whose `targetPackage` matches the `--app` you
pass, so each terminal runs just its own app's tasks.

## Raspberry Pi / host setup

1. Install ADB (no Python packages are needed — standard library only):

   ```sh
   sudo apt install android-tools-adb
   ```

2. On the Android terminal, enable **Developer options → USB debugging**.

3. Plug the terminal into the Pi over USB. The first connection pops an
   **"Allow USB debugging?"** dialog on the terminal — tap **Allow** (check
   "always allow from this computer"). The terminal must be unlocked to show it.

4. Confirm the device is visible and authorized:

   ```sh
   adb devices
   # List of devices attached
   # ABCD1234        device          <- "device" = good; "unauthorized" = re-authorize
   ```

   Note the serial (`ABCD1234`) if more than one device is attached.

## Running

```sh
python -m adb \
  --serial ABCD1234 \
  --email you@example.com \
  --password 'your-password' \
  --app com.fastwares.lezzoo.eats.merchant
```

Arguments:

| Flag              | Default                     | Meaning                                                        |
| ----------------- | --------------------------- | -------------------------------------------------------------- |
| `--serial`        | (single device)             | adb serial (`adb -s <serial>`); omit if only one device        |
| `--base-url`      | `https://api.3alijny.com`   | backend base URL                                               |
| `--email`         | *(required)*                | backend account email                                          |
| `--password`      | *(required)*                | backend account password                                       |
| `--app`           | *(required)*                | the `targetPackage` this terminal runs                         |
| `--poll-interval` | `5`                         | seconds between menu-sync poll attempts                        |

Stop it with **Ctrl-C**; it signals its worker threads and exits cleanly.

### One device, one flow at a time

A single device is effectively **serial** — two `adb shell` actions at once
would interleave taps on one screen. So:

* **One** continuous task → its own worker thread running `run_loop`.
* **More than one** continuous task → a single thread that **round-robins** one
  `run_once` per platform, so only one flow ever touches the device.

The menu poller shares a device lock with the order worker, so a menu sync and
an order flow never run against the device simultaneously.

## Menu-sync polling — backend TODO

The menu-sync loop calls `poll_pending`, which expects a
**`GET /api/pending-syncs/`** endpoint (or equivalent). **This endpoint does not
exist on the backend yet.** Until it ships, `poll_pending` returns `[]` and the
menu loop is a harmless no-op.

When the endpoint lands it should return, for the authenticated restaurant, a
list of jobs shaped like:

```json
[
  { "platform": "lezzo", "items": [ { "name": "...", "available": false } ] }
]
```

The runner maps `platform` → its `<platform>_menu` flow and runs it once with
`vars = {"pushItems": items}`. This replaces the FCM push the mobile app uses.

## Known limitation — Arabic / non-ASCII text input

Android's `input text` command **cannot type non-ASCII characters** (Arabic,
emoji, accented Latin) — it silently drops or mangles them. `AdbDevice` makes a
best-effort clipboard attempt (`cmd clipboard set-text` + `KEYCODE_PASTE`), but
that is unreliable: `cmd clipboard` is missing or restricted on many OEM builds,
and pasting needs a focused, paste-capable field.

The practical consequence: **searching a menu item by its Arabic name will often
fail.** Robust non-ASCII entry needs an on-device IME (e.g. ADBKeyBoard) — which
we cannot install on the locked terminal. Where possible, design flows to match
items without typing Arabic (scroll/visual match, ASCII codes/SKUs, etc.).
