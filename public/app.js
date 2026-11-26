import { Terminal } from "/vendor/xterm.mjs";
import { FitAddon } from "/vendor/addon-fit.mjs";
import { WebLinksAddon } from "/vendor/addon-web-links.mjs";
import { marked } from "/vendor/marked.mjs";
import DOMPurify from "/vendor/purify.mjs";
import { t, setLang, getLang, translateStatic } from "/i18n.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// External images in transcripts could be tracking beacons: keep them as text, load nothing.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") || "";
    if (!src.startsWith("data:")) { node.removeAttribute("src"); node.removeAttribute("srcset"); node.setAttribute("alt", `[external image not loaded: ${src}]`); }
  }
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});
const md = (s) => DOMPurify.sanitize(marked.parse(String(s ?? ""), { breaks: true, gfm: true }));
// Layout follows width, not device type: an iPad with a keyboard or a MacBook gets the desktop layout.
const wide = () => innerWidth >= 900;
// The session sidebar fits from iPad-portrait width up (narrower than the two-column dashboard).
const sideOn = () => innerWidth >= 760;
// A newer version of the page was fetched in the background (service worker): offer it, never reload on our own.
// Registered first thing — the notice can arrive while the page is still starting.
let updateSeen = false;
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.t !== "updated" || updateSeen) return; updateSeen = true;
  setTimeout(() => toast(t("A new version is ready — tap to reload"), 20000, { href: location.hash || "#", kind: "done", reload: true }), 1500);
});
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

function ago(t) {
  const ms = Date.now() - (typeof t === "number" ? t : Date.parse(t));
  if (!isFinite(ms)) return "";
  const s = ms / 1000;
  if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
// Toasts sit at the top (below the header on phones, top-right on desktop) so they never cover the composer.
// Session events are clickable (open that session) and dismissable; plain notices never block taps.
function toast(msg, ms = 2500, opts = {}) {
  const box = $("#toasts"); if (!box) return;
  const el = document.createElement("div");
  el.className = `toast${opts.href ? " link" : ""}${opts.kind ? " " + opts.kind : ""}`;
  el.innerHTML = `<span class="tmsg"></span>${opts.href ? `<button class="tx" aria-label="Dismiss">×</button>` : ""}`;
  el.querySelector(".tmsg").textContent = msg;
  const close = () => { el.classList.remove("on"); setTimeout(() => el.remove(), 200); };
  if (opts.href) el.onclick = (e) => { if (!e.target.closest(".tx")) { if (opts.reload) return location.reload(); location.hash = opts.href; } close(); };
  box.prepend(el); while (box.children.length > 3) box.lastElementChild.remove();
  requestAnimationFrame(() => el.classList.add("on"));
  setTimeout(close, ms);
}
// GET answers are remembered with the server's ETag: when nothing changed the server sends an empty 304 and the last
// copy is reused — on a slow link the polls then cost almost nothing.
const apiCache = new Map(); // path → { etag, data }
async function api(path, body) {
  const hit = body ? null : apiCache.get(path);
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : hit ? { headers: { "if-none-match": hit.etag } } : {});
  if (r.status === 304 && hit) return hit.data;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.out || r.statusText);
  const etag = body ? null : r.headers.get("etag");
  if (etag) { if (apiCache.size > 60) apiCache.clear(); apiCache.set(path, { etag, data: d }); }
  return d;
}
const short = (p) => (p || "").replace(/^\/(?:Users|home)\/[^/]+/, "~");
// mcp__server__tool → tool (full name on hover). A bare path shows the file name first, the folder dimmed after it,
// so the part that matters survives truncation on a phone.
const toolName = (n) => (/^mcp__/.test(n || "") ? n.split("__").pop() : n);
function pathHtml(p) {
  const s = short(p); const i = s.replace(/\/$/, "").lastIndexOf("/");
  return i < 0 ? `<span class="pb">${esc(s)}</span>` : `<span class="pp" title="${esc(s)}"><span class="pb">${esc(s.slice(i + 1))}</span><span class="pd">${esc(s.slice(0, i + 1))}</span></span>`;
}
const sumHtml = (x) => `<span class="ts">${/^[~/][^\s]*$/.test(short(x)) ? pathHtml(x) : esc(x)}</span>`;
const needsText = (n) => (n == null ? "" : typeof n === "string" ? n : n.text || n.question || JSON.stringify(n));
const outText = (o) => (o == null ? "" : typeof o === "string" ? o : o.result || o.text || o.headline || JSON.stringify(o));
// ───────────── accounts ─────────────
const accountsOf = (node) => (node ? nodeOf(node)?.data?.accounts : data.accounts) || [];
const multiAccount = (node = "") => accountsOf(node).length > 1;
const acctOf = (id, node = "") => accountsOf(node).find((a) => a.id === (id || "default"));
const acctLabel = (id, node = "") => {
  const a = acctOf(id, node); const local = a?.email ? a.email.split("@")[0] : "";
  const clash = local && accountsOf(node).some((b) => b.id !== a.id && (b.email || "").split("@")[0] === local);
  return local && !clash ? local : (id || "default");
};
const acctBadge = (id, node = "") => (multiAccount(node) ? `<span class="chip acct" title="${esc(acctOf(id, node)?.email || id)}">${esc(acctLabel(id, node))}</span>` : "");
function acctOptions(selected, node = "") {
  return accountsOf(node).map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""} ${a.loggedIn ? "" : "disabled"}>${esc(a.email || a.id)}${a.isDefault ? ` (${t("default")})` : ""}${a.loggedIn ? "" : ` — ${t("not logged in")}`}</option>`).join("");
}
const staleBlocked = (j) => j.tempo === "blocked" || j.state === "blocked" || (j.needs && j.state !== "done");
// A resumed/attached session keeps state "done" while it generates; only tempo turns "active".
// Prefer the transcript-derived phase (server) over the lagging state.json fields.
const jobState = (j) => (j.phase === "working" ? "working" : j.phase === "waiting" ? "blocked"
  : staleBlocked(j) ? "blocked" : j.phase === "idle" && j.state === "working" ? "done" : j.tempo === "active" ? "working" : j.state);
// "Needs you" = the same answer jobState gives: a session state.json still calls blocked while Claude is already
// answering (transcript says working) is not waiting for you.
const isBlocked = (j) => jobState(j) === "blocked";
const stLabel = (st) => t(st); // state chips: working / blocked / done / failed …

// ───────────── plug-ins: optional extra features loaded from the server's config ("plugins") ─────────────
// A plug-in's browser module registers through window.QD: a block at the top of the dashboard (mounted once,
// updated on every refresh, so a half-typed text box survives), full pages at #/<name>, buttons in a session's
// header, and a refresh function called before the dashboard or its page renders. Its API lives under /api/p/<name>/.
const plug = { tops: [], pages: {}, jobButtons: [], refresh: [] };
window.QD = {
  api, esc, md, toast, ago, short, $, t, lang: () => getLang(), poll: () => poll(),
  dashTop: (p) => plug.tops.push(p), page: (name, p) => (plug.pages[name] = p),
  jobButton: (fn) => plug.jobButtons.push(fn), onRefresh: (fn) => plug.refresh.push(fn),
  rerender: () => { const v = route().view; if (v === "list") renderDash(); else if (plug.pages[v]) renderPage(v); else { if ($("#meta")) $("#meta")._sig = ""; refreshMeta(); } },
};
const isDashView = (v) => v === "list" || !!plug.pages[v];
const refreshPlugins = () => Promise.all(plug.refresh.map((f) => Promise.resolve().then(f).catch((e) => console.warn(e))));
// Language: this device's own choice (the switch at the bottom of the dashboard), else the server's "lang" setting.
const LANGS = [["en", "English"], ["zh", "中文"]];
// Both start from what this device saw last time (no waiting on the network) and are refreshed in the background;
// a changed server setting applies on the next open.
async function initLang() {
  let l = store.get("lang") || store.get("srvLang");
  const fresh = api("/api/ui").then((u) => { store.set("srvLang", u.lang || "en"); return u.lang; }).catch(() => null);
  if (!l) l = await fresh;
  setLang(l || "en"); translateStatic();
}
async function loadPluginUi() {
  let list = null; try { list = JSON.parse(store.get("plugins") || "null"); } catch {}
  const fresh = api("/api/plugins").then((x) => { store.set("plugins", JSON.stringify(x)); return x; }).catch(() => null);
  if (!list) list = (await fresh) || [];
  for (const p of list) {
    if (p.css) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = p.css; document.head.append(l); }
    if (p.ui) try { await import(p.ui); } catch (e) { console.warn(`plug-in ${p.name}:`, e); }
  }
}

// ───────────── state + polling + notifications ─────────────
let data = { jobs: [], transcripts: [], tmux: [], cwds: [], ptys: [] };
// ───────────── fleet: several machines in one page (hub forwards /n/<machine>/… to the others) ─────────────
let fleet = { self: null, nodes: [] };
const multiHost = () => (fleet.nodes || []).length > 0;
const nb = (node) => (node ? `/n/${encodeURIComponent(node)}` : ""); // URL prefix for a machine's API / WebSockets
const nodeOf = (node) => (fleet.nodes || []).find((n) => n.id === node);
const hostLabel = (node) => (node ? nodeOf(node)?.label || node : fleet.self?.label || "this machine");
const hostChip = (node) => (multiHost() ? `<span class="chip host${node && !nodeOf(node)?.online ? " off" : ""}" title="${node && !nodeOf(node)?.online ? "offline" : "machine"}">${esc(hostLabel(node))}</span>` : "");
const hrefOf = (view, id, node) => `#/${view}/${view === "tmux" ? encodeURIComponent(id) : id}${node ? "/" + node : ""}`;
const findJob = (id, node) => data.jobs.find((x) => x.id === id && (x.node || "") === (node || ""));
function mergeFleet(loc, fl) {
  fleet = fl || { self: null, nodes: [] };
  const tag = (arr, node, offline) => (arr || []).map((x) => ({ ...x, node, offline }));
  const out = { ...loc, jobs: tag(loc.jobs, "", false), transcripts: tag(loc.transcripts, "", false), tmux: tag(loc.tmux, "", false) };
  for (const n of fleet.nodes) if (n.data) {
    out.jobs.push(...tag(n.data.jobs, n.id, !n.online)); out.transcripts.push(...tag(n.data.transcripts, n.id, !n.online)); out.tmux.push(...tag(n.data.tmux, n.id, !n.online));
  }
  if (fleet.nodes.length) {
    const t = (x) => (typeof x === "number" ? x : Date.parse(x) || 0);
    out.jobs.sort((a, b) => t(b.updatedAt) - t(a.updatedAt)); out.transcripts.sort((a, b) => t(b.mtime) - t(a.mtime));
  }
  return out;
}
let prevJobState = null;
const showAll = { done: false, tr: false };
// The last listing is kept on this device, so opening the page shows it at once (marked "updating…") while the
// fresh one is on its way. Only the lists are kept — never terminal or chat content.
function saveSnapshot(loc, fl) { try { localStorage.setItem("snap", JSON.stringify({ at: Date.now(), loc, fl })); } catch {} }
function loadSnapshot() {
  try {
    const s = JSON.parse(store.get("snap") || "null"); if (!s?.loc || Date.now() - s.at > 7 * 86400_000) return false;
    data = mergeFleet(s.loc, s.fl); document.body.classList.add("stale"); $("#home").title = t("updating…"); return true;
  } catch { return false; }
}

