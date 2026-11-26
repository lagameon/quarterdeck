// Quarterdeck service worker: shows server-sent pushes and opens the session on tap; keeps a copy of the page's own
// files (never data) so the app opens at once on a slow link.
const SHELL = "qd-shell-v1";
// Only the page itself: HTML, scripts, styles, icons, vendor and plug-in files. Never /api/ or /ws/.
const isShell = (u) => u.origin === self.location.origin && (u.pathname === "/" || /^\/(app\.js|i18n\.js|style\.css|manifest\.webmanifest|icon[\w.-]*|vendor\/[\w.-]+|plugins\/[\w.-]+)$/.test(u.pathname));
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("qd-shell-") && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
// Stale-while-revalidate: answer from the copy at once, fetch the current file in the background; when a file has
// changed, tell the page so it can offer a reload. Any failure falls back to the plain network.
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  let u; try { u = new URL(req.url); } catch { return; }
  if (!isShell(u)) return;
  e.respondWith((async () => {
    try {
      const cache = await caches.open(SHELL); const key = u.pathname;
      const hit = await cache.match(key);
      const refresh = fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(async (res) => {
        if (!res.ok || res.type !== "basic") return res;
        const changed = hit && hit.headers.get("etag") && res.headers.get("etag") && hit.headers.get("etag") !== res.headers.get("etag");
        await cache.put(key, res.clone());
        if (changed && /^\/($|app\.js|i18n\.js|style\.css|plugins\/)/.test(u.pathname)) for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ t: "updated" });
        return res;
      });
      if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
      return await refresh;
    } catch { return fetch(req); }
  })());
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Quarterdeck", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Quarterdeck", {
    body: d.body || "", tag: d.tag, renotify: true, data: { url: d.url || "/" }, icon: "/icon-192.png", badge: "/icon-192.png",
  }));
});
// The browser replaced or dropped this device's subscription: subscribe again and tell the server (best effort —
// the page does the same on its next open).
self.addEventListener("pushsubscriptionchange", (e) => e.waitUntil((async () => {
  try {
    const key = (await (await fetch("/api/push/key")).json()).publicKey;
    const raw = atob((key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), label: "renewed by the browser" }) });
  } catch {}
})()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { try { await w.focus(); if ("navigate" in w) await w.navigate(url); return; } catch {} }
    await self.clients.openWindow(url);
  })());
});
