// Watchdog: if the main thread stops ticking (stuck in a blocking call, e.g. a macOS privacy dialog holding an
// openat() forever), a separate thread kills the process so launchd / systemd starts a fresh one.
// A hung process is never restarted by KeepAlive / Restart=always on its own — only a dead one is.
// The worker writes its message straight to fd 2 (console output may be routed through the stuck main thread).
const WORKER = `
const { writeSync } = require("node:fs");
let hb, limit;
self.onmessage = (e) => {
  hb = new Int32Array(e.data.buf); limit = e.data.limit;
  setInterval(() => {
    const age = Math.floor(Date.now() / 1000) - Atomics.load(hb, 0);
    if (age > limit) {
      try { writeSync(2, "[watchdog] main thread unresponsive for " + age + " s — exiting so the service manager restarts it\\n"); } catch {}
      process.kill(process.pid, "SIGKILL");
    }
  }, 2000);
};
`;

export function startWatchdog(limitSeconds: number): boolean {
  if (!(limitSeconds > 0)) return false;
  const buf = new SharedArrayBuffer(4); const hb = new Int32Array(buf);
  const beat = () => Atomics.store(hb, 0, Math.floor(Date.now() / 1000));
  beat(); setInterval(beat, 1000);
  const w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "application/javascript" })));
  w.postMessage({ buf, limit: Math.max(10, limitSeconds) });
  w.unref?.();
  return true;
}
