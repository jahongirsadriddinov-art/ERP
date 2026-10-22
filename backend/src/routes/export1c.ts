import { Router } from 'express';
import Transaction from '../models/Transaction';
import ObjectModel from '../models/Object';
import User from '../models/User';
import Company from '../models/Company';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { buildXlsx, dateSerial, tableSheet, type CellInput, type SheetDef } from '../utils/xlsxWriter';

const router = Router();

// GET /api/export1c/transactions — buxgalteriya (1C va shunga o'xshash dasturlar) uchun tranzaksiyalar eksporti.
// HAQIQIY 1C tarmoq integratsiyasi EMAS — qasddan: firma ma'lumoti hech qanday tashqi xizmatga yuborilmaydi,
// direktor o'zi yuklab olib, 1C'ga (yoki Excel'ga) o'zi import qiladi.
//
// Owner 2026-10-22: "Excel'ga yuklangan hamma narsa tartibsiz". Endi fayl o'z yozuvchimiz (utils/xlsxWriter) bilan:
// sana — haqiqiy sana (dd.mm.yyyy), summa — son (#,##0), sarlavha muzlatilgan va filtrli, JAMI qatori,
// ID o'rniga nomlar (obyekt, xodim, lavozim), holat so'z bilan.
const TYPE_LABEL: Record<string, string> = {
  transfer: 'Material yukxati', expense: 'Boshqa', income: 'Kirim', oylik: 'Oylik',
  material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Kutilmoqda', confirmed: 'Tasdiqlangan', rejected: "Rad etilgan",
};
const ROLE_LABEL: Record<string, string> = {
  direktor: 'Direktor', orinbosar: "O'rinbosar", prorab: 'Prorab', brigadir: 'Brigadir', ishchi: 'Ishchi', dasturchi: 'Dasturchi',
};
const fmtYmd = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; };
const periodText = (from?: string, to?: string) => !from && !to ? 'Butun davr' : `${from ? fmtYmd(from) : '…'} — ${to ? fmtYmd(to) : '…'}`;
const dCell = (ymd: string): CellInput => { const s = dateSerial(ymd); return s == null ? (ymd || '') : { v: s, s: 'date' }; };
const origCell = (tx: any): CellInput =>
  tx.currency && tx.currency !== 'UZS' && tx.originalAmount != null ? { v: tx.originalAmount, s: tx.currency === 'EUR' ? 'eur' : 'usd' } : '';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export async function sendXlsx(res: any, filename: string, sheets: SheetDef[], title: string) {
  const buf = Buffer.from(await buildXlsx(sheets, { title }));
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

async function lookups() {
  const [objects, users] = await Promise.all([
    ObjectModel.find(scoped()).select('name budget status').lean(),
    User.find(scoped()).select('firstName lastName role').lean(),
  ]);
  const objName = new Map(objects.map((o: any) => [String(o._id), o.name as string]));
  const user = new Map(users.map((u: any) => [String(u._id), { name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), role: u.role as string }]));
  const uname = (id?: any) => (id && user.get(String(id))?.name) || '';
  const urole = (id?: any) => { const r = id && user.get(String(id))?.role; return r ? ROLE_LABEL[r] || r : ''; };
  return { objects, objName, uname, urole };
}
async function companyName(): Promise<string> {
  try {
    const cid = getTenant()?.companyId;
    if (!cid) return '';
    const c: any = await Company.findById(cid).select('name').lean();
    return c?.name || '';
  } catch { return ''; }
}