async function poll() {
  try {
    const [loc, fl] = await Promise.all([api("/api/sessions"), api("/api/fleet").catch(() => null)]);
    data = mergeFleet(loc, fl);
    saveSnapshot(loc, fl); document.body.classList.remove("stale");
    notifyTransitions();
    const v = route().view;
    if (v === "list") { renderDash(); Promise.all([refreshPlugins(), loadStats()]).then(() => route().view === "list" && renderDash()); }
    else if (plug.pages[v]) { await refreshPlugins(); renderPage(v); } else refreshMeta();
    renderSide();
    const blocked = data.jobs.filter(isBlocked).length;
    document.title = blocked ? `(${blocked}) Quarterdeck` : "Quarterdeck";
    const off = (fleet.nodes || []).filter((n) => !n.online).length; $("#home").title = off ? `${off} machine(s) offline` : "";
    const sw = $("#swBtn"); sw.textContent = blocked ? `⚑ ${blocked}` : "☰"; sw.classList.toggle("warn", !!blocked);
  } catch (e) { console.warn(e); }
}
function notifyTransitions() {
  const now = new Map(data.jobs.map((j) => [`${j.node}:${j.id}`, jobState(j)]));
  if (prevJobState) for (const [id, st] of now) {
    const was = prevJobState.get(id);
    if (was && was !== st && (st === "blocked" || st === "done")) {
      const j = data.jobs.find((x) => `${x.node}:${x.id}` === id);
      const msg = st === "blocked" ? `${t("needs you")}: ${needsText(j.needs) || j.detail}` : `${t("done")}: ${outText(j.output) || j.detail}`;
      // System notifications now come from the server (Web Push), so only an in-page toast here.
      const h = hrefOf("job", j.id, j.node);
      if (location.hash !== h) toast(`${multiHost() ? `[${hostLabel(j.node)}] ` : ""}${j.name} — ${msg}`, 8000, { href: h, kind: st }); // already looking at it → no toast
      navigator.vibrate?.(120);
    }
  }
  prevJobState = now;
}
// ───────────── push notifications (server → this device) ─────────────
const b64ToU8 = (b) => { const s = atob((b + "=".repeat((4 - (b.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function pushState() {
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}
async function refreshBell() { const st = await pushState().catch(() => "off"); $("#notif").textContent = st === "on" ? "🔔" : "🔕"; $("#notif").title = st === "on" ? t("Push on for this device — click to send a test") : t("Enable push notifications on this device"); }
const pushLabel = () => `${/iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : "device"} · ${navigator.userAgent.match(/(Chrome|Safari|Firefox|Edg)\/[\d.]+/)?.[0] || ""}`;
// A device that had push switched on keeps it: the subscription is re-created if the browser dropped it (expired,
// app re-installed) and re-announced to the server on every open (the server may have forgotten it).
async function ensurePush() {
  try {
    if (!window.isSecureContext || !("PushManager" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub && store.get("pushOn") !== "1") return;           // never switched on here
    if (!sub) { const { publicKey } = await api("/api/push/key"); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) }); }
    store.set("pushOn", "1");
    await api("/api/push/subscribe", { subscription: sub.toJSON(), label: pushLabel() });
    refreshBell();
  } catch (e) { console.warn("push:", e); }
}
$("#notif").onclick = async () => {
  try {
    if (!window.isSecureContext) {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      return toast(ios ? t("Push needs the HTTPS address, opened from the Home Screen app (see README)") : t("Push needs HTTPS or localhost (see README)"), 6000);
    }
    if (!("PushManager" in window)) return toast(t("This browser has no Web Push. On iPhone: Share → Add to Home Screen, then open Quarterdeck from the Home Screen."), 7000);
    const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if ((await Notification.requestPermission()) !== "granted") return toast(t("Notifications were not allowed"));
      const { publicKey } = await api("/api/push/key");
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
      await api("/api/push/subscribe", { subscription: sub.toJSON(), label: pushLabel() });
    }
    store.set("pushOn", "1");
    const r = await api("/api/push/test", {});
    toast(`${t("Test sent to {n} device(s)", { n: r.push })}${r.telegram === null ? "" : `, Telegram ${r.telegram ? "ok" : "failed"}`}`, 4000);
  } catch (e) { toast(t("Push setup failed: {e}", { e: e.message }), 6000); }
  refreshBell();
};

// ───────────── all sessions as one flat list (sidebar, switcher) ─────────────
function allItems() {
  const order = { blocked: 0, working: 1 };
  const jobs = [...data.jobs].sort((a, b) => (order[jobState(a)] ?? 2) - (order[jobState(b)] ?? 2));
  return [
    ...jobs.map((j) => ({ href: hrefOf("job", j.id, j.node), node: j.node, cwd: j.cwd, group: jobState(j) === "blocked" ? "Needs you" : jobState(j) === "working" ? "Running" : "Finished", cls: jobState(j), name: j.name, sub: isBlocked(j) ? needsText(j.needs) || j.detail : j.detail, age: j.updatedAt, key: `${j.name} ${j.id} ${j.detail} ${j.cwd} ${hostLabel(j.node)}` })),
    ...data.transcripts.map((t) => ({ href: hrefOf("t", t.sessionId, t.node), node: t.node, group: "Interactive", cls: "", name: t.title, sub: t.lastPrompt, age: t.mtime, key: `${t.title} ${t.lastPrompt} ${t.cwd} ${hostLabel(t.node)}` })),
    ...data.tmux.map((s) => ({ href: hrefOf("tmux", s.name, s.node), node: s.node, group: "tmux", cls: "", name: `tmux: ${s.name}`, sub: `${s.command} · ${short(s.path)}`, age: s.activity, key: `tmux ${s.name} ${s.path}` })),
    { href: "#/shell", group: "tmux", cls: "", name: "shell (tmux quarterdeck)", sub: t("persistent shell"), age: "", key: "shell Quarterdeck" },
    ...(fleet.nodes || []).filter((n) => n.online).map((n) => ({ href: `#/shell/main/${n.id}`, node: n.id, group: "tmux", cls: "", name: t("shell on {m}", { m: n.label }), sub: t("persistent shell (tmux)"), age: "", key: `shell ${n.label}` })),
  ];
}
function itemHtml(it, extra = "") {
  return `<a class="si ${it.cls} ${extra}" href="${it.href}"><div class="n"><b>${esc(it.name)}</b>${multiHost() && it.node !== undefined ? `<span class="hn">${esc(hostLabel(it.node))}</span>` : ""}<i>${ago(it.age)}</i></div><div class="d">${esc(it.sub)}</div></a>`;
}
function match(it, q) { return !q || q.toLowerCase().split(/\s+/).every((w) => it.key.toLowerCase().includes(w) || it.name.toLowerCase().includes(w)); }

// ───────────── finished sessions grouped by project (= folder on a machine) ─────────────
const projKey = (x) => `${x.node || ""}|${x.cwd || ""}`;
const projName = (cwd) => (cwd || "").replace(/\/+$/, "").split("/").pop() || "~";
function groupByProject(list, timeOf) {
  const m = new Map();
  for (const x of list) {
    const k = projKey(x); if (!m.has(k)) m.set(k, { k, node: x.node, cwd: x.cwd, items: [], last: 0 });
    const g = m.get(k); g.items.push(x); g.last = Math.max(g.last, timeOf(x));
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}
// Open/closed per group is remembered (shared by dashboard and sidebar); unset → the two most recent are open.
const grpOpen = (k, i) => { const v = store.get(`grp:${k}`); return v === null ? i < 2 : v === "1"; };
const rememberGroups = (root, sel, when = () => true) => root.querySelectorAll(sel).forEach((d) => d.addEventListener("toggle", () => { if (when()) store.set(`grp:${d.dataset.g}`, d.open ? "1" : "0"); }));
function finishedSection(list) {
  const groups = groupByProject(list, (j) => Date.parse(j.updatedAt) || 0);
  const body = groups.map((g, i) => {
    const all = showAll[`g:${g.k}`], shown = all ? g.items : g.items.slice(0, 5);
    return `<details class="grp" data-g="${esc(g.k)}" ${grpOpen(g.k, i) ? "open" : ""}><summary><span class="gname">${esc(projName(g.cwd))}</span>${hostChip(g.node)}<span class="gpath">${esc(short(g.cwd))}</span><span class="gcount">${g.items.length}</span><span class="age">${ago(g.last)}</span></summary>` +
      shown.map((j) => jobCard(j, { stateChip: true, inGroup: true })).join("") +
      (!all && g.items.length > 5 ? `<button class="more" data-more="g:${esc(g.k)}">${t("show {n} more", { n: g.items.length - 5 })}</button>` : "") + `</details>`;
  }).join("") || `<div class="empty">${t("none")}</div>`;
  return `<div><h2>${t("Finished background sessions")}<span class="count">${list.length}</span></h2>${body}</div>`;
}
function renderSide() {
  const side = $("#side"); if (side.hidden) return;
  const q = $("#sideFilter").value.trim(); const here = location.hash;
  const items = allItems().filter((i) => match(i, q)); const fin = items.filter((i) => i.group === "Finished");
  let html = "", group = "";
  for (const it of items) {
    if (it.group === "Finished") {
      if (group === "Finished") continue; group = "Finished";
      html += `<div class="sg">${t("Finished")}<span class="sgc">${fin.length}</span></div>` + groupByProject(fin, (x) => Date.parse(x.age) || 0).map((g, i) =>
        `<details class="sgrp" data-g="${esc(g.k)}" ${q || grpOpen(g.k, i) || g.items.some((x) => x.href === here) ? "open" : ""}><summary><span class="sgn">${esc(projName(g.cwd))}</span>${multiHost() ? `<span class="hn">${esc(hostLabel(g.node))}</span>` : ""}<span class="sgc">${g.items.length}</span></summary>` +
        g.items.map((x) => itemHtml({ ...x, node: undefined }, x.href === here ? "on" : "")).join("") + `</details>`).join("");
      continue;
    }
    if (it.group !== group) { group = it.group; html += `<div class="sg">${esc(t(group))}</div>`; }
    html += itemHtml(it, it.href === here ? "on" : "");
  }
  const el = $("#sideList"); const y = el.scrollTop; el.innerHTML = html; el.scrollTop = y;
  rememberGroups(el, "details.sgrp", () => !$("#sideFilter").value.trim()); // a filter opens everything; don't remember that
}
$("#sideFilter").addEventListener("input", renderSide);

// ───────────── dashboard ─────────────
function jobCard(j, opt = {}) {
  const st = jobState(j);
  const nt = isBlocked(j) ? needsText(j.needs) : "";
  const needs = nt ? `<div class="needs">⚑ ${esc(nt)}</div>` : "";
  const ot = outText(j.output);
  const res = j.state === "done" && ot ? `<div class="result">${esc(ot.slice(0, 220))}</div>` : "";
  const dup = (nt && nt === j.detail) || (j.state === "done" && ot && (ot.startsWith(j.detail) || j.detail.startsWith(ot.slice(0, 40))));
  const detail = dup ? "" : `<div class="l2">${esc(j.detail || j.intent)}</div>`;
  // The section heading already says the state; only an unusual one (failed, stopped…) gets a chip.
  const chip = opt.stateChip && st !== "done" ? `<span class="chip ${st}">${esc(stLabel(st))}</span>` : "";
  return `<a class="card ${st}" href="${hrefOf("job", j.id, j.node)}">
    <div class="l1"><span class="name">${esc(j.name)}</span><span class="age">${ago(j.updatedAt)}</span><button class="x" data-rm="${j.id}" data-node="${esc(j.node || "")}" title="${t("Close and remove from the list (transcript is kept)")}" aria-label="${t("Close session")}">×</button></div>
    ${detail}${needs}${res}<div class="l2 lm">${opt.inGroup ? "" : hostChip(j.node)}${acctBadge(j.profile, j.node)}${chip}${opt.inGroup ? "" : esc(short(j.cwd)) + " · "}${esc(j.id)}</div></a>`;
}
const trCard = (t) => `<a class="card" href="${hrefOf("t", t.sessionId, t.node)}"><div class="l1"><span class="name">${esc(t.title)}</span><span class="age">${ago(t.mtime)}</span></div><div class="l2">${esc(t.lastPrompt)}</div><div class="l2 lm">${hostChip(t.node)}${esc(short(t.cwd))}</div></a>`;
const tmuxCard = (s) => `<a class="card" href="${hrefOf("tmux", s.name, s.node)}"><div class="l1"><span class="name">tmux: ${esc(s.name)}</span>${s.attached ? `<span class="chip live">${t("{n} attached", { n: s.attached })}</span>` : ""}<span class="age">${ago(s.activity)}</span></div><div class="l2 lm">${hostChip(s.node)}${esc(s.command)} · ${esc(short(s.path))} · ${t("{n} win", { n: s.windows })}</div></a>`;
function section(title, items, render, opt = {}) {
  let list = items, more = "";
  if (opt.limit && !showAll[opt.key] && items.length > opt.limit) { list = items.slice(0, opt.limit); more = `<button class="more" data-more="${opt.key}">${t("show {n} more", { n: items.length - opt.limit })}</button>`; }
  const body = list.length ? list.map(render).join("") : `<div class="empty">${opt.empty || t("none")}</div>`;
  return `<div><h2>${title}<span class="count">${items.length}</span></h2>${body}${more}</div>`;
}
// ───────────── overview (today tiles + 14-day charts) ─────────────
let stats = null;
async function loadStats() { try { stats = await api("/api/stats?days=14"); } catch (e) { console.warn(e); } }
function dashSkeleton() {
  if ($("#overview")) return;
  $("#dash").innerHTML = `<div id="dashTop" hidden></div><div id="pluginTop"></div><div id="overview"></div><div id="dashBody"></div><div id="pluginPage" hidden></div>`;
}
// Dashboard vs. a plug-in's own page share #dash: show one set of blocks, hide the other.
function dashMode(page) {
  dashSkeleton();
  for (const id of ["#pluginTop", "#overview", "#dashBody"]) $(id).hidden = !!page;
  if (page) $("#dashTop").hidden = true;
  $("#pluginPage").hidden = !page;
}
function renderPluginTops() {
  const box = $("#pluginTop");
  plug.tops.forEach((p, i) => {
    let el = box.querySelector(`[data-pt="${i}"]`);
    if (!el) { el = document.createElement("div"); el.dataset.pt = String(i); box.append(el); try { p.mount?.(el); } catch (e) { console.warn(e); } }
    try { p.update?.(el); } catch (e) { console.warn(e); }
  });
}
function renderPage(name) {
  const p = plug.pages[name]; if (!p) return;
  dashMode(true); $("#subtitle").textContent = p.title || "";
  try { p.render($("#pluginPage")); } catch (e) { console.warn(e); }
}
const fmtTok = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
let overviewSig = "";
const ovOpen = () => store.get("ovOpen") === "1"; // phones: the overview is one tappable line until opened
function renderOverview() {
  const st = stats; const el = $("#overview"); if (!el) return;
  const jobsNow = { run: data.jobs.filter((j) => jobState(j) === "working").length, wait: data.jobs.filter(isBlocked).length,
    doneToday: data.jobs.filter((j) => j.state === "done" && j.updatedAt && new Date(j.updatedAt).toDateString() === new Date().toDateString()).length };
  const sig = JSON.stringify([st?.updatedAt, st?.quota, jobsNow, wide(), ovOpen(), data.accounts]); if (sig === overviewSig) return; overviewSig = sig;
  if (!st?.ready) { el.innerHTML = `<div class="empty">${t("building usage stats…")}</div>`; return; }
  const td = st.days[st.days.length - 1];
  const tile = (label, val, sub = "") => `<div class="tile"><div class="tv">${val}</div><div class="tl">${label}</div>${sub ? `<div class="ts2">${sub}</div>` : ""}</div>`;
  // Optional quota tiles (config.quotaUrl). Each account carries its own state: never show a stale number as current.
  const q = st.quota;
  const pct = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Math.round(Number(v)))));
  const hrs = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);
  for (const b of (st.quota?.bars || [])) { b.h = pct(b.h); b.w = pct(b.w); b.ageHours = hrs(b.ageHours); }
  if (st.quota) st.quota.ageHours = hrs(st.quota.ageHours);
  const qBar = (b) => b.state === "ok"
    ? tile(t("Quota {name} (7d)", { name: esc(b.label) }), b.w == null ? "–" : `${b.w}%`, (b.h == null ? t("no 5-hour limit") : t("5-hour window {p}%", { p: b.h })) + (b.codex && b.ageHours ? t("; snapshot {h}h old", { h: b.ageHours }) : ""))
    : b.codex && b.state === "stale"
    ? tile(t("Quota {name} (7d)", { name: esc(b.label) }), b.w == null ? "–" : `${b.w}%`, t("snapshot {h}h old (updates only when Codex is used)", { h: b.ageHours }))
    : `<div class="tile warn"><div class="tv">⚠</div><div class="tl">${t("Quota {name}", { name: esc(b.label) })}</div><div class="ts2">${esc(b.state === "auth" ? t("login expired — sign in to this account again") : b.note || b.state)}${b.ageHours ? t("; data is {h}h old", { h: b.ageHours }) : ""}</div></div>`;
  const quota = !q ? "" : q.bars.length ? (q.ok ? q.bars.map(qBar).join("")
      : `<div class="tile warn"><div class="tv">⚠</div><div class="tl">${t("Quota unavailable")}</div><div class="ts2">${t("data is {h}h old", { h: q.ageHours })}${q.err ? t(" (collector error)") : ""}${t("; not showing stale numbers")}</div></div>`)
    : `<div class="tile warn"><div class="tv">⚠</div><div class="tl">${t("Quota")}</div><div class="ts2">${esc(q.err || t("no data"))}</div></div>`;
  // One tile for all signed-in accounts (one tile each left a lone tile on its own row); a missing login still warns.
  const accts = data.accounts || [], signedIn = accts.filter((a) => a.loggedIn);
  const acctTiles = !multiAccount() ? "" : (signedIn.length ? `<div class="tile"><div class="tv">${signedIn.length}</div><div class="tl">${t("Accounts")}</div>${signedIn.map((a) =>
      `<div class="ts2" title="${esc(a.email || a.id)}">${esc(acctLabel(a.id))}${a.isDefault ? ` (${t("default")})` : ""}${a.planTier ? " · " + esc(a.planTier) : ""}${a.loginExpiresAt ? t(" · until {d}", { d: esc(a.loginExpiresAt.slice(5, 10)) }) : ""}</div>`).join("")}</div>` : "") +
    accts.filter((a) => !a.loggedIn).map((a) => `<div class="tile warn"><div class="tv">⚠</div><div class="tl">${t("Account {id} not logged in", { id: esc(a.id) })}</div><div class="ts2">${t("run")} <code>CLAUDE_CONFIG_DIR=${esc(a.dir)} claude auth login</code></div></div>`).join("");
  if (!wide() && !ovOpen()) {
    const qs = (q?.bars || []).filter((b) => b.state === "ok" && b.w != null).map((b) => `${esc(b.label)} ${b.w}%`).join(" · ");
    el.innerHTML = `<button class="ov-line" id="ovToggle"><span class="ov-car">▸</span><span>${t("Today · {out} out · {turns} turns · {done} done", { out: fmtTok(td.out), turns: td.turns, done: jobsNow.doneToday })}${qs ? t(" · quota {q}", { q: qs }) : ""}</span></button>`;
    $("#ovToggle").onclick = () => { store.set("ovOpen", "1"); overviewSig = ""; renderOverview(); };
    return;
  }
  const models = Object.entries(td.models || {}).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${esc(m)} ${fmtTok(v)}`).join(" · ");
  el.innerHTML = `<h2>${t("Today")}<span class="count">${esc(td.date)}</span><span class="ov-upd">${ago(st.updatedAt) === "now" ? t("stats updated just now") : t("stats updated {t} ago", { t: ago(st.updatedAt) })}</span></h2>
    <div class="tiles">
      ${tile(t("done today"), jobsNow.doneToday)}
      ${tile(t("active sessions"), td.sessions)}${tile(t("your messages"), td.prompts)}${tile(t("Claude turns"), td.turns, t("{n} tool calls", { n: td.tools }))}
      ${tile(t("output tokens"), fmtTok(td.out), models)}${tile(t("input tokens"), fmtTok(td.inp + td.cr), t("{n} from cache", { n: fmtTok(td.cr) }))}
      ${quota}${acctTiles}
    </div>
    <div class="charts">
      ${barChart(t("Output tokens per day (14 days)"), st.days, (d) => d.out, (d) => `${d.date}<br>${t("output {o} · input {i}", { o: fmtTok(d.out), i: fmtTok(d.inp + d.cr) })}<br>${t("{t} turns · {n} tool calls", { t: d.turns, n: d.tools })}`, fmtTok)}
      ${barChart(t("Active sessions per day (14 days)"), st.days, (d) => d.sessions, (d) => `${d.date}<br>${t("{s} active sessions · {p} messages from you", { s: d.sessions, p: d.prompts })}`, String)}
    </div>
    ${st.top.length ? `<div class="top-s"><div class="tl">${t("Top sessions by tokens today")}</div>${st.top.map((x) => `<a href="${x.href}"><span>${esc(x.name)}</span><b>${fmtTok(x.tokens)}</b></a>`).join("")}</div>` : ""}`;
  if (!wide()) { const b = document.createElement("button"); b.className = "ov-x"; b.textContent = "▴"; b.title = t("Collapse"); b.onclick = () => { store.set("ovOpen", "0"); overviewSig = ""; renderOverview(); }; el.querySelector("h2")?.appendChild(b); }
  el.querySelectorAll(".bar").forEach((b) => {
    b.addEventListener("mouseenter", (e) => showTip(b.dataset.tip, e)); b.addEventListener("mousemove", (e) => showTip(b.dataset.tip, e));
    b.addEventListener("mouseleave", hideTip); b.addEventListener("click", (e) => showTip(b.dataset.tip, e));
  });
}
// Single-series column chart: thin columns (≤24px), 4px rounded top, hairline baseline, peak labelled, tooltip per column.
function barChart(title, days, val, tip, fmt) {
  const W = 320, H = 110, padB = 18, padT = 14, n = days.length, slot = W / n, bw = Math.min(16, slot - 4);
  const max = Math.max(1, ...days.map(val)); const peak = days.reduce((a, d, i) => (val(d) > val(days[a]) ? i : a), 0);
  const bars = days.map((d, i) => {
    const v = val(d), h = v ? Math.max(2, (v / max) * (H - padB - padT)) : 0, x = i * slot + (slot - bw) / 2, y = H - padB - h;
    const r = Math.min(4, h / 2);
    const path = h ? `M${x},${H - padB} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - padB} Z` : "";
    return `<g class="bar" data-tip="${esc(tip(d))}"><rect x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>${path ? `<path d="${path}"/>` : ""}
      ${i === peak && v ? `<text x="${x + bw / 2}" y="${y - 3}" text-anchor="middle" class="peak">${fmt(v)}</text>` : ""}
      ${i % 2 === (n - 1) % 2 ? `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" class="ax">${d.date.slice(5).replace("-", "/")}</text>` : ""}</g>`;
  }).join("");
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="base"/>${bars}</svg></figure>`;
}
function showTip(html, e) { const t = $("#tip"); t.innerHTML = html; t.hidden = false; const x = Math.min(innerWidth - t.offsetWidth - 8, e.clientX + 12); t.style.left = x + "px"; t.style.top = (e.clientY - t.offsetHeight - 10) + "px"; }
function hideTip() { $("#tip").hidden = true; }

