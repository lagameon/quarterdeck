// quarterdeck — remote control for Claude Code over Tailscale.
// One Bun process: HTTP API + static UI + WebSocket PTY hub + transcript tail.
import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, readFileSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from "node:fs";
import webpush from "web-push";
import { Terminal as HeadlessTerm } from "@xterm/headless";
import { parseMenu } from "./menu";
import { join, basename } from "node:path";
import { homedir, hostname as osHostname } from "node:os";
import type { ServerWebSocket } from "bun";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const JOBS_DIR = join(CLAUDE_DIR, "jobs");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

// ───────────────────────────── accounts ("profiles") ─────────────────────────────
// Each profile is a Claude Code config dir with its OWN login and background sessions, so several accounts
// stay signed in side by side and nothing ever copies credentials between them (no refresh-token rotation
// trouble). The default dir (~/.claude) is used WITHOUT CLAUDE_CONFIG_DIR — setting it would move
// ~/.claude.json into the dir. Extra profiles come from config.json: "profiles": [{"id": "work", "dir": "~/.claude-work"}].
type Profile = { id: string; dir: string; isDefault: boolean };
const PROFILES: Profile[] = (() => {
  let list: any[] = [];
  try { list = JSON.parse(readFileSync(join(process.env.QUARTERDECK_CONFIG_DIR || join(HOME, ".config/quarterdeck"), "config.json"), "utf8")).profiles || []; } catch {}
  const norm = (d: string) => d.replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, "");
  const out: Profile[] = [{ id: "default", dir: CLAUDE_DIR, isDefault: true }];
  for (const x of list) {
    const dir = norm(String(x?.dir || "")); if (!dir || dir === CLAUDE_DIR || !existsSync(dir)) continue;
    const id = String(x?.id || basename(dir)).replace(/[^\w.-]/g, "").slice(0, 32);
    if (id && id !== "default" && !out.some((p) => p.id === id || p.dir === dir)) out.push({ id, dir, isDefault: false });
  }
  return out;
})();
const profileById = (id?: unknown): Profile | null => PROFILES.find((p) => p.id === (id ? String(id) : "default")) || null;
const profileEnv = (p: Profile | null): Record<string, string> => (p && !p.isDefault ? { CLAUDE_CONFIG_DIR: p.dir } : {});
function profileOfJob(id: string): Profile | null {
  for (const p of PROFILES) if (existsSync(join(p.dir, "jobs", id, "state.json"))) return p;
  return null;
}
// Transcript roots, de-duplicated (a profile may share ~/.claude/projects through a symlink).
const PROJECT_ROOTS: string[] = (() => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of PROFILES) { const d = join(p.dir, "projects"); let r = d; try { r = realpathSync(d); } catch { continue; } if (!seen.has(r)) { seen.add(r); out.push(d); } }
  return out;
})();
let accountsCache: { at: number; list: any[] } = { at: 0, list: [] };
function accountsStatus() {
  if (Date.now() - accountsCache.at < 60_000) return accountsCache.list;
  const list = PROFILES.map((p) => {
    const r = run([CLAUDE_BIN, "auth", "status"], { timeoutMs: 15000, env: profileEnv(p) });
    let d: any = {}; try { d = JSON.parse(r.out); } catch {}
    return { id: p.id, dir: p.dir.replace(HOME, "~"), isDefault: p.isDefault, loggedIn: !!d.loggedIn, email: d.email || null, planTier: d.planTier || null, loginExpiresAt: d.loginExpiresAt || null };
  });
  accountsCache = { at: Date.now(), list };
  return list;
}
const PUBLIC = join(import.meta.dir, "public");
const NM = join(import.meta.dir, "node_modules");

// Configuration: ~/.config/quarterdeck/config.json (env vars override). See config.example.json.
const CONF_DIR = process.env.QUARTERDECK_CONFIG_DIR || join(HOME, ".config/quarterdeck");
const CONFIG: Record<string, any> = (() => { try { return JSON.parse(readFileSync(join(CONF_DIR, "config.json"), "utf8")); } catch { return {}; } })();
const PORT = Number(process.env.QUARTERDECK_PORT || CONFIG.port || 7690);
// The ONE Tailscale login allowed in. Required — quarterdeck gives a shell, so there is no default.
const OWNER: string = process.env.QUARTERDECK_OWNER || CONFIG.owner || "";
if (!OWNER) {
  console.error(`[quarterdeck] refusing to start: set "owner" (your Tailscale login, e.g. you@example.com) in ${join(CONF_DIR, "config.json")} or QUARTERDECK_OWNER.`);
  process.exit(1);
}
const TAILSCALE = process.env.QUARTERDECK_TAILSCALE || CONFIG.tailscale || (process.platform === "darwin" ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale" : "tailscale");
const CLAUDE_BIN = process.env.QUARTERDECK_CLAUDE || CONFIG.claude || join(HOME, ".local/bin/claude");
const BIND_TS = (process.env.QUARTERDECK_BIND_TS ?? (CONFIG.bindTailscale === false ? "0" : "1")) !== "0"; // also listen on the Tailscale IP
const DATA_DIR = process.env.QUARTERDECK_DATA_DIR || CONFIG.dataDir || join(HOME, ".local/share/quarterdeck");

// ───────────────────────────── helpers ─────────────────────────────
function run(cmd: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { cwd: opts.cwd, env: { ...childEnv(), ...(opts.env || {}) }, stdout: "pipe", stderr: "pipe", timeout: opts.timeoutMs ?? 15000 });
  return { code: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() };
}
function childEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.TMUX; delete env.TMUX_PANE; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  env.TERM = "xterm-256color"; env.COLORTERM = "truecolor"; env.LANG = env.LANG || "en_US.UTF-8";
  env.PATH = [join(HOME, ".local/bin"), join(HOME, ".bun/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", env.PATH || ""].join(":");
  return env;
}
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

function readHead(path: string, bytes: number): string {
  const fd = openSync(path, "r"); try { const b = Buffer.alloc(bytes); const n = readSync(fd, b, 0, bytes, 0); return b.subarray(0, n).toString("utf8"); } finally { closeSync(fd); }
}
function readTail(path: string, bytes: number): string {
  const size = statSync(path).size; const start = Math.max(0, size - bytes);
  const fd = openSync(path, "r"); try { const b = Buffer.alloc(size - start); readSync(fd, b, 0, b.length, start); return b.toString("utf8"); } finally { closeSync(fd); }
}

