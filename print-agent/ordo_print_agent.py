"""
Ordo local print agent — desktop GUI.

Runs on a Windows PC inside the restaurant (same LAN as the thermal printers).
The user logs in once with the branch account; everything else (which printers
exist, their IPs, and which items go where) is configured in the Ordo dashboard
and fetched from the server. The agent polls for order tickets and prints each
to the right printer over ESC/POS, then acks so each order prints once.

The server pre-computes, per order, a list of `groups` — one per printer that
should print: station printers get only the items routed to them, the cashier
printer gets the whole order. The agent just prints each group to its IP.

Why render an image? Most cheap thermal printers can't print Arabic from raw
text (wrong codepage / no RTL). Rendering with a real Arabic font prints on any
ESC/POS printer.

No config file. Settings (server, login, token) live in
%LOCALAPPDATA%\\OrdoPrintAgent\\settings.json.
"""
import json
import os
import queue
import threading
import tkinter as tk
from tkinter import ttk, scrolledtext
from datetime import datetime

import requests
import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont
from escpos.printer import Network

DEFAULT_BASE = 'https://ordoiraq.com'
POLL_SECONDS = 4
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\tahoma.ttf',
    r'C:\Windows\Fonts\arial.ttf',
    r'C:\Windows\Fonts\segoeui.ttf',
]

APPDIR = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'OrdoPrintAgent')
SETTINGS_PATH = os.path.join(APPDIR, 'settings.json')


# ── settings ────────────────────────────────────────────────────────────────
def load_settings():
    try:
        with open(SETTINGS_PATH, encoding='utf-8-sig') as fh:
            return json.load(fh)
    except Exception:
        return {}


def save_settings(d):
    os.makedirs(APPDIR, exist_ok=True)
    with open(SETTINGS_PATH, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)


def font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return FONT_CANDIDATES[0]


# ── rendering ─────────────────────────────────────────────────────────────────
def shape(text):
    try:
        return get_display(arabic_reshaper.reshape(str(text)))
    except Exception:
        return str(text)


def _hhmm(iso):
    try:
        return datetime.fromisoformat(str(iso).replace('Z', '+00:00')).strftime('%H:%M')
    except Exception:
        return ''


def render_ticket(order, items, printer, is_cashier, fp, fs=30):
    """Build a PIL image for one printer's portion of an order (RTL)."""
    width = int(printer.get('paperWidth') or 576)
    margin = 12
    f_reg = ImageFont.truetype(fp, fs)
    f_big = ImageFont.truetype(fp, int(fs * 1.5))
    f_sm = ImageFont.truetype(fp, int(fs * 0.8))

    lines = []
    # printer/station name so staff know where it came from
    lines.append((shape(printer.get('name', '')), f_big))
    lines.append((shape(order.get('platform', '')), f_reg))
    lines.append((shape(f"طلب #{order.get('externalId', '')}"), f_reg))
    t = _hhmm(order.get('createdAt', ''))
    if t:
        lines.append((shape(t), f_sm))
    if order.get('customerName'):
        lines.append((shape(order['customerName']), f_reg))
    lines.append(('-' * 32, f_sm))
    for it in items:
        lines.append((shape(f"{it.get('qty', 1)} × {it.get('name', '')}"), f_reg))
        if it.get('notes'):
            lines.append((shape(f"  • {it['notes']}"), f_sm))
    lines.append(('-' * 32, f_sm))
    if is_cashier:
        lines.append((shape(f"المجموع: {order.get('total', '')}"), f_big))
        if order.get('notes'):
            lines.append((shape(order['notes']), f_sm))

    dummy = ImageDraw.Draw(Image.new('L', (10, 10), 255))
    gap = 8
    heights = [dummy.textbbox((0, 0), t, font=f)[3] - dummy.textbbox((0, 0), t, font=f)[1]
               for t, f in lines]
    total_h = sum(heights) + gap * len(lines) + margin * 2

    img = Image.new('L', (width, total_h), 255)
    draw = ImageDraw.Draw(img)
    y = margin
    for (text, font), h in zip(lines, heights):
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        x = width - tw - margin  # right-align (RTL)
        draw.text((x, y - bbox[1]), text, font=font, fill=0)
        y += h + gap
    return img


def print_image(printer, img):
    host = str(printer.get('ip', '')).strip()
    port = int(printer.get('port') or 9100)
    p = Network(host, port=port, timeout=10)
    p.image(img)
    p.cut()
    p.close()


