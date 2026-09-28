import Transaction from '../models/Transaction';
import ObjectModel from '../models/Object';
import User from '../models/User';
import Company from '../models/Company';
import { todayInTashkent, tashkentHour } from '../utils/tz';

// Chiqimlar ustidan avtomatik tahlil:
//  1) Byudjet nazorati — obyekt sarfi byudjetning 80% / 100% chegarasidan o'tsa rahbarlarga xabar.
//  2) G'ayrioddiy chiqim — shu turdagi odatiy chiqimlardan (mediana) 3 barobar katta bo'lsa belgilanadi.
//  3) Oylik xulosa — har oyning 1-sanasida (Toshkent 09:00) o'tgan oy bo'yicha qisqa hisobot botga.
// Model hook'idan chaqiriladi — bot/sayt/AI qaysi yo'l bilan chiqim yaratilgan bo'lsa ham ishlaydi.

export const EXPENSE_TYPES = ['oylik', 'material', 'jihozlar', 'transport', 'boshqa', 'expense'];
const TYPE_UZ: Record<string, string> = { oylik: 'Oylik', material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa', expense: 'Chiqim' };
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} so'm`;
const ANOMALY_FACTOR = 3;
const ANOMALY_MIN_AMOUNT = 1_000_000;
const ANOMALY_MIN_SAMPLES = 5;

