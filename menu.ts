// Parse a Claude Code selection menu from the visible screen: AskUserQuestion (single, multi-select,
// several questions with a tab bar and a "Review your answers" page), permission prompts, and any other
// numbered "1. … 2. …" list Claude is waiting on.
export type MenuOption = { n: number; label: string; desc: string; selected: boolean; checked: boolean | null };
export type Menu = {
  title: string; tabs: string; options: MenuOption[]; footer: string;
  multiSelect: boolean;  // options are checkboxes: digits toggle, nothing is submitted until you move on
  hasTabs: boolean;      // several questions / a Submit page: Tab (→) and Shift-Tab (←) move between them
};

const OPT_RE = /^\s*(?:[❯›>]\s*)?(\d{1,2})[.)]\s+(.+?)\s*$/;
const SEP_RE = /^[─━]{10,}/;
const FOOTER_RE = /Enter to (select|confirm)|to navigate|Esc to (cancel|exit)/i;
const CHECK_RE = /^\[( |✔|✓|x|X)\]\s*(.*)$/;

// Menus without a footer line (e.g. AskUserQuestion's "Review your answers" page): the last numbered block,
// right above a separator, with no empty input prompt after it — the normal screen always ends in "❯ ".
function footerlessEnd(lines: string[]): number {
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (OPT_RE.test(lines[i])) { last = i; break; }
  if (last < 0) return -1;
  const after = lines.slice(last + 1);
  if (after.some((l) => /^\s*❯\s*$/.test(l))) return -1;
  const sepAt = after.findIndex((l) => SEP_RE.test(l.trim()));
  if (sepAt < 0 || after.slice(0, sepAt).some((l) => l.trim() && !/^\s{2,}\S/.test(l))) return -1;
  return last + 1 + sepAt;
}

export function parseMenu(lines: string[]): Menu | null {
  let fi = lines.findLastIndex((l) => FOOTER_RE.test(l));
  let footer = fi >= 0 ? lines[fi].trim() : "";
  if (fi < 0) { fi = footerlessEnd(lines); if (fi < 0) return null; }
  // Walk up from the footer: menu numbers count down to 1, so the option numbered 1 is the top.
  let first = -1, gap = 0, expect = Infinity;
  for (let i = fi - 1; i >= 0 && i >= fi - 60; i--) {
    const m = lines[i].match(OPT_RE);
    if (m) {
      const n = +m[1];
      if (n >= expect) break; // numbering restarted: an older list above the menu
      first = i; expect = n; gap = 0;
      if (n === 1) break;
      continue;
    }
    if (first >= 0 && ++gap > 14) break;
  }
  if (first < 0 || expect !== 1) return null; // no complete 1..N menu
  const options: MenuOption[] = [];
  for (let i = first; i < fi; i++) {
    const m = lines[i].match(OPT_RE);
    if (m) {
      const cb = m[2].match(CHECK_RE);
      options.push({ n: +m[1], label: cb ? cb[2] : m[2], desc: "", selected: /^\s*[❯›>]/.test(lines[i]), checked: cb ? cb[1] !== " " : null });
      continue;
    }
    const t = lines[i].trim();
    if (!t || SEP_RE.test(t) || t === "Submit") continue; // "Submit" = the unnumbered row under a multi-select list
    if (options.length) options[options.length - 1].desc = (options[options.length - 1].desc + " " + t).trim();
  }
  if (options.length < 2) return null;
  // Title: non-empty lines between the previous separator and the first option.
  let ti = first - 1; const head: string[] = [];
  while (ti >= 0 && !SEP_RE.test(lines[ti].trim()) && head.length < 12) { if (lines[ti].trim()) head.unshift(lines[ti].trim()); ti--; }
  const tabs = head.find((l) => /[☐☑☒✔✓]/.test(l) && /(←|→|Submit)/.test(l)) || head.find((l) => /^[☐☑☒]/.test(l)) || "";
  return {
    title: head.filter((l) => l !== tabs).join("\n"), tabs, options, footer,
    multiSelect: options.some((o) => o.checked !== null), hasTabs: /(←|→|Submit)/.test(tabs),
  };
}