router.get('/transactions', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string>;
    const filter: any = scoped();
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = String(from);
      if (to) filter.date.$lte = String(to);
    }
    const [transactions, lk, company] = await Promise.all([Transaction.find(filter).sort({ date: 1 }).lean(), lookups(), companyName()]);
    const rows = transactions.map((tx: any, i: number): CellInput[] => {
      const isTransfer = tx.type === 'transfer';
      return [
        i + 1, dCell(tx.date), isTransfer ? 'Material yukxati' : tx.type === 'income' ? 'Kirim' : 'Chiqim',
        isTransfer ? 'Material' : TYPE_LABEL[tx.type] || tx.type,
        isTransfer ? (tx.materialName || '') : (tx.description || ''),
        tx.projectId ? lk.objName.get(String(tx.projectId)) || '' : (tx.objectLabel || ''),
        isTransfer ? (tx.fromUserName || lk.uname(tx.fromUserId)) : lk.uname(tx.createdById),
        lk.uname(tx.toUserId) || tx.toUserName || tx.recipientName || '',
        isTransfer ? (tx.quantity ?? '') : '', isTransfer ? (tx.unit || '') : '',
        isTransfer ? '' : (tx.amount || 0), origCell(tx),
        STATUS_LABEL[tx.status] || tx.status, lk.uname(tx.confirmedById),
      ];
    });
    const sheet = tableSheet({
      name: 'Tranzaksiyalar', title: '1C uchun tranzaksiyalar', subtitle: [company, periodText(from, to)].filter(Boolean).join(' · '),
      columns: [
        { header: '№', width: 6, style: 'int', total: 'JAMI' },
        { header: 'Sana', width: 12, style: 'date' },
        { header: 'Hujjat', width: 16 },
        { header: 'Turi', width: 12 },
        { header: 'Tavsif / material', width: 38 },
        { header: 'Obyekt', width: 24 },
        { header: 'Kimdan / kiritgan', width: 20 },
        { header: 'Kimga', width: 20 },
        { header: 'Miqdor', width: 9, style: 'dec1' },
        { header: "O'lchov", width: 8 },
        { header: "Summa (so'm)", width: 16, style: 'money', total: 'sum' },
        { header: 'Asl valyuta', width: 14 },
        { header: 'Holati', width: 13 },
        { header: 'Tasdiqlagan', width: 20 },
      ],
      rows, emptyText: "Tanlangan davrda tranzaksiya yo'q",
    });
    await sendXlsx(res, `1c-export-${new Date().toISOString().split('T')[0]}.xlsx`, [sheet], '1C eksport');
  } catch (err) {
    console.error('[export1c]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/export1c/report?from&to&projectId — eski ilova versiyalari uchun saqlangan (yangi ilova "Hisobotlar"
// faylini o'zi quradi: frontend lib/xlsx/reportWorkbook.ts). Endi u ham tartibli varaqlar bilan.
const EXP_TYPES = ['oylik', 'material', 'jihozlar', 'transport', 'boshqa', 'expense'];
router.get('/report', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { from, to, projectId } = req.query as Record<string, string>;
    const filter: any = scoped({ type: { $in: EXP_TYPES }, status: 'confirmed' });
    if (from || to) { filter.date = {}; if (from) filter.date.$gte = String(from); if (to) filter.date.$lte = String(to); }
    if (projectId) filter.projectId = String(projectId);
    const [txs, lk, company] = await Promise.all([Transaction.find(filter).sort({ date: 1 }).lean(), lookups(), companyName()]);
    const subtitle = [company, periodText(from, to), projectId ? lk.objName.get(String(projectId)) || '' : 'Barcha obyektlar'].filter(Boolean).join(' · ');
    const total = txs.reduce((a: number, t: any) => a + (t.amount || 0), 0);
    const s1 = tableSheet({
      name: 'Chiqimlar', title: 'Chiqimlar', subtitle,
      columns: [
        { header: '№', width: 6, style: 'int', total: 'JAMI' }, { header: 'Sana', width: 12, style: 'date' },
        { header: 'Obyekt', width: 24 }, { header: 'Turi', width: 12 }, { header: 'Tavsif', width: 40 },
        { header: 'Kimga', width: 20 }, { header: 'Lavozimi', width: 12 }, { header: "Summa (so'm)", width: 16, style: 'money', total: 'sum' },
        { header: 'Asl valyuta', width: 14 }, { header: 'Kiritgan', width: 20 }, { header: 'Tasdiqlagan', width: 20 },
      ],
      rows: txs.map((tx: any, i: number): CellInput[] => [
        i + 1, dCell(tx.date), tx.projectId ? lk.objName.get(String(tx.projectId)) || '' : (tx.objectLabel || ''),
        TYPE_LABEL[tx.type] || tx.type, tx.description || '',
        lk.uname(tx.toUserId) || tx.recipientName || '', lk.urole(tx.toUserId), tx.amount || 0, origCell(tx),
        lk.uname(tx.createdById), lk.uname(tx.confirmedById),
      ]),
      emptyText: "Tanlangan davrda tasdiqlangan chiqim yo'q",
    });
    const byType = new Map<string, { v: number; n: number }>();
    for (const t of txs as any[]) { const k = TYPE_LABEL[t.type] || t.type; const r = byType.get(k) || { v: 0, n: 0 }; r.v += t.amount || 0; r.n++; byType.set(k, r); }
    const s2 = tableSheet({
      name: "Turlar bo'yicha", title: "Chiqim turlari bo'yicha", subtitle,
      columns: [{ header: 'Turi', width: 16, total: 'JAMI' }, { header: "Summa (so'm)", width: 18, style: 'money', total: 'sum' },
        { header: 'Ulushi', width: 10, style: 'pct' }, { header: 'Amallar soni', width: 12, style: 'int', total: 'sum' }],
      rows: [...byType.entries()].sort((a, b) => b[1].v - a[1].v).map(([k, r]) => [k, r.v, total ? r.v / total : 0, r.n]),
    });
    const allSpent = await Transaction.aggregate([
      { $match: scoped({ type: { $in: EXP_TYPES }, status: 'confirmed', projectId: { $exists: true, $ne: null } }) },
      { $group: { _id: '$projectId', spent: { $sum: '$amount' } } },
    ]);
    const spentBy = new Map(allSpent.map((r: any) => [String(r._id), r.spent as number]));
    const s3 = tableSheet({
      name: 'Byudjet', title: 'Obyektlar byudjeti (butun davr)', subtitle: company,
      columns: [{ header: 'Obyekt', width: 28, total: 'JAMI' }, { header: "Byudjet (so'm)", width: 18, style: 'money', total: 'sum' },
        { header: "Sarflangan (so'm)", width: 18, style: 'money', total: 'sum' }, { header: "Qoldiq (so'm)", width: 18, style: 'moneySigned', total: 'sum' },
        { header: 'Ishlatilgan', width: 11, style: 'pct' }],
      rows: lk.objects.filter((o: any) => o.budget || spentBy.get(String(o._id))).map((o: any): CellInput[] => {
        const spent = spentBy.get(String(o._id)) || 0, budget = o.budget || 0;
        return [o.name, budget, spent, budget ? budget - spent : '', budget ? spent / budget : ''];
      }),
    });
    await sendXlsx(res, `hisobot-${new Date().toISOString().split('T')[0]}.xlsx`, [s1, s2, s3], 'Hisobot');
  } catch (err) {
    console.error('[report xlsx]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
