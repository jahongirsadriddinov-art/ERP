import Company from '../models/Company';
import Subscription from '../models/Subscription';
import User from '../models/User';
import { PLAN_CONFIG } from '../config/plans';
import { checkRate } from '../utils/rateLimit';

// "Admin orqali to'lash" (owner 2026-10-30: "bitta tugma orqali menga xabar
// yuboradi avtomatik ma'lumotlar bilan, bosadi — menga keladi va hal qilaman").
//
// Oldin obuna tugaganda foydalanuvchiga faqat "@admin bilan bog'laning" deyilardi:
// u Telegramda adminni qidirib topishi, o'zini tanishtirishi, firma nomini,
// tarifini aytishi kerak edi — ko'pchilik shu yerda to'xtab qolardi. Endi bitta
// tugma: xabar KERAKLI MA'LUMOTLAR bilan to'liq tayyor holda dasturchiga boradi.
//
// Sayt ham, bot ham AYNAN shu funksiyani chaqiradi — xabar matni bir xil bo'lsin
// va kelajakda ikki joyda ayri-ayri o'zgarib ketmasin.

export const ADMIN_HANDLE = '@Sadriddinov_Jahongir';

/** Bitta firma shuncha vaqtda bir marta so'rov yuboradi (admin xabarga ko'milib qolmasin). */
const COOLDOWN_MS = 10 * 60_000;

export type AdminHelpSource = 'web' | 'bot';

export interface AdminHelpResult {
  ok: boolean;
  /** Takroriy bosish — xabar yuborilmadi, lekin bu xato emas. */
  throttled?: boolean;
  retryAfterSec?: number;
  error?: string;
}

function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `${v.toLocaleString('uz-UZ')} so'm` : '—';
}

/**
 * Dasturchiga "obunani faollashtirib bering" so'rovini yuboradi.
 * Xabarda admin qo'lda qidirmasligi uchun hamma narsa bor: firma, filial kodi,
 * kim so'rayapti va qanday bog'lanish, tarif, qachon tugagan.
 */
export async function requestAdminHelp(p: {
  companyId: string; userId: string; source: AdminHelpSource;
  /** Foydalanuvchi tanlagan tarif (ixtiyoriy) — admin shuni faollashtiradi. */
  planKey?: string;
}): Promise<AdminHelpResult> {
  const companyId = String(p.companyId || '');
  if (!companyId) return { ok: false, error: 'Firma aniqlanmadi' };

  const rl = checkRate(`adminhelp:${companyId}`, 1, COOLDOWN_MS);
  if (!rl.allowed) return { ok: false, throttled: true, retryAfterSec: rl.retryAfterSec };

  const [company, sub, user] = await Promise.all([
    Company.findById(companyId).select('name branchId phone region').lean().catch(() => null),
    Subscription.findOne({ companyId }).sort({ createdAt: -1 }).select('_id status selectedPlan amount currentPeriodEnd').lean().catch(() => null),
    User.findById(String(p.userId || '')).select('firstName lastName phone role telegramChatId').lean().catch(() => null),
  ]) as any[];

  const planKey = p.planKey || sub?.selectedPlan || '';
  const plan = planKey ? PLAN_CONFIG[planKey] : undefined;
  const ended = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString('uz-UZ') : '—';
  const who = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || '—' : '—';

  const lines = [
    '💳 *Obunani faollashtirish so\'rovi*',
    '',
    `*Firma:* ${company?.name || '—'}`,
    `*Filial kodi:* \`${company?.branchId || '—'}\``,
    company?.region ? `*Hudud:* ${company.region}` : '',
    '',
    `*So\'rayapti:* ${who} (${user?.role || '—'})`,
    `*Telefon:* \`${user?.phone || company?.phone || '—'}\``,
    '',
    `*Tarif:* ${plan?.label || planKey || '—'}${plan ? ` — ${money(plan.amount)}` : ''}`,
    `*Holat:* ${sub?.status || '—'}, muddati: ${ended}`,
    '',
    `_${p.source === 'bot' ? 'Telegram bot' : 'Sayt'} orqali, bitta tugma bilan yuborildi._`,
    '',
    "_To'lovni naqd yoki o'tkazma bilan olganingizdan keyin pastdagi tugmani bosing — obuna o'sha zahoti ochiladi._",
  ].filter(Boolean);

  try {
    // Owner savoli (2026-10-30): "so'rov keldi, lekin to'lov qilishi kerak-ku —
    // admin nima qiladi?". Bu yo'l naqd/o'tkazma bilan to'laydiganlar uchun:
    // admin pulni oladi va SHU XABARDAGI tugma bilan obunani ochadi. Oldin
    // xabar keluvchi edi, amal qiladigan tugma yo'q edi — admin panelga kirib
    // firmani qidirishi kerak bo'lardi.
    const { notifyDeveloperWithButtons } = await import('./bot');
    const subId = sub?._id ? String(sub._id) : '';
    const rows = subId && planKey
      ? [[{ text: `✅ Faollashtirish — ${plan?.label || planKey}`, callback_data: `subact:${subId}:${planKey}` }]]
      : [];
    await notifyDeveloperWithButtons(lines.join('\n'), rows);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 160) };
  }
}