// ───────────────────────────── auth ─────────────────────────────
// Loopback = local user (or `tailscale serve`, which forwards identity headers).
// Tailnet peers are checked with `tailscale whois`: must be OWNER's own, untagged device.
const whoisCache = new Map<string, { ok: boolean; who: string; at: number }>();
function authorize(req: Request, ip: string | undefined): { ok: boolean; who: string } {
  if (!ip) return { ok: false, who: "?" };
  const addr = ip.replace(/^::ffff:/, "");
  if (addr === "127.0.0.1" || addr === "::1") {
    // Via `tailscale serve`: it always adds X-Forwarded-For + Tailscale-Headers-Info, but sends
    // Tailscale-User-Login only for user-owned nodes — tagged nodes arrive WITHOUT it, so a missing
    // login on a proxied request must be a denial, never "local".
    const fwd = req.headers.get("x-forwarded-for");
    const proxied = fwd !== null || req.headers.has("tailscale-headers-info") || req.headers.has("tailscale-user-login");
    if (!proxied) return { ok: true, who: "local" };
    const login = req.headers.get("tailscale-user-login");
    if (login !== OWNER) { console.warn(`[auth] denied proxied request (login=${login ?? "none"}, from=${fwd})`); return { ok: false, who: login || "tagged/unknown" }; }
    const peer = (fwd || "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (!peer) return { ok: false, who: login };
    if (peer === "127.0.0.1" || peer === "::1") return { ok: true, who: `${login}@local` };
    return whoisCheck(peer);
  }
  return whoisCheck(addr);
}
function whoisCheck(addr: string): { ok: boolean; who: string } {
  const c = whoisCache.get(addr);
  if (c && Date.now() - c.at < 5 * 60_000) return c;
  let res = { ok: false, who: addr, at: Date.now() };
  const r = run([TAILSCALE, "whois", "--json", addr], { timeoutMs: 5000 });
  if (r.code === 0) {
    try {
      const d = JSON.parse(r.out);
      const tags = d?.Node?.Tags || [];
      const login = d?.UserProfile?.LoginName || "";
      res = { ok: login === OWNER && tags.length === 0, who: `${login}@${d?.Node?.ComputedName || d?.Node?.Name || addr}`, at: Date.now() };
    } catch {}
  }
  // Cache only real answers: if `tailscale whois` itself failed (CLI hiccup, daemon restarting), deny this
  // request but retry on the next one instead of locking the device out for the full cache period.
  if (r.code === 0) whoisCache.set(addr, res);
  if (!res.ok) console.warn(`[auth] denied ${addr} (${res.who})${r.code === 0 ? "" : ` — whois failed (exit ${r.code}): ${r.err.trim().slice(0, 120)}`}`);
  return res;
}
// Block cross-site requests (a page on another origin poking the API / WS from an allowed device).
// DNS-rebinding guard: a page on another site could re-point its own hostname at 127.0.0.1 and then
// talk to quarterdeck "same-origin". So the Host header must be one of quarterdeck's own names.
const ALLOWED_HOSTS = new Set<string>(["localhost", "127.0.0.1", "[::1]", ...((CONFIG.allowedHosts || []) as string[])]);
function learnTailscaleNames() {
  const r = run([TAILSCALE, "status", "--json"], { timeoutMs: 5000 });
  try {
    const d = JSON.parse(r.out); const self = d?.Self || {};
    for (const ip of self.TailscaleIPs || []) ALLOWED_HOSTS.add(ip.includes(":") ? `[${ip}]` : ip);
    const dns = String(self.DNSName || "").replace(/\.$/, ""); if (dns) { ALLOWED_HOSTS.add(dns); ALLOWED_HOSTS.add(dns.split(".")[0]); }
    if (self.HostName) ALLOWED_HOSTS.add(String(self.HostName).toLowerCase());
  } catch {}
}
learnTailscaleNames();
function hostAllowed(req: Request): boolean {
  const h = (req.headers.get("host") || "").toLowerCase();
  const name = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
  return ALLOWED_HOSTS.has(name);
}
// Fetch metadata (sent by all modern browsers, incl. on no-cors GETs where Origin is absent):
// API and WebSocket calls must come from quarterdeck's own page; any cross-site embedding is refused.
function fetchSiteOk(req: Request, path: string): boolean {
  const site = req.headers.get("sec-fetch-site"); const dest = req.headers.get("sec-fetch-dest") || "";
  if (path.startsWith("/api/") || path.startsWith("/ws/")) return !site || site === "same-origin" || site === "none";
  if (["iframe", "frame", "embed", "object"].includes(dest)) return site === "same-origin" || !site;
  return true; // top-level navigation from a link (e.g. a notification) is fine
}
function sameOrigin(req: Request): boolean {
  const o = req.headers.get("origin");
  if (!o) return true;
  try { return new URL(o).host === req.headers.get("host"); } catch { return false; }
}

// ───────────────────────────── session index ─────────────────────────────
type Job = {
  kind: "job"; id: string; sessionId: string; name: string; state: string; tempo: string;
  detail: string; needs: unknown; output: unknown; intent: string; cwd: string;
  createdAt: string; updatedAt: string; pid?: number; profile: string;
  phase?: "working" | "idle" | "waiting"; activityAt?: number;
};

// state.json lags in both directions (seen: "working" 80 s after the turn ended; "blocked" while Claude was
// already answering the user's reply). The transcript is the truth: its last main-chain entry says whether
// a turn is in progress. Cached per file by mtime, so polling stays cheap.
const END_SUBTYPES = new Set(["turn_duration", "away_summary"]);
const phaseCache = new Map<string, { mtime: number; phase: "working" | "idle" | "waiting" }>();
function transcriptPhase(file: string, tempo: string, sidechain = false): { phase: "working" | "idle" | "waiting"; at: number } | null {
  let st; try { st = statSync(file); } catch { return null; }
  const ck = sidechain ? file + "#side" : file;
  const c2 = phaseCache.get(ck);
  let phase = c2 && c2.mtime === st.mtimeMs ? c2.phase : null;
  if (!phase) {
    phase = "idle";
    const lines = readTail(file, 256_000).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]; if (!l.startsWith("{")) continue;
      let e: any; try { e = JSON.parse(l); } catch { continue; }
      if (e.isSidechain && !sidechain) continue; // a sub-agent's own file is all sidechain entries
      if (e.type === "system") { if (END_SUBTYPES.has(e.subtype)) { phase = "idle"; break; } continue; }
      if (e.type === "assistant") {
        const sr = e.message?.stop_reason; const content = Array.isArray(e.message?.content) ? e.message.content : [];
        if (sr === "end_turn" || sr === "stop_sequence" || sr === "max_tokens") { phase = "idle"; break; }
        const tool = content.find((b: any) => b?.type === "tool_use");
        phase = tool && tool.name === "AskUserQuestion" ? "waiting" : "working"; break;
      }
      if (e.type === "user") { if (e.isMeta) continue; phase = "working"; break; }
    }
    phaseCache.set(ck, { mtime: st.mtimeMs, phase });
  }
  // A crashed/abandoned turn must not look busy forever: no writes for 20 min and not active → idle.
  if (phase === "working" && Date.now() - st.mtimeMs > 20 * 60_000 && tempo !== "active") phase = "idle";
  return { phase, at: st.mtimeMs };
}
let agentsCache: { at: number; byId: Map<string, any> } = { at: 0, byId: new Map() };
function agentsInfo() {
  if (Date.now() - agentsCache.at < 15_000) return agentsCache.byId;
  const byId = new Map<string, any>();
  for (const p of PROFILES) {
    const r = run([CLAUDE_BIN, "agents", "--json", "--all"], { timeoutMs: 15000, env: profileEnv(p) });
    try { for (const a of JSON.parse(r.out)) byId.set(a.id, a); } catch {}
  }
  agentsCache = { at: Date.now(), byId };
  return byId;
}
function listJobs(): Job[] {
  const agents = agentsInfo();
  const out: Job[] = [];
  for (const prof of PROFILES) {
  const jobsDir = join(prof.dir, "jobs"); if (!existsSync(jobsDir)) continue;
  for (const id of readdirSync(jobsDir)) {
    const s = readJson(join(jobsDir, id, "state.json"));
    if (!s) continue;
    out.push({
      kind: "job", id, sessionId: s.sessionId || s.resumeSessionId || "", name: s.name || s.intent?.slice(0, 60) || id,
      state: s.state || "?", tempo: s.tempo || "", detail: s.detail || "", needs: s.needs ?? null, output: s.output ?? null,
      intent: s.intent || "", cwd: s.cwd || s.originCwd || HOME, createdAt: s.createdAt || "", updatedAt: s.updatedAt || "",
      pid: agents.get(id)?.pid, profile: prof.id,
    });
    const job = out[out.length - 1]; const tf = job.sessionId ? findSessionFile(job.sessionId) : null;
    const ph = tf ? transcriptPhase(tf, job.tempo) : null; if (ph) { job.phase = ph.phase; job.activityAt = ph.at; }
  }
  }
  return out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

type Transcript = { kind: "transcript"; sessionId: string; title: string; cwd: string; lastPrompt: string; mtime: number; size: number; project: string };
const transcriptMeta = new Map<string, { mtime: number; meta: Transcript }>();
const sessionFileCache = new Map<string, string>();
function findSessionFile(sessionId: string): string | null {
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return null;
  const c = sessionFileCache.get(sessionId); if (c && existsSync(c)) return c;
  for (const root of PROJECT_ROOTS) for (const proj of readdirSync(root)) {
    const p = join(root, proj, `${sessionId}.jsonl`);
    if (existsSync(p)) { sessionFileCache.set(sessionId, p); return p; }
  }
  return null;
}
function transcriptInfo(path: string, project: string): Transcript | null {
  const st = statSync(path);
  const cached = transcriptMeta.get(path);
  if (cached && cached.mtime === st.mtimeMs) return cached.meta;
  const sessionId = basename(path, ".jsonl");
  let title = "", cwd = "", lastPrompt = "";
  const scan = (text: string) => {
    for (const line of text.split("\n")) {
      if (!line.startsWith("{")) continue;
      let d: any; try { d = JSON.parse(line); } catch { continue; }
      if (d.type === "ai-title" && d.aiTitle) title = d.aiTitle;
      if (d.type === "custom-title" && d.customTitle) title = d.customTitle;
      if (d.cwd && !cwd) cwd = d.cwd;
      if (d.type === "last-prompt" && d.lastPrompt) lastPrompt = d.lastPrompt;
      if (d.type === "user" && typeof d.message?.content === "string" && !d.isMeta && !d.message.content.startsWith("<")) lastPrompt = d.message.content;
    }
  };
  scan(readHead(path, 48_000)); scan(readTail(path, 160_000));
  if (!title && !lastPrompt) return null;
  const meta: Transcript = { kind: "transcript", sessionId, title: title || lastPrompt.slice(0, 70), cwd, lastPrompt: lastPrompt.slice(0, 300), mtime: st.mtimeMs, size: st.size, project };
  transcriptMeta.set(path, { mtime: st.mtimeMs, meta });
  sessionFileCache.set(sessionId, path);
  return meta;
}
function listTranscripts(limit = 40, exclude: Set<string>): Transcript[] {
  const files: { p: string; m: number; proj: string }[] = [];
  for (const root of PROJECT_ROOTS) for (const proj of readdirSync(root)) {
    const dir = join(root, proj);
    let ents: string[] = []; try { ents = readdirSync(dir); } catch { continue; }
    for (const f of ents) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try { files.push({ p, m: statSync(p).mtimeMs, proj }); } catch {}
    }
  }
  files.sort((a, b) => b.m - a.m);
  const out: Transcript[] = [];
  for (const f of files) {
    if (out.length >= limit) break;
    const sid = basename(f.p, ".jsonl");
    if (exclude.has(sid)) continue;
    try { const t = transcriptInfo(f.p, f.proj); if (t) out.push(t); } catch {}
  }
  return out;
}

