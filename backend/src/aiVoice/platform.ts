import AiAssistantSettings from '../models/AiAssistantSettings';
import AiChannelConnection from '../models/AiChannelConnection';
import type { AiSettingsData, ToolChannel } from './contracts';
import { loadActor, type ActorState } from './actor';
import { aiConfig } from './config';
import { isObjectIdString } from './lib/ids';
import { sanitizeForPrompt } from './lib/untrusted';
import { CHANNEL_GUIDE } from './brain/systemPrompt';
import { defaultSettings, isAiActive } from './settings';

// Dasturchi (platforma) AI rejimi — owner 2026-10-16: dasturchi akkaunti (rol 'dasturchi', firmasiz) AI bilan
// gaplasha oladi (bot /ai, ilova chati, ilova/Telegram qo'ng'irog'i, o'ziga sinov qo'ng'irog'i). Qoidalar:
//  • firma YO'Q: hech qanday ERP tool berilmaydi, executor firmasiz kontekstni rad etadi;
//  • prompt — umumiy yordamchi + platforma holati (AI yoqilgan firmalar soni, worker holati), firma ma'lumoti yo'q;
//  • firma byudjeti/sozlamasi ishlatilmaydi — sarf 'platform' kaliti ostida, chegaralar PLATFORM_LIMITS;
//  • sessiya/sarf yozuvlarida companyId = PLATFORM_SCOPE (ObjectId emas — firma ro'yxatlariga tushmaydi).

export const PLATFORM_SCOPE = 'platform';
export const PLATFORM_NAME = 'QurilishERP';

export const isPlatformScope = (companyId: unknown): boolean => companyId === PLATFORM_SCOPE;

/** Platforma chegaralari (firma byudjeti o'rniga). */
export const PLATFORM_LIMITS = {
  voiceSessionsPerHour: 10,
  concurrentSessions: 1,
  voiceMinutesPerDay: 60,
  textMsgsPer10Min: 30,
  maxDurationSec: 300,
} as const;

/** Faqat faol (bloklanmagan) dasturchi; aks holda null. */
export async function loadDeveloperActor(userId: string): Promise<ActorState | null> {
  if (!isObjectIdString(userId)) return null;
  const a = await loadActor(userId);
  return a && a.role === 'dasturchi' && !a.isBlocked ? a : null;
}

/** Platforma sessiyalari uchun sozlama: standart + platforma chegaralari (DB'dan o'qilmaydi). */
export function platformSettings(): AiSettingsData {
  const s = defaultSettings(PLATFORM_SCOPE);
  return {
    ...s,
    enabled: aiConfig.enabled,
    calls: { ...s.calls, companyConcurrency: PLATFORM_LIMITS.concurrentSessions, assistantMaxDurationSec: PLATFORM_LIMITS.maxDurationSec, maxDurationSec: Math.min(s.calls.maxDurationSec, PLATFORM_LIMITS.maxDurationSec) },
    limits: {
      ...s.limits,
      userSessionsPerHour: PLATFORM_LIMITS.voiceSessionsPerHour, companyMinutesPerDay: PLATFORM_LIMITS.voiceMinutesPerDay,
      botMsgsPer10Min: PLATFORM_LIMITS.textMsgsPer10Min, hardStop: false,
    },
  };
}

export interface PlatformStatus { aiEnabled: boolean; companiesWithAi: number; account: string; workerOnline: boolean }

let statusCache: { at: number; data: PlatformStatus } | null = null;
const STATUS_TTL_MS = 60_000;

/** Platforma holati (60 s kesh): AI yoqilgan faol firmalar soni, AI Telegram akkaunti va worker. */
export async function platformStatus(now = Date.now()): Promise<PlatformStatus> {
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.data;
  const rows: any[] = await AiAssistantSettings.find({ enabled: true }).select('companyId').limit(1000).lean();
  let companiesWithAi = 0;
  for (const id of new Set(rows.map((r) => String(r.companyId || '')))) {
    if (isObjectIdString(id) && (await isAiActive(id).catch(() => false))) companiesWithAi++;
  }
  const conn: any = await AiChannelConnection.findOne({ scope: 'platform', companyId: null, type: 'telegram_user' })
    .select('status leaseUntil').lean().catch(() => null);
  const data: PlatformStatus = {
    aiEnabled: aiConfig.enabled,
    companiesWithAi,
    account: String(conn?.status || 'disconnected'),
    workerOnline: !!conn?.leaseUntil && new Date(conn.leaseUntil).getTime() > now,
  };
  statusCache = { at: now, data };
  return data;
}

/** Faqat testlar uchun. */
export function __resetPlatformStatusCache(): void { statusCache = null; }

export interface PlatformPromptInput {
  lang: 'uz' | 'ru';
  userName?: string;
  today: string;
  time?: string;
  status: PlatformStatus;
  /** Qaysi kanalda gaplashyapti (bot / ilova chati / qo'ng'iroq) — owner 2026-10-17 #5. */
  channel?: ToolChannel;
}

/** Dasturchi uchun system prompt: umumiy yordamchi + platforma holati. Firma ma'lumoti/tool yo'q. */
export function buildPlatformSystemPrompt(i: PlatformPromptInput): string {
  const name = sanitizeForPrompt(i.userName, 40) || 'dasturchi';
  const st = i.status;
  const worker = st.workerOnline ? 'ulangan' : 'ulanmagan';
  const lines = [
    `Siz ${PLATFORM_NAME} platformasining sun'iy intellekt yordamchisisiz. Siz AI ekaningizni yashirmang — so'rashsa ochiq ayting.`,
    "Hozir platforma DASTURCHISI (firmasiz akkaunt) bilan gaplashyapsiz.",
    "QOIDALAR:",
    "- Bu rejimda firma ma'lumotlariga (xodimlar, moliya, obyektlar, davomat) kirish YO'Q va ERP tool'lari yo'q. Bunday so'rovga: \"Bu firma ichidagi ma'lumot — dasturchi rejimida mavjud emas\" deng. Ma'lumot o'ylab topmang.",
    "- Umumiy savollarga (texnik, dasturlash, matn, tarjima, maslahat, vaqt, oddiy faktlar) qisqa va aniq javob bering. Ob-havo — getWeather tool'i orqali.",
    "- Aytilgan ishni bajaring; salomni takrorlamang (javobni \"Assalomu alaykum\" bilan boshlamang).",
    ...(i.channel ? [CHANNEL_GUIDE[i.channel]] : []),
    "- Platforma holati haqida faqat quyidagi server ma'lumotidan foydalaning.",
    '',
    'PLATFORMA HOLATI (server ma\'lumoti):',
    `- AI server kaliti: ${st.aiEnabled ? 'yoqiq' : "o'chiq"}`,
    `- AI yoqilgan faol firmalar: ${st.companiesWithAi} ta`,
    `- AI Telegram akkaunti: ${st.account}; qo'ng'iroq workeri: ${worker}`,
    '',
    'KONTEKST:',
    `- Siz: ERP AI yordamchi (${PLATFORM_NAME} platformasi)`,
    `- Suhbatdosh: ${name} (dasturchi, firmasiz)`,
    `- Bugun: ${i.today}${i.time ? `, hozir ${i.time}` : ''}, Asia/Tashkent`,
    `- Standart javob tili: ${i.lang === 'ru' ? 'rus' : "o'zbek (lotin)"} (foydalanuvchi boshqa tilda yozsa — o'sha tilda). Javob qisqa, jadval/markdown'siz.`,
  ];
  return lines.join('\n');
}