// ───────────── machines: health + version (from each machine's own /api/sessions) ─────────────
function machinesBlock() {
  const mine = data.machine?.quarterdeck?.protocol || 0;
  const ms = [{ id: "", label: hostLabel(""), m: data.machine, accounts: data.accounts || [], online: true },
    ...(fleet.nodes || []).map((n) => ({ id: n.id, label: n.label, m: n.data?.machine, accounts: n.data?.accounts || [], online: n.online }))];
  const warns = [], rows = [];
  if (data.push?.lost) warns.push(t("Notifications reach no device since {d} ({n} not delivered): the phone's subscription ended. Open Quarterdeck on the phone and tap 🔔.", { d: esc(new Date(data.push.lost.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })), n: data.push.lost.missed }));
  for (const x of ms) {
    if (!x.online) continue; // the offline banner covers it
    const h = x.m?.health, qd = x.m?.quarterdeck, bad = [];
    if (x.id && (!qd || qd.protocol < mine)) { bad.push("old"); warns.push(t("{m} runs an older Quarterdeck", { m: `<b>${esc(x.label)}</b>` }) + (qd ? t(" (protocol {p}, this page expects {e})", { p: qd.protocol, e: mine }) : "") + t(": deploy the update to it.")); }
    if (h?.disk?.low) { bad.push("disk"); warns.push(t("{m}: disk almost full — {p}% free ({g} GB).", { m: `<b>${esc(x.label)}</b>`, p: h.disk.freePct, g: h.disk.freeGB })); }
    for (const a of x.accounts) {
      const left = a.loginExpiresAt ? (Date.parse(a.loginExpiresAt) - Date.now()) / 86400000 : Infinity;
      if (!a.loggedIn) { bad.push("login"); warns.push(t("{m}: Claude account {a} is logged out.", { m: `<b>${esc(x.label)}</b>`, a: esc(a.email || a.id) })); }
      else if (left < 7) { bad.push("login"); warns.push(left < 1 ? t("{m}: Claude login ({a}) expires today.", { m: `<b>${esc(x.label)}</b>`, a: esc(a.email || a.id) }) : t("{m}: Claude login ({a}) expires in {n} days.", { m: `<b>${esc(x.label)}</b>`, a: esc(a.email || a.id), n: Math.ceil(left) })); }
    }
    if (!h) { rows.push(`<div class="mrow"><b>${esc(x.label)}</b><span class="dim">${t("no machine data")}${qd ? "" : t(" (older version)")}</span></div>`); continue; }
    const login = x.accounts.filter((a) => a.loggedIn && a.loginExpiresAt).map((a) => a.loginExpiresAt.slice(5, 10)).sort()[0];
    const parts = [
      h.disk ? `<span class="${h.disk.low ? "warnt" : ""}">${t("disk {p}% free", { p: h.disk.freePct })}</span>` : "",
      t("load {l}/{c}", { l: h.load1, c: h.cpus }),
      h.mem && h.mem.usedPct >= 0 ? t("mem {p}%", { p: h.mem.usedPct }) : "",
      ...h.gpu.map((g) => `GPU ${g.utilPct}% · ${g.memUsedGB}/${g.memTotalGB} GB`),
      h.claudeVersion ? `Claude ${esc(h.claudeVersion)}` : "",
      login ? `<span class="${bad.includes("login") ? "warnt" : ""}">${t("login until {d}", { d: esc(login) })}</span>` : "",
    ].filter(Boolean);
    rows.push(`<div class="mrow" title="Quarterdeck ${esc(qd?.version || "?")} · build ${esc(qd?.build || "?")} · protocol ${qd?.protocol ?? "?"}"><b>${esc(x.label)}</b>${parts.map((p) => `<span>${p}</span>`).join("")}</div>`);
  }
  const warnHtml = warns.length ? `<div class="hint warn">⚠ ${warns.join("<br>⚠ ")}</div>` : "";
  return warnHtml + (multiHost() ? `<div class="machines">${rows.join("")}</div>` : "");
}

