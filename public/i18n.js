// UI language. The English text is the key; a missing translation falls back to English, so a new string never
// breaks the page — it just shows in English until someone adds it here. {name} = a value filled in at runtime.
// Language: "lang" in the server's config.json ("en" default, "zh"); a device can override it (stored locally).
let lang = "en";
export const getLang = () => lang;
export function setLang(l) { lang = DICT[l] ? l : "en"; document.documentElement.lang = lang === "zh" ? "zh-CN" : "en"; }
export function t(key, vars) {
  let s = (lang !== "en" && DICT[lang]?.[key]) || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
// Static text in index.html: data-i18n (text), data-i18n-title, data-i18n-placeholder. The English original is kept
// on the element, so switching language back and forth works.
export function translateStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) { el.dataset.i18nKey ??= el.textContent; el.textContent = t(el.dataset.i18nKey); }
  for (const a of ["title", "placeholder"]) for (const el of root.querySelectorAll(`[data-i18n-${a}]`)) {
    const k = `i18nKey${a[0].toUpperCase()}${a.slice(1)}`; el.dataset[k] ??= el.getAttribute(a) || ""; el.setAttribute(a, t(el.dataset[k]));
  }
}

const zh = {
  // header, tabs, dialogs (index.html)
  "Back to dashboard": "返回首页", "Switch session (⌘K)": "切换会话（⌘K）", "Chat": "对话", "Terminal": "终端", "Split": "分屏", "Changes": "改动",
  "Enable notifications": "开启通知", "New session (Alt+N)": "新建会话（Alt+N）", "＋ New": "＋ 新建", "Filter sessions…": "筛选会话…",
  "↓ latest": "↓ 最新", "Send": "发送", "New background session": "新建后台会话", "Machine": "机器", "Account": "账号", "Project": "项目",
  "Filter projects…": "筛选项目…", "Folder": "文件夹", "Name (optional)": "名称（可选）", "Prompt": "任务", "Permission mode": "权限模式",
  "Cancel": "取消", "Start": "开始", "Jump to session…  (↑↓ Enter)": "跳到会话…（↑↓ 回车）", "Language": "语言",
  // states
  "working": "运行中", "blocked": "等你", "done": "完成", "failed": "失败", "stopped": "已停止",
  // accounts
  "default": "默认", "not logged in": "未登录",
  // in-page notices
  "needs you": "需要你", "Notifications are on for this device — tap to turn them off": "这台设备已开通知——点一下关闭",
  "Notifications are off for this device — tap to turn them on": "这台设备已关通知——点一下开启",
  "{m}: Claude Code {v} is older than {n} on your other machines.": "{m}：Claude Code {v} 比其他机器上的 {n} 旧。",
  "Update to {v}": "更新到 {v}", "Runs the official 'claude update' on that machine": "在那台机器上执行官方的 claude update",
  "Update Claude Code on {m} now?\nIt runs the official 'claude update' there. Sessions that are running keep the old version until they are restarted.": "现在更新 {m} 上的 Claude Code？\n会在那台机器上执行官方的 claude update。正在运行的会话在重启之前仍用旧版本。",
  "{m}: Claude Code is now {v}": "{m}：Claude Code 现在是 {v}",
  "Notifications are off on this device. Tap the bell to turn them on again.": "这台设备的通知已关闭。再点铃铛可以重新开启。",
  
  "Push needs the HTTPS address, opened from the Home Screen app (see README)": "推送需要用 HTTPS 地址，并从主屏幕 App 打开（见 README）",
  "Push needs HTTPS or localhost (see README)": "推送需要 HTTPS 或 localhost（见 README）",
  "This browser has no Web Push. On iPhone: Share → Add to Home Screen, then open Quarterdeck from the Home Screen.": "这个浏览器不支持网页推送。iPhone 上：分享 → 添加到主屏幕，再从主屏幕打开 Quarterdeck。",
  "Notifications were not allowed": "没有允许通知", "Test sent to {n} device(s)": "测试已发到 {n} 台设备", "Push setup failed: {e}": "推送设置失败：{e}",
  // session lists
  "Needs you": "等你处理", "Running": "运行中", "Finished": "已结束", "Interactive": "交互会话", "persistent shell": "常驻 shell",
  "shell on {m}": "{m} 上的 shell", "persistent shell (tmux)": "常驻 shell（tmux）", "show {n} more": "再显示 {n} 个", "none": "无",
  "Finished background sessions": "已结束的后台会话", "Close and remove from the list (transcript is kept)": "关闭并从列表移除（对话记录保留）",
  "Close session": "关闭会话", "{n} attached": "{n} 个已连接", "{n} win": "{n} 个窗口", "nothing waiting on you": "没有在等你的",
  "Interactive sessions (resume)": "交互会话（可续接）", "no tmux sessions": "没有 tmux 会话", "Open shell (tmux “quarterdeck”)": "打开 shell（tmux「quarterdeck」）",
  "{m} is offline": "{m} 离线", " (last seen {t} ago)": "（{t} 前最后在线）",
  ": its sessions are shown as they were, and actions on them wait until it is back.": "：它的会话按最后一次的状态显示，对它的操作要等它恢复。",
  "Hide this hint": "不再显示", "Hide hint": "隐藏提示",
  "Open any session to get <b>Chat</b> · <b>Terminal</b> · <b>Split</b> (both side by side) · <b>Changes</b> (this session's diffs).": "打开任一会话可用 <b>对话</b> · <b>终端</b> · <b>分屏</b>（两者并排）· <b>改动</b>（这个会话改了哪些文件）。",
  "switch session": "切换会话", "switch view": "切换视图", "new": "新建", "type a message": "输入消息",
  '"{name}" is still running or waiting for you.\nStop it and remove it from the list?': "「{name}」还在运行或在等你。\n停止并从列表移除？",
  'Remove "{name}" from the list?': "把「{name}」从列表移除？",
  '(The transcript is kept — resume it later from "Interactive sessions".)': "（对话记录会保留，之后可在「交互会话」里续接。）",
  "removed": "已移除",
  // overview
  "building usage stats…": "正在生成用量统计…", "Quota {name} (7d)": "额度 {name}（7 天）", "no 5-hour limit": "无 5 小时限制",
  "5-hour window {p}%": "5 小时窗口 {p}%", "; snapshot {h}h old": "；快照 {h} 小时前", "snapshot {h}h old (updates only when Codex is used)": "快照 {h} 小时前（只在用 Codex 时更新）",
  "Quota {name}": "额度 {name}", "login expired — sign in to this account again": "登录失效，请重新登录这个账号", "; data is {h}h old": "；数据停在 {h} 小时前",
  "Quota unavailable": "额度不可用", "data is {h}h old": "数据停在 {h} 小时前", " (collector error)": "（采集出错）", "; not showing stale numbers": "，不显示旧数字",
  "Quota": "额度", "no data": "无数据", "Accounts": "账号", " · until {d}": " · 到 {d}", "Account {id} not logged in": "账号 {id} 未登录", "run": "运行",
  "Today · {out} out · {turns} turns · {done} done": "今天 · 输出 {out} · {turns} 回合 · 完成 {done}", " · quota {q}": " · 额度 {q}",
  "Today": "今天", "stats updated just now": "统计刚刚更新", "stats updated {t} ago": "统计更新于 {t} 前",
  "done today": "今天完成", "active sessions": "活跃会话", "your messages": "你发的消息", "Claude turns": "Claude 回合", "{n} tool calls": "工具调用 {n} 次",
  "output tokens": "输出 tokens", "input tokens": "读入 tokens", "{n} from cache": "其中缓存命中 {n}",
  "Output tokens per day (14 days)": "每天输出 tokens（14 天）", "Active sessions per day (14 days)": "每天活跃会话（14 天）",
  "output {o} · input {i}": "输出 {o} · 读入 {i}", "{t} turns · {n} tool calls": "{t} 回合 · 工具 {n} 次", "{s} active sessions · {p} messages from you": "活跃会话 {s} · 你发的消息 {p}",
  "Top sessions by tokens today": "今天最耗 tokens 的会话", "Collapse": "收起",
  // machines
  "{m} runs an older Quarterdeck": "{m} 运行的是旧版 Quarterdeck", " (protocol {p}, this page expects {e})": "（协议 {p}，本页需要 {e}）", ": deploy the update to it.": "：请给它部署更新。",
  "{m}: disk almost full — {p}% free ({g} GB).": "{m}：磁盘快满了——剩 {p}%（{g} GB）。", "{m}: Claude account {a} is logged out.": "{m}：Claude 账号 {a} 已登出。",
  "{m}: Claude login ({a}) expires today.": "{m}：Claude 登录（{a}）今天到期。", "{m}: Claude login ({a}) expires in {n} days.": "{m}：Claude 登录（{a}）{n} 天后到期。",
  "no machine data": "没有机器数据", " (older version)": "（旧版本）", "disk {p}% free": "磁盘剩 {p}%", "load {l}/{c}": "负载 {l}/{c}", "mem {p}%": "内存 {p}%",
  "login until {d}": "登录到 {d}",
  // session header
  "Details and actions": "详情和操作", "Stop": "停止", "× Close": "× 关闭", 'Stop session "{name}"? (The conversation is kept.)': "停止会话「{name}」？（对话会保留。）",
  "stopped": "已停止", "interactive transcript": "交互会话记录", "Account that resumes this conversation": "用哪个账号续接这段对话",
  "Resume in background": "在后台续接", "persistent — closing this page does not stop it": "常驻——关掉页面不会停止它",
  "Message → resumes this session in the background…": "输入消息 → 在后台续接这个会话…", "Message…  (Enter send · Shift+Enter newline)": "输入消息…（回车发送 · Shift+回车换行）", "Message…": "输入消息…",
  // chat
  "loading…": "加载中…", "(older messages omitted)": "（更早的消息已省略）", "Load earlier messages": "加载更早的消息", "sending…": "发送中…",
  "not confirmed yet": "尚未确认", "live connection lost — reconnecting…": "实时连接断开，正在重连…", "can't open this session's transcript (not found on that machine) — still trying; the Terminal view works": "打不开这个会话的对话记录（那台机器上没找到），仍在重试；终端视图可以正常用", "Claude is working": "Claude 正在工作",
  "sent — waiting for Claude to pick it up…": "已发送，等 Claude 接手…", "background": "后台", "{n} in background": "后台运行 {n} 个", "finished": "已结束", "running": "运行中",
  "{n} steps": "{n} 步", "sub-agent": "子代理", "sub-agent running": "子代理运行中", "(output file no longer exists)": "（输出文件已不存在）",
  "(no output yet)": "（还没有输出）", "(empty)": "（空）", "(no output)": "（无输出）", "error": "出错", "updated {t} ago": "{t} 前更新", "updated just now": "刚刚更新",
  "new since {t}": "{t} 之后的新消息",
  // changes
  "{n} file(s) edited by this session": "这个会话改了 {n} 个文件", "diff vs HEAD, current disk state": "对比 HEAD，磁盘当前状态",
  "This session hasn't edited any files.": "这个会话没有改过文件。", "no uncommitted changes (already committed or reverted)": "没有未提交的改动（已提交或已还原）",
  "no diff available": "没有可显示的差异", "{n} unchanged (already committed or reverted)": "{n} 个没有变化（已提交或已还原）",
  // terminal, key bar, composer
  "[process exited — reopen the session to restart it]": "[进程已退出——重新打开会话即可重启]", "[disconnected — reconnecting in {s}s]": "[连接断开——{s} 秒后重连]",
  "⟳ redraw": "⟳ 重绘", "sent": "已发送", "Resume this conversation as a background session? (If it is still open in a terminal, Claude starts a copy.)": "把这段对话作为后台会话续接？（如果它还在某个终端里开着，Claude 会另起一份。）",
  "resumed": "已续接", "started": "已开始",
  // menus in chat
  "Check the answers, then tap “Submit answers”": "核对答案，然后点「Submit answers」", "Tick as many as you like, then tap Next ›": "可以多选，选完点「下一步 ›」",
  "Pick one — it moves to the next question": "选一个，会自动进入下一题", "‹ Back": "‹ 上一步", "Next ›": "下一步 ›", "waiting for your choice": "等你选择", "⏎ Enter": "⏎ 回车",
  // new-session dialog
  "recent": "最近", "has its own CLAUDE.md": "有自己的 CLAUDE.md", "only a folder above it is trusted; background sessions need this folder itself": "只有上级文件夹被信任；后台会话需要这个文件夹本身被信任",
  "not trusted yet": "尚未信任", "untrusted": "未信任", "no match: type the folder below": "没有匹配：在下面直接输入文件夹",
  "Memory this session loads, top to bottom": "这个会话会加载的记忆（从上到下）", "no CLAUDE.md or memory files for this folder": "这个文件夹没有 CLAUDE.md 或记忆文件",
  "⚠ Not trusted yet: a background session can't start here until Claude Code trusts this folder itself": "⚠ 尚未信任：Claude Code 信任这个文件夹本身之前，后台会话不能在这里启动",
  " (a folder above it is trusted, but that doesn't count for background sessions)": "（上级文件夹被信任，但对后台会话不算数）",
  "Open Claude here to trust it": "在这里打开 Claude 来信任它", "no match": "没有匹配",
  "← does nothing here: Claude's session overview is the Quarterdeck home page": "这里按 ← 不起作用：会话总览就是 Quarterdeck 首页", "Notifications reach no device since {d} ({n} not delivered): the phone's subscription ended. Open Quarterdeck on the phone and tap 🔔.": "从 {d} 起通知发不到任何设备（已有 {n} 条没送达）：手机上的订阅失效了。在手机上打开 Quarterdeck，点一下 🔔。",
  "updating…": "更新中…", "A new version is ready — tap to reload": "有新版本——点这里刷新",
  "global": "全局", "global rules": "全局规则", "parent": "上级", "parent rules": "上级规则", "this folder": "本文件夹", "this folder rules": "本文件夹规则", "auto-memory": "自动记忆",
};
const DICT = { en: {}, zh };
