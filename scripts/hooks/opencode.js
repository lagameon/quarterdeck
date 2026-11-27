// OpenCode plug-in: tell Quarterdeck when a session finishes a turn or asks for permission.
// Copy to ~/.config/opencode/plugins/ (every project) or <project>/.opencode/plugins/ (one project).
// It runs scripts/qd-notify — put that on your PATH, or set QD_NOTIFY to its full path.
// Tested with OpenCode 1.19 (events: session.idle, permission.asked, question.asked).
const QD = process.env.QD_NOTIFY || "qd-notify";
export const QuarterdeckNotify = async ({ $ }) => ({
  event: async ({ event }) => {
    const p = event.properties || {};
    if (event.type === "session.idle") await $`${QD} opencode done`.quiet().nothrow();
    else if (event.type === "permission.asked") await $`${QD} opencode needs ${`Permission: ${p.permission || ""} ${(p.patterns || []).join(" ")}`.trim().slice(0, 300)}`.quiet().nothrow();
    else if (event.type === "question.asked") await $`${QD} opencode needs ${"Question"}`.quiet().nothrow();
  },
});