function renderDash() {
  dashMode(false); renderPluginTops(); renderOverview();
  const blocked = data.jobs.filter(isBlocked);
  const working = data.jobs.filter((j) => jobState(j) === "working");
  const rest = data.jobs.filter((j) => !isBlocked(j) && jobState(j) !== "working");
  const el = $("#dashBody"); const y = $("#dash").scrollTop;
  const hint = wide() && store.get("hintHidden") !== "1" ? `<div class="hint"><button class="hx" title="${t("Hide this hint")}" aria-label="${t("Hide hint")}">×</button>${t("Open any session to get <b>Chat</b> · <b>Terminal</b> · <b>Split</b> (both side by side) · <b>Changes</b> (this session's diffs).")}
    <kbd>⌘K</kbd> ${t("switch session")} · <kbd>Alt+1–4</kbd> ${t("switch view")} · <kbd>Alt+N</kbd> ${t("new")} · <kbd>/</kbd> ${t("type a message")}</div>` : "";
  // What needs you and what is running: left column on wide screens, the very top on phones.
  const top = section(t("Needs you"), blocked, jobCard, { empty: t("nothing waiting on you") }) + section(t("Running"), working, jobCard);
  const others = finishedSection(rest) +
    section(t("Interactive sessions (resume)"), data.transcripts, trCard, { limit: 8, key: "tr" }) +
    section("tmux", data.tmux, tmuxCard, { empty: t("no tmux sessions") }) +
    `<p><button id="shellBtn">${t("Open shell (tmux “quarterdeck”)")}</button></p>` +
    `<p class="langrow">${t("Language")}: ${LANGS.map(([k, n]) => k === getLang() ? `<b>${n}</b>` : `<a href="#" data-lang="${k}">${n}</a>`).join(" · ")}</p>`;
  const off = (fleet.nodes || []).filter((n) => !n.online).map((n) => `<div class="hint warn">⚠ ${t("{m} is offline", { m: `<b>${esc(n.label)}</b>` })}${n.lastOk ? t(" (last seen {t} ago)", { t: ago(n.lastOk) }) : ""}${t(": its sessions are shown as they were, and actions on them wait until it is back.")}${n.error ? `<br><small>${esc(n.error)}</small>` : ""}</div>`).join("") + machinesBlock();
  const dt = $("#dashTop"); dt.hidden = wide(); dt.innerHTML = wide() ? "" : off + top;
  el.innerHTML = wide() ? off + hint + `<div class="cols"><div class="col">${top}</div><div class="col">${others}</div></div>` : others;
  $("#dash").scrollTop = y;
  el.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => { showAll[b.dataset.more] = true; renderDash(); }));
  $("#shellBtn").onclick = () => (location.hash = "#/shell");
  el.querySelectorAll("[data-lang]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); store.set("lang", a.dataset.lang); location.reload(); }));
  $("#dash").querySelectorAll("#dashTop [data-rm], #dashBody [data-rm]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); removeJob(b.dataset.rm, b.dataset.node || ""); }));
  rememberGroups($("#dash"), "details.grp");
  el.querySelector(".hint .hx")?.addEventListener("click", () => { store.set("hintHidden", "1"); renderDash(); });
}
async function removeJob(id, node = "") {
  const j = findJob(id, node); if (!j) return;
  const running = j.state !== "done";
  if (!confirm(`${running ? t('"{name}" is still running or waiting for you.\nStop it and remove it from the list?', { name: j.name }) : t('Remove "{name}" from the list?', { name: j.name })}\n${t('(The transcript is kept — resume it later from "Interactive sessions".)')}`)) return;
  try { await api(nb(node) + "/api/rm", { id }); toast(t("removed")); if (location.hash === hrefOf("job", id, node)) location.hash = ""; await poll(); } catch (e) { toast(e.message, 5000); }
}

// ───────────── routing ─────────────
function route() {
  const [, view, id, node] = location.hash.split("/"); // #/<view>/<id>[/<machine>]
  return view ? { view, id: id && decodeURIComponent(id), node: node ? decodeURIComponent(node) : "" } : { view: "list", node: "" };
}
let cur = null;
window.addEventListener("hashchange", go);
$("#back").onclick = () => (location.hash = "");
$("#swBtn").onclick = () => openFind();
let lastDashView = "list";

function applyLayout() {
  const inSession = !isDashView(route().view);
  $("#side").hidden = !sideOn();
  document.body.classList.toggle("wide", wide());
  $("#back").hidden = !inSession || sideOn();
  $("#swBtn").hidden = !inSession || sideOn();
}
function go() {
  teardown();
  const r = route(); const inSession = !isDashView(r.view);
  $("#dash").hidden = inSession; $("#session").hidden = !inSession;
  $("#tabs").hidden = !inSession; document.body.classList.toggle("in-session", inSession); applyLayout();
  if (!inSession) {
    if (r.view !== lastDashView) { $("#dash").scrollTop = 0; lastDashView = r.view; } renderSide();
    if (plug.pages[r.view]) { renderPage(r.view); refreshPlugins().then(() => route().view === r.view && renderPage(r.view)); return; }
    $("#subtitle").textContent = ""; renderDash(); Promise.all([loadStats(), refreshPlugins()]).then(() => route().view === "list" && renderDash()); return;
  }
  if (r.view === "job") {
    const j = findJob(r.id, r.node);
    cur = { kind: "job", node: r.node, id: r.id, target: `job:${r.id}`, sessionId: j?.sessionId, title: j?.name || r.id };
  } else if (r.view === "t") {
    const t = data.transcripts.find((x) => x.sessionId === r.id && (x.node || "") === r.node);
    cur = { kind: "transcript", node: r.node, id: r.id, sessionId: r.id, title: t?.title || r.id };
  } else if (r.view === "tmux") cur = { kind: "tmux", node: r.node, id: r.id, target: `tmux:${r.id}`, title: `tmux: ${r.id}` };
  else if (r.view === "shell") cur = { kind: "shell", node: r.node, id: "quarterdeck", target: "shell:", title: "shell (tmux quarterdeck)" };
  else if (r.view === "here") cur = { kind: "here", node: r.node, id: r.id, target: `here:${r.id}`, title: `claude in ${r.id.slice(r.id.indexOf(":") + 1).split("/").pop()}` };
  else { location.hash = ""; return; }
  $("#subtitle").textContent = (multiHost() ? `[${hostLabel(cur.node)}] ` : "") + cur.title;
  const has = { chat: !!cur.sessionId, term: !!cur.target, split: !!(cur.sessionId && cur.target), changes: !!cur.sessionId };
  document.querySelectorAll("#tabs .tab").forEach((b) => (b.hidden = !has[b.dataset.tab]));
  cur.has = has;
  refreshMeta(); renderKeys(); renderSide();
  $("#input").placeholder = t(cur.kind === "transcript" ? "Message → resumes this session in the background…" : wide() ? "Message…  (Enter send · Shift+Enter newline)" : "Message…");
  syncSend();
  const saved = store.get(`tab:${cur.kind}:${wide() ? "w" : "n"}`);
  setTab(saved && has[saved] && (saved !== "split" || wide()) ? saved : has.chat ? (wide() && has.split && cur.kind === "job" ? "split" : "chat") : "term");
}
addEventListener("resize", () => {
  applyLayout(); renderSide();
  if (cur?.tab === "split" && !wide()) setTab("chat");
});

function refreshMeta() {
  if (!cur) return;
  const m = $("#meta");
  if (cur.kind === "job") {
    const j = findJob(cur.id, cur.node);
    if (!j) { m.innerHTML = `<span>${esc(cur.id)}</span>`; m._sig = ""; return; }
    if (!cur.sessionId && j.sessionId) { cur.sessionId = j.sessionId; go(); return; }
    const st = jobState(j); const nt = isBlocked(j) ? needsText(j.needs) : "";
    // One row: name · state · detail · Stop (only while it is doing something) · ⋯ (full detail, folder, id, Close).
    const canStop = st === "working" || st === "blocked";
    const extra = plug.jobButtons.flatMap((f) => { try { return f(j) || []; } catch { return []; } }); // plug-in buttons: [{ label, title?, onClick }]
    const html = `<div class="meta-row"><b class="meta-name">${esc(j.name)}</b><span class="chip ${st}">${esc(stLabel(st))}</span>${hostChip(j.node)}${acctBadge(j.profile, j.node)}<span class="meta-detail">${esc(j.detail)}</span><span class="spacer"></span>
      ${extra.map((b, i) => `<button data-pb="${i}" title="${esc(b.title || "")}">${esc(b.label)}</button>`).join("")}${canStop ? `<button id="stopBtn" class="danger">${t("Stop")}</button>` : ""}<button id="moreBtn" class="icon" title="${t("Details and actions")}" aria-expanded="${!!cur.metaOpen}">⋯</button></div>
      ${nt && nt !== j.detail ? `<div class="needs">⚑ ${esc(nt)}</div>` : ""}
      <div class="meta-more" ${cur.metaOpen ? "" : "hidden"}><div class="mm-detail">${esc(j.detail || j.intent || "")}</div><div class="mm-row"><span title="${esc(j.cwd)}">${esc(short(j.cwd))}</span><span>${esc(j.id)}</span><span class="spacer"></span><button id="rmBtn" title="${t("Close and remove from the list (transcript is kept)")}">${t("× Close")}</button></div></div>`;
    if (m._sig === html) return; m._sig = html; m.innerHTML = html; // unchanged → keep the DOM (no flicker, no lost taps)
    const toggle = () => { cur.metaOpen = !cur.metaOpen; m._sig = ""; refreshMeta(); };
    $("#moreBtn").onclick = toggle; m.querySelector(".meta-detail").onclick = toggle;
    $("#rmBtn").onclick = () => removeJob(j.id, j.node);
    m.querySelectorAll("[data-pb]").forEach((b) => (b.onclick = () => extra[+b.dataset.pb].onClick(j)));
    if ($("#stopBtn")) $("#stopBtn").onclick = async () => { if (!confirm(t('Stop session "{name}"? (The conversation is kept.)', { name: j.name }))) return; try { await api(nb(j.node) + "/api/stop", { id: j.id }); toast(t("stopped")); poll(); } catch (e) { toast(e.message); } };
  } else if (cur.kind === "transcript") {
    m._sig = "";
    const tr = data.transcripts.find((x) => x.sessionId === cur.id && (x.node || "") === (cur.node || ""));
    m.innerHTML = `<b class="meta-name">${esc(cur.title)}</b><span class="chip">${t("interactive transcript")}</span><span>${esc(short(tr?.cwd))}</span><span class="spacer"></span>${hostChip(cur.node)}${multiAccount(cur.node) ? `<select id="resumeProfile" title="${t("Account that resumes this conversation")}">${acctOptions(cur.resumeProfile || "default", cur.node)}</select>` : ""}<button id="resumeBtn">${t("Resume in background")}</button>`;
    $("#resumeBtn").onclick = () => resume("");
    if ($("#resumeProfile")) $("#resumeProfile").onchange = (e) => { cur.resumeProfile = e.target.value; };
  } else m.innerHTML = `<b class="meta-name">${esc(cur.title)}</b><span class="chip">${esc(cur.kind)}</span><span>${t("persistent — closing this page does not stop it")}</span>`;
}

// ───────────── tabs ─────────────
document.querySelectorAll("#tabs .tab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab, true)));
function setTab(tab, byUser) {
  if (!cur || !cur.has[tab]) return;
  cur.tab = tab;
  // Remember only explicit choices — an automatic fallback (e.g. Terminal while the transcript id
  // is still unknown) must not overwrite the user's preferred view.
  if (byUser) store.set(`tab:${cur.kind}:${wide() ? "w" : "n"}`, tab);
  document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const showChat = tab === "chat" || tab === "split", showTerm = tab === "term" || tab === "split";
  $("#panes").classList.toggle("split", tab === "split");
  $("#chat").hidden = !showChat; $("#term").hidden = !showTerm; $("#changes").hidden = tab !== "changes";
  $("#keys").hidden = !cur.target || tab === "changes" || tab === "chat";
  $("#composer").hidden = tab === "changes";
  if (showChat && !cur.tailWs) openChat();
  if (showChat && cur.target) pollPrompt();                 // once, now; changes then arrive over the chat stream
  if (!showChat) $("#promptCard").hidden = true;
  sendVisible();
  if (showTerm) { if (!cur.term) openTerm(); else setTimeout(() => fitTerm(true), 30); }
  if (tab === "changes") loadChanges();
}

// ───────────── chat (rendered transcript, live) ─────────────
function openChat(opt = {}) {
  const ev = $("#events"); if (!opt.keep) ev.innerHTML = `<div class="empty">${t("loading…")}</div>`;
  cur.toolEls = new Map(); cur.lastTs = 0; cur.subs = new Map(); cur.bgs = new Map(); cur.agentIds = new Map();
  cur.tailLimit = cur.tailLimit || 150; cur.newDiv = null;
  // What arrived since you last read this session (on this device) gets a "new since" divider.
  if (cur.seenAt === undefined) cur.seenAt = Number(store.get(`seen:${cur.sessionId}`)) || 0;
  const q = `session=${encodeURIComponent(cur.sessionId)}&limit=${cur.tailLimit}&bytes=${Math.min(40_000_000, cur.tailLimit * 20_000)}${cur.target ? "&target=" + encodeURIComponent(cur.target) : ""}`;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${nb(cur.node)}/ws/tail?${q}`);
  cur.tailWs = ws; const ctx = cur;
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data); if (ctx !== cur) return;
    if (d.t === "menu") { ctx.menuPushed = true; if (!$("#chat").hidden) renderPrompt(d.menu); return; } // menus come with the stream — no polling
    if (d.t !== "events") return;
    const chat = $("#chat"); const stick = !d.initial && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
    if (d.initial) {
      ev.innerHTML = !d.truncated ? "" : ctx.tailLimit >= 6000 ? `<div class="empty">${t("(older messages omitted)")}</div>` : `<div class="earlier"><button id="earlierBtn">${t("Load earlier messages")}</button></div>`;
      if ($("#earlierBtn")) $("#earlierBtn").onclick = loadEarlier;
      ctx.initialLoad = true;
    }
    for (const e of d.evs) addEvent(e);
    ctx.initialLoad = false;
    renderActivity();
    if (d.initial) {
      const anchor = opt.anchor && ev.querySelector(`[data-id="${CSS.escape(opt.anchor)}"]`);
      const to = (el) => { chat.scrollTop += el.getBoundingClientRect().top - chat.getBoundingClientRect().top - 8; };
      if (anchor) to(anchor);
      else if (ctx.newDiv?.nextElementSibling) { to(ctx.newDiv); $("#jump").hidden = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60; }
      else { chat.scrollTop = chat.scrollHeight; markSeen(); }
    } else if (stick) { chat.scrollTop = chat.scrollHeight; markSeen(); }
    else if (d.evs.length) $("#jump").hidden = false;
    if (!d.initial && d.evs.some((e) => e.k === "tool" && /Edit|Write/.test(e.name)) && cur.tab === "changes") loadChanges();
  };
  ws.onopen = () => { ws._opened = true; ctx.tailFails = 0; sendVisible(); renderActivity(); };
  ws.onclose = () => { if (ctx === cur && !ctx.closing) { if (!ws._opened) ctx.tailFails = (ctx.tailFails || 0) + 1; ctx.tailWs = null; renderActivity(); setTimeout(() => ctx === cur && !ctx.tailWs && openChat(), 2000); } };
}
// The server skips the "finished" push for a session whose page is in front right now.
function sendVisible() { const ws = cur?.tailWs; if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "vis", v: document.visibilityState === "visible" && !$("#chat").hidden })); }
function loadEarlier() {
  if (!cur?.tailWs) return;
  const first = $("#events").querySelector(".ev[data-id]");
  const btn = $("#earlierBtn"); if (btn) { btn.disabled = true; btn.textContent = t("loading…"); }
  cur.tailLimit = Math.min(6000, cur.tailLimit * 4);
  const ws = cur.tailWs; ws.onclose = null; ws.close(); cur.tailWs = null;
  openChat({ anchor: first?.dataset.id, keep: true });
}
function markSeen() { if (cur?.sessionId && cur.lastTs) store.set(`seen:${cur.sessionId}`, String(cur.lastTs)); }
$("#chat").addEventListener("scroll", () => { const c = $("#chat"); if (c.scrollHeight - c.scrollTop - c.clientHeight < 60) { $("#jump").hidden = true; markSeen(); } });
$("#jump").onclick = () => { const c = $("#chat"); c.scrollTop = c.scrollHeight; $("#jump").hidden = true; markSeen(); };

// ───────────── activity indicator (Chat view) ─────────────
// Shows that a message went out and the session is alive: an optimistic "sending" bubble, then a
// "Claude is working · <what> · <elapsed>" bubble with animated dots, or a warning if the live link dropped.
function addPending(text) {
  const ev = $("#events"); const d = document.createElement("div");
  d.className = "ev user pending"; d.dataset.text = text.replace(/\s+/g, " ").trim(); d.dataset.at = String(Date.now());
  d.innerHTML = `<span class="ptext"></span><span class="pstate">${t("sending…")}</span>`; d.querySelector(".ptext").textContent = text;
  ev.appendChild(d); const c = $("#chat"); c.scrollTop = c.scrollHeight;
}
const fmtSecs = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
function renderActivity() {
  const ev = $("#events"); if (!ev || !cur || $("#chat").hidden || !cur.sessionId) return;
  const j = cur.kind === "job" ? data.jobs.find((x) => x.id === cur.id) : null;
  // "Working" = the session says so, OR we sent a message and the session hasn't yet reported done/waiting
  // with an update newer than that send (the session list refreshes only every few seconds).
  // After a send, the transcript needs a moment to show the new turn: bridge that gap with awaitingSince,
  // and drop it once the server reports any phase newer than the send (working → the phase takes over).
  const phaseAfterSend = j && cur.awaitingSince && j.activityAt && j.activityAt > cur.awaitingSince;
  if (phaseAfterSend || (cur.awaitingSince && Date.now() - cur.awaitingSince > 10 * 60_000)) cur.awaitingSince = null;
  // Note: a resumed/attached session keeps state "done" while generating; only tempo turns "active".
  const menuShown = !$("#promptCard")?.hidden; // waiting for a choice → the option card says so, no bubble
  const working = !!(j && !menuShown && (j.phase ? j.phase === "working" : (!isBlocked(j) && (j.state === "working" || j.tempo === "active"))) || (j && cur.awaitingSince && !menuShown));
  const detailFresh = j && !(cur.awaitingSince && Date.parse(j.updatedAt) <= cur.awaitingSince) && Date.parse(j.updatedAt) >= (j.activityAt || 0) - 60_000; // don't show a stale status line
  const pending = [...ev.querySelectorAll(".ev.user.pending")];
  for (const p of pending) if (Date.now() - Number(p.dataset.at) > 30_000) p.querySelector(".pstate").textContent = t("not confirmed yet");
  let text = "", cls = "";
  if (cur.tailWs?.readyState !== 1) { text = t((cur.tailFails || 0) >= 3 ? "can't open this session's transcript (not found on that machine) — still trying; the Terminal view works" : "live connection lost — reconnecting…"); cls = "warn"; }
  else if (working) {
    if (!cur.workSince) cur.workSince = Date.now();
    text = `${t("Claude is working")}${j.detail && detailFresh ? " · " + j.detail : ""} · ${fmtSecs(Math.round((Date.now() - cur.workSince) / 1000))}`;
  } else if (pending.length) text = t("sent — waiting for Claude to pick it up…");
  if (!working && !pending.length) cur.workSince = null;
  let el = $("#activity");
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "activity"; el.innerHTML = `<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="atext" role="status"></span>`; }
  el.className = `ev activity ${cls}`; el.querySelector(".atext").textContent = text;
  if (ev.lastElementChild !== el) {
    const c = $("#chat"); const stick = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
    ev.appendChild(el); if (stick) c.scrollTop = c.scrollHeight;
  }
}
setInterval(renderActivity, 1000);

// ───────────── live sub-agents & background shells (Chat view) ─────────────
function markBgDone(taskId, status) {
  const bg = cur?.bgs.get(taskId);
  if (bg) {
    bg.done = true; bg.box.querySelector(".bghead").textContent = `✓ ${t("background")} · ${status || t("finished")}`;
    const st = bg.det.querySelector(".st"); st.textContent = `✓ ${t("background")} · ${status || t("finished")}`; st.className = "st"; pollBg(taskId);
  }
  const tool = cur?.agentIds.get(taskId); const sub = tool && cur.subs.get(tool);
  if (sub) { sub.done = true; pollSub(tool, true); }
}
async function pollSub(toolId, force) {
  const ctx = cur, sub = ctx?.subs.get(toolId); if (!sub || (sub.busy && !force)) return;
  sub.busy = true;
  try {
    const d = await api(`${nb(ctx.node)}/api/subagent?session=${encodeURIComponent(ctx.sessionId)}&tool=${encodeURIComponent(toolId)}`);
    if (ctx !== cur || !d.found) return;
    // Async sub-agents finish with a task notification (markBgDone); the file's own status is display-only —
    // right after launch it can briefly read "done" before the first step is written.
    if (d.status === "done" && !sub.async) sub.done = true;
    const evs = d.events || []; const lastTool = [...evs].reverse().find((x) => x.k === "tool");
    const st = sub.det.querySelector(".st");
    st.textContent = sub.done ? `✓ ${t("{n} steps", { n: d.steps })}` : `${t("running")} · ${t("{n} steps", { n: d.steps })}${lastTool ? " · " + toolName(lastTool.name) : ""}`;
    st.className = `st ${sub.done ? "" : "pending"}`;
    if (sub.det.open) {
      sub.feed.innerHTML = `<div class="subhead">${t("sub-agent")}${d.agentType ? " · " + esc(d.agentType) : ""}${d.model ? " · " + esc(d.model) : ""}${d.background ? ` · ${t("background")}` : ""}</div>` +
        evs.filter((x) => x.k === "tool" || x.k === "assistant").slice(-30).map((x) => x.k === "tool"
          ? `<div class="subrow"><span class="tn">${esc(toolName(x.name))}</span> ${sumHtml(x.summary)}</div>`
          : `<div class="subrow say">${esc(String(x.text).slice(0, 300))}</div>`).join("");
    }
  } catch {} finally { sub.busy = false; }
}
async function pollBg(taskId) {
  const ctx = cur, bg = ctx?.bgs.get(taskId); if (!bg || bg.busy) return;
  bg.busy = true;
  try {
    const d = await api(`${nb(ctx.node)}/api/bgout?session=${encodeURIComponent(ctx.sessionId)}&task=${encodeURIComponent(taskId)}`);
    if (ctx !== cur) return;
    const out = bg.box.querySelector(".bgout");
    if (!d.exists) { out.textContent = bg.done ? t("(output file no longer exists)") : t("(no output yet)"); return; }
    const lines = String(d.text || "").split("\n"); out.textContent = lines.slice(-30).join("\n") || t("(empty)");
    if (!bg.done) { const last = lines.filter((l) => l.trim()).pop() || ""; const st = bg.det.querySelector(".st"); st.textContent = `${t("background")} · ${t("running")}${last ? " · " + last.slice(0, 40) : ""}`; }
    if (!bg.done) bg.box.querySelector(".bghead").textContent = `⏳ ${t("background")} · ${t("running")} · ${ago(d.mtime) === "now" ? t("updated just now") : t("updated {t} ago", { t: ago(d.mtime) })}`;
  } catch {} finally { bg.busy = false; }
}
setInterval(() => {
  if (!cur?.sessionId || $("#chat").hidden || !cur.subs) return;
  [...cur.subs.entries()].filter(([, x]) => !x.done).slice(-6).forEach(([id]) => pollSub(id));
  [...cur.bgs.entries()].filter(([, x]) => !x.done).slice(-6).forEach(([id]) => pollBg(id));
}, 2000);

function addEvent(e) {
  const ev = $("#events");
  const ts = Date.parse(e.ts);
  if (ts && ts - cur.lastTs > 20 * 60_000) { const d = document.createElement("div"); d.className = "ts-label"; d.textContent = new Date(ts).toLocaleString(); ev.appendChild(d); }
  if (ts) cur.lastTs = ts;
  if (e.k === "bgdone") { markBgDone(e.taskId, e.status); return; }
  if (e.k === "result") {
    const det = cur.toolEls.get(e.toolId); if (!det) return;
    { const st = det.querySelector(".st"); st.textContent = e.isError ? t("error") : "✓"; st.className = `st ${e.isError ? "err" : ""}`; } // generic first; special states below override it
    const sub = cur.subs.get(e.toolId);
    if (sub) { // sub-agent: async ones keep running until their task notification; sync ones are done now
      if (e.agentId) cur.agentIds.set(e.agentId, e.toolId);
      if (!/^Async agent launched/i.test(e.text || "")) sub.done = true;
      else { sub.async = true; const st = det.querySelector(".st"); st.textContent = t("sub-agent running"); st.className = "st pending"; } // launched in the background: done only when its task notification arrives
    }
    if (e.bg) { // background shell: a live output box, polled until its task notification arrives
      const box = document.createElement("div"); box.className = "bgbox";
      box.innerHTML = `<div class="bghead">⏳ ${t("background")} · ${t("running")}</div><pre class="bgout">…</pre>`;
      det.appendChild(box); cur.bgs.set(e.bg, { det, box, done: false });
      const st = det.querySelector(".st"); st.textContent = `${t("background")} · ${t("running")}`; st.className = "st pending";
      if (Date.now() - Date.parse(e.ts) < 10 * 60_000) det.open = true; // just started → show the live output
    }
    const pre = document.createElement("pre"); pre.textContent = e.text || t("(no output)"); det.appendChild(pre);
    return;
  }
  if (e.k === "user") { // the transcript confirmed it → drop the matching optimistic bubble
    const norm = (x) => String(x || "").replace(/\s+/g, " ").trim();
    for (const p of ev.querySelectorAll(".ev.user.pending")) if (p.dataset.text === norm(e.text)) { p.remove(); break; }
  }
  if (cur.initialLoad && !cur.newDiv && cur.seenAt && ts > cur.seenAt && ev.querySelector(".ev")) {
    const at = new Date(cur.seenAt), today = at.toDateString() === new Date().toDateString();
    const nd = document.createElement("div"); nd.className = "new-div";
    nd.textContent = t("new since {t}", { t: today ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : at.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
    ev.appendChild(nd); cur.newDiv = nd;
  }
  const div = document.createElement("div"); div.className = `ev ${e.k}`; if (e.id) div.dataset.id = e.id;
  if (e.k === "user" || e.k === "system") div.textContent = e.text;
  else if (e.k === "assistant") div.innerHTML = md(e.text);
  else if (e.k === "tool") {
    const det = document.createElement("details"); det.className = "tool";
    det.innerHTML = `<summary><span class="tn" title="${esc(e.name)}">${esc(toolName(e.name))}</span>${sumHtml(e.summary)}<span class="st pending">…</span></summary>`;
    const pre = document.createElement("pre"); pre.textContent = e.input; det.appendChild(pre);
    cur.toolEls.set(e.toolId, det); div.appendChild(det);
    if (e.name === "Agent" || e.name === "Task") {
      const feed = document.createElement("div"); feed.className = "subfeed"; feed.textContent = "…"; det.appendChild(feed);
      cur.subs.set(e.toolId, { det, feed, done: false, steps: 0 });
      det.addEventListener("toggle", () => det.open && pollSub(e.toolId, true));
    }
  }
  ev.appendChild(div);
}

// ───────────── changes (files this session edited, with diffs) ─────────────
async function loadChanges() {
  const el = $("#changes"); const ctx = cur;
  if (!el.dataset.loaded) el.innerHTML = `<div class="empty">${t("loading…")}</div>`;
  let d; try { d = await api(`${nb(cur.node)}/api/changes?session=${encodeURIComponent(cur.sessionId)}`); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (ctx !== cur) return;
  const open = new Set([...el.querySelectorAll("details.file[open]")].map((x) => x.dataset.p));
  el.dataset.loaded = "1";
  const totA = d.files.reduce((s, f) => s + f.add, 0), totD = d.files.reduce((s, f) => s + f.del, 0);
  el.innerHTML = `<div class="chg-head"><span>${t("{n} file(s) edited by this session", { n: d.files.length })}</span><span class="add">+${totA}</span><span class="del">−${totD}</span><span class="spacer"></span><span>${t("diff vs HEAD, current disk state")}</span><button id="chgRefresh">⟳</button></div>` +
    (d.files.length ? "" : `<div class="empty">${t("This session hasn't edited any files.")}</div>`) +
    (() => {
      const fileHtml = (f) => `<details class="file" data-p="${esc(f.path)}" ${open.has(f.path) ? "open" : ""}><summary>
      <span class="stat ${esc(f.status)}">${esc(f.status)}</span><span class="p" title="${esc(f.path)}">${pathHtml(f.rel)}</span>
      ${f.repo ? `<span class="stat">${esc(f.repo)}</span>` : ""}<span class="add">+${f.add}</span><span class="del">−${f.del}</span><span class="stat">${ago(f.last)}</span></summary>
      ${f.diff ? diffHtml(f.diff) : `<div class="empty" style="padding:4px 10px 8px">${f.status === "clean" ? t("no uncommitted changes (already committed or reverted)") : t("no diff available")}</div>`}</details>`;
      const chg = d.files.filter((f) => f.status !== "clean"), same = d.files.filter((f) => f.status === "clean");
      return chg.map(fileHtml).join("") + (same.length ? `<details class="unchanged" ${el.querySelector("details.unchanged[open]") ? "open" : ""}><summary>${t("{n} unchanged (already committed or reverted)", { n: same.length })}</summary>${same.map(fileHtml).join("")}</details>` : "");
    })();
  $("#chgRefresh").onclick = loadChanges;
}
function diffHtml(diff) {
  return `<div class="diff">${diff.split("\n").map((l) => {
    const c = l.startsWith("@@") ? "h" : l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? "m" : l.startsWith("+") ? "a" : l.startsWith("-") ? "r" : "";
    return `<div class="${c}">${esc(l) || " "}</div>`;
  }).join("")}</div>`;
}

// ───────────── terminal (shared PTY over WebSocket) ─────────────
function openTerm() {
  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: wide() ? 13 : 11, cursorBlink: true,
    scrollback: 10000, allowProposedApi: true, macOptionIsMeta: true,
    theme: { background: "#0b0d11", foreground: "#e6e8ee", cursor: "#d97757", selectionBackground: "#33415580" },
  });
  const fit = new FitAddon(); term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
  term.open($("#xterm"));
  // Let the page's own shortcuts through even when the terminal has focus.
  term.attachCustomKeyEventHandler((e) => !(e.type === "keydown" && ((e.metaKey && e.key === "k") || (e.altKey && /^Digit[1-4]$/.test(e.code)))));
  cur.term = term; cur.fit = fit;
  term.onData((d) => sendPty({ t: "in", d }));
  const ro = new ResizeObserver(() => fitTerm()); ro.observe($("#term")); cur.ro = ro;
  connectPty(cur);
  setTimeout(() => fitTerm(true), 50);
  if (wide() && cur.tab === "term") term.focus();
}
function connectPty(ctx) {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${nb(ctx.node)}/ws/pty?target=${encodeURIComponent(ctx.target)}`);
  ws.binaryType = "arraybuffer"; ctx.ptyWs = ws;
  ws.onopen = () => { ctx.retry = 0; ctx.term.reset(); fitTerm(true); };
  ws.onmessage = (m) => {
    if (ctx.closing || ctx !== cur) return; // late bytes after a view switch: the terminal is already disposed
    if (typeof m.data === "string") { const d = JSON.parse(m.data); if (d.t === "blocked") { if (Date.now() - (ctx.blockedAt || 0) > 6000) { ctx.blockedAt = Date.now(); toast(t("← does nothing here: Claude's session overview is the Quarterdeck home page"), 3500); } return; } if (d.t === "exit") { ctx.term.write(`\r\n\x1b[33m${t("[process exited — reopen the session to restart it]")}\x1b[0m\r\n`); ctx.exited = true; } return; }
    ctx.term.write(new Uint8Array(m.data));
  };
  ws.onclose = () => {
    if (ctx !== cur || ctx.closing || ctx.exited) return;
    const wait = Math.min(8000, 500 * 2 ** (ctx.retry = (ctx.retry || 0) + 1));
    ctx.term.write(`\r\n\x1b[90m${t("[disconnected — reconnecting in {s}s]", { s: wait / 1000 })}\x1b[0m`);
    setTimeout(() => ctx === cur && connectPty(ctx), wait);
  };
}
function sendPty(m) { const ws = cur?.ptyWs; if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function fitTerm(force) {
  if (!cur?.term || $("#term").hidden) return;
  try { cur.fit.fit(); } catch {}
  const { cols, rows } = cur.term;
  if (force || cols !== cur.cols || rows !== cur.rows) { cur.cols = cols; cur.rows = rows; sendPty({ t: "resize", cols, rows }); }
}
// Whichever device you touch last owns the PTY size (tmux "latest client").
addEventListener("focus", () => fitTerm(true));
document.addEventListener("visibilitychange", () => { sendVisible(); if (document.visibilityState === "visible") { fitTerm(true); poll(); } });

// ───────────── key bar (touch keyboards lack Esc / Tab / arrows / ctrl) ─────────────
const KEYS = [
  ["Esc", "\x1b"], ["⇧Tab", "\x1b[Z"], ["Tab", "\t"], ["↑", "\x1b[A"], ["↓", "\x1b[B"], ["←", "\x1b[D"], ["→", "\x1b[C"],
  ["⏎", "\r"], ["1", "1"], ["2", "2"], ["3", "3"], ["^C", "\x03"], ["^D", "\x04"], ["^R", "\x12"], ["/", "/"], ["^B", "\x02"],
];
function renderKeys() {
  const k = $("#keys");
  if (!cur.target) { k.innerHTML = ""; return; }
  k.innerHTML = KEYS.map(([l], i) => `<button data-k="${i}">${esc(l)}</button>`).join("") + `<button data-redraw>${t("⟳ redraw")}</button>`;
  k.querySelectorAll("[data-k]").forEach((b) => (b.onclick = async (ev) => {
    ev.preventDefault(); const seq = KEYS[+b.dataset.k][1];
    if (cur.ptyWs?.readyState === 1) sendPty({ t: "in", d: seq });
    else await api(nb(cur.node) + "/api/keys", { target: cur.target, data: seq }).catch((e) => toast(e.message));
    if (wide()) cur.term?.focus();
  }));
  k.querySelector("[data-redraw]").onclick = () => sendPty({ t: "redraw" });
}

// ───────────── composer ─────────────
const input = $("#input");
const syncSend = () => { $("#send").disabled = !input.value.trim(); };
input.addEventListener("input", syncSend);
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, innerHeight * 0.4) + "px"; });
input.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return; // IME candidate selection
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (wide() && !e.shiftKey))) { e.preventDefault(); $("#composer").requestSubmit(); }
});
$("#composer").onsubmit = async (e) => {
  e.preventDefault();
  const text = input.value; if (!text.trim()) return; // empty Send must not press Enter in the session — ⏎ on the key bar does that
  const btn = $("#send"); btn.disabled = true;
  try {
    if (cur.kind === "transcript") await resume(text);
    else if (cur.ptyWs?.readyState === 1) { sendPty({ t: "in", d: `\x1b[200~${text}\x1b[201~` }); setTimeout(() => sendPty({ t: "in", d: "\r" }), 150); }
    else await api(nb(cur.node) + "/api/send", { target: cur.target, text });
    input.value = ""; input.style.height = "auto"; syncSend();
    if (cur.kind === "job" && !$("#chat").hidden && text.trim()) { addPending(text); cur.workSince = cur.awaitingSince = Date.now(); renderActivity(); }
    else toast(t("sent"));
  } catch (err) { toast(err.message); } finally { syncSend(); }
};
async function resume(prompt) {
  if (!confirm(t("Resume this conversation as a background session? (If it is still open in a terminal, Claude starts a copy.)"))) return;
  const node = cur.node;
  const r = await api(nb(node) + "/api/resume", { sessionId: cur.id, prompt, profile: $("#resumeProfile")?.value || "default" });
  toast(r.out.split("\n")[0] || t("resumed"));
  await poll();
  if (r.id) location.hash = hrefOf("job", r.id, node);
}

