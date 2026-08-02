# Ordo Print Agent (Windows)

Prints incoming Ordo orders to the branch's **LAN thermal printers** for
restaurants with no POS link. Runs on a PC inside the restaurant, on the same
network as the printers. **No config file — everything is a window.**

## Setup (2 steps)
1. Double-click **`OrdoPrintAgent.exe`**.
2. Log in with the **branch account** (email + password). That's it — it starts
   printing and remembers the login next time.

Printers and item routing are configured **in the Ordo dashboard**, not here:
**الطابعات** in the side menu → add each printer (name, IP, role) and route each
item to its station. See below.

## How it works
1. Logs in to Ordo as the branch account (once).
2. Polls the server for new order tickets every few seconds.
3. The server tells it, per order, **which items go to which printer**:
   - **station** printers (kitchen, drinks…) print only the items routed to them,
   - the **cashier** printer prints the whole order.
4. Renders each ticket as an Arabic image and prints over **ESC/POS / TCP 9100**.
5. Acks so each order prints exactly once.

Only branches with **printing enabled** queue print jobs (set per restaurant by
the Ordo team). Those branches are *not* pushed to Foodics.

## Configure printers (in the dashboard → الطابعات)
- **Add a printer:** name, IP (e.g. `192.168.1.50`), port (usually 9100), paper
  width (80mm / 58mm), and **role**:
  - **محطة (station):** prints only items routed to it.
  - **كاشير (cashier):** prints every item of every order.
- **Route items:** for each menu item pick its station printer, or leave it
  «كاشير فقط» to print only on the cashier. Use «عيّن الكل» to route a whole
  category at once.

## Requirements
- A Windows PC that stays on, on the same LAN/Wi-Fi as the printers.
- One or more **network thermal printers** with a static IP (ESC/POS).

## Finding a printer's IP
Print a self-test (hold FEED while powering on) — most thermal printers print
their IP. Or check the router's connected-devices list. Set that IP in the
dashboard.

## Auto-start on boot
Put a shortcut to the exe in `shell:startup` (Win+R → `shell:startup`). It starts
with Windows, auto-logs in with the saved account, and keeps printing.

## Where settings live
`%LOCALAPPDATA%\OrdoPrintAgent\settings.json` (server URL + login). Delete it to
reset. "تسجيل الخروج" in the app clears the saved password.

## Build the .exe (for maintainers)
```bat
cd print-agent
python -m pip install -r requirements.txt pyinstaller
pyinstaller --onefile --windowed --name OrdoPrintAgent --collect-all escpos ordo_print_agent.py
```
Output: `dist\OrdoPrintAgent.exe`.
