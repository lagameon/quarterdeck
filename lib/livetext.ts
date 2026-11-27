// The reply Claude is writing right now, read off the terminal screen.
// The transcript only gets a message once it is complete, so the Chat view would show nothing and then everything at
// once. The TUI, however, prints the text as it arrives: "⏺ " starts a reply, its following lines are indented by
// two spaces, and while a turn runs the footer says "esc to interrupt". This turns that part of the screen back into
// text for a live preview; the finished message from the transcript replaces it. It is a preview: only what is on the
// screen (the tail of a long reply), re-joined from the terminal's line wrapping.
const RULE = /^[─━]{20,}/;
const SPINNER = /^\S\s+\S+…/;              // "✻ Sautéing… (12s · ↓ 1.2k tokens)"
const RIGHT_NOTE = /^\s{30,}\S/;            // right-aligned status such as "◐ medium · /effort"
const wide = (ch: string) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch);
const width = (s: string) => [...s].reduce((n, c) => n + (wide(c) ? 2 : 1), 0);

export function liveText(lines: string[], cols: number): { text: string; partial: boolean } | null {
  const L = lines.map((l) => l.replace(/\s+$/, ""));
  if (!L.slice(-4).some((l) => l.includes("esc to interrupt"))) return null;   // no turn in progress
  // The input box: a rule, the "❯" line(s), a rule. Everything above its upper rule is conversation.
  let box = -1;
  for (let i = L.length - 1; i > 0; i--) if (/^\s*❯/.test(L[i]) && RULE.test(L[i - 1])) { box = i - 1; break; }
  if (box < 0) return null;
  let end = box;                                                               // exclusive
  while (end > 0 && (!L[end - 1] || RIGHT_NOTE.test(L[end - 1]) || SPINNER.test(L[end - 1]))) end--;
  // Start of the last block: a line beginning at column 0 ("⏺ reply", "⏺ Tool(…)", "❯ prompt", banner …).
  let start = -1;
  for (let i = end - 1; i >= 0; i--) if (L[i] && !L[i].startsWith(" ")) { start = i; break; }
  const partial = start < 0;                                                   // its first line has scrolled off the top
  const block = L.slice(partial ? 0 : start, end);
  if (!block.length) return null;
  if (!partial) {
    if (!block[0].startsWith("⏺ ")) return null;                               // a prompt echo, the banner …: nothing being written yet
    if (/^⏺ [\w.:-]+\(/.test(block[0]) || /^\s+⎿/.test(block[1] || "")) return null; // a tool call, not prose
    block[0] = "  " + block[0].slice(2);
  } else if (block.some((l) => /^\s+⎿/.test(l))) return null;
  // Undo the terminal's wrapping: a line that fills the width continues on the next one.
  const out: string[] = []; let cur = "", prevFull = false;
  for (const raw of block) {
    const line = raw.startsWith("  ") ? raw.slice(2) : raw;
    if (!line.trim()) { if (cur) out.push(cur); out.push(""); cur = ""; prevFull = false; continue; }
    if (cur && prevFull) {
      const add = line.replace(/^\s+/, ""); const a = cur.slice(-1), b = add[0] || "";
      cur += (wide(a) || wide(b) || /[\s\-/]/.test(a) ? "" : " ") + add;
    } else { if (cur) out.push(cur); cur = line; }
    prevFull = width(raw) >= cols - 10;
  }
  if (cur) out.push(cur);
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? { text: text.slice(-8000), partial } : null;
}
