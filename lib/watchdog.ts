// Watchdog: if the main thread stops ticking (stuck in a blocking call, e.g. a macOS privacy dialog holding an
// openat() forever), a separate thread kills the process so launchd / systemd starts a fresh one.
// A hung process is never restarted by KeepAlive / Restart=always on its own — only a dead one is.
// The worker writes its message straight to fd 2 (console output may be routed through the stuck main thread).
//
// A machine that slept is not hung: after a wake the clock has jumped, and the main thread's last tick looks
// minutes old (seen on a laptop: "unresponsive for 1076 s", seven needless restarts). The worker's own timer
// stalls during sleep too, so a gap in ITS ticks means "suspended" — then the main thread gets a fresh grace period.
const WORKER = `
const { writeSync } = require("node:fs");
let hb, limit, lastTick = Date.now(), graceUntil = 0;
self.onmessage = (e) => {
  hb = new Int32Array(e.data.buf); limit = e.data.limit;
  setInterval(() => {
    const now = Date.now();
    if (now - lastTick > 8000) graceUntil = now + limit * 1000;   // we did not run either: sleep / SIGSTOP, not a hang
    lastTick = now;
    const age = Math.floor(now / 1000) - Atomics.load(hb, 0);
    if (age > limit && now > graceUntil) {
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
