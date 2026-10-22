// Bot dizayni — botdagi BARCHA tugmalar va buyruqlar ro'yxati (dasturchi paneli shu ro'yxatni ko'rsatadi).
// Standart matnlar i18n/bot.ts (tb) yoki kodda yozilgan matnlardan olinadi — konfiguratsiya bo'lmasa
// bot aynan hozirgidek ishlaydi. Bu fayl services/bot.ts'ni IMPORT QILMAYDI (u tokensiz xato tashlaydi).
import { tb, botDictEntries, type BotLang } from '../../i18n/bot';
import { EXP_T } from '../botExpense';
import { latinToCyrillicUz } from '../../utils/transliterate';

export type BotUiGroup = 'main' | 'admin' | 'worker' | 'dev' | 'system' | 'inline';
export type BotUiKind = 'reply' | 'inline';

export interface BotUiCatalogItem {
  key: string;
  group: BotUiGroup;
  /** reply — pastki klaviatura (bosilganda MATN botga keladi, solishtiriladi); inline — xabar ostidagi tugma */
  kind: BotUiKind;
  /** tugma nima qiladi — AI emoji/rang tanlashi uchun qisqa izoh */
  meaning: string;
  defaults: { uz: string; ru: string };
}

const fromTb = (key: string) => ({ uz: String((tb as any)('uz', key)), ru: String((tb as any)('ru', key)) });
const lit = (uz: string, ru: string) => ({ uz, ru });
const exp = (k: 'okBtn' | 'cancelBtn' | 'retryBtn' | 'catBtn') => ({ uz: String((EXP_T as any).uz[k]), ru: String((EXP_T as any).ru[k]) });

const R = (key: string, group: BotUiGroup, meaning: string, defaults = fromTb(key)): BotUiCatalogItem => ({ key, group, kind: 'reply', meaning, defaults });
const I = (key: string, meaning: string, defaults = fromTb(key)): BotUiCatalogItem => ({ key, group: 'inline', kind: 'inline', meaning, defaults });

export const BOT_UI_CATALOG: BotUiCatalogItem[] = [
  // Hamma uchun umumiy (asosiy menyu)
  R('kb_openSite', 'main', 'open the web app / website'),
  R('kb_chat', 'main', 'open chat with colleagues'),
  R('kb_addExpense', 'main', 'add a new expense (money spent)'),
  R('kb_expenseHistory', 'main', 'list of past expenses / receipts'),
  R('kb_dailyReport', 'main', 'send daily work report'),
  R('ai_ai', 'main', 'AI assistant (voice/text)', lit('🤖 AI yordamchi', '🤖 AI-помощник')),
  R('ai_schedule', 'main', 'work schedule / calendar', lit('📅 Ish jadvali', '📅 График работы')),
  R('kb_language', 'main', 'change language'),
  // Direktor / o'rinbosar
  R('kb_pendingApprovals', 'admin', 'pending approvals waiting for decision'),
  R('kb_financeStatus', 'admin', 'finance / money balance'),
  R('kb_objects', 'admin', 'construction objects / buildings'),
  R('kb_staffList', 'admin', 'list of employees / people'),
  R('kb_report', 'admin', 'statistics report / chart'),
  R('kb_subscriptionStatus', 'admin', 'subscription / payment card status'),
  // Ishchi
  R('kb_incomingTransfers', 'worker', 'incoming material deliveries (package)'),
  R('kb_sentTransfers', 'worker', 'sent deliveries (outbox)'),
  R('kb_incomingPayments', 'worker', 'incoming payments (mailbox with money)'),
  R('kb_checkIn', 'worker', 'I arrived at work (start shift)'),
  R('kb_checkOut', 'worker', 'I finished work (end shift)'),
  // Dasturchi
  R('kb_broadcast', 'dev', 'broadcast a message to everyone (megaphone)'),
  R('kb_broadcastEnd', 'dev', 'stop broadcast mode'),
  R('kb_disableSite', 'dev', 'turn the website OFF (danger)'),
  R('kb_enableSite', 'dev', 'turn the website ON'),
  R('kb_disableApp', 'dev', 'turn the mobile/desktop app OFF (danger)'),
  R('kb_enableApp', 'dev', 'turn the app ON'),
  R('kb_disableBot', 'dev', 'turn the bot OFF (danger)'),
  R('kb_enableBot', 'dev', 'turn the bot ON'),
  R('kb_firmsList', 'dev', 'list of companies (office building)'),
  R('kb_allUsers', 'dev', 'all users (people)'),
  R('kb_allSubscriptions', 'dev', 'all subscriptions (payment cards)'),
  R('kb_generalStats', 'dev', 'general statistics (chart)'),
  R('kb_chatHistory', 'dev', 'chat history (speech bubble)'),
  R('kb_devSettings', 'dev', 'bot button settings (gear)'),
  // Tizim (vaqtinchalik klaviaturalar)
  R('sharePhoneBtn', 'system', 'share phone number to register'),
  R('locationShareBtn', 'system', 'share location (map pin)'),
  R('exitChat', 'system', 'exit / end chat (danger)'),
  R('kb_refreshStatus', 'system', 'refresh / reload status'),
  // Xabar ostidagi (inline) tugmalar
  I('confirmYes', 'yes, confirm (success)'),
  I('confirmNo', 'no, cancel (danger)'),
  I('confirmBtn', 'confirm (success)'),
  I('acceptBtn', 'accept (success)'),
  I('acceptedByMeBtn', 'I accepted it (success)'),
  I('rejectBtn', 'reject (danger)'),
  I('subPayLinkBtn', 'pay subscription (credit card)'),
  I('subGateCheckBtn', 'check channel subscription (checkmark)'),
  I('kb_devBack', 'go back (arrow)'),
  I('exp_okBtn', 'confirm and save expense (success)', exp('okBtn')),
  I('exp_cancelBtn', 'cancel expense (danger)', exp('cancelBtn')),
  I('exp_retryBtn', 'send expense again / retry', exp('retryBtn')),
  I('exp_catBtn', 'change expense category (tag)', exp('catBtn')),
  I('exp_editBtn', 'edit expense draft (pencil)', lit('✏️ Tahrirlash', '✏️ Исправить')),
  I('rpt_save', 'save daily report (success)', lit('✅ Saqlash', '✅ Сохранить')),
  I('rpt_cancel', 'cancel daily report (danger)', lit('✖️ Bekor qilish', '✖️ Отмена')),
  I('rpt_cancelShort', 'cancel (danger)', lit('✖️ Bekor', '✖️ Отмена')),
];