// ───────────── menus in Chat view (AskUserQuestion, permission prompts) ─────────────
// The server mirrors the TUI screen; when it shows a numbered menu, render it as buttons.
async function pollPrompt() {
  const ctx = cur; if (!ctx?.target || ctx.promptBusy) return;
  ctx.promptBusy = true;
  try {
    const d = await api(nb(ctx.node) + "/api/prompt", { target: ctx.target });
    if (ctx === cur) renderPrompt(d.menu);
  } catch {} finally { ctx.promptBusy = false; }
}
function renderPrompt(m) {
  const el = $("#promptCard");
  const sig = m ? JSON.stringify(m) : "";
  if (sig === cur.promptSig) return; cur.promptSig = sig;
  if (!m) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  // Tab bar ("← ☒ Color ☐ Toppings ✔ Submit →") → readable steps: answered ones get a check mark.
  const steps = m.tabs ? m.tabs.replace(/[←→]/g, "").trim().split(/\s{2,}/).filter(Boolean).map((t) => {
    const done = /^[☒☑]/.test(t), label = t.replace(/^[☐☑☒✔✓]\s*/, "");
    return `<span class="pc-step ${done ? "done" : ""}">${done ? "✓ " : ""}${esc(label)}</span>`;
  }).join('<span class="pc-sep">›</span>') : "";
  const review = m.options.some((o) => /^Submit answers/i.test(o.label));
  const hint = t(review ? "Check the answers, then tap “Submit answers”" : m.multiSelect ? "Tick as many as you like, then tap Next ›" : m.hasTabs ? "Pick one — it moves to the next question" : "");
  // Back/Next sit in the header so they stay visible on a phone without scrolling the card.
  const nav = m.hasTabs || m.multiSelect ? `<span class="pc-nav"><button data-k="back">${t("‹ Back")}</button>${review ? "" : `<button data-k="next" class="primary">${t("Next ›")}</button>`}</span>` : "";
  el.innerHTML = `<div class="pc-head"><span class="chip blocked">${t("waiting for your choice")}</span>${steps ? `<span class="pc-tabs">${steps}</span>` : ""}${nav}</div>
    ${m.title ? `<div class="pc-title">${esc(m.title)}</div>` : ""}
    ${hint ? `<div class="pc-hint">${esc(hint)}</div>` : ""}
    <div class="pc-opts">${m.options.map((o) => `<button class="pc-opt ${o.selected ? "sel" : ""} ${o.checked !== null ? "cb" : ""} ${o.checked ? "on" : ""}" data-n="${o.n}">${o.checked !== null ? `<span class="box">${o.checked ? "☑" : "☐"}</span>` : `<b>${o.n}.</b>`} ${esc(o.label)}${o.desc ? `<small>${esc(o.desc)}</small>` : ""}</button>`).join("")}</div>
    <div class="pc-foot"><button data-k="up">↑</button><button data-k="down">↓</button><button data-k="enter">${t("⏎ Enter")}</button><button data-k="esc">Esc</button></div>`;
  const send = async (data) => {
    try {
      if (cur.ptyWs?.readyState === 1) sendPty({ t: "in", d: data }); else await api(nb(cur.node) + "/api/keys", { target: cur.target, data });
      setTimeout(pollPrompt, 400); setTimeout(pollPrompt, 1200);
    } catch (e) { toast(e.message); }
  };
  el.querySelectorAll(".pc-opt").forEach((b) => (b.onclick = () => { b.classList.add("sending"); send(b.dataset.n); }));
  // Next/Back = Tab / Shift-Tab: moves between questions and to the "Review your answers" page.
  const K = { up: "\x1b[A", down: "\x1b[B", enter: "\r", esc: "\x1b", next: "\t", back: "\x1b[Z" };
  el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => send(K[b.dataset.k])));
}