type TmuxS = { kind: "tmux"; name: string; windows: number; attached: number; activity: number; path: string; command: string };
function listTmux(): TmuxS[] {
  const r = run(["tmux", "list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_activity}\t#{pane_current_path}\t#{pane_current_command}"], { timeoutMs: 3000 });
  if (r.code !== 0) return [];
  return r.out.trim().split("\n").filter(Boolean).map((l) => {
    const [name, w, a, act, path, command] = l.split("\t");
    return { kind: "tmux", name, windows: +w, attached: +a, activity: +act * 1000, path, command } as TmuxS;
  });
}

// ───────────────────────────── transcript parsing ─────────────────────────────
type Ev =
  | { k: "user"; id: string; ts: string; text: string }
  | { k: "assistant"; id: string; ts: string; text: string }
  | { k: "tool"; id: string; ts: string; name: string; summary: string; input: string; toolId: string }
  | { k: "result"; id: string; ts: string; toolId: string; text: string; isError: boolean; bg?: string; agentId?: string }
  | { k: "system"; id: string; ts: string; text: string }
  | { k: "bgdone"; id: string; ts: string; taskId: string; status: string };

function clip(s: string, n: number) { return s.length > n ? s.slice(0, n) + `\n… [${s.length - n} more chars]` : s; }
function toolSummary(name: string, inp: any): string {
  if (!inp || typeof inp !== "object") return "";
  const pick = inp.command ?? inp.file_path ?? inp.pattern ?? inp.description ?? inp.url ?? inp.query ?? inp.prompt ?? inp.skill ?? inp.path ?? "";
  return String(pick).split("\n")[0].slice(0, 200);
}
function resultText(c: any): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => (x?.type === "text" ? x.text : x?.type === "image" ? "[image]" : "")).join("\n");
  return "";
}
function parseLine(line: string, allowSidechain = false): Ev[] {
  if (!line.startsWith("{")) return [];
  let d: any; try { d = JSON.parse(line); } catch { return []; }
  if (d.isSidechain && !allowSidechain) return [];
  const ts = d.timestamp || "", uuid = d.uuid || "";
  const evs: Ev[] = [];
  if (d.type === "user") {
    const c = d.message?.content;
    if (typeof c === "string") {
      if (d.isMeta) return [];
      // A background shell / async sub-agent finished: tell the page which one, so it can stop polling it.
      const tn = c.startsWith("<task-notification>") ? c.match(/<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>/) : null;
      if (tn) evs.push({ k: "bgdone", id: `${uuid}:bg`, ts, taskId: tn[1].trim(), status: tn[2].trim() });
      if (c.startsWith("<task-notification>") || c.startsWith("<system-reminder>")) evs.push({ k: "system", id: uuid, ts, text: clip(c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 400) });
      else if (c.startsWith("<command-name>") || c.startsWith("<local-command")) evs.push({ k: "system", id: uuid, ts, text: clip(c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 300) });
      else evs.push({ k: "user", id: uuid, ts, text: c });
    } else if (Array.isArray(c)) {
      c.forEach((b: any, i: number) => {
        if (b?.type === "tool_result") {
          const tur = d.toolUseResult && typeof d.toolUseResult === "object" ? d.toolUseResult : {};
          evs.push({ k: "result", id: `${uuid}:${i}`, ts, toolId: b.tool_use_id, text: clip(resultText(b.content), 4000), isError: !!b.is_error,
            ...(typeof tur.backgroundTaskId === "string" ? { bg: tur.backgroundTaskId } : {}), ...(typeof tur.agentId === "string" ? { agentId: tur.agentId } : {}) });
        }
        else if (b?.type === "text" && !d.isMeta && !String(b.text).startsWith("<")) evs.push({ k: "user", id: `${uuid}:${i}`, ts, text: b.text });
      });
    }
  } else if (d.type === "assistant") {
    const c = d.message?.content;
    if (Array.isArray(c)) c.forEach((b: any, i: number) => {
      if (b?.type === "text" && b.text?.trim()) evs.push({ k: "assistant", id: `${uuid}:${i}`, ts, text: b.text });
      else if (b?.type === "tool_use") evs.push({ k: "tool", id: `${uuid}:${i}`, ts, name: b.name, summary: toolSummary(b.name, b.input), input: clip(JSON.stringify(b.input, null, 2), 3000), toolId: b.id });
    });
  }
  return evs;
}

// Incremental reader per websocket: tracks byte offset, emits complete lines only.
class Tail {
  off = 0; rem = ""; skipPartial = false; startedMidFile = false;
  constructor(public path: string, maxInitial = 4_000_000) {
    try { const size = statSync(path).size; if (size > maxInitial) { this.off = size - maxInitial; this.skipPartial = true; this.startedMidFile = true; } } catch {}
  }
  readNew(): Ev[] {
    let size = 0; try { size = statSync(this.path).size; } catch { return []; }
    if (size < this.off) { this.off = 0; this.rem = ""; }
    if (size === this.off) return [];
    const fd = openSync(this.path, "r");
    try {
      const b = Buffer.alloc(size - this.off); readSync(fd, b, 0, b.length, this.off); this.off = size;
      const text = this.rem + b.toString("utf8");
      const lines = text.split("\n"); this.rem = lines.pop() || "";
      if (this.skipPartial) { lines.shift(); this.skipPartial = false; } // started mid-line
      return lines.flatMap(parseLine);
    } finally { closeSync(fd); }
  }
}

// ───────────────────────────── PTY hub ─────────────────────────────
// One PTY per target, shared by all viewers (tmux-like). Output kept in a ring buffer
// so a reconnecting / second device gets the screen back (mosh-like).
type WsAuth = { who: string; peer?: string }; // peer = tailnet address to re-check (absent for plain local)
type WsData = ({ kind: "pty"; key: string } | { kind: "tail"; tail: Tail; limit: number; timer?: Timer }
  | { kind: "proxy"; target: string; queue: (string | Buffer)[]; up?: WebSocket }) & WsAuth;
const openSockets = new Set<ServerWebSocket<WsData>>();
const RING = 400_000;
class Pty {
  proc: any; chunks: Uint8Array[] = []; bytes = 0; clients = new Set<ServerWebSocket<WsData>>();
  cols = 120; rows = 36; lastOut = Date.now(); lastClientAt = Date.now(); exited = false;
  // Server-side mirror of the screen, so the Chat view can see menus that only exist in the TUI.
  screen = new HeadlessTerm({ cols: 120, rows: 36, allowProposedApi: true, scrollback: 0 });
  constructor(public key: string, cmd: string[], cwd: string, extraEnv: Record<string, string> = {}) {
    this.proc = Bun.spawn(cmd, {
      cwd: existsSync(cwd) ? cwd : HOME, env: { ...childEnv(), ...extraEnv },
      terminal: { cols: this.cols, rows: this.rows, data: (_t: any, d: Uint8Array) => this.onData(d) },
      onExit: () => { this.exited = true; for (const c of this.clients) { try { c.send(JSON.stringify({ t: "exit" })); } catch {} } ptys.delete(this.key); },
    } as any);
  }
  onData(d: Uint8Array) {
    const copy = new Uint8Array(d); this.lastOut = Date.now(); this.screen.write(copy);
    this.chunks.push(copy); this.bytes += copy.length;
    while (this.bytes > RING && this.chunks.length > 1) this.bytes -= this.chunks.shift()!.length;
    for (const c of this.clients) { try { c.sendBinary(copy); } catch {} }
  }
  write(s: string) { if (!this.exited) this.proc.terminal.write(s); }
  resize(cols: number, rows: number) {
    cols = Math.max(20, Math.min(400, cols | 0)); rows = Math.max(5, Math.min(200, rows | 0));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols; this.rows = rows; try { this.proc.terminal.resize(cols, rows); this.screen.resize(cols, rows); } catch {}
  }
  // Force a full repaint (TUIs redraw on SIGWINCH).
  nudge() { const c = this.cols, r = this.rows; try { this.proc.terminal.resize(c - 1, r); setTimeout(() => { try { this.proc.terminal.resize(c, r); } catch {} }, 60); } catch {} }
  lines(): string[] { const b = this.screen.buffer.active; const out: string[] = []; for (let i = 0; i < this.screen.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? ""); return out; }
  replay(): Uint8Array { const out = new Uint8Array(this.bytes); let o = 0; for (const c of this.chunks) { out.set(c, o); o += c.length; } return out; }
  kill() { try { this.proc.kill(); } catch {} }
}
const ptys = new Map<string, Pty>();

