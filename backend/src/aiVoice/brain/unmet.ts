import crypto from 'crypto';
import AiUnmetRequest, { type AiUnmetReason } from '../../models/AiUnmetRequest';
import Company from '../../models/Company';
import User from '../../models/User';
import { isObjectIdString } from '../lib/ids';
import { redactText } from '../lib/redact';
import { normApostrophes, toLatinUz } from './style';

// "AI qila olmadi" (owner 2026-10-22): "agar biror narsani qila olmasa — SAQLASIN va dasturchiga aytsin".
// Navbat oxirida agent aniqlagan muammo (rad, noma'lum tool, tool xatosi, juda ko'p bosqich, provayder ishlamadi)
// yoki javobning o'zidagi "qila olmayman / не могу" iborasi → AiUnmetRequest + dasturchiga Telegram xabari.
//  • Saqlash har doim (90 kun TTL); xabar — bir xil imzo 6 soatda bir marta, umumiy ≤10 ta / soat;
//  • javobni sekinlashtirmaydi: fon vazifasi (testlar __flushUnmet bilan kutadi);
//  • matnlar redaksiya qilinadi va qisqartiriladi; bot xabari oddiy matn (Markdown/havola emas).

export interface UnmetIssue { reason: AiUnmetReason; toolName?: string; toolMessage?: string }

export interface UnmetInput {
  companyId: string;
  userId: string;
  channel: string;
  userText: string;
  aiReply: string;
  provider?: string;
  issue: UnmetIssue;
}

// "qila olmayman", "yordam bera olmayman", "qilolmayman", "imkonim yo'q", "qo'limdan kelmaydi", "не могу"...
const CANT_UZ = /\bbilmayman\b|\b[a-z']{2,}\s*olmayman\b|\b[a-z']{3,}olmayman\b|imkon(iyat)?im\s+yo'q|imkon(iyat)?i\s+yo'q|qo'limdan\s+kelmaydi|ruxsatim\s+yo'q|(menda|bunday)\s+(imkoniyat|funksiya|vosita|tool)\s+yo'q|bajarib\s+bo'lmadi|qila\s+olmadim|bajara\s+olmadim/;
const CANT_RU = /не\s+могу|не\s+умею|не\s+в\s+состоянии|нет\s+возможности|не\s+имею\s+возможности|не\s+получится|не\s+поддерживается|у\s+меня\s+нет\s+(доступа|возможности|такой\s+функции)/;

/** Javob matnida "qila olmayman" ma'nosidagi ibora bormi (lotin, kirill o'zbek, rus). */
export function soundsLikeCant(reply: string): boolean {
  const raw = String(reply || '').slice(0, 2000).toLowerCase();
  if (!raw.trim()) return false;
  if (CANT_RU.test(raw)) return true;
  return CANT_UZ.test(normApostrophes(toLatinUz(raw)));
}

// ── Dasturchiga xabar (DI: testlar soxtasini qo'yadi) ──
export type UnmetNotifier = (text: string) => Promise<void>;
const defaultNotifier: UnmetNotifier = async (text) => {
  // Testlarda haqiqiy botni import qilmaymiz (polling/ulanish)
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
  const { notifyDeveloper } = await import('../../services/bot');
  await notifyDeveloper(text, { plain: true });
};
let notifier: UnmetNotifier = defaultNotifier;
export function setUnmetNotifier(fn: UnmetNotifier | null): void { notifier = fn || defaultNotifier; }

const DEDUPE_MS = 6 * 3600_000;
const ALERTS_PER_HOUR = 10;
const seen = new Map<string, number>();
let alertTimes: number[] = [];
export function __resetUnmetForTests(): void { seen.clear(); alertTimes = []; pending.clear(); }

