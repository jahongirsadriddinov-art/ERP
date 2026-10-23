// AI ofis unit testlari uchun umumiy agentlar ro'yxati (to'liq standart ro'yxat + Telegram akkauntlari + noma'lum jamoa).
export const AGENTS = [
  { id: "manager", team: "lead" },
  ...["backend", "frontend", "database", "designer", "office-designer", "devpanel", "payments", "feature", "finance", "chat"].map((id) => ({ id, team: "platform" })),
  ...["mobile", "windows", "android", "miniapp", "landing", "gps"].map((id) => ({ id, team: "apps" })),
  ...["ai", "erpbot", "devbot", "tgworker", "botdesign", "notify"].map((id) => ({ id, team: "ai" })),
  ...["tg:1", "tg:2", "tg:3", "tg:4", "tg:5", "tg:6", "tg:7", "tg:8"].map((id) => ({ id, team: "ai", kind: "tg" })),
  ...["security", "qa", "monitoring", "perf", "devops", "translator", "analytics"].map((id) => ({ id, team: "ops" })),
  ...["smm", "marketing", "support", "docs", "billing", "reporter", "custom-1"].map((id) => ({ id, team: "growth" })),
  ...["d", "o", "p", "b", "i"].map((id) => ({ id: `role-${id}`, team: "assistants", kind: "role" })),
  { id: "weird", team: "unknown-team" },
];