// ───────────────────────────── projects: where a session starts, and what memory it loads ─────────────────────────────
// Claude Code loads CLAUDE.md from the session's folder and every folder above it (plus the global one and that
// folder's auto-memory), so picking the folder picks the memory. Folders come from "projectRoots" in config.json
// (default ~/Projects, else ~): children that look like projects, plus trusted and recently used folders.
const PROJECT_MARKERS = ["CLAUDE.md", ".git", "AGENTS.md", "package.json", "pyproject.toml", "setup.py", "requirements.txt", "Cargo.toml", "go.mod", "Makefile"];
const expandHome = (d: string) => d.replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, "") || "/";
// macOS privacy-protected folders: touching them from a login service pops an "allow access?" dialog on that
// machine's screen and the call blocks until someone answers it (seen: the whole server hung). Never touch them.
const TCC_DIRS = process.platform === "darwin" ? [...["Documents", "Desktop", "Downloads", "Library", "Pictures", "Movies", "Music"].map((x) => join(HOME, x)), "/Volumes"] : [];
const tccProtected = (dir: string) => TCC_DIRS.some((t) => dir === t || dir.startsWith(t + "/"));
function projectDirOk(dir: string): boolean {
  if (!dir.startsWith("/") || dir.includes("\0") || tccProtected(dir)) return false;
  try { const r = realpathSync(dir); return statSync(r).isDirectory() && r.startsWith(HOME + "/"); } catch { return false; }
}
let trustCache: { at: number; key: string; dirs: string[] } = { at: 0, key: "", dirs: [] };
function trustedDirs(prof: Profile): string[] {
  const f = prof.isDefault ? join(HOME, ".claude.json") : join(prof.dir, ".claude.json");
  if (trustCache.key === f && Date.now() - trustCache.at < 10_000) return trustCache.dirs;
  const pr = readJson(f)?.projects || {};
  const dirs = Object.keys(pr).filter((k) => pr[k]?.hasTrustDialogAccepted);
  trustCache = { at: Date.now(), key: f, dirs }; return dirs;
}
// Trust covers a folder and its subfolders; the home folder itself never counts (Claude trusts it one session at a time).
const trustOf = (dir: string, t: string[]) => (t.includes(dir) && dir !== HOME ? "yes" : t.some((x) => x !== HOME && dir.startsWith(x + "/")) ? "parent" : "no");
function listProjects(prof: Profile, recent: string[]) {
  const conf = readJson(join(CONF_DIR, "config.json")) || {};
  const roots = (Array.isArray(conf.projectRoots) ? conf.projectRoots : existsSync(join(HOME, "Projects")) ? ["~/Projects"] : ["~"]).map((r: string) => expandHome(String(r)));
  const trusted = trustedDirs(prof); const out = new Map<string, any>();
  const add = (d0: string, src: string) => {
    if (tccProtected(d0)) return;
    let dir = ""; try { dir = realpathSync.native(d0); } catch { return; } // one entry per real folder (macOS ignores case)
    if (out.has(dir) || dir === HOME || !projectDirOk(dir)) return;
    out.set(dir, { path: dir, name: basename(dir), src, git: existsSync(join(dir, ".git")), claudeMd: existsSync(join(dir, "CLAUDE.md")), trust: trustOf(dir, trusted) });
  };
  recent.forEach((d) => add(d, "recent"));
  for (const root of roots) {
    let names: string[] = []; try { names = readdirSync(root); } catch { continue; }
    for (const n of names.sort((a, b) => a.localeCompare(b))) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const d = join(root, n); if (PROJECT_MARKERS.some((m) => existsSync(join(d, m)))) add(d, "root");
    }
  }
  trusted.filter((t) => t.startsWith(HOME + "/")).sort().forEach((t) => add(t, "trusted"));
  return [...out.values()].slice(0, 200);
}
function memoryLayers(dir: string, prof: Profile) {
  const layers: { label: string; path: string; bytes: number; note?: string }[] = [];
  const short = (x: string) => x.replace(HOME, "~");
  const file = (f: string, label: string, note?: string) => { try { const st = statSync(f); if (st.isFile()) layers.push({ label, path: short(f), bytes: st.size, note }); } catch {} };
  const countMd = (d: string): [number, number] => { let n = 0, b = 0; const walk = (x: string, depth: number) => { let es: string[] = []; try { es = readdirSync(x); } catch { return; } for (const e of es) { const q = join(x, e); try { const st = statSync(q); if (st.isDirectory() && depth < 4) walk(q, depth + 1); else if (e.endsWith(".md")) { n++; b += st.size; } } catch {} } }; walk(d, 0); return [n, b]; };
  file(join(prof.dir, "CLAUDE.md"), "global");
  { const [n, b] = countMd(join(prof.dir, "rules")); if (n) layers.push({ label: "global rules", path: short(join(prof.dir, "rules")) + "/", bytes: b, note: `${n} rule files` }); }
  const chain: string[] = []; for (let d = dir; ; d = join(d, "..")) { chain.unshift(d); if (d === "/" || chain.length > 30) break; }
  for (const d of chain) {
    const label = d === dir ? "this folder" : "parent";
    file(join(d, "CLAUDE.md"), label); if (d !== HOME) file(join(d, ".claude", "CLAUDE.md"), label); file(join(d, "CLAUDE.local.md"), label, "personal, not in git");
    if (d !== HOME) { const [n, b] = countMd(join(d, ".claude", "rules")); if (n) layers.push({ label: label + " rules", path: short(join(d, ".claude", "rules")) + "/", bytes: b, note: `${n} rule files (some load only for matching paths)` }); }
  }
  const mem = join(prof.dir, "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
  try { const idx = readFileSync(join(mem, "MEMORY.md"), "utf8"); layers.push({ label: "auto-memory", path: short(join(mem, "MEMORY.md")), bytes: idx.length, note: `${idx.split("\n").filter((l) => l.trim()).length} index lines · ${readdirSync(mem).filter((x) => x.endsWith(".md")).length - 1} topic files` }); } catch {}
  return { dir, trust: trustOf(dir, trustedDirs(prof)), layers };
}

function targetCommand(key: string): { cmd: string[]; cwd: string; env?: Record<string, string> } | null {
  const [kind, ...rest] = key.split(":"); const arg = rest.join(":");
  if (kind === "here") { // an interactive Claude in a project folder, e.g. to answer its trust question from a phone
    const i = arg.indexOf(":"); const prof = profileById(arg.slice(0, i)); const dir = arg.slice(i + 1);
    if (!prof || !projectDirOk(dir)) return null;
    return { cmd: [CLAUDE_BIN], cwd: dir, env: profileEnv(prof) };
  }
  if (kind === "job") {
    if (!/^[0-9a-f]{6,12}$/.test(arg)) return null;
    const prof = profileOfJob(arg);
    const s = prof ? readJson(join(prof.dir, "jobs", arg, "state.json")) : null;
    return { cmd: [CLAUDE_BIN, "attach", arg], cwd: s?.cwd || HOME, env: profileEnv(prof) };
  }
  if (kind === "tmux") {
    if (!/^[\w.@%+-]{1,64}$/.test(arg)) return null;
    return { cmd: ["tmux", "attach-session", "-t", arg], cwd: HOME };
  }
  if (kind === "shell") {
    // Persistent shell = a tmux session, so it outlives quarterdeck restarts.
    const cwd = arg && existsSync(arg) ? arg : HOME;
    return { cmd: ["tmux", "new-session", "-A", "-s", "quarterdeck", "-c", cwd], cwd };
  }
  return null;
}
// All shell targets share one tmux session, so they share one key (otherwise every distinct
// "shell:<x>" string would spawn another attach process).
const normKey = (k: string) => (k.startsWith("shell:") ? "shell:" : k);
const MAX_PTYS = 24;
function getPty(key: string): Pty | null {
  key = normKey(key);
  let p = ptys.get(key);
  if (p && !p.exited) return p;
  const t = targetCommand(key); if (!t) return null;
  if (ptys.size >= MAX_PTYS) {
    // Reap the longest-unwatched attach client without viewers; refuse if every PTY is in use.
    const idle = [...ptys.values()].filter((x) => x.clients.size === 0).sort((x, y) => x.lastClientAt - y.lastClientAt)[0];
    if (!idle) return null; idle.kill(); ptys.delete(idle.key);
  }
  p = new Pty(key, t.cmd, t.cwd, t.env); ptys.set(key, p);
  console.log(`[pty] spawn ${key}: ${t.cmd.join(" ")}`);
  return p;
}
// Reap attach clients nobody has watched for 30 min (the Claude session itself keeps running).
setInterval(() => {
  for (const [k, p] of ptys) if (p.clients.size === 0 && Date.now() - p.lastClientAt > 30 * 60_000) { console.log(`[pty] reap ${k}`); p.kill(); ptys.delete(k); }
}, 60_000);

async function waitQuiet(p: Pty, quietMs = 1200, maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) { if (Date.now() - p.lastOut > quietMs) return; await Bun.sleep(150); }
}


