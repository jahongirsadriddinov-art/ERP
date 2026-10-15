import type { AiBrainCfg, AiLimitsCfg, AiProviderCfg, AiSettingsData, AiTranscriptArchive, PlatformCompany, PlatformCompanyPatch, PlatformUsage, PlatformUsageRow } from "../api";

// Dasturchi paneli (AI platforma) uchun sof yordamchilar: server javoblarini bir shaklga keltirish
// (backend parallel yozilmoqda — massiv yoki {companies|items|archives} ko'rinishida kelishi mumkin).

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Massiv yoki {key: [...]} — birinchi topilgan massiv. */
export function pickList(data: unknown, keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of keys) { const v = (data as any)[k]; if (Array.isArray(v)) return v; }
  }
  return [];
}

export function normalizePlatformCompany(raw: any): PlatformCompany | null {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id || raw.companyId || raw._id);
  if (!id) return null;
  const u = raw.usage || {};
  const budget = u.budgetUsd ?? u.month?.budgetUsd ?? raw.monthlyBudgetUsd ?? raw.limits?.monthlyBudgetUsd;
  return {
    id,
    name: str(raw.name || raw.companyName) || id,
    aiEnabled: !!(raw.aiEnabled ?? raw.enabled),
    planHasFeature: typeof raw.planHasFeature === "boolean" ? raw.planHasFeature : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    attendanceEnabled: typeof raw.attendanceEnabled === "boolean" ? raw.attendanceEnabled : undefined,
    usage: {
      monthCostUsdMicros: num(raw.monthCostUsdMicros ?? u.monthCostUsdMicros ?? u.costUsdMicros ?? u.month?.costUsdMicros),
      sessions: num(raw.sessions ?? u.sessions ?? u.totals?.sessions),
      budgetUsd: typeof budget === "number" ? budget : undefined,
      exceeded: !!(raw.exceeded ?? u.exceeded ?? u.month?.exceeded),
    },
  };
}

export const normalizeCompanies = (data: unknown): PlatformCompany[] =>
  pickList(data, ["companies", "items", "data"]).map(normalizePlatformCompany).filter((x): x is PlatformCompany => !!x);

/** Arxivlar: server bitta kun (period) + qism (part) qaytaradi; eski shakl — periodFrom/periodTo. Yangisi yuqorida. */
export function normalizeArchives(data: unknown): AiTranscriptArchive[] {
  return pickList(data, ["items", "archives", "data"]).map((a: any) => {
    const from = str(a?.periodFrom || a?.period), to = str(a?.periodTo || a?.period);
    return {
      id: str(a?.id || a?._id), periodFrom: from, periodTo: to, size: num(a?.size), createdAt: str(a?.createdAt),
      companyId: a?.companyId ? str(a.companyId) : undefined, companyName: a?.companyName ? str(a.companyName) : undefined,
      part: typeof a?.part === "number" ? a.part : undefined, fileName: a?.fileName ? str(a.fileName) : undefined,
      conversations: typeof a?.counts?.conversations === "number" ? a.counts.conversations : undefined,
    };
  }).filter((a) => a.id).sort((a, b) => (a.periodTo < b.periodTo ? 1 : a.periodTo > b.periodTo ? -1 : (a.part || 0) - (b.part || 0)));
}

/** 1536 → "1.5 KB". */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

/** Arxiv fayli nomi (server Content-Disposition bermasa). */
export const archiveFileName = (a: Pick<AiTranscriptArchive, "periodFrom" | "periodTo" | "companyName" | "fileName">) => {
  if (a.fileName && /^[\w.-]{1,120}$/.test(a.fileName)) return a.fileName;
  const co = (a.companyName || "firma").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 40);
  const from = a.periodFrom.slice(0, 10), to = a.periodTo.slice(0, 10);
  return `ai-suhbatlar_${co}_${from === to ? from : `${from}_${to}`}.jsonl.gz`;
};