export const BOT_UI_KEYS = new Set(BOT_UI_CATALOG.map(i => i.key));
export const catalogItem = (key: string) => BOT_UI_CATALOG.find(i => i.key === key);

export type UiLang = 'uz' | 'uz-cyrl' | 'ru';
export const UI_LANGS: UiLang[] = ['uz', 'uz-cyrl', 'ru'];

/** Standart matn (o'zgartirilmagan) — uz-cyrl lotin uz'dan avtomatik hosil bo'ladi (i18n bilan bir xil). */
export function defaultLabel(item: BotUiCatalogItem, lang: UiLang): string {
  if (lang === 'ru') return item.defaults.ru;
  if (lang === 'uz-cyrl') {
    // tb kalitlari uchun aynan i18n'ning o'zi (bir xil transliteratsiya) — bot shu matnni yuboradi
    const v = (tb as any)('uz-cyrl' as BotLang, item.key);
    return typeof v === 'string' && v ? v : latinToCyrillicUz(item.defaults.uz);
  }
  return item.defaults.uz;
}

// ── Buyruqlar (setMyCommands) ──
export interface BotUiCommandItem { command: string; meaning: string; defaults: { uz: string; ru: string }; aiOnly?: boolean }
export const BOT_UI_COMMANDS: BotUiCommandItem[] = [
  { command: 'start', meaning: 'start the bot', defaults: lit('Botni boshlash', 'Запуск бота') },
  { command: 'res', meaning: 'reset / refresh the bot', defaults: lit('Botni yangilash', 'Обновить бота') },
  { command: 'ai', meaning: 'AI assistant', defaults: lit('AI yordamchi', 'AI помощник'), aiOnly: true },
  { command: 'jadval', meaning: 'work schedule (managers)', defaults: lit('Ish jadvali (rahbar)', 'График работы'), aiOnly: true },
];

// ── Xabarlardagi emoji'lar (AI premium emoji tanlashi uchun) ──
const EMOJI_RE = /\p{Extended_Pictographic}️?/gu;
/** i18n bot xabarlari va kalit tugmalardagi barcha takrorlanmas oddiy emoji'lar. */
export function messageEmojiCandidates(): string[] {
  const out = new Set<string>();
  const add = (s: unknown) => { if (typeof s === 'string') for (const m of s.match(EMOJI_RE) || []) out.add(m.replace(/️/g, '')); };
  for (const lang of ['uz', 'ru'] as const) {
    for (const [, v] of botDictEntries(lang)) add(typeof v === 'function' ? safeCall(v) : v);
    for (const v of Object.values((EXP_T as any)[lang] || {})) add(typeof v === 'function' ? safeCall(v) : v);
  }
  for (const it of BOT_UI_CATALOG) { add(it.defaults.uz); }
  return [...out].slice(0, 120);
}
function safeCall(fn: any): string { try { return String(fn({})); } catch { return ''; } }