// ───────────────────────────── actions ─────────────────────────────
function parseBgId(code: number, text: string, prof: Profile | null = profileById()): string | null {
  if (code !== 0) return null;
  const jobsDir = join((prof || PROFILES[0]).dir, "jobs");
  const known = new Set(existsSync(jobsDir) ? readdirSync(jobsDir) : []);
  for (const m of text.matchAll(/\b([0-9a-f]{8})\b/g)) if (known.has(m[1])) return m[1];
  return null;
}
async function actNew(body: any) {
  const cwd = String(body.cwd || HOME); if (!existsSync(cwd)) return json({ error: `cwd not found: ${cwd}` }, 400);
  const prompt = String(body.prompt || "").trim(); if (!prompt) return json({ error: "prompt required" }, 400);
  const prof = profileById(body.profile); if (!prof) return json({ error: "unknown account" }, 400);
  const cmd = [CLAUDE_BIN, "--bg"];
  if (body.name) cmd.push("-n", String(body.name).slice(0, 80));
  if (body.permissionMode) cmd.push("--permission-mode", String(body.permissionMode));
  if (body.model) cmd.push("--model", String(body.model));
  cmd.push("--", prompt);
  const r = run(cmd, { cwd, timeoutMs: 60000, env: profileEnv(prof) });
  agentsCache.at = 0;
  return json({ ok: r.code === 0, id: parseBgId(r.code, r.out + r.err, prof), out: (r.out + r.err).trim().slice(0, 2000) }, r.code === 0 ? 200 : 500);
}
async function actResume(body: any) {
  const sid = String(body.sessionId || ""); const file = findSessionFile(sid);
  if (!file) return json({ error: "session not found" }, 404);
  const meta = transcriptInfo(file, basename(join(file, "..")));
  const cwd = meta?.cwd && existsSync(meta.cwd) ? meta.cwd : HOME;
  const prof = profileById(body.profile); if (!prof) return json({ error: "unknown account" }, 400);
  const cmd = [CLAUDE_BIN, "--bg", "--resume", sid];
  if (body.prompt) cmd.push("--", String(body.prompt));
  const r = run(cmd, { cwd, timeoutMs: 60000, env: profileEnv(prof) });
  agentsCache.at = 0;
  return json({ ok: r.code === 0, id: parseBgId(r.code, r.out + r.err, prof), out: (r.out + r.err).trim().slice(0, 2000) }, r.code === 0 ? 200 : 500);
}
async function actSend(body: any) {
  const key = normKey(String(body.target || "")); const text = String(body.text ?? "");
  const fresh = !ptys.get(key) || ptys.get(key)!.exited;
  const p = getPty(key); if (!p) return json({ error: "bad target" }, 400);
  if (fresh) await waitQuiet(p, 1500, 12000);
  if (text) p.write(`\x1b[200~${text}\x1b[201~`);
  if (body.enter !== false) { await Bun.sleep(text ? 200 : 0); p.write("\r"); }
  return json({ ok: true });
}
function actKeys(body: any) {
  const p = getPty(String(body.target || "")); if (!p) return json({ error: "bad target" }, 400);
  p.write(String(body.data || "")); return json({ ok: true });
}
function actRm(body: any) {
  // "×" in the UI: remove a background session from the list. `claude rm` keeps the transcript, so the
  // conversation stays resumable from "Interactive sessions". A running session is stopped first.
  const id = String(body.id || ""); if (!/^[0-9a-f]{6,12}$/.test(id)) return json({ error: "bad id" }, 400);
  const prof = profileOfJob(id); const env = profileEnv(prof);
  const st = prof ? readJson(join(prof.dir, "jobs", id, "state.json")) : null;
  let out = "";
  if (st && st.state !== "done") out += (run([CLAUDE_BIN, "stop", id], { timeoutMs: 30000, env }).out + "\n");
  const p = ptys.get(`job:${id}`); if (p) { p.kill(); ptys.delete(`job:${id}`); }
  const r = run([CLAUDE_BIN, "rm", id], { timeoutMs: 30000, env }); agentsCache.at = 0;
  return json({ ok: r.code === 0, out: (out + r.out + r.err).trim() }, r.code === 0 ? 200 : 500);
}

// ───────────────────────────── usage stats ─────────────────────────────
const STATS_CACHE = join(DATA_DIR, "stats_cache.json");
let statsRunning = false;
function refreshStats() {
  if (statsRunning) return; statsRunning = true;
  const p = Bun.spawn(["nice", "-n", "10", "bun", join(import.meta.dir, "lib/stats.ts")], { stdout: "ignore", stderr: "pipe", env: { ...childEnv(), QUARTERDECK_DATA_DIR: DATA_DIR } });
  p.exited.then(() => { statsRunning = false; });
}
setInterval(refreshStats, 5 * 60_000); setTimeout(refreshStats, 5000);
// Optional: subscription quota from a quotad-compatible endpoint ({ts, err, bars:[{id,label,h,w,state,note,age}]}).
async function quotaStatus() {
  if (!CONFIG.quotaUrl) return null;
  try {
    const q: any = await (await fetch(CONFIG.quotaUrl, { signal: AbortSignal.timeout(3000) })).json();
    const ageH = (Date.now() / 1000 - q.ts) / 3600;
    return { ok: !q.err && ageH < 1, ageHours: Math.round(ageH * 10) / 10, err: q.err || "", bars: (q.bars || []).map((b: any) => ({ label: b.label, codex: b.id === "codex", h: b.h, w: b.w, state: b.state, note: b.note, ageHours: Math.round((b.age || 0) / 360) / 10 })) };
  } catch (e: any) { return { ok: false, ageHours: null, err: `quota endpoint unreachable: ${e?.message}`, bars: [] }; }
}
async function statsApi(daysN: number) {
  if (!existsSync(STATS_CACHE)) { refreshStats(); return { ready: false }; }
  const c = JSON.parse(readFileSync(STATS_CACHE, "utf8"));
  const days: any[] = [];
  for (let i = daysN - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString("sv"); const x = c.days[d];
    days.push(x ? { date: d, out: x.out, inp: x.inp + x.cw, cr: x.cr, turns: x.turns, prompts: x.prompts, tools: x.tools, sessions: Object.keys(x.sessions).length, models: x.models } : { date: d, out: 0, inp: 0, cr: 0, turns: 0, prompts: 0, tools: 0, sessions: 0, models: {} });
  }
  const today = c.days[new Date().toLocaleDateString("sv")];
  const names = new Map<string, { name: string; href: string }>();
  for (const j of listJobs()) if (j.sessionId) names.set(j.sessionId, { name: j.name, href: `#/job/${j.id}` });
  const top = today ? Object.entries(today.sessions as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sid, tok]) => {
    const n = names.get(sid); if (n) return { ...n, tokens: tok };
    const f = findSessionFile(sid); const t = f ? transcriptInfo(f, basename(join(f, ".."))) : null;
    return { name: t?.title || sid.slice(0, 8), href: `#/t/${sid}`, tokens: tok };
  }) : [];
  return { ready: true, updatedAt: c.updatedAt, days, top, quota: await quotaStatus() };
}

function actStop(body: any) {
  const id = String(body.id || ""); if (!/^[0-9a-f]{6,12}$/.test(id)) return json({ error: "bad id" }, 400);
  const r = run([CLAUDE_BIN, "stop", id], { timeoutMs: 30000, env: profileEnv(profileOfJob(id)) }); agentsCache.at = 0;
  return json({ ok: r.code === 0, out: (r.out + r.err).trim() });
}

// ───────────────────────────── per-session changes ─────────────────────────────
// Files this session edited (from its own Edit/Write tool calls, incl. subagents), each with
// its current git diff vs HEAD. Session-scoped on purpose: many sessions share one dirty tree.
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const repoRootCache = new Map<string, string | null>();
function repoRoot(dir: string): string | null {
  if (repoRootCache.has(dir)) return repoRootCache.get(dir)!;
  const r = run(["git", "-C", dir, "rev-parse", "--show-toplevel"], { timeoutMs: 5000 });
  const root = r.code === 0 ? r.out.trim() : null; repoRootCache.set(dir, root); return root;
}
function sessionChanges(sessionId: string) {
  const file = findSessionFile(sessionId); if (!file) return null;
  const touched = new Map<string, { last: string; tool: string; n: number }>();
  let started = "";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!started) { const m = line.match(/"timestamp":"([^"]+)"/); if (m) started = m[1]; }
    if (!line.includes('"tool_use"')) continue;
    let d: any; try { d = JSON.parse(line); } catch { continue; }
    for (const b of d.message?.content || []) {
      if (b?.type !== "tool_use" || !EDIT_TOOLS.has(b.name)) continue;
      const p = b.input?.file_path || b.input?.notebook_path; if (!p) continue;
      const t = touched.get(p); touched.set(p, { last: d.timestamp || "", tool: b.name, n: (t?.n || 0) + 1 });
    }
  }
  const files = [...touched.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, 80).map(([path, info]) => {
    const exists = existsSync(path);
    const dir = join(path, "..");
    const root = existsSync(dir) ? repoRoot(dir) : null;
    let status = exists ? "" : "deleted", diff = "", add = 0, del = 0;
    if (root) {
      const st = run(["git", "-C", root, "status", "--porcelain=v1", "--", path], { timeoutMs: 5000 }).out.trim();
      status = st.slice(0, 2).trim() || (exists ? "clean" : "deleted");
      if (status === "??") {
        status = "new"; try { const c = readFileSync(path, "utf8"); diff = c.slice(0, 30000).split("\n").map((l) => "+" + l).join("\n"); add = c.split("\n").length; } catch {}
      } else {
        let base = "HEAD";
        if (status === "clean" && started) {
          // Already committed: diff from just before the first commit this session made to the file.
          const shas = run(["git", "-C", root, "log", `--since=${started}`, "--format=%H", "--", path], { timeoutMs: 8000 }).out.trim().split("\n").filter(Boolean);
          if (shas.length) { base = `${shas.at(-1)}^`; status = "committed"; }
        }
        if (status !== "clean") diff = run(["git", "-C", root, "diff", base, "--no-color", "--", path], { timeoutMs: 8000 }).out;
        for (const l of diff.split("\n")) { if (l.startsWith("+") && !l.startsWith("+++")) add++; else if (l.startsWith("-") && !l.startsWith("---")) del++; }
        if (diff.length > 60000) diff = diff.slice(0, 60000) + "\n… [diff truncated]";
      }
    } else status = exists ? "not in git" : "deleted";
    return { path, rel: root ? path.slice(root.length + 1) : path.replace(HOME, "~"), repo: root ? basename(root) : null, ...info, status, add, del, diff };
  });
  return { files };
}

