import { API_BASE } from "../../api";

// AI ovozli yordamchi sozlamalari — REST mijozi va turlar (backend aiVoice/contracts.ts bilan mos).
// Token api.ts'dagi fetch interceptor orqali qo'shiladi. Xatolar tashlanmaydi — {ok:false,status,error}
// qaytadi (501 "hali tayyor emas" va 404 holatlari UI'da yumshoq ko'rsatiladi).

export type AiRole = "direktor" | "orinbosar" | "prorab" | "brigadir" | "ishchi";
export const AI_ROLES: AiRole[] = ["direktor", "orinbosar", "prorab", "brigadir", "ishchi"];
export type ChannelName = "telegram_call" | "bot_message" | "inapp_call" | "push" | "notify_manager";
export const CHANNEL_NAMES: ChannelName[] = ["bot_message", "telegram_call", "inapp_call", "push", "notify_manager"];
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface AiShift {
  id: string; name: string; objectIds: string[]; roles: AiRole[];
  workStart: string; callLeadMin: number; callTime: string; workdays: IsoWeekday[];
  lateAfterMin: number; absentCutoff: string; buttonWaitMin: number; maxLateMin: number;
  skipDates: string[]; extraWorkDates: string[];
}

export interface AiSettingsData {
  companyId: string;
  enabled: boolean;
  language: "uz" | "ru" | "auto";
  voiceName: string;
  timezone: "Asia/Tashkent";
  disclosureText?: string;
  attendance: { enabled: boolean; suppressLegacyMorningReminder: boolean; orinbosarCanEditSchedule: boolean; shifts: AiShift[] };
  calls: {
    maxAttemptsPerChannel: number; backoffMin: number[]; ringTimeoutSec: number; maxDurationSec: number;
    assistantMaxDurationSec: number; companyConcurrency: number; minGapSec: number; quietHours: { from: string; to: string };
    /** Firma barcha xodimlar nomidan AI qo'ng'iroqlariga rozilik bergan (standart true). Eski server — yo'q. */
    companyConsent?: boolean;
  };
  fallbackOrder: ChannelName[];
  reminders: { defaultLeadMin: number; defaultChannels: ChannelName[]; maxActivePerUser: number };
  tools: { byRole: Partial<Record<AiRole, string[]>>; allowOffShiftAssistant: boolean };
  /** Dasturchi bo'limlari: firma ko'rinishida (/admin/settings) KELMAYDI — faqat /platform/companies/:id. */
  provider?: AiProviderCfg;
  brain?: AiBrainCfg;
  limits?: AiLimitsCfg;
  privacy: { recordAudio: false; transcriptRetentionDays: number; auditRetentionDays: number };
  version: number;
  updatedBy?: string;
}

export interface AiProviderCfg { primary: "gemini_live" | "gemini_cascade"; fallback: "gemini_cascade" | "none"; liveModel?: string; textModel?: string; ttsModel?: string; transcribeModel?: string }
export interface AiBrainCfg { provider: "gemini" | "claude"; fallback: "openrouter" | "none"; effort: "low" | "medium" | "high" }
export interface AiLimitsCfg { userSessionsPerHour: number; companyMinutesPerDay: number; monthlyBudgetUsd: number; hardStop: boolean; botMsgsPer10Min: number; toolCallsPerSession: number }

export interface AiSettingsView {
  settings: AiSettingsData;
  editor: { canEditSchedule: boolean; canEditBossRows: boolean; canDownloadArchives?: boolean };
  /** Eski server qaytarishi mumkin; yangi firma ko'rinishida yo'q. */
  providers?: { gemini: boolean; openrouter: boolean; claude: boolean };
  status: { aiVoiceEnabled: boolean; planHasFeature: boolean; companyActive: boolean };
}

export interface AiToolEntry {
  name: string; kind: "read" | "write"; description: { uz: string; ru: string };
  maxRoles: AiRole[]; defaultRoles: AiRole[]; channels: string[]; purposes: string[];
}