/** Qidiruv + xarajat bo'yicha tartiblash (eng qimmati yuqorida, keyin nom). */
export function filterCompanies(list: readonly PlatformCompany[], q: string): PlatformCompany[] {
  const s = q.trim().toLowerCase();
  return list.filter((c) => !s || c.name.toLowerCase().includes(s) || c.id.toLowerCase().includes(s))
    .sort((a, b) => b.usage.monthCostUsdMicros - a.usage.monthCostUsdMicros || a.name.localeCompare(b.name));
}

/** Dasturchi tahrir qiladigan qism (firma sozlamasidan). */
export interface PlatformDraft { enabled: boolean; brain: AiBrainCfg; limits: AiLimitsCfg; provider: AiProviderCfg }
export const DEF_BRAIN: AiBrainCfg = { provider: "gemini", fallback: "openrouter", effort: "low" };
export const DEF_LIMITS: AiLimitsCfg = { userSessionsPerHour: 6, companyMinutesPerDay: 120, monthlyBudgetUsd: 20, hardStop: true, botMsgsPer10Min: 20, toolCallsPerSession: 30 };
export const DEF_PROVIDER: AiProviderCfg = { primary: "gemini_live", fallback: "gemini_cascade" };

export function draftOf(s: Partial<AiSettingsData> | null | undefined): PlatformDraft {
  return { enabled: !!s?.enabled, brain: { ...DEF_BRAIN, ...(s?.brain || {}) }, limits: { ...DEF_LIMITS, ...(s?.limits || {}) }, provider: { ...DEF_PROVIDER, ...(s?.provider || {}) } };
}

/** Faqat o'zgargan bo'limlar (PATCH /platform/companies/:id → patch). Bo'sh model nomlari yuborilmaydi. */
export function companyPatch(server: PlatformDraft, draft: PlatformDraft): PlatformCompanyPatch {
  const p: PlatformCompanyPatch = {};
  if (server.enabled !== draft.enabled) p.enabled = draft.enabled;
  if (JSON.stringify(server.brain) !== JSON.stringify(draft.brain)) p.brain = draft.brain;
  if (JSON.stringify(server.limits) !== JSON.stringify(draft.limits)) p.limits = draft.limits;
  const prov = cleanProvider(draft.provider);
  if (JSON.stringify(cleanProvider(server.provider)) !== JSON.stringify(prov)) p.provider = prov;
  return p;
}

function cleanProvider(p: AiProviderCfg): AiProviderCfg {
  const out: any = { primary: p.primary, fallback: p.fallback };
  for (const k of ["liveModel", "textModel", "ttsModel", "transcribeModel"] as const) if (p[k]) out[k] = p[k];
  return out;
}

/** Davr (oxirgi N kun, Toshkent sanasi bilan) → {from, to}. */
export function rangeOfDays(days: number, today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Math.max(1, days) - 1));
  return { from: d.toISOString().slice(0, 10), to: today };
}

/** Sarf ro'yxati: yangi (companies) yoki eski (byCompany) shakl, qimmati yuqorida. */
export function usageRows(u: PlatformUsage | null | undefined): PlatformUsageRow[] {
  const rows = (u?.companies || u?.byCompany || []).filter((r) => r && r.companyId);
  return [...rows].sort((a, b) => num(b.costUsdMicros) - num(a.costUsdMicros));
}

/** Limit qiymatlari server chegaralarida (settings.ts bilan bir xil). */
export function validateLimits(l: AiLimitsCfg | undefined): boolean {
  if (!l) return true;
  const inR = (v: number, a: number, b: number) => Number.isFinite(v) && v >= a && v <= b;
  return inR(l.monthlyBudgetUsd, 0, 10000) && inR(l.userSessionsPerHour, 0, 60) && inR(l.companyMinutesPerDay, 0, 10000)
    && inR(l.botMsgsPer10Min, 1, 200) && inR(l.toolCallsPerSession, 1, 100);
}