// ───────────────────────────── push notifications ─────────────────────────────
// Server-side, so they arrive with every page closed. Channels: Web Push (PWA / desktop
// browser; tap opens the session) and optionally a dedicated Telegram bot.
// State lives in ~/.config/quarterdeck (outside the repo): vapid.json, subscriptions.json, config.json.
mkdirSync(CONF_DIR, { recursive: true }); mkdirSync(DATA_DIR, { recursive: true });
function confRead(name: string, dflt: any) { return readJson(join(CONF_DIR, name)) ?? dflt; }
function confWrite(name: string, v: any) { const p = join(CONF_DIR, name); writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 }); chmodSync(p, 0o600); }
try { chmodSync(CONF_DIR, 0o700); if (existsSync(join(CONF_DIR, "config.json"))) chmodSync(join(CONF_DIR, "config.json"), 0o600); } catch {}
let vapid = confRead("vapid.json", null);
if (!vapid) { vapid = webpush.generateVAPIDKeys(); confWrite("vapid.json", vapid); }
// Apple rejects a "localhost" subject with 403 BadJwtToken, so use the real HTTPS origin.
// VAPID subject: Apple's push service rejects "localhost" subjects (403 BadJwtToken) → use the real HTTPS origin.
webpush.setVapidDetails(process.env.QUARTERDECK_VAPID_SUBJECT || CONFIG.baseUrl || `mailto:${OWNER}`, vapid.publicKey, vapid.privateKey);
type Sub = { subscription: any; label: string; at: string };
let subs: Sub[] = confRead("subscriptions.json", []);
const notifyConf = () => confRead("config.json", {}) as { baseUrl?: string; telegram?: { token: string; chatId: string }; notifyDone?: boolean };