export interface AiChannelsStatus {
  bot: { configured: boolean; username?: string; webhookSecretConfigured: boolean };
  telegramAccount: { status: string; username?: string; workerConnected: boolean; dailyCallCount: number; dailyCap: number };
}

export interface AiEmployeeRow {
  userId: string; name: string; role: string; telegramLinked: boolean; resolveStatus: string; callConsent: string;
  optOut: { calls: boolean; reminders: boolean; all: boolean }; channelOrder?: ChannelName[]; disabledChannels: ChannelName[];
  /** Xodimning alohida ish jadvali (null/yo'q — firma jadvali). Server qo'llamasa maydon kelmaydi. */
  scheduleOverride?: AiScheduleOverride | null;
  /** Samarali rozilik: AI shu xodimga qo'ng'iroq qila oladimi (firma roziligi, voz kechmagan). */
  callsAllowed?: boolean;
}

/** Xodim uchun alohida ish kunlari (ISO 1-7) va ixtiyoriy ish boshlanishi. */
export interface AiScheduleOverride { weekdays: IsoWeekday[]; workStart?: string }

/** Suhbatlar arxivi fayli (7 kundan keyin bazadan siqilgan JSONL faylga o'tkaziladi). Server: bitta kun (period) + qism (part). */
export interface AiTranscriptArchive {
  id: string; periodFrom: string; periodTo: string; size: number; createdAt: string; companyId?: string; companyName?: string;
  part?: number; fileName?: string; conversations?: number;
}

/** Dasturchi paneli: firma qatori (normalizePlatformCompany orqali). */
export interface PlatformCompany {
  id: string; name: string; aiEnabled: boolean; planHasFeature?: boolean; status?: string; attendanceEnabled?: boolean;
  usage: { monthCostUsdMicros: number; sessions: number; budgetUsd?: number; exceeded?: boolean };
}
/** PATCH /platform/companies/:id → {version, patch}. Faqat shu 4 bo'lim (server PLATFORM_KEYS). */
export interface PlatformCompanyPatch { enabled?: boolean; brain?: AiBrainCfg; limits?: AiLimitsCfg; provider?: AiProviderCfg }
/** GET /platform/companies/:id — to'liq sozlama (versiya bilan), provayder kalitlari holati, oylik xarajat. */
export interface PlatformCompanyView {
  companyId: string; name: string;
  status: { exists: boolean; active: boolean; planHasFeature: boolean; aiVoiceEnabled: boolean };
  settings: AiSettingsData;
  providers: { gemini: boolean; openrouter: boolean; claude: boolean };
  month: { costUsdMicros: number; budgetUsd: number; hardStop: boolean; exceeded: boolean };
}
export interface PlatformUsageRow { companyId: string; name?: string; costUsdMicros: number; sessions?: number; tokensIn?: number; tokensOut?: number; telegramCalls?: number; botMessages?: number }
export interface PlatformUsage extends Partial<AiUsageSummary> { byCompany?: PlatformUsageRow[]; companies?: PlatformUsageRow[] }
/** GET /platform/overview — platforma holati (server kaliti, provayderlar, navbat, arxivlar). */
export interface PlatformOverview {
  aiVoiceEnabled: boolean; providers: { gemini: boolean; openrouter: boolean; claude: boolean }; enabledCompanies: number;
  month: { month: string; costUsdMicros: number }; archives: { total: number; pendingDelete: number; keepInDbDays: number }; queue: { running: boolean };
}
/** GET /platform/telegram-account — worker holati (P6). */
export interface PlatformTgStatus {
  aiVoiceEnabled?: boolean;
  account?: { status?: string; username?: string; phoneMasked?: string; workerConnected?: boolean; workerVersion?: string; lastHealthAt?: string; udpOk?: boolean; dailyCallCount?: number; dailyCap?: number } | null;
  worker?: { connectedHere: boolean; workerId?: string; leaseActive: boolean }; lastError?: string; connectedAt?: string;
}