# ── worker thread ─────────────────────────────────────────────────────────────
class Worker(threading.Thread):
    def __init__(self, base_url, email, password, log, on_auth_fail):
        super().__init__(daemon=True)
        self.base_url = base_url.rstrip('/')
        self.email = email
        self.password = password
        self.token = None
        self.log = log               # callable(str)
        self.on_auth_fail = on_auth_fail
        self._stop = threading.Event()
        self.fp = font_path()

    def stop(self):
        self._stop.set()

    def login(self):
        r = requests.post(f'{self.base_url}/api/auth/login/',
                          json={'email': self.email, 'password': self.password}, timeout=15)
        r.raise_for_status()
        self.token = r.json()['token']
        return self.token

    def _headers(self):
        return {'Authorization': f'Token {self.token}'}

    def fetch_jobs(self):
        r = requests.get(f'{self.base_url}/api/print-jobs/', headers=self._headers(), timeout=15)
        if r.status_code == 401:
            self.login()
            r = requests.get(f'{self.base_url}/api/print-jobs/', headers=self._headers(), timeout=15)
        r.raise_for_status()
        return r.json()

    def ack(self, ids):
        if ids:
            requests.post(f'{self.base_url}/api/print-jobs/ack/',
                          json={'ids': ids}, headers=self._headers(), timeout=15)

    def run(self):
        try:
            self.login()
            self.log(f'متصل: {self.email}')
        except Exception as e:
            self.log(f'فشل تسجيل الدخول: {e}')
            self.on_auth_fail()
            return
        self.log(f'يراقب الطلبات كل {POLL_SECONDS} ثانية…')
        while not self._stop.is_set():
            try:
                jobs = self.fetch_jobs()
                printed = []
                for job in jobs:
                    order = job.get('order', {})
                    groups = job.get('groups', [])
                    ok = True
                    for g in groups:
                        printer = g.get('printer', {})
                        is_cashier = printer.get('role') == 'cashier'
                        try:
                            img = render_ticket(order, g.get('items', []), printer, is_cashier, self.fp)
                            print_image(printer, img)
                            self.log(f"طُبع #{order.get('externalId','')} → {printer.get('name','')}")
                        except Exception as e:
                            ok = False
                            self.log(f"تعذّرت الطباعة على {printer.get('name','')} ({printer.get('ip','')}): {e}")
                    if ok:  # all groups printed (or no groups → nothing to print)
                        printed.append(job['id'])
                self.ack(printed)
            except Exception as e:
                self.log(f'خطأ في الاتصال: {e}')
            self._stop.wait(POLL_SECONDS)
        self.log('تم الإيقاف.')