async function notifyBosses(companyId: string | undefined, text: string, title: string) {
  if (!companyId) return;
  const bosses: any[] = await User.find({ companyId, role: { $in: ['direktor', 'orinbosar'] } }).select('_id telegramChatId').lean();
  const [{ bot }, { createNotification }] = await Promise.all([import('./bot'), import('./notifications')]);
  for (const b of bosses) {
    if (b.telegramChatId) bot.sendMessage(b.telegramChatId, text).catch(() => {});
    createNotification({ recipientId: String(b._id), companyId, type: 'expense', title, body: text.slice(0, 300), url: '/reports' }).catch(() => {});
  }
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const isAnomalous = (amount: number, history: number[]) =>
  history.length >= ANOMALY_MIN_SAMPLES && amount >= ANOMALY_MIN_AMOUNT && amount >= median(history) * ANOMALY_FACTOR;
export const budgetLevel = (spent: number, budget: number) => (!budget ? 0 : spent >= budget ? 100 : spent >= budget * 0.8 ? 80 : 0);

async function checkAnomaly(tx: any) {
  const history: any[] = await Transaction.find({ companyId: tx.companyId, type: tx.type, _id: { $ne: tx._id }, status: { $ne: 'rejected' } })
    .sort({ createdAt: -1 }).limit(60).select('amount').lean();
  if (!isAnomalous(tx.amount || 0, history.map(h => h.amount || 0))) return;
  await Transaction.updateOne({ _id: tx._id }, { $set: { anomaly: true } });
  const typical = median(history.map(h => h.amount || 0));
  await notifyBosses(tx.companyId,
    `⚠️ G'ayrioddiy katta chiqim\n${TYPE_UZ[tx.type] || tx.type}: ${money(tx.amount)}\n📝 ${tx.description || '—'}\n📅 ${tx.date || '—'}\nOdatdagi shu turdagi chiqim: ~${money(typical)} (${Math.round(tx.amount / Math.max(1, typical))}x ko'p)`,
    "G'ayrioddiy chiqim");
}

async function checkBudget(tx: any) {
  if (!tx.projectId) return;
  const obj: any = await ObjectModel.findById(tx.projectId).select('name budget budgetAlertLevel companyId').lean().catch(() => null);
  if (!obj?.budget) return;
  const [agg] = await Transaction.aggregate([
    { $match: { projectId: String(tx.projectId), type: { $in: EXPENSE_TYPES }, status: 'confirmed' } },
    { $group: { _id: null, spent: { $sum: '$amount' } } },
  ]);
  const spent = agg?.spent || 0;
  const level = budgetLevel(spent, obj.budget);
  const prev = obj.budgetAlertLevel || 0;
  if (level === prev) return;
  await ObjectModel.updateOne({ _id: obj._id }, { $set: { budgetAlertLevel: level } });
  if (level <= prev) return; // byudjet oshirilgan — faqat darajani pasaytiramiz, xabar yo'q
  const pct = Math.round((spent / obj.budget) * 100);
  await notifyBosses(obj.companyId || tx.companyId,
    `${level >= 100 ? '🔴 Byudjet OSHIB KETDI' : '🟡 Byudjetning 80% ishlatildi'}\n🏗 ${obj.name}\nSarflandi: ${money(spent)} / ${money(obj.budget)} (${pct}%)\nQoldiq: ${money(obj.budget - spent)}`,
    level >= 100 ? 'Byudjet oshib ketdi' : 'Byudjet 80%');
}

// Transaction post-save hook'idan chaqiriladi (asinxron, xatolar yutiladi — asosiy amalni to'xtatmaydi)
export async function onExpenseSaved(tx: any, wasNew: boolean) {
  if (!EXPENSE_TYPES.includes(tx.type)) return;
  try {
    if (wasNew) await checkAnomaly(tx);
    if (tx.status === 'confirmed') await checkBudget(tx);
  } catch (e) {
    console.error('[expense insights]', (e as Error).message);
  }
}

// ── Oylik xulosa ──────────────────────────────────────────────────────────
export async function buildMonthlySummary(companyId: string, month: string): Promise<string | null> {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const txs: any[] = await Transaction.find({ companyId, type: { $in: [...EXPENSE_TYPES, 'income'] }, status: 'confirmed', date: { $gte: from, $lte: to } } as any).lean();
  const exp = txs.filter(t => t.type !== 'income');
  if (!txs.length) return null;
  const total = exp.reduce((a, t) => a + (t.amount || 0), 0);
  const income = txs.filter(t => t.type === 'income').reduce((a, t) => a + (t.amount || 0), 0);
  const byType = new Map<string, number>();
  for (const t of exp) byType.set(t.type, (byType.get(t.type) || 0) + (t.amount || 0));
  const objIds = [...new Set(exp.map(t => t.projectId).filter(Boolean))];
  const objs: any[] = objIds.length ? await ObjectModel.find({ _id: { $in: objIds } }).select('name budget').lean() : [];
  const byObj = objIds.map(id => ({ name: objs.find(o => String(o._id) === String(id))?.name || '—', sum: exp.filter(t => t.projectId === id).reduce((a, t) => a + (t.amount || 0), 0) }))
    .sort((a, b) => b.sum - a.sum).slice(0, 5);
  const top = [...exp].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const anomalies = exp.filter(t => t.anomaly).length;

  // Oldingi oy bilan solishtirish
  const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const [prevAgg] = await Transaction.aggregate([
    { $match: { companyId, type: { $in: EXPENSE_TYPES }, status: 'confirmed', date: { $gte: `${pm}-01`, $lte: `${pm}-31` } } },
    { $group: { _id: null, s: { $sum: '$amount' } } },
  ]);
  const prev = prevAgg?.s || 0;
  const delta = prev ? Math.round(((total - prev) / prev) * 100) : null;

  const lines = [
    `📊 Oylik xulosa — ${month}`,
    '',
    `💸 Jami chiqim: ${money(total)}${delta != null ? ` (${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% o'tgan oyga nisbatan)` : ''}`,
    `💰 Kirim: ${money(income)}`,
    `📈 Sof natija: ${income - total >= 0 ? '+' : ''}${money(income - total)}`,
    '',
    '🏷 Turlar bo\'yicha:',
    ...[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  • ${TYPE_UZ[k] || k}: ${money(v)} (${Math.round((v / Math.max(1, total)) * 100)}%)`),
  ];
  if (byObj.length) lines.push('', '🏗 Obyektlar bo\'yicha:', ...byObj.map(o => `  • ${o.name}: ${money(o.sum)}`));
  if (top.length) lines.push('', '🔝 Eng katta chiqimlar:', ...top.map(t => `  • ${money(t.amount)} — ${(t.description || TYPE_UZ[t.type] || '').slice(0, 60)} (${t.date})`));
  if (anomalies) lines.push('', `⚠️ G'ayrioddiy katta chiqimlar: ${anomalies} ta — "Hisobotlar"da ⚠ belgisi bilan ko'rsatilgan.`);
  return lines.join('\n');
}

let lastRunKey = '';
async function monthlyTick() {
  const today = todayInTashkent();
  if (!today.endsWith('-01') || tashkentHour() !== 9) return;
  const key = today.slice(0, 7);
  if (lastRunKey === key) return;
  lastRunKey = key;
  const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1);
  const month = d.toISOString().slice(0, 7);
  const companies: any[] = await Company.find({ lastMonthlySummary: { $ne: month } }).select('_id').lean();
  for (const c of companies) {
    // Ikki server nusxasi bo'lsa ham bir marta yuborilishi uchun — atomik belgilash
    const claimed = await Company.updateOne({ _id: c._id, lastMonthlySummary: { $ne: month } }, { $set: { lastMonthlySummary: month } });
    if (!claimed.modifiedCount) continue;
    const text = await buildMonthlySummary(String(c._id), month).catch(() => null);
    if (text) await notifyBosses(String(c._id), text, `Oylik xulosa ${month}`);
  }
}
export function startMonthlySummaryLoop() {
  setInterval(() => { monthlyTick().catch(e => console.error('[monthly summary]', e.message)); }, 10 * 60 * 1000);
}