export interface AiAuditItem {
  id: string; at: string; actorUserId: string; actorName: string; actorRole: string; targetUserId?: string; targetName?: string;
  channel: string; tool: string; kind: "read" | "write"; status: string; resultSummary?: string; errorCode?: string; latencyMs?: number;
  /** Faqat platforma (dasturchi) auditida. */
  companyId?: string; companyName?: string;
}
export interface AiAuditPage { page: number; limit: number; total: number; items: AiAuditItem[] }

export interface AiUsageSummary {
  from: string; to: string;
  days: { day: string; costUsdMicros: number; tokens: number; sessions: number }[];
  totals: { costUsdMicros: number; tokensIn: number; tokensOut: number; sessions: number; audioSec: number; toolCalls: number; telegramCalls: number; botMessages: number };
  byProvider: Record<string, number>;
  month: { costUsdMicros: number; budgetUsd: number; hardStop: boolean; exceeded: boolean };
}

/** /api/ai-voice/me — P3 backend. quietHours ixtiyoriy (server qo'llasa keladi). */
export interface AiMePrefs {
  languageOverride?: "uz" | "ru";
  channelOrder?: ChannelName[];
  disabledChannels: ChannelName[];
  callConsent: "none" | "requested" | "granted" | "revoked";
  optOut: { calls: boolean; reminders: boolean; all: boolean };
  quietHours?: { from: string; to: string } | null;
  /** Server holati (P3): AI firmada faolmi — o'chiq bo'lsa o'zgartirish 403 ai_disabled. */
  status?: {
    aiActive: boolean; attendanceEnabled: boolean; telegramLinked: boolean; planHasFeature: boolean;
    /** false — faqat ko'rish (sozlamalarni rahbariyat boshqaradi). Eski server — yo'q (tahrirlash mumkin). */
    canEdit?: boolean; companyConsent?: boolean; callsAllowed?: boolean;
  };
}
export interface AiMePrefsPatch {
  languageOverride?: "uz" | "ru" | null;
  channelOrder?: ChannelName[] | null;
  disabledChannels?: ChannelName[];
  callConsent?: "granted" | "revoked";
  optOut?: Partial<{ calls: boolean; reminders: boolean; all: boolean }>;
  quietHours?: { from: string; to: string } | null;
}
export interface AiReminder {
  id: string; text: string; targetUserId: string; ownerId: string; dueAt: string; nextFireAt?: string;
  recurrence: { freq: "none" | "daily" | "weekdays" | "weekly" | "monthly"; interval: number; byWeekday: IsoWeekday[] };
  status: "active" | "done" | "cancelled" | "failed" | "missed"; channels: ChannelName[];
  /** Server: shu foydalanuvchi yaratganmi (faqat o'zinikini bekor qila oladi). Yo'q bo'lsa — true deb olinadi. */
  canCancel?: boolean;
}

/** ok=false bo'lsa data bo'sh, xato tanasi errorData'da (strict o'chiq — discriminated union torayishi ishlamaydi). */
export interface ApiResult<T> { ok: boolean; status: number; data: T; error: string; errorData?: any }

