"""Fictional data for the README screenshots. Nothing here comes from a real machine or session."""
import time, datetime

NOW = int(time.time() * 1000)
def iso(mins_ago): return datetime.datetime.utcfromtimestamp((NOW - mins_ago * 60_000) / 1000).strftime("%Y-%m-%dT%H:%M:%S.000Z")
H = "/Users/alex"

def job(id, name, state, detail, cwd, mins, needs=None, output=None, phase=None, tempo="idle", profile="default"):
    return {"kind": "job", "id": id, "sessionId": f"{id}-0000-4000-8000-000000000000", "name": name, "state": state, "tempo": tempo,
            "detail": detail, "needs": needs, "output": output, "intent": name, "cwd": cwd, "createdAt": iso(mins + 90), "updatedAt": iso(mins),
            "profile": profile, "phase": phase or ("working" if state == "working" else "idle"), "activityAt": NOW - mins * 60_000}
def transcript(id, title, prompt, cwd, mins):
    return {"kind": "transcript", "sessionId": f"{id}-0000-4000-8000-000000000000", "title": title, "cwd": cwd, "lastPrompt": prompt, "mtime": NOW - mins * 60_000, "size": 180000, "project": "p"}
def machine(node, label, disk, load, cpus, mem=None, gpu=None, claude="2.1.332"):
    return {"node": {"id": node, "label": label}, "quarterdeck": {"version": "0.2.0", "build": "demo00000000", "protocol": 2, "startedAt": NOW - 86400_000},
            "health": {"at": NOW, "hostname": label, "platform": "x", "cpus": cpus, "load1": load, "uptimeS": 400000,
                       "disk": {"path": H, "freePct": disk, "freeGB": round(disk * 9.3, 1), "totalGB": 930, "low": disk < 10},
                       "mem": {"usedPct": mem if mem is not None else -1, "totalGB": 64}, "gpu": gpu or [], "claudeVersion": claude}}
ACCOUNTS = [{"id": "default", "dir": "~/.claude", "isDefault": True, "loggedIn": True, "email": "alex@example.com", "planTier": "max", "loginExpiresAt": "2027-01-18T10:00:00Z"},
            {"id": "work", "dir": "~/.claude-work", "isDefault": False, "loggedIn": True, "email": "alex@acme.example", "planTier": "team", "loginExpiresAt": "2027-01-09T10:00:00Z"}]

PAY = job("a41c07e2", "payments webhook retries", "blocked", "retry policy drafted; one decision open", f"{H}/code/shop-api", 3,
          needs="Stripe marks an event failed after 3 attempts. Keep 3 retries with backoff, or raise to 5?", phase="waiting", tempo="blocked", profile="work")
LOCAL_JOBS = [
    PAY,
    job("7be2190d", "flaky checkout test", "working", "bisecting: 6 of 9 commits checked", f"{H}/code/shop-web", 0, phase="working", tempo="active"),
    job("c0ffee12", "dependency upgrade plan", "done", "plan ready: 14 packages, 2 need code changes", f"{H}/code/shop-api", 42,
        output="Upgrade plan written to docs/upgrade-2027-01.md: 12 packages are drop-in, 2 (the ORM and the queue client) need small code changes."),
    job("d15ea5e0", "changelog for 3.8", "done", "changelog drafted from 61 merged PRs", f"{H}/code/shop-api", 190,
        output="CHANGELOG.md updated for 3.8: 9 features, 23 fixes, 2 breaking changes called out at the top."),
    job("0b5e55ed", "landing page copy", "done", "three headline options, hero rewritten", f"{H}/code/site", 300, output="Rewrote the hero and added three headline options."),
]
LAPTOP_JOBS = [job("51de0a11", "search indexing speedup", "working", "profiling the tokenizer; first fix gives 2.1× on the sample", f"{H}/code/search", 1, phase="working", tempo="active"),
               job("ab12cd34", "docs link check", "done", "4 dead links fixed", f"{H}/code/docs", 600, output="Fixed 4 dead links; 212 links checked.")]
GPU_JOBS = [job("9f00d1e5", "nightly eval sweep", "working", "run 37 of 120 · best so far 0.812", "/home/alex/eval", 0, phase="working", tempo="active"),
            job("e7a11ed0", "dataset dedup", "done", "removed 3.1% near-duplicates", "/home/alex/data", 800, output="Deduplicated: 3.1% near-duplicates removed, report in out/dedup.md.")]

SESSIONS = {"jobs": LOCAL_JOBS, "transcripts": [transcript("11aa22bb", "release checklist", "walk me through the release checklist", f"{H}/code/shop-api", 75),
                                               transcript("33cc44dd", "why is CI slow", "why did CI go from 6 to 14 minutes?", f"{H}/code/shop-web", 400)],
            "tmux": [{"kind": "tmux", "name": "dev", "windows": 3, "attached": 1, "activity": NOW - 240_000, "path": f"{H}/code/shop-web", "command": "zsh"}],
            "cwds": [f"{H}/code/shop-api", f"{H}/code/shop-web"], "ptys": [], "accounts": ACCOUNTS, "machine": machine("desk", "Desk", 41.5, 2.3, 12),
            "push": {"devices": 2, "lost": None}, "who": "alex@example.com", "now": NOW}
