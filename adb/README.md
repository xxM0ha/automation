# `adb` — run delivery apps from a PC, for devices the Ordo app can't control

Some delivery apps can't be driven by the Ordo Android app (locked POS
terminals that refuse app installs, apps that block accessibility services).
This package drives those devices **from a PC over USB** instead. It is the same
engine as the app — same server config, same flow steps — but every action goes
through `adb shell` rather than an on-device service.

One PC drives **every device plugged into it**. Nothing is configured on the PC
except the branch login:

* The automation config lives **on the server** (dashboard → الأتمتة). The
  script fetches it at start and again every 20 seconds, so editing a config in
  the dashboard takes effect on the running PC without touching it.
* For each plugged-in device the script checks which delivery app from the
  config is **installed on it** and runs that app's tasks. Plug a device in and
  it starts; unplug it and it stops. No restart.

## Set up a branch PC (Windows)

1. **Python** — install Python 3.9+ from <https://www.python.org/downloads/> and
   tick **"Add python.exe to PATH"**. No other packages are needed.
2. **adb** — download "SDK Platform-Tools for Windows" from
   <https://developer.android.com/tools/releases/platform-tools>, unzip it, and
   put the `platform-tools` folder **inside this `adb` folder**
   (`adb\platform-tools\adb.exe`). The script finds it there; nothing to add to
   PATH.
3. **Copy this `adb` folder** to the PC (any location, e.g. `C:\ordo\adb`).
4. **On each device:** Settings → Developer options → **USB debugging** on. Plug
   it in, unlock it, and tap **Allow** on the "Allow USB debugging?" dialog —
   tick "Always allow from this computer".
5. **Double-click `ordo-adb.bat`.** The first run asks for the server and the
   branch account (email or branch username) and saves them; from then on it
   starts on its own. It restarts itself if it ever exits, so it can be left
   running. To start it with Windows, put a shortcut to `ordo-adb.bat` in the
   Startup folder (`Win+R` → `shell:startup`).

On Linux / Raspberry Pi: `sudo apt install android-tools-adb`, then
`python3 -m adb` from the folder that contains `adb/`.

The login is saved in `%USERPROFILE%\.ordo-adb\settings.json` (plain text, like
the print agent's). Use the **branch's own account** — orders are filed under
the branch of the account that is logged in.

## Commands

Run from the folder that contains `adb/` (`ordo-adb.bat <command>` does the same):

| Command | What it does |
| --- | --- |
| `python -m adb` | Run: drive every plugged-in device. |
| `python -m adb setup` | Enter / change the saved login; choose the app for a device that has several. |
| `python -m adb devices` | List plugged-in devices and which config apps are installed on each. |
| `python -m adb dump` | Print what is on a device's screen right now (for writing selectors). |
| `python -m adb test <task>` | Run one task from the server config once, printing every step. |

Options: `--serial <id>` (one device only), `--app <package>` (force an app
instead of auto-detecting), `--base-url`, `--email`, `--password` (override the
saved login), `--out <file>` (for `dump`), `--items '<json>'` (for `test` of a
menu task).

## Adding a new app

The config for an app is a **task** in the server's automation config — the
same document, and the same step types, the Android app uses. Nothing in this
folder changes.

1. Plug the device in and open the app on the screen you care about.
2. `python -m adb dump` — prints the foreground **package** and every element's
   `text`, `contentDesc` and `viewId`. Those are exactly what a selector can
   match:

   ```
   package: com.example.merchant
   text="طلب جديد"  viewId="order_title"  clickable  bounds=[40, 300, 1040, 420]
   ```

3. In the dashboard (الأتمتة), add the task. An order task needs
   `targetPackage`, `control: "running"`, `runMode: "continuous"`, its
   `selectors` and its `flow`. A menu on/off task is named **`<platform>_menu`**
   (e.g. `lezzo_menu`) with `runMode: "once"`; its flow loops over `pushItems`.
4. `python -m adb test <task>` runs it once and shows each step, so a wrong
   selector is obvious. (It really runs — an order it reads is sent to the
   server.) For a menu task:
   `python -m adb test lezzo_menu --items "[{\"name\": \"Pepsi\", \"available\": false}]"`
5. When it works, leave `control: "running"` — every PC with that app on a
   plugged-in device picks it up within 20 seconds.

`python -m adb devices` shows, per device, which configured apps it found — if a
device shows "(none installed)", the task's `targetPackage` doesn't match the
package printed by `dump`.

## Orders and menu on/off share one screen

A device has one screen, so two flows must never tap it at once:

* An order task holds the screen **only while it is handling an order**. While
  it is just watching for a new order, the screen is free.
* A menu on/off run takes the screen when it is free. If an order is being
  handled, the menu run **waits for it to finish**; an order that arrives during
  a menu run is handled right after.
* Turning several items on/off in the dashboard at once arrives as **one job
  with the whole list** — one run of the menu flow, not one per item.
* After a menu run, the order task starts its flow over (re-opening the app), so
  it goes back to its orders screen.

## Errors

Every failure — a step that didn't find its element, an order that couldn't be
sent, adb losing the device — is printed here **and uploaded to the dashboard**
(المطوّر → أخطاء الأجهزة) with the steps before it and the text that was on
screen. Errors made while offline are kept in `~/.ordo-adb/` and sent later. A
repeating error is sent once, then again after 10 minutes with a repeat count.

## Known limitation — typing Arabic

Android's `input text` cannot type non-ASCII characters. The script tries the
clipboard (`cmd clipboard set-text` + paste), but that is missing or restricted
on many devices. So **searching a menu item by typing its Arabic name often
fails over ADB**. Where possible, write menu flows that find the item without
typing (scroll until it appears, then `tapInRow`).

## Layout

* `device.py` — the `adb shell` driver (and where the adb binary is found).
* `backend.py` — server client (login, config, order webhook, menu job poll).
* `interpreter.py` — runs a task's flow; shares the screen lock.
* `runner.py` — supervises the devices; the commands above.
* `devicelog.py` — the error log uploaded to the dashboard.