# ── GUI ───────────────────────────────────────────────────────────────────────
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Ordo Print Agent')
        self.geometry('560x520')
        self.configure(bg='#0a0a0a')
        self.msg_q = queue.Queue()
        self.worker = None
        self.settings = load_settings()

        self._build_login()
        self._build_status()
        self.after(150, self._drain)

        # auto-start if we already have saved credentials
        if self.settings.get('email') and self.settings.get('password'):
            self.e_base.delete(0, tk.END); self.e_base.insert(0, self.settings.get('base_url', DEFAULT_BASE))
            self._start(self.settings['base_url'], self.settings['email'], self.settings['password'])

    # styling helpers
    def _lbl(self, parent, text):
        return tk.Label(parent, text=text, bg='#0a0a0a', fg='#94f519',
                        font=('Segoe UI', 11, 'bold'), anchor='e', justify='right')

    def _entry(self, parent, show=None):
        e = tk.Entry(parent, show=show, font=('Segoe UI', 12), justify='left',
                     bg='#1a1a1a', fg='white', insertbackground='white', relief='flat')
        e.configure(highlightthickness=1, highlightbackground='#333', highlightcolor='#94f519')
        return e

    def _build_login(self):
        self.login_frame = tk.Frame(self, bg='#0a0a0a')
        f = self.login_frame
        tk.Label(f, text='Ordo', bg='#0a0a0a', fg='#94f519',
                 font=('Segoe UI Black', 34, 'bold')).pack(pady=(40, 4))
        tk.Label(f, text='وكيل الطباعة المحلي', bg='#0a0a0a', fg='#888',
                 font=('Segoe UI', 11)).pack(pady=(0, 28))

        box = tk.Frame(f, bg='#0a0a0a'); box.pack()
        self._lbl(box, 'الخادم').grid(row=0, column=1, sticky='e', pady=6, padx=8)
        self.e_base = self._entry(box); self.e_base.grid(row=0, column=0, pady=6)
        self.e_base.insert(0, self.settings.get('base_url', DEFAULT_BASE))
        self._lbl(box, 'البريد').grid(row=1, column=1, sticky='e', pady=6, padx=8)
        self.e_email = self._entry(box); self.e_email.grid(row=1, column=0, pady=6)
        self.e_email.insert(0, self.settings.get('email', ''))
        self._lbl(box, 'كلمة المرور').grid(row=2, column=1, sticky='e', pady=6, padx=8)
        self.e_pw = self._entry(box, show='•'); self.e_pw.grid(row=2, column=0, pady=6)
        for e in (self.e_base, self.e_email, self.e_pw):
            e.configure(width=28)

        self.login_msg = tk.Label(f, text='', bg='#0a0a0a', fg='#ff6b6b', font=('Segoe UI', 10))
        self.login_msg.pack(pady=(14, 6))
        self.btn_login = tk.Button(f, text='تسجيل الدخول وبدء الطباعة', command=self._login_click,
                                   bg='#94f519', fg='#0a0a0a', font=('Segoe UI', 12, 'bold'),
                                   relief='flat', activebackground='#7ed30f', cursor='hand2',
                                   padx=24, pady=10)
        self.btn_login.pack(pady=6)
        self.e_pw.bind('<Return>', lambda _e: self._login_click())

    def _build_status(self):
        self.status_frame = tk.Frame(self, bg='#0a0a0a')
        f = self.status_frame
        top = tk.Frame(f, bg='#0a0a0a'); top.pack(fill='x', padx=20, pady=(20, 8))
        self.dot = tk.Label(top, text='●', bg='#0a0a0a', fg='#94f519', font=('Segoe UI', 16))
        self.dot.pack(side='left')
        self.status_lbl = tk.Label(top, text='يعمل', bg='#0a0a0a', fg='white',
                                   font=('Segoe UI', 14, 'bold'))
        self.status_lbl.pack(side='left', padx=8)
        tk.Button(top, text='تسجيل الخروج', command=self._logout, bg='#1a1a1a', fg='#aaa',
                  relief='flat', cursor='hand2', padx=12, pady=4,
                  activebackground='#333', activeforeground='white').pack(side='right')

        self.log_box = scrolledtext.ScrolledText(f, bg='#111', fg='#ccc', relief='flat',
                                                  font=('Consolas', 10), height=20, wrap='word')
        self.log_box.pack(fill='both', expand=True, padx=20, pady=(8, 20))
        self.log_box.configure(state='disabled')

    def _show(self, frame):
        self.login_frame.pack_forget()
        self.status_frame.pack_forget()
        frame.pack(fill='both', expand=True)

    # actions
    def _login_click(self):
        base = self.e_base.get().strip() or DEFAULT_BASE
        email = self.e_email.get().strip()
        pw = self.e_pw.get()
        if not email or not pw:
            self.login_msg.config(text='أدخل البريد وكلمة المرور')
            return
        self.login_msg.config(text='')
        self._start(base, email, pw)

    def _start(self, base, email, pw):
        self.settings = {'base_url': base, 'email': email, 'password': pw}
        save_settings(self.settings)
        self._show(self.status_frame)
        self.dot.config(fg='#94f519'); self.status_lbl.config(text='يعمل')
        self.worker = Worker(base, email, pw, self._enqueue, self._auth_failed)
        self.worker.start()

    def _enqueue(self, msg):
        self.msg_q.put(msg)

    def _auth_failed(self):
        # called from worker thread → defer to GUI thread
        self.msg_q.put('__AUTH_FAIL__')

    def _drain(self):
        try:
            while True:
                msg = self.msg_q.get_nowait()
                if msg == '__AUTH_FAIL__':
                    self._logout(failed=True)
                    continue
                ts = datetime.now().strftime('%H:%M:%S')
                self.log_box.configure(state='normal')
                self.log_box.insert('end', f'[{ts}] {msg}\n')
                self.log_box.see('end')
                self.log_box.configure(state='disabled')
        except queue.Empty:
            pass
        self.after(200, self._drain)

    def _logout(self, failed=False):
        if self.worker:
            self.worker.stop()
            self.worker = None
        # keep base_url + email, drop password so we don't auto-start again
        s = {'base_url': self.settings.get('base_url', DEFAULT_BASE),
             'email': self.settings.get('email', '')}
        save_settings(s)
        self.settings = s
        self.e_pw.delete(0, tk.END)
        if failed:
            self.login_msg.config(text='فشل تسجيل الدخول — تحقق من البيانات')
        self._show(self.login_frame)


if __name__ == '__main__':
    app = App()
    if not (app.settings.get('email') and app.settings.get('password')):
        app._show(app.login_frame)
    else:
        app._show(app.status_frame)
    app.mainloop()