type Note = { title: string; body: string; url: string; tag: string };
async function sendAll(n: Note): Promise<{ push: number; pushFailed: number; telegram: boolean | null }> {
  let push = 0, pushFailed = 0;
  const dead = new Set<string>();
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s.subscription, JSON.stringify(n), { TTL: 6 * 3600, urgency: "high", timeout: 20000 }); push++; }
    catch (e: any) { pushFailed++; if (e?.statusCode === 404 || e?.statusCode === 410) dead.add(s.subscription.endpoint); console.warn(`[push] ${s.label}: ${e?.statusCode || e?.message}`); }
  }));
  if (dead.size) { subs = subs.filter((s) => !dead.has(s.subscription.endpoint)); confWrite("subscriptions.json", subs); }
  let telegram: boolean | null = null;
  const c = notifyConf();
  if (c.telegram?.token && c.telegram?.chatId) {
    const link = `${(c.baseUrl || `http://127.0.0.1:${PORT}`).replace(/\/$/, "")}${n.url}`;
    try {
      const r = await fetch(`https://api.telegram.org/bot${c.telegram.token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: c.telegram.chatId, text: `${n.title}\n${n.body}\n${link}`, disable_web_page_preview: true }),
      });
      telegram = r.ok; if (!r.ok) console.warn(`[telegram] ${r.status} ${await r.text()}`);
    } catch (e: any) { telegram = false; console.warn(`[telegram] ${e?.message}`); }
  }
  console.log(`[notify] ${n.title} — push ${push}/${push + pushFailed}${telegram === null ? "" : `, telegram ${telegram}`}`);
  return { push, pushFailed, telegram };
}
// A resumed/attached session keeps state "done" while it generates; only tempo turns "active" — count that as
// working, so a follow-up reply finishing still triggers the "done" notification.
// Real phase first (transcript), then state.json: a reply in progress is "working" even if state.json still
// says blocked; a finished turn is not "working" even if state.json still says so.
const jobStateOf = (j: Job) => (j.phase === "working" ? "working" : j.phase === "waiting" ? "blocked"
  : j.tempo === "blocked" || j.state === "blocked" || (j.needs && j.state !== "done") ? "blocked"
  : j.phase === "idle" && j.state === "working" ? "done" : j.tempo === "active" ? "working" : j.state);
const textOf = (v: any) => (v == null ? "" : typeof v === "string" ? v : v.text || v.question || v.result || v.headline || JSON.stringify(v));
// ───────────────────────────── fleet (one page for several machines) ─────────────────────────────
// config.json: "nodeId" / "nodeLabel" name this machine; "nodes": [{"id": "mbp", "label": "MBP", "url": "http://100.x.y.z:7690"}]
// lists the other machines running Quarterdeck. This machine (the hub) forwards /n/<id>/api|ws/… to them — only
// to nodes named here — and polls their session lists so push notifications cover every machine. Each node still
// authorises the hub itself (tailscale whois: the owner's own, untagged device).
type NodeConf = { id: string; label: string; url: string };
const FLEET = (() => {
  const c = readJson(join(CONF_DIR, "config.json")) || {};
  const host = osHostname().split(".")[0].toLowerCase();
  const clean = (v: unknown) => String(v || "").toLowerCase().replace(/[^\w-]/g, "").slice(0, 24);
  const self = { id: clean(c.nodeId) || clean(host) || "local", label: String(c.nodeLabel || c.nodeId || host).slice(0, 24) };
  const nodes: NodeConf[] = [];
  for (const n of Array.isArray(c.nodes) ? c.nodes : []) {
    const id = clean(n?.id), url = String(n?.url || "").replace(/\/+$/, "");
    if (!id || id === self.id || nodes.some((x) => x.id === id) || !/^https?:\/\/[\w.\-\[\]:]+$/.test(url)) { console.warn(`[fleet] ignoring node entry ${JSON.stringify(n)}`); continue; }
    nodes.push({ id, label: String(n.label || id).slice(0, 24), url });
  }
  return { self, nodes };
})();
type NodeState = { online: boolean; at: number; lastOk: number; error: string; data: any };
const nodeState = new Map<string, NodeState>(); const nodeBusy = new Set<string>();
async function pollNode(n: NodeConf) {
  if (nodeBusy.has(n.id)) return; nodeBusy.add(n.id);
  const prev = nodeState.get(n.id);
  try {
    const r = await fetch(`${n.url}/api/sessions`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 403 ? " (the node does not accept this machine: check its owner / Tailscale login)" : ""}`);
    nodeState.set(n.id, { online: true, at: Date.now(), lastOk: Date.now(), error: "", data: await r.json() });
    if (!prev?.online) console.log(`[fleet] ${n.label} online`);
  } catch (e: any) {
    if (prev?.online !== false) console.warn(`[fleet] ${n.label} offline: ${e?.message || e}`);
    nodeState.set(n.id, { online: false, at: Date.now(), lastOk: prev?.lastOk || 0, error: String(e?.message || e).slice(0, 200), data: prev?.data || null });
  } finally { nodeBusy.delete(n.id); }
}
if (FLEET.nodes.length) {
  const tick = () => FLEET.nodes.forEach((n) => pollNode(n)); tick(); setInterval(tick, 3000);
  console.log(`[fleet] this machine: ${FLEET.self.label}; nodes: ${FLEET.nodes.map((n) => `${n.label} ${n.url}`).join(", ")}`);
}
const fleetStatus = () => ({ self: FLEET.self, nodes: FLEET.nodes.map((n) => { const st = nodeState.get(n.id); return { id: n.id, label: n.label, online: !!st?.online, lastOk: st?.lastOk || 0, error: st?.error || "", data: st?.data || null }; }) });
async function proxyToNode(req: Request, server: any, url: URL, id: string, inner: string, auth: { who: string }, ip?: string): Promise<Response | undefined> {
  const node = FLEET.nodes.find((n) => n.id === id); if (!node) return json({ error: "unknown machine" }, 404);
  if (!sameOrigin(req)) return json({ error: "bad origin" }, 403);
  const target = node.url + inner + url.search;
  if (inner.startsWith("/ws/")) {
    if (server.upgrade(req, { data: { kind: "proxy", target: target.replace(/^http/, "ws"), queue: [], who: auth.who, peer: authPeer(req, ip) } })) return;
    return new Response("upgrade failed", { status: 400 });
  }
  try {
    const r = await fetch(target, { method: req.method, redirect: "manual", signal: AbortSignal.timeout(60_000),
      headers: { "content-type": req.headers.get("content-type") || "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer() });
    return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (e: any) { return json({ error: `${node.label} is unreachable (${e?.message || e})` }, 502); }
}

let lastStates: Map<string, string> | null = null;
const seenNodes = new Set<string>(); // a node's first answer is a baseline, not a burst of notifications
function watchJobs() {
  let local: Job[]; try { local = listJobs(); } catch { return; }
  // Every machine's sessions, keyed "<node>:<id>" (this machine = ""). An offline node keeps its last states,
  // so coming back does not re-announce what was already waiting.
  const all: { key: string; j: Job; node: NodeConf | null }[] = local.map((j) => ({ key: `:${j.id}`, j, node: null }));
  for (const n of FLEET.nodes) { const ns = nodeState.get(n.id); if (ns?.online && Array.isArray(ns.data?.jobs)) for (const j of ns.data.jobs) all.push({ key: `${n.id}:${j.id}`, j, node: n }); }
  const now = new Map(all.map((x) => [x.key, jobStateOf(x.j)]));
  if (lastStates) for (const [k, v] of lastStates) if (!now.has(k) && FLEET.nodes.some((n) => k.startsWith(`${n.id}:`) && !nodeState.get(n.id)?.online)) now.set(k, v);
  if (lastStates) for (const { key, j, node } of all) {
    if (node && !seenNodes.has(node.id)) continue;
    const st = now.get(key)!, prev = lastStates.get(key);
    const url = node ? `/#/job/${j.id}/${node.id}` : `/#/job/${j.id}`, at = node ? `[${node.label}] ` : "";
    if (st === prev) continue;
    const hide = !!notifyConf().hideBody; // optional lock-screen privacy for all sessions
    if (st === "blocked") sendAll({ title: hide ? "⚑ A session needs you" : `⚑ ${at}${j.name}`, body: hide ? "needs your reply" : (textOf(j.needs) || j.detail || "needs your input").slice(0, 300), url, tag: key });
    else if (st === "done" && prev !== undefined && notifyConf().notifyDone !== false) sendAll({ title: hide ? "✓ A session finished" : `✓ ${at}${j.name}`, body: hide ? "finished" : (textOf(j.output) || j.detail || "finished").slice(0, 300), url, tag: key });
  }
  lastStates = now;
  for (const n of FLEET.nodes) if (nodeState.get(n.id)?.online) seenNodes.add(n.id);
}
setInterval(watchJobs, 2000); watchJobs(); // 2 s: short "active" phases of quick follow-up replies must not slip between checks



// ───────────────────────────── static ─────────────────────────────
const VENDOR: Record<string, string> = {
  "xterm.mjs": "@xterm/xterm/lib/xterm.mjs",
  "xterm.css": "@xterm/xterm/css/xterm.css",
  "addon-fit.mjs": "@xterm/addon-fit/lib/addon-fit.mjs",
  "addon-web-links.mjs": "@xterm/addon-web-links/lib/addon-web-links.mjs",
  "marked.mjs": "marked/lib/marked.esm.js",
  "purify.mjs": "dompurify/dist/purify.es.mjs",
};
const SEC_HEADERS = {
  "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
};
function staticFile(path: string): Response | null {
  if (path.startsWith("/vendor/")) {
    const rel = VENDOR[path.slice(8)]; if (!rel) return null;
    return new Response(Bun.file(join(NM, rel)), { headers: { "cache-control": "max-age=86400", ...SEC_HEADERS } });
  }
  const name = path === "/" ? "index.html" : path.slice(1);
  if (name.includes("..") || name.includes("/")) return null;
  const f = join(PUBLIC, name);
  if (!existsSync(f)) return null;
  return new Response(Bun.file(f), { headers: { "cache-control": "no-cache", ...SEC_HEADERS } });
}

// ───────────────────────────── server ─────────────────────────────
async function handle(req: Request, server: any): Promise<Response | undefined> {
  if (!hostAllowed(req)) return new Response("forbidden: unknown Host header (add it to allowedHosts in config.json)\n", { status: 403 });
  const ip = server.requestIP(req)?.address;
  const auth = authorize(req, ip);
  if (!auth.ok) return new Response("forbidden: not an authorised Tailscale identity\n", { status: 403 });
  const url = new URL(req.url); const path = url.pathname;
  const viaNode = path.match(/^\/n\/([\w-]{1,24})(\/(?:api|ws)\/.*)$/); // another machine, same checks on the inner path
  if (viaNode) return fetchSiteOk(req, viaNode[2]) ? proxyToNode(req, server, url, viaNode[1], viaNode[2], auth, ip) : new Response("forbidden: cross-site request\n", { status: 403 });
  if (!fetchSiteOk(req, path)) return new Response("forbidden: cross-site request\n", { status: 403 });

  if (path === "/ws/pty" || path === "/ws/tail") {
    if (!sameOrigin(req)) return new Response("bad origin", { status: 403 });
    if (path === "/ws/pty") {
      const key = normKey(url.searchParams.get("target") || "");
      if (!targetCommand(key)) return new Response("bad target", { status: 400 });
      if (server.upgrade(req, { data: { kind: "pty", key, who: auth.who, peer: authPeer(req, ip) } })) return;
    } else {
      const file = findSessionFile(url.searchParams.get("session") || "");
      if (!file) return new Response("no session", { status: 404 });
      // "Load earlier" re-opens the tail with a larger event limit and byte window (both capped).
      const num = (k: string, def: number, lo: number, hi: number) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? Math.max(lo, Math.min(hi, Math.floor(v))) : def; };
      const limit = num("limit", 600, 100, 6000), bytes = num("bytes", 4_000_000, 1_000_000, 40_000_000);
      if (server.upgrade(req, { data: { kind: "tail", tail: new Tail(file, bytes), limit, who: auth.who, peer: authPeer(req, ip) } })) return;
    }
    return new Response("upgrade failed", { status: 400 });
  }

  if (path.startsWith("/api/")) {
    if (req.method !== "GET" && !sameOrigin(req)) return json({ error: "bad origin" }, 403);
    if (path === "/api/fleet") return json(fleetStatus());
    if (path === "/api/projects") {
      const prof = profileById(url.searchParams.get("profile") || "default"); if (!prof) return json({ error: "unknown account" }, 400);
      const jobs = listJobs(); const tr = listTranscripts(40, new Set(jobs.map((j) => j.sessionId)));
      const recent = [...new Set([...jobs.map((j) => j.cwd), ...tr.map((t) => t.cwd)].filter(Boolean))].slice(0, 12);
      return json({ projects: listProjects(prof, recent), home: HOME });
    }
    if (path === "/api/memory") {
      const prof = profileById(url.searchParams.get("profile") || "default"); const dir = (url.searchParams.get("dir") || "").replace(/\/+$/, "");
      if (!prof || !projectDirOk(dir)) return json({ error: tccProtected(dir) ? "macOS protects this folder (Documents, Desktop, Downloads…); Quarterdeck does not open it" : "not a folder under your home folder" }, 400);
      return json(memoryLayers(dir, prof));
    }
    if (path === "/api/sessions") {
      const jobs = listJobs();
      const jobSids = new Set(jobs.map((j) => j.sessionId));
      const transcripts = listTranscripts(Number(url.searchParams.get("limit") || 40), jobSids);
      const tmux = listTmux();
      const cwds = [...new Set([...jobs.map((j) => j.cwd), ...transcripts.map((t) => t.cwd)].filter(Boolean))].slice(0, 25);
      return json({ jobs, transcripts, tmux, cwds, ptys: [...ptys.keys()], accounts: accountsStatus(), who: auth.who, now: Date.now() });
    }
    if (path === "/api/job") {
      const id = url.searchParams.get("id") || "";
      const j = listJobs().find((x) => x.id === id);
      return j ? json(j) : json({ error: "not found" }, 404);
    }
    if (path === "/api/stats") return json(await statsApi(Math.min(31, Math.max(7, Number(url.searchParams.get("days")) || 14))));
    if (path === "/api/push/key") return json({ publicKey: vapid.publicKey, devices: subs.map((x) => ({ label: x.label, at: x.at, endpoint: x.subscription.endpoint.slice(0, 60) })), telegram: !!notifyConf().telegram?.token });
    if (path === "/api/changes") {
      const c = sessionChanges(url.searchParams.get("session") || "");
      return c ? json(c) : json({ error: "not found" }, 404);
    }
    if (path === "/api/subagent") {
      // A sub-agent's own transcript lives in <session>/subagents/agent-<id>.jsonl; its .meta.json names the
      // parent's tool_use id, which is how the Chat view finds it.
      const sid = url.searchParams.get("session") || "", tool = url.searchParams.get("tool") || "";
      const f = findSessionFile(sid); if (!f || !/^[\w-]{8,80}$/.test(tool)) return json({ error: "not found" }, 404);
      const dir = join(f.replace(/\.jsonl$/, ""), "subagents");
      let found: { meta: any; file: string } | null = null;
      try { for (const m of readdirSync(dir)) if (m.endsWith(".meta.json")) { const meta = readJson(join(dir, m)); if (meta?.toolUseId === tool) { found = { meta, file: join(dir, m.replace(/\.meta\.json$/, ".jsonl")) }; break; } } } catch {}
      if (!found || !existsSync(found.file)) return json({ found: false });
      const evs = readTail(found.file, 600_000).split("\n").flatMap((l) => parseLine(l, true));
      const ph = transcriptPhase(found.file, "", true);
      const steps = evs.filter((e) => e.k === "tool").length;
      return json({ found: true, description: found.meta.description || "", agentType: found.meta.agentType || "", model: found.meta.model || "", background: found.meta.requestShape === "background",
        status: ph?.phase === "working" ? "running" : "done", updatedAt: ph?.at || 0, steps, events: evs.slice(-120) });
    }
    if (path === "/api/bgout") {
      // Output of a background shell: only <tmp>/claude-<uid>/<project>/<session>/tasks/<task>.output.
      const sid = url.searchParams.get("session") || "", task = url.searchParams.get("task") || "";
      if (!/^[0-9a-f-]{8,64}$/i.test(sid) || !/^[a-z0-9]{4,24}$/i.test(task)) return json({ error: "bad id" }, 400);
      const root = `${existsSync("/private/tmp") ? "/private/tmp" : "/tmp"}/claude-${process.getuid?.() ?? ""}`;
      let file = "";
      try { for (const proj of readdirSync(root)) { const c = join(root, proj, sid, "tasks", `${task}.output`); if (existsSync(c)) { file = c; break; } } } catch {}
      if (!file) return json({ exists: false });
      const st = statSync(file);
      return json({ exists: true, size: st.size, mtime: st.mtimeMs, text: readTail(file, 12_000) });
    }
    if (path === "/api/transcript-meta") {
      const f = findSessionFile(url.searchParams.get("session") || "");
      return f ? json(transcriptInfo(f, basename(join(f, "..")))) : json({ error: "not found" }, 404);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const ref = [body.id, body.target, body.sessionId].filter((x) => typeof x === "string" && /^[\w:.\-]{1,80}$/.test(x)).join(" ");
      console.log(`[act] ${auth.who} ${path}${ref ? " " + ref : ""}`);
      if (path === "/api/push/subscribe") {
        const sub = body.subscription;
        if (!sub?.endpoint || !/^https:\/\//.test(String(sub.endpoint)) || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "invalid subscription" }, 400);
        subs = subs.filter((x) => x.subscription.endpoint !== sub.endpoint);
        subs.push({ subscription: sub, label: String(body.label || auth.who).slice(0, 80), at: new Date().toISOString() });
        confWrite("subscriptions.json", subs); return json({ ok: true, devices: subs.length });
      }
      if (path === "/api/push/unsubscribe") { subs = subs.filter((x) => x.subscription.endpoint !== body.endpoint); confWrite("subscriptions.json", subs); return json({ ok: true }); }
      if (path === "/api/push/test") return json(await sendAll({ title: "🔔 Quarterdeck test", body: `Notifications work on this channel (${new Date().toLocaleTimeString()}).`, url: "/", tag: "quarterdeck-test" }));
      if (path === "/api/prompt") {
        // Ensures an attach client exists so the screen mirror is live, then reports the current menu (if any).
        const key = normKey(String(body.target || ""));
        if (!targetCommand(key)) return json({ error: "bad target" }, 400);
        const fresh = !ptys.get(key) || ptys.get(key)!.exited;
        const p = getPty(key); if (!p) return json({ error: "too many open terminals" }, 429);
        p.lastClientAt = Date.now();
        if (fresh) await waitQuiet(p, 800, 6000);
        return json({ menu: parseMenu(p.lines()) });
      }
      if (path === "/api/new") return actNew(body);
      if (path === "/api/resume") return actResume(body);
      if (path === "/api/send") return actSend(body);
      if (path === "/api/keys") return actKeys(body);
      if (path === "/api/stop") return actStop(body);
      if (path === "/api/rm") return actRm(body);
    }
    return json({ error: "not found" }, 404);
  }
  return staticFile(path) ?? staticFile("/")!;
}

// The tailnet address whose authorisation a connection depends on (forwarded peer behind `tailscale serve`).
function authPeer(req: Request, ip?: string): string | undefined {
  const addr = (ip || "").replace(/^::ffff:/, "");
  if (addr !== "127.0.0.1" && addr !== "::1") return addr;
  const fwd = req.headers.get("x-forwarded-for"); if (!fwd) return undefined;
  const peer = fwd.split(",").map((x) => x.trim()).filter(Boolean).pop();
  return peer && peer !== "127.0.0.1" && peer !== "::1" ? peer : undefined;
}
setInterval(() => {
  whoisCache.clear();
  for (const ws of openSockets) {
    const peer = ws.data.peer; if (!peer) continue;
    if (!whoisCheck(peer).ok) { console.warn(`[auth] closing connection from ${peer}: no longer authorised`); try { ws.close(1008, "unauthorised"); } catch {} }
  }
}, 5 * 60_000);

const websocket = {
  open(ws: ServerWebSocket<WsData>) {
    openSockets.add(ws);
    const d = ws.data;
    if (d.kind === "proxy") { // relay to the node's own /ws/…; the node authorises this machine itself
      const up = new WebSocket(d.target); up.binaryType = "arraybuffer"; d.up = up;
      up.onopen = () => { for (const m of d.queue) up.send(m); d.queue = []; };
      up.onmessage = (m) => { try { typeof m.data === "string" ? ws.send(m.data) : ws.sendBinary(new Uint8Array(m.data as ArrayBuffer)); } catch {} };
      up.onclose = (e) => { try { ws.close(e.code >= 3000 || e.code === 1000 || e.code === 1008 ? e.code : 1011, e.reason || "machine closed the connection"); } catch {} };
      up.onerror = () => { try { ws.close(1011, "machine unreachable"); } catch {} };
      return;
    }
    if (d.kind === "pty") {
      const p = getPty(d.key); if (!p) { ws.close(1011, "spawn failed"); return; }
      p.clients.add(ws); p.lastClientAt = Date.now();
      ws.send(JSON.stringify({ t: "hello", cols: p.cols, rows: p.rows }));
      const r = p.replay(); if (r.length) ws.sendBinary(r);
      setTimeout(() => p.nudge(), 120);
    } else {
      const evs = d.tail.readNew();
      ws.send(JSON.stringify({ t: "events", evs: evs.slice(-d.limit), truncated: evs.length > d.limit || d.tail.startedMidFile, initial: true }));
      d.timer = setInterval(() => {
        const n = d.tail.readNew(); if (n.length) ws.send(JSON.stringify({ t: "events", evs: n }));
      }, 700);
    }
  },
  message(ws: ServerWebSocket<WsData>, msg: string | Buffer) {
    const d = ws.data;
    if (d.kind === "proxy") { if (d.up?.readyState === 1) d.up.send(msg); else if (d.queue.length < 200) d.queue.push(msg); return; }
    if (d.kind !== "pty") return;
    const p = ptys.get(d.key); if (!p) return;
    let m: any; try { m = JSON.parse(String(msg)); } catch { return; }
    p.lastClientAt = Date.now();
    if (m.t === "in" && typeof m.d === "string") p.write(m.d);
    else if (m.t === "resize") p.resize(m.cols, m.rows);
    else if (m.t === "redraw") p.nudge();
  },
  close(ws: ServerWebSocket<WsData>) {
    openSockets.delete(ws);
    const d = ws.data;
    if (d.kind === "pty") { const p = ptys.get(d.key); if (p) { p.clients.delete(ws); p.lastClientAt = Date.now(); } }
    else if (d.kind === "proxy") { try { d.up?.close(); } catch {} }
    else if (d.timer) clearInterval(d.timer);
  },
  idleTimeout: 120, sendPings: true,
};

function tailscaleIP(): string | null {
  const r = run([TAILSCALE, "ip", "-4"], { timeoutMs: 5000 });
  const ip = r.out.trim().split("\n")[0]; return /^100\./.test(ip) ? ip : null;
}
const hosts = ["127.0.0.1"]; if (BIND_TS) { const ip = tailscaleIP(); if (ip) hosts.push(ip); else console.warn("[quarterdeck] no Tailscale IP; loopback only"); }
for (const hostname of hosts) {
  Bun.serve({ hostname, port: PORT, fetch: handle as any, websocket: websocket as any });
  console.log(`[quarterdeck] listening http://${hostname}:${PORT}  (owner=${OWNER})`);
}