function teardown() {
  if (!cur) return;
  cur.closing = true; clearInterval(cur.promptTimer); $("#promptCard").hidden = true; $("#promptCard").innerHTML = "";
  cur.tailWs?.close(); cur.ptyWs?.close(); cur.ro?.disconnect(); cur.term?.dispose();
  cur = null; $("#events").innerHTML = ""; $("#xterm").innerHTML = ""; $("#changes").innerHTML = ""; delete $("#changes").dataset.loaded; $("#jump").hidden = true;
}

// ───────────── new session ─────────────
function openNew() {
  const hosts = [{ id: "", label: hostLabel("") }, ...(fleet.nodes || []).filter((n) => n.online).map((n) => ({ id: n.id, label: n.label }))];
  const sel = $("#newHost"), keep = sel.value;
  sel.innerHTML = hosts.map((h) => `<option value="${esc(h.id)}">${esc(h.label)}</option>`).join("");
  sel.value = hosts.some((h) => h.id === keep) ? keep : hosts.some((h) => h.id === cur?.node) ? cur.node : "";
  $("#newHostRow").hidden = hosts.length < 2;
  fillNewHost(sel.value !== keep);
  $("#newDlg").showModal(); $("#newPrompt").focus();
}
// Folders and accounts belong to the chosen machine.
function fillNewHost(resetCwd) {
  const node = $("#newHost").value; const cwds = (node ? nodeOf(node)?.data?.cwds : data.cwds) || [];
  $("#cwdList").innerHTML = cwds.map((c) => `<option value="${esc(c)}">`).join("");
  if (resetCwd) $("#newCwd").value = "";
  $("#newProfileRow").hidden = !multiAccount(node); $("#newProfile").innerHTML = acctOptions($("#newProfile").value || "default", node);
  loadProjects();
}
// Project picker: the folder decides which CLAUDE.md layers and auto-memory the session loads, so show them.
let newProj = { list: [] }, memTimer = null;
async function loadProjects() {
  const node = $("#newHost").value, prof = $("#newProfile").value || "default", list = $("#newProjList");
  list.innerHTML = `<div class="empty">${t("loading…")}</div>`;
  try { newProj = { list: (await api(`${nb(node)}/api/projects?profile=${encodeURIComponent(prof)}`)).projects || [] }; }
  catch (e) { newProj = { list: [] }; list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!$("#newCwd").value && newProj.list[0]) $("#newCwd").value = newProj.list[0].path;
  renderProjects(); loadMemory();
}
function renderProjects() {
  const q = $("#newProjFilter").value.trim().toLowerCase(), cwd = $("#newCwd").value.trim();
  const rows = newProj.list.filter((x) => !q || x.path.toLowerCase().includes(q));
  $("#newProjList").innerHTML = rows.map((x) => `<button type="button" class="pj ${x.path === cwd ? "on" : ""}" data-p="${esc(x.path)}"><b>${esc(x.name)}</b><span class="pjp">${esc(short(x.path))}</span>${x.src === "recent" ? `<span class="pb rc">${t("recent")}</span>` : ""}${x.claudeMd ? `<span class="pb md" title="${t("has its own CLAUDE.md")}">CLAUDE.md</span>` : ""}${x.git ? `<span class="pb">git</span>` : ""}${x.trust !== "yes" ? `<span class="pb warn" title="${x.trust === "parent" ? t("only a folder above it is trusted; background sessions need this folder itself") : t("not trusted yet")}">${t("untrusted")}</span>` : ""}</button>`).join("")
    || `<div class="empty">${t("no match: type the folder below")}</div>`;
  $("#newProjList").querySelectorAll(".pj").forEach((b) => (b.onclick = () => { $("#newCwd").value = b.dataset.p; renderProjects(); loadMemory(); }));
}
async function loadMemory() {
  const node = $("#newHost").value, prof = $("#newProfile").value || "default", dir = $("#newCwd").value.trim().replace(/\/+$/, ""), el = $("#newMem");
  if (!dir) { el.innerHTML = ""; return; }
  try {
    const m = await api(`${nb(node)}/api/memory?profile=${encodeURIComponent(prof)}&dir=${encodeURIComponent(dir)}`);
    if (dir !== $("#newCwd").value.trim().replace(/\/+$/, "")) return;
    const kb = (b) => (b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
    el.innerHTML = `<div class="mm-h">${t("Memory this session loads, top to bottom")}</div>` +
      m.layers.map((l) => `<div class="ml"><span class="mlk">${esc(t(l.label))}</span><span class="mlp">${pathHtml(l.path)}</span><span class="mls">${kb(l.bytes)}</span>${l.note ? `<div class="mln">${esc(l.note)}</div>` : ""}</div>`).join("") +
      (m.layers.length ? "" : `<div class="mln">${t("no CLAUDE.md or memory files for this folder")}</div>`) +
      (m.trust !== "yes" ? `<div class="mtrust">${t("⚠ Not trusted yet: a background session can't start here until Claude Code trusts this folder itself")}${m.trust === "parent" ? t(" (a folder above it is trusted, but that doesn't count for background sessions)") : ""}. <button type="button" id="trustBtn">${t("Open Claude here to trust it")}</button></div>` : "");
    if ($("#trustBtn")) $("#trustBtn").onclick = () => { $("#newDlg").close("cancel"); location.hash = `#/here/${encodeURIComponent(prof + ":" + dir)}${node ? "/" + node : ""}`; };
  } catch (e) { el.innerHTML = `<div class="mtrust">${esc(e.message)}</div>`; }
}
$("#newProfile").onchange = loadProjects;
$("#newProjFilter").addEventListener("input", renderProjects);
$("#newCwd").addEventListener("input", () => { renderProjects(); clearTimeout(memTimer); memTimer = setTimeout(loadMemory, 400); });
$("#newHost").onchange = () => fillNewHost(true);
$("#newBtn").onclick = openNew;
$("#newPrompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("#newDlg").close("ok"); } });
$("#newDlg").addEventListener("close", async () => {
  if ($("#newDlg").returnValue !== "ok") return;
  try {
    const node = $("#newHost").value;
    const r = await api(nb(node) + "/api/new", { cwd: $("#newCwd").value, name: $("#newName").value, prompt: $("#newPrompt").value, permissionMode: $("#newMode").value, profile: $("#newProfile").value || "default" });
    toast(r.out.split("\n")[0] || t("started")); $("#newPrompt").value = ""; $("#newName").value = "";
    await poll(); if (r.id) location.hash = hrefOf("job", r.id, node);
  } catch (e) { toast(e.message, 5000); }
});

// ───────────── ⌘K quick switcher ─────────────
let findSel = 0, findItems = [];
function openFind() { $("#findInput").value = ""; renderFind(); $("#findDlg").showModal(); $("#findInput").focus(); }
function renderFind() {
  findItems = allItems().filter((i) => match(i, $("#findInput").value.trim())).slice(0, 40);
  findSel = Math.min(findSel, Math.max(0, findItems.length - 1));
  $("#findList").innerHTML = findItems.map((it, i) => itemHtml(it, i === findSel ? "sel" : "")).join("") || `<div class="empty" style="padding:8px">${t("no match")}</div>`;
  $("#findList .sel")?.scrollIntoView({ block: "nearest" });
}
$("#findBtn").onclick = openFind;
$("#findInput").addEventListener("input", () => { findSel = 0; renderFind(); });
$("#findInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); findSel = Math.min(findSel + 1, findItems.length - 1); renderFind(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); findSel = Math.max(findSel - 1, 0); renderFind(); }
  else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); const it = findItems[findSel]; if (it) { $("#findDlg").close(); location.hash = it.href; } }
});
$("#findList").addEventListener("click", (e) => { if (e.target.closest("a")) $("#findDlg").close(); });
$("#findDlg").addEventListener("click", (e) => { if (e.target === $("#findDlg")) $("#findDlg").close(); });

// ───────────── global shortcuts (MacBook / iPad keyboard) ─────────────
addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openFind(); return; }
  if (e.altKey && /^Digit[1-4]$/.test(e.code) && cur) { e.preventDefault(); setTab(["chat", "term", "split", "changes"][+e.code.slice(5) - 1], true); return; }
  if (e.altKey && e.code === "KeyN") { e.preventDefault(); openNew(); return; }
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.closest?.(".xterm");
  if (!typing && cur && e.key === "/" ) { e.preventDefault(); input.focus(); }
  if (!typing && !cur && e.key === "/") { e.preventDefault(); openFind(); }
});

if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").then(refreshBell).catch(() => {});
else refreshBell();
ensurePush();
await Promise.all([initLang(), loadPluginUi()]); // plug-ins before the first route, so a page like #/cleanse is known
if (loadSnapshot()) { go(); await poll(); } // last known lists first, fresh ones as soon as they arrive
else { await poll(); go(); }

setInterval(poll, 4000);
