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
  };
  fallbackOrder: ChannelName[];
  reminders: { defaultLeadMin: number; defaultChannels: ChannelName[]; maxActivePerUser: number };
  tools: { byRole: Partial<Record<AiRole, string[]>>; allowOffShiftAssistant: boolean };
  provider: { primary: "gemini_live" | "gemini_cascade"; fallback: "gemini_cascade" | "none"; liveModel?: string; textModel?: string; ttsModel?: string; transcribeModel?: string };
  brain: { provider: "gemini" | "claude"; fallback: "openrouter" | "none"; effort: "low" | "medium" | "high" };
  limits: { userSessionsPerHour: number; companyMinutesPerDay: number; monthlyBudgetUsd: number; hardStop: boolean; botMsgsPer10Min: number; toolCallsPerSession: number };
  privacy: { recordAudio: false; transcriptRetentionDays: number; auditRetentionDays: number };
  version: number;
  updatedBy?: string;
}

export interface AiSettingsView {
  settings: AiSettingsData;
  editor: { canEditSchedule: boolean; canEditBossRows: boolean };
  providers: { gemini: boolean; openrouter: boolean; claude: boolean };
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
}

export interface AiAuditItem {
  id: string; at: string; actorUserId: string; actorName: string; actorRole: string; targetUserId?: string; targetName?: string;
  channel: string; tool: string; kind: "read" | "write"; status: string; resultSummary?: string; errorCode?: string; latencyMs?: number;
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
  status?: { aiActive: boolean; attendanceEnabled: boolean; telegramLinked: boolean; planHasFeature: boolean };
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
  patchEmployee: (userId: string, body: { channelOrder?: ChannelName[] | null; disabledChannels?: ChannelName[] }) =>
    call<{ employee: AiEmployeeRow }>("PATCH", `/admin/employees/${encodeURIComponent(userId)}`, body),
  runNow: (shiftId: string) => call<{ ok: true; jobId: string; duplicate: boolean }>("POST", "/admin/attendance/run-now", { shiftId }),
  getAudit: (p: { page?: number; limit?: number; status?: string; tool?: string; from?: string; to?: string } = {}) =>
    call<AiAuditPage>("GET", `/admin/audit${qs(p)}`),
  getUsage: (p: { from?: string; to?: string } = {}) => call<AiUsageSummary>("GET", `/admin/usage${qs(p)}`),
  sendTest: () => call<{ ok: true; channel: string }>("POST", "/admin/test", { channel: "bot_message" }),
};

export const meApi = {
  get: () => call<AiMePrefs>("GET", "/me"),
  patch: (body: AiMePrefsPatch) => call<AiMePrefs>("PATCH", "/me", body),
  reminders: () => call<AiReminder[] | { reminders: AiReminder[] }>("GET", "/me/reminders"),
  cancelReminder: (id: string) => call<unknown>("DELETE", `/me/reminders/${encodeURIComponent(id)}`),
};

/** Server bu yo'lni hali qo'llamaydi (P3 parallel) — "tez orada" ko'rsatiladi. */
export const isNotReady = (r: ApiResult<unknown>) => !r.ok && (r.status === 501 || r.status === 404);
