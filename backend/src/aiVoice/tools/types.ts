import type { AuditAction } from '../../models/AuditLog';
import type { AiRole, JsonSchema, Purpose, ToolChannel, ToolCtx, ToolResult } from '../contracts';

export type { AiRole, JsonSchema, Purpose, ToolChannel, ToolCtx, ToolResult, ToolStatus } from '../contracts';

/** Argumentdagi ID qaysi modelga tegishli — executor uning ctx.companyId'ga tegishliligini tekshiradi. */
export type RefModel = 'User' | 'Object' | 'AiReminder' | 'Transaction' | 'AiAttendanceConfirmation';

/**
 * AI tool ta'rifi. XAVFSIZLIK CHEGARALARI KODDA (review B1, B4, A7):
 *  • maxRoles — kod "shifti": sozlamalardagi byRole undan kengroq ruxsat bera OLMAYDI;
 *  • channels — qaysi kanallardan chaqirish mumkin (allow-list);
 *  • behavior — doim 'BLOCKING' (model natijani kutmasdan "bajarildi" demasin);
 *  • confirm — 'when_other_user' boshqa foydalanuvchiga ta'sir qiluvchi YOZUVLAR uchun baribir
 *    majburiy (sozlama pasaytira olmaydi), 'always' — har doim inson tasdig'i.
 */
export interface AiToolDef<A = any> {
  name: string;
  description: { uz: string; ru: string };
  parameters: JsonSchema & { type: 'object' };
  kind: 'read' | 'write';
  maxRoles: AiRole[];
  defaultRoles: AiRole[];
  purposes: Purpose[];
  channels: ToolChannel[];
  behavior: 'BLOCKING';
  confirm: 'never' | 'always' | 'when_other_user';
  /** arg nomi → model. Qiymat (yoki massiv elementlari) shu firmaga tegishli bo'lmasa — not_found. */
  refs?: Record<string, RefModel>;
  /** Yozuv kimga ta'sir qiladi (masalan targetUserId). Berilmasa — chaqiruvchining o'ziga. */
  targetUserArg?: string;
  /** Tasdiq kartasi/tugmasi uchun qisqa matn (erkin matn bo'lmasligi kerak — untrusted). */
  summarize?: (args: A, lang: 'uz' | 'ru') => string;
  auditEntity?: string;
  auditAction?: AuditAction;
  /**
   * Natijadagi erkin matn maydonlari (masalan 'description', 'text', 'name') — executor ularni
   * istalgan chuqurlikda {"untrusted_text": "..."} ga o'raydi va ≤200 belgiga qisqartiradi (B4).
   */
  untrustedKeys?: string[];
  /**
   * Foydalanuvchining O'Z qarori (masalan, u tanlangan tasdiqlovchi bo'lgan chiqimni tasdiqlash/rad etish).
   * ERP yozuvi bo'yicha qaror — AI tasdiq-kutish (pending) amallarini tasdiqlamaydi (B3). Faqat
   * kind:'write', confirm:'never'. Agent buni faqat foydalanuvchining shu navbatdagi aniq so'rovi bilan chaqiradi.
   */
  ownDecision?: boolean;
  /**
   * Umumiy (firma ma'lumotiga tegmaydigan) tool — ob-havo, qo'ng'iroqni tugatish (owner 2026-10-17).
   * Firma tool matritsasidan qat'i nazar har doim yoqiq (maxRoles baribir amal qiladi) va firmasiz
   * dasturchi (platforma) kontekstida ham ishlaydi. Handler companyId yo'q bo'lsa firma bazasiga tegmasligi shart.
   */
  general?: boolean;
  /**
   * Ovozli tasdiq (owner 2026-10-17 #4): faqat ovozli kanallar, faqat SHU sessiyada yaratilgan pending amal.
   * Faqat registry'dagi aniq nom (answerPendingAction) — boshqa "tasdiqlovchi" tool'lar baribir taqiqlangan (B3).
   */
  spokenConfirm?: boolean;
  handler: (ctx: ToolCtx, args: A) => Promise<ToolResult>;
}

/**
 * Handler'lar uchun: har bir so'rovga AN'IQ companyId filtri (scoped() kontekstsiz no-op bo'lgani
 * uchun unga tayanilmaydi — design D12). ctx.companyId har doim ustun (filtrdagi qiymat almashtiriladi).
 */
export function inCompany<T extends Record<string, unknown>>(ctx: Pick<ToolCtx, 'companyId'>, filter: T = {} as T): T & { companyId: string } {
  if (!ctx?.companyId) throw new Error('NO_COMPANY_CONTEXT');
  return { ...filter, companyId: String(ctx.companyId) };
}