FLEET = {"self": {"id": "desk", "label": "Desk"}, "nodes": [
    {"id": "laptop", "label": "Laptop", "online": True, "lastOk": NOW, "error": "", "data": {"jobs": LAPTOP_JOBS, "transcripts": [], "tmux": [], "cwds": [], "ptys": [], "accounts": ACCOUNTS[:1], "machine": machine("laptop", "Laptop", 22.8, 1.1, 10)}},
    {"id": "gpu", "label": "GPU box", "online": True, "lastOk": NOW, "error": "", "data": {"jobs": GPU_JOBS, "transcripts": [], "tmux": [], "cwds": [], "ptys": [], "accounts": ACCOUNTS[:1],
        "machine": machine("gpu", "GPU box", 63.0, 7.4, 64, mem=38, gpu=[{"name": "RTX", "utilPct": 96, "memUsedGB": 21.4, "memTotalGB": 24}])}}]}
def _days():
    out = []; vals = [310, 120, 540, 60, 480, 910, 150, 270, 90, 330, 420, 760, 280, 390]
    for i, v in enumerate(vals):
        d = datetime.date.today() - datetime.timedelta(days=13 - i)
        out.append({"date": d.isoformat(), "out": v * 1000, "inp": v * 40_000, "cr": v * 180_000, "turns": v // 2, "prompts": v // 14, "tools": v, "sessions": 3 + (v % 9), "models": {"opus": v * 800, "haiku": v * 200}})
    return out
STATS = {"ready": True, "updatedAt": NOW - 120_000, "days": _days(), "quota": None,
         "top": [{"name": "nightly eval sweep", "href": "#/job/9f00d1e5/gpu", "tokens": 1_240_000}, {"name": "flaky checkout test", "href": "#/job/7be2190d", "tokens": 610_000},
                 {"name": "payments webhook retries", "href": "#/job/a41c07e2", "tokens": 388_000}, {"name": "dependency upgrade plan", "href": "#/job/c0ffee12", "tokens": 212_000}]}

def ev(k, i, mins, **kw): return {"k": k, "id": f"e{i}", "ts": iso(mins), **kw}
CHAT = [
    ev("user", 1, 14, text="Our Stripe webhook handler sometimes processes the same event twice. Find out why and fix it, then look at the retry policy."),
    ev("assistant", 2, 14, text="I'll look at the handler and the delivery log first."),
    ev("tool", 3, 13, name="Bash", summary="grep -rn \"event.id\" src/webhooks/", input="{\n  \"command\": \"grep -rn \\\"event.id\\\" src/webhooks/\"\n}", toolId="t1"),
    ev("result", 4, 13, toolId="t1", text="src/webhooks/stripe.ts:41:  const seen = await cache.get(event.id)\nsrc/webhooks/stripe.ts:58:  await cache.set(event.id, 1, { ttl: 60 })", isError=False),
    ev("tool", 5, 12, name="Read", summary="src/webhooks/stripe.ts", input="{\n  \"file_path\": \"src/webhooks/stripe.ts\"\n}", toolId="t2"),
    ev("result", 6, 12, toolId="t2", text="(92 lines)", isError=False),
    ev("assistant", 7, 11, text="Found it. The handler marks an event as seen **after** it has done the work, and only for 60 seconds:\n\n| | Before | After |\n|---|---|---|\n| When it is marked | after processing | before processing |\n| How long | 60 s | 72 h (Stripe's retry window) |\n| Two deliveries at once | both run | the second one stops |\n\nSo a slow run plus Stripe's own retry gave two full runs."),
    ev("tool", 8, 9, name="Edit", summary="src/webhooks/stripe.ts", input="{\n  \"file_path\": \"src/webhooks/stripe.ts\"\n}", toolId="t3"),
    ev("result", 9, 9, toolId="t3", text="The file src/webhooks/stripe.ts has been updated.", isError=False),
    ev("tool", 10, 7, name="Bash", summary="npm test -- webhooks", input="{\n  \"command\": \"npm test -- webhooks\"\n}", toolId="t4"),
    ev("result", 11, 7, toolId="t4", text="PASS  test/webhooks/stripe.test.ts\n  ✓ processes an event once (31 ms)\n  ✓ second delivery of the same event is ignored (12 ms)\n  ✓ two deliveries at the same time: one runs (44 ms)\n\nTests: 3 passed, 3 total", isError=False),
    ev("assistant", 12, 4, text="The duplicate is fixed and covered by three tests.\n\nOne decision is yours: the retry policy. Stripe gives up on an event after its own schedule, but **our** worker marks a job failed after 3 attempts."),
]
MENU = {"title": "How many retries should the worker make before it marks a webhook job failed?", "tabs": "", "footer": "", "multiSelect": False, "hasTabs": False,
        "options": [{"n": 1, "label": "Keep 3, add backoff (recommended)", "desc": "1 s, 10 s, 60 s — covers short outages", "selected": True, "checked": None},
                    {"n": 2, "label": "Raise to 5", "desc": "adds 5 min and 30 min — covers a deploy", "selected": False, "checked": None},
                    {"n": 3, "label": "Leave as it is", "desc": "3 attempts, no backoff", "selected": False, "checked": None}]}
LIVE_TEXT = ("With backoff in place, a short outage on our side no longer turns into a failed job.\n\nWhat changes:\n\n"
             "1. Attempt 1 runs at once, as before.\n2. Attempt 2 waits 1 second, attempt 3 waits 10 seconds.\n3. After the third failure the job is parked and you get a notification.\n\n"
             "Nothing changes for events that succeed the first time, which is 99.4% of them in last month's log.")
CHANGES = {"files": [{"path": f"{H}/code/shop-api/src/webhooks/stripe.ts", "rel": "src/webhooks/stripe.ts", "repo": "shop-api", "last": iso(9), "tool": "Edit", "n": 2, "status": "M", "add": 9, "del": 4,
    "diff": "diff --git a/src/webhooks/stripe.ts b/src/webhooks/stripe.ts\n--- a/src/webhooks/stripe.ts\n+++ b/src/webhooks/stripe.ts\n@@ -38,12 +38,17 @@ export async function handle(event: Stripe.Event) {\n-  const seen = await cache.get(event.id)\n-  if (seen) return\n+  // Claim the event before doing any work: a second delivery (Stripe's retry, or two workers at once)\n+  // must stop here, not after the order has been touched.\n+  const claimed = await cache.setIfAbsent(event.id, 1, { ttl: RETRY_WINDOW })\n+  if (!claimed) return\n \n   await applyToOrder(event)\n-  await cache.set(event.id, 1, { ttl: 60 })\n+  metrics.count(\"webhook.processed\", { type: event.type })\n }\n"},
    {"path": f"{H}/code/shop-api/test/webhooks/stripe.test.ts", "rel": "test/webhooks/stripe.test.ts", "repo": "shop-api", "last": iso(8), "tool": "Write", "n": 1, "status": "new", "add": 41, "del": 0,
     "diff": "+import { handle } from \"../../src/webhooks/stripe\"\n+\n+test(\"second delivery of the same event is ignored\", async () => {\n+  await handle(event)\n+  await handle(event)\n+  expect(orders.updates).toBe(1)\n+})"}]}
PROJECTS = {"home": H, "projects": [
    {"path": f"{H}/code/shop-api", "name": "shop-api", "src": "recent", "git": True, "claudeMd": True, "trust": "yes"},
    {"path": f"{H}/code/shop-web", "name": "shop-web", "src": "recent", "git": True, "claudeMd": True, "trust": "yes"},
    {"path": f"{H}/code/search", "name": "search", "src": "root", "git": True, "claudeMd": False, "trust": "yes"},
    {"path": f"{H}/code/site", "name": "site", "src": "root", "git": True, "claudeMd": False, "trust": "yes"},
    {"path": f"{H}/code/experiments", "name": "experiments", "src": "root", "git": True, "claudeMd": False, "trust": "parent"}]}
MEMORY = {"dir": f"{H}/code/shop-api", "trust": "yes", "layers": [
    {"label": "global", "path": "~/.claude/CLAUDE.md", "bytes": 6200},
    {"label": "parent", "path": "~/code/CLAUDE.md", "bytes": 3100},
    {"label": "this folder", "path": "~/code/shop-api/CLAUDE.md", "bytes": 9400},
    {"label": "this folder rules", "path": "~/code/shop-api/.claude/rules/", "bytes": 12800, "note": "6 rule files (some load only for matching paths)"},
    {"label": "auto-memory", "path": "~/.claude/projects/-Users-alex-code-shop-api/memory/MEMORY.md", "bytes": 1400, "note": "11 index lines · 9 topic files"}]}
TERMINAL = ("\x1b[2J\x1b[H\x1b[38;5;208m●\x1b[0m The duplicate is fixed and covered by three tests.\r\n\r\n"
            "  One decision is yours: the retry policy.\r\n\r\n"
            "\x1b[2m────────────────────────────────────────────────────────────────────────\x1b[0m\r\n"
            " \x1b[1mHow many retries should the worker make before it marks a webhook job failed?\x1b[0m\r\n\r\n"
            " \x1b[36m❯ 1. Keep 3, add backoff (recommended)\x1b[0m\r\n      1 s, 10 s, 60 s — covers short outages\r\n"
            "   2. Raise to 5\r\n      adds 5 min and 30 min — covers a deploy\r\n"
            "   3. Leave as it is\r\n      3 attempts, no backoff\r\n\r\n"
            "\x1b[2m Enter to select · ↑/↓ to navigate · Esc to cancel\x1b[0m\r\n")
