// This machine: which Quarterdeck build it runs (so the hub can spot a node left on an old version) and its
// health (disk, load, memory, GPU, Claude Code version), collected in the background every 30 s.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// Bump when the API between hub and nodes changes; the hub flags nodes reporting a lower number (or none).
export const PROTOCOL = 2;

// Content hash of the code that is running: the same files give the same id on every machine, git or not.
export function buildId(root: string): string {
  const h = createHash("sha256");
  const add = (rel: string) => { try { h.update(rel + "\0"); h.update(readFileSync(join(root, rel))); h.update("\0"); } catch {} };
  const list = (dir: string, depth = 0): string[] => {
    let out: string[] = [];
    for (const n of (() => { try { return readdirSync(join(root, dir)).sort(); } catch { return []; } })()) {
      if (n.startsWith(".")) continue;
      const rel = dir ? `${dir}/${n}` : n;
      try { if (statSync(join(root, rel)).isDirectory()) { if (depth < 2) out = out.concat(list(rel, depth + 1)); } else out.push(rel); } catch {}
    }
    return out;
  };
  for (const f of ["server.ts", "menu.ts", "package.json", "bun.lock", ...list("lib"), ...list("public")]) add(f);
  return h.digest("hex").slice(0, 12);
}

type Run = (cmd: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>;
export type Health = {
  at: number; hostname: string; platform: string; cpus: number; load1: number; uptimeS: number;
  disk: { path: string; freePct: number; freeGB: number; totalGB: number } | null;
  mem: { usedPct: number; totalGB: number } | null;
  gpu: { name: string; utilPct: number; memUsedGB: number; memTotalGB: number }[];
  claudeVersion: string | null;
};

const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
async function disk(run: Run, path: string): Promise<Health["disk"]> {
  const r = await run(["df", "-Pk", path], { timeoutMs: 5000 });
  const cols = r.out.trim().split("\n").pop()?.split(/\s+/) || [];
  const used = Number(cols[2]) * 1024, avail = Number(cols[3]) * 1024;
  if (!(used + avail > 0)) return null;
  return { path, freePct: Math.round((avail / (used + avail)) * 1000) / 10, freeGB: gb(avail), totalGB: gb(used + avail) };
}
function mem(): Health["mem"] {
  const total = os.totalmem();
  if (process.platform === "linux") {
    try {
      const m = readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+) kB/);
      if (m) return { usedPct: Math.round((1 - (Number(m[1]) * 1024) / total) * 100), totalGB: gb(total) };
    } catch {}
  }
  return { usedPct: -1, totalGB: gb(total) }; // macOS "free" memory means little (caches); show the size only
}
async function gpus(run: Run): Promise<Health["gpu"]> {
  if (process.platform !== "linux") return [];
  const r = await run(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { timeoutMs: 8000 });
  if (r.code !== 0) return [];
  return r.out.trim().split("\n").filter(Boolean).map((l) => {
    const [name, util, used, total] = l.split(",").map((x) => x.trim());
    return { name, utilPct: Number(util) || 0, memUsedGB: Math.round(Number(used) / 102.4) / 10, memTotalGB: Math.round(Number(total) / 102.4) / 10 };
  });
}

export function startHealth(run: Run, claudeBin: string, home: string, everyMs = 30_000) {
  let latest: Health | null = null; let claudeVersion: string | null = null; let versionAt = 0; let busy = false;
  const collect = async () => {
    if (busy) return; busy = true;
    try {
      if (Date.now() - versionAt > 10 * 60_000) {
        const r = await run([claudeBin, "--version"], { timeoutMs: 10000 });
        if (r.code === 0) claudeVersion = r.out.trim().split(/\s+/)[0] || null; versionAt = Date.now();
      }
      const [d, g] = await Promise.all([disk(run, home), gpus(run)]);
      latest = { at: Date.now(), hostname: os.hostname().split(".")[0], platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length,
        load1: Math.round(os.loadavg()[0] * 10) / 10, uptimeS: Math.round(os.uptime()), disk: d, mem: mem(), gpu: g, claudeVersion };
    } catch (e: any) { console.warn(`[health] ${e?.message || e}`); } finally { busy = false; }
  };
  collect(); setInterval(collect, everyMs);
  return () => latest;
}