/** Bir xil muammo (sabab + tool + so'rov "imzosi") — 6 soatda bir marta xabar. */
export function unmetSignature(i: Pick<UnmetInput, 'issue' | 'userText'>): string {
  const norm = normApostrophes(toLatinUz(String(i.userText || '').toLowerCase()))
    .replace(/\d+/g, '#').replace(/[^a-z#'\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return crypto.createHash('sha1').update(`${i.issue.reason}|${i.issue.toolName || ''}|${norm}`).digest('hex');
}

function shouldAlert(sig: string, now: number): boolean {
  const prev = seen.get(sig);
  if (prev && now - prev < DEDUPE_MS) return false;
  seen.set(sig, now);
  if (seen.size > 1000) seen.delete(seen.keys().next().value as string);
  alertTimes = alertTimes.filter((t) => now - t < 3600_000);
  if (alertTimes.length >= ALERTS_PER_HOUR) return false;
  alertTimes.push(now);
  return true;
}

const REASON_LABEL: Record<AiUnmetReason, string> = {
  refusal: 'rad etdi', unknown_tool: "noma'lum/ruxsatsiz tool", bad_args: "noto'g'ri argument", tool_error: 'tool xatosi',
  tool_denied: 'tool rad etildi', rounds: "juda ko'p bosqich", provider_failed: 'model javob bermadi', cant_reply: '"qila olmayman" javobi',
};

/** Bot uchun oddiy matn: havola va @mention'lar olib tashlanadi. */
const plain = (v: string, n: number) => redactText(String(v || '')).replace(/https?:\/\/\S+/gi, '[url]').replace(/@\w+/g, '[@]').replace(/\s+/g, ' ').trim().slice(0, n);

async function persistAndAlert(i: UnmetInput): Promise<void> {
  const doc = {
    companyId: String(i.companyId || 'unknown').slice(0, 64),
    userId: String(i.userId || '').slice(0, 64),
    channel: String(i.channel || 'web').slice(0, 32),
    userText: redactText(String(i.userText || '')).slice(0, 1000),
    aiReply: redactText(String(i.aiReply || '')).slice(0, 1000),
    reason: i.issue.reason,
    ...(i.issue.toolName ? { toolName: String(i.issue.toolName).slice(0, 64) } : {}),
    ...(i.issue.toolMessage ? { toolMessage: redactText(String(i.issue.toolMessage)).slice(0, 300) } : {}),
    ...(i.provider ? { provider: String(i.provider).slice(0, 32) } : {}),
  };
  await AiUnmetRequest.create(doc);
  if (!shouldAlert(unmetSignature(i), Date.now())) return;
  const [co, u]: any[] = await Promise.all([
    isObjectIdString(doc.companyId) ? Company.findById(doc.companyId).select('name').lean().catch(() => null) : null,
    isObjectIdString(doc.userId) ? User.findById(doc.userId).select('firstName lastName role').lean().catch(() => null) : null,
  ]);
  const who = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
  const lines = [
    `🤖 AI qila olmadi — ${REASON_LABEL[doc.reason]} (${doc.channel})`,
    `🏢 ${plain(co?.name || (doc.companyId === 'platform' ? 'platforma' : doc.companyId), 60)}${who ? ` · 👤 ${plain(who, 60)}${u?.role ? ` (${plain(u.role, 20)})` : ''}` : ''}`,
    `❓ ${plain(doc.userText, 300) || '—'}`,
    `💬 ${plain(doc.aiReply, 300) || '—'}`,
  ];
  if (doc.toolName) lines.push(`🔧 ${plain(doc.toolName, 64)}${doc.toolMessage ? `: ${plain(doc.toolMessage, 200)}` : ''}`);
  await notifier(lines.join('\n'));
}

const pending = new Set<Promise<void>>();

/** Fon vazifasi: saqlash + (dedupe/limit bilan) dasturchiga xabar. Hech qachon tashlamaydi. */
export function reportUnmet(i: UnmetInput): void {
  const p = persistAndAlert(i)
    .catch((e) => { console.warn('[aiVoice] AI unmet yozilmadi:', String((e as Error)?.message || e).slice(0, 120)); })
    .finally(() => { pending.delete(p); });
  pending.add(p);
}

/** Faqat testlar uchun: fon yozuvlarini kutish. */
export async function __flushUnmet(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
