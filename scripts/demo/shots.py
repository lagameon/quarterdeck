#!/usr/bin/env python3
"""Regenerate the README screenshots and the demo GIF.

    python3 scripts/demo/shots.py            (needs: bun, playwright for Python + Chrome, Pillow)

Starts a throw-away Quarterdeck on a spare port with an empty config, opens it in a headless browser and answers
EVERY API call and live connection from scripts/demo/fixtures.py — the pictures can never contain a real session.
Output: docs/img/*.png and docs/img/demo.gif.
"""
import json, os, subprocess, sys, tempfile, time, io
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
import fixtures as F

ROOT = Path(__file__).resolve().parents[2]; OUT = ROOT / "docs" / "img"; OUT.mkdir(parents=True, exist_ok=True)
PORT = 7790; BASE = f"http://127.0.0.1:{PORT}"

def start_server():
    conf = Path(tempfile.mkdtemp(prefix="qd-demo-"))
    (conf / "config.json").write_text(json.dumps({"owner": "demo@example.com", "port": PORT, "bindTailscale": False, "nodeId": "desk", "nodeLabel": "Desk"}))
    env = {**os.environ, "QUARTERDECK_CONFIG_DIR": str(conf), "QUARTERDECK_DATA_DIR": str(conf)}
    p = subprocess.Popen(["bun", "server.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            import urllib.request; urllib.request.urlopen(BASE + "/manifest.webmanifest", timeout=1); return p
        except Exception: time.sleep(0.2)
    p.kill(); raise SystemExit("demo server did not start")

API = {"/api/sessions": F.SESSIONS, "/api/fleet": F.FLEET, "/api/stats": F.STATS, "/api/ui": {"lang": "en"}, "/api/plugins": [],
       "/api/changes": F.CHANGES, "/api/projects": F.PROJECTS, "/api/memory": F.MEMORY, "/api/prompt": {"menu": None}, "/api/push/key": {"publicKey": "", "devices": [], "telegram": False}}

def wire(page, state):
    def api(route):
        path = route.request.url.split("?")[0].split(str(PORT))[1]
        for pre in ("/n/laptop", "/n/gpu"):
            if path.startswith(pre): path = path[len(pre):]
        body = API.get(path, {})                                  # anything not listed gets an empty answer, never real data
        if path == "/api/prompt": body = {"menu": F.MENU if state.get("menu") else None}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/**", api)
    def tail(ws):
        ws.send(json.dumps({"t": "events", "evs": F.CHAT if not state.get("short") else F.CHAT[:1], "initial": True, "truncated": False}))
        if state.get("menu"): ws.send(json.dumps({"t": "menu", "menu": F.MENU}))
        state["tail"] = ws
        ws.on_message(lambda m: None)
    page.route_web_socket("**/ws/tail**", tail)
    def pty(ws):
        ws.send(json.dumps({"t": "hello", "cols": 80, "rows": 24})); ws.send(F.TERMINAL.encode())
        ws.on_message(lambda m: None)
    page.route_web_socket("**/ws/pty**", pty)

def page_for(browser, w, h, scale, state):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale, service_workers="block")
    pg = ctx.new_page(); wire(pg, state); return ctx, pg

def main():
    srv = start_server()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chrome")
            # 1. dashboard, desktop
            ctx, pg = page_for(b, 1440, 900, 2, {}); pg.goto(BASE); pg.wait_for_timeout(2500)
            pg.screenshot(path=str(OUT / "dashboard-desktop.png")); ctx.close()
            # 2. dashboard, phone
            ctx, pg = page_for(b, 390, 844, 3, {}); pg.goto(BASE); pg.wait_for_timeout(2500)
            pg.screenshot(path=str(OUT / "dashboard-phone.png")); ctx.close()
            # 3. chat with a question as buttons, phone
            st = {"menu": True}; ctx, pg = page_for(b, 390, 844, 3, st); pg.goto(BASE + "/#/job/a41c07e2"); pg.wait_for_timeout(1500)
            pg.click('#tabs .tab[data-tab=chat]'); pg.wait_for_timeout(1800)
            pg.screenshot(path=str(OUT / "chat-phone.png")); ctx.close()
            # 4. split view (chat beside the live terminal), desktop
            st = {"menu": True}; ctx, pg = page_for(b, 1440, 900, 2, st); pg.goto(BASE + "/#/job/a41c07e2"); pg.wait_for_timeout(1500)
            pg.click('#tabs .tab[data-tab=split]'); pg.wait_for_timeout(2500)
            pg.screenshot(path=str(OUT / "split-desktop.png"))
            # 5. changes
            pg.click('#tabs .tab[data-tab=changes]'); pg.wait_for_timeout(1200)
            pg.locator("details.file summary").first.click(); pg.wait_for_timeout(400)
            pg.screenshot(path=str(OUT / "changes-desktop.png")); ctx.close()
            # 6. new session: project picker + the memory the session will load, phone
            ctx, pg = page_for(b, 390, 844, 3, {}); pg.goto(BASE); pg.wait_for_timeout(1800); pg.click("#newBtn"); pg.wait_for_timeout(1500)
            pg.screenshot(path=str(OUT / "new-session-phone.png")); ctx.close()
            # 7. GIF: a reply being typed out in the chat, then a question answered with one tap
            st = {}; ctx, pg = page_for(b, 390, 780, 1, st); pg.goto(BASE + "/#/job/a41c07e2"); pg.wait_for_timeout(1500)
            pg.click('#tabs .tab[data-tab=chat]'); pg.wait_for_timeout(1500)
            frames = []; shot = lambda n=1: [frames.append(Image.open(io.BytesIO(pg.screenshot())).convert("RGB")) for _ in range(n)]
            shot(6); ws = st["tail"]; text = F.LIVE_TEXT
            for i in range(0, len(text) + 1, 14):
                ws.send(json.dumps({"t": "live", "text": text[:i]})); pg.wait_for_timeout(140); shot()
            ws.send(json.dumps({"t": "events", "evs": [F.ev("assistant", 99, 0, text=text)]})); pg.wait_for_timeout(300); shot(5)
            ws.send(json.dumps({"t": "menu", "menu": F.MENU})); pg.wait_for_timeout(500); shot(10)
            pg.locator(".pc-opt").first.click(); pg.wait_for_timeout(200); shot(3)
            ws.send(json.dumps({"t": "menu", "menu": None})); ws.send(json.dumps({"t": "events", "evs": [F.ev("assistant", 100, 0, text="Done: 3 attempts with backoff (1 s, 10 s, 60 s). Tests pass.")]})); pg.wait_for_timeout(500); shot(14)
            frames[0].save(OUT / "demo.gif", save_all=True, append_images=frames[1:], duration=110, loop=0, optimize=True)
            ctx.close(); b.close()
    finally:
        srv.kill()
    for f in sorted(OUT.iterdir()): print(f"{f.name:28s} {f.stat().st_size / 1024:7.0f} KB")

if __name__ == "__main__":
    main()