const BASE = "/api/ai-voice";

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`${API_BASE}${BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await r.json().catch(() => null);
    if (r.ok) return { ok: true, status: r.status, data: data as T, error: "" };
    return { ok: false, status: r.status, data: undefined as T, error: String(data?.error || `http_${r.status}`), errorData: data };
  } catch {
    return { ok: false, status: 0, data: undefined as T, error: "network" };
  }
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
};

export const adminApi = {
  getSettings: () => call<AiSettingsView>("GET", "/admin/settings"),
  putSettings: (version: number, patch: Record<string, unknown>) => call<AiSettingsView>("PUT", "/admin/settings", { version, patch }),
  getTools: () => call<{ tools: AiToolEntry[] }>("GET", "/admin/tools"),
  getChannelsStatus: () => call<AiChannelsStatus>("GET", "/admin/channels/status"),
  getEmployees: (q = "") => call<{ employees: AiEmployeeRow[] }>("GET", `/admin/employees${qs({ q })}`),
  patchEmployee: (userId: string, body: { channelOrder?: ChannelName[] | null; disabledChannels?: ChannelName[]; scheduleOverride?: AiScheduleOverride | null;
    optOut?: Partial<{ calls: boolean; reminders: boolean; all: boolean }> }) =>
    call<{ employee: AiEmployeeRow }>("PATCH", `/admin/employees/${encodeURIComponent(userId)}`, body),
  runNow: (shiftId: string) => call<{ ok: true; jobId: string; duplicate: boolean }>("POST", "/admin/attendance/run-now", { shiftId }),
  getAudit: (p: { page?: number; limit?: number; status?: string; tool?: string; from?: string; to?: string } = {}) =>
    call<AiAuditPage>("GET", `/admin/audit${qs(p)}`),
  sendTest: () => call<{ ok: true; channel: string }>("POST", "/admin/test", { channel: "bot_message" }),
  // Arxivlar — faqat egasi/direktor (o'rinbosarga 403)
  getArchives: () => call<unknown>("GET", "/admin/archives?limit=60"),
  archiveUrl: (id: string) => `/admin/archives/${encodeURIComponent(id)}/download`,
};

/** Dasturchi (platforma) — barcha firmalar. Javob shakllari platform/helpers.ts'da normallashtiriladi. */
export const platformApi = {
  getOverview: () => call<PlatformOverview>("GET", "/platform/overview"),
  getTelegram: () => call<PlatformTgStatus>("GET", "/platform/telegram-account"),
  getCompanies: (p: { q?: string; page?: number; limit?: number } = {}) => call<unknown>("GET", `/platform/companies${qs({ limit: 100, ...p })}`),
  getCompany: (id: string) => call<PlatformCompanyView>("GET", `/platform/companies/${encodeURIComponent(id)}`),
  patchCompany: (id: string, version: number, patch: PlatformCompanyPatch) =>
    call<PlatformCompanyView>("PATCH", `/platform/companies/${encodeURIComponent(id)}`, { version, patch }),
  getUsage: (p: { from?: string; to?: string } = {}) => call<PlatformUsage>("GET", `/platform/usage${qs(p)}`),
  getCompanyUsage: (id: string, p: { from?: string; to?: string } = {}) => call<AiUsageSummary>("GET", `/platform/usage/${encodeURIComponent(id)}${qs(p)}`),
  getAudit: (p: { page?: number; limit?: number; status?: string; companyId?: string } = {}) =>
    call<AiAuditPage & { items: (AiAuditItem & { companyId?: string; companyName?: string })[] }>("GET", `/platform/audit${qs(p)}`),
  getArchives: (p: { companyId?: string } = {}) => call<unknown>("GET", `/platform/archives${qs({ limit: 60, ...p })}`),
  archiveUrl: (id: string) => `/platform/archives/${encodeURIComponent(id)}/download`,
  runArchive: () => call<{ ok: true; jobId: string; duplicate: boolean }>("POST", "/platform/archives/run", {}),
};

/** Faylni token bilan yuklab olib, brauzerda saqlash (arxivlar). true — muvaffaqiyatli. */
export async function downloadFile(path: string, fallbackName: string): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}${BASE}${path}`, { cache: "no-store" });
    if (!r.ok) return false;
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

export const meApi = {
  get: () => call<AiMePrefs>("GET", "/me"),
  patch: (body: AiMePrefsPatch) => call<AiMePrefs>("PATCH", "/me", body),
  reminders: () => call<AiReminder[] | { reminders: AiReminder[] }>("GET", "/me/reminders"),
  cancelReminder: (id: string) => call<unknown>("DELETE", `/me/reminders/${encodeURIComponent(id)}`),
};

/** Server bu yo'lni hali qo'llamaydi (P3 parallel) — "tez orada" ko'rsatiladi. */
export const isNotReady = (r: ApiResult<unknown>) => !r.ok && (r.status === 501 || r.status === 404);
