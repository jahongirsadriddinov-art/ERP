import { Router } from 'express';
import * as xlsx from 'xlsx';
import Transaction from '../models/Transaction';
import ObjectModel from '../models/Object';
import User from '../models/User';
import { scoped } from '../middleware/scope';
import { requireOwnerOrAdmin } from '../middleware/auth';

const router = Router();

// GET /api/export1c/transactions — buxgalteriya (1C va shunga o'xshash
// dasturlar) uchun tranzaksiyalarni eksport qiladi. HAQIQIY 1C tarmoq
// integratsiyasi (uning o'z "CommerceML" almashuv serveri, canli API) EMAS
// — bu qasddan shunday: firma ma'lumotlari hech qanday tashqi xizmatga
// yubormaydi, faqat direktor o'zi yuklab olib, 1C'ga (yoki Excel'ga) O'ZI
// import qiladi ("boshqalar bilmasligi kerak" talabi bilan mos — hech kim,
// hatto bizning serverimiz ham, bu faylni birov bilan baham ko'rmaydi,
// faqat so'ragan admin brauzeriga tushadi).
//
// XATO TUZATILDI ("exel'da ko'rinishi tushunarsiz"): avval `;` bilan
// ajratilgan .csv fayl yuborilardi — bu Excel/Sheets qaysi TIL/MINTAQA
// sozlamasida ochilishiga qarab noto'g'ri (yoki umuman) bo'lib-bo'linmay,
// hammasi bitta ustunga (A) yopishib qolishi mumkin edi. Endi haqiqiy
// .xlsx fayl (aniq ustunlar, kengliklari sozlangan) yuboriladi — hech
// qanday ajratuvchi belgi yoki til sozlamasiga bog'liqlik yo'q.
const TYPE_LABEL: Record<string, string> = {
  transfer: 'Material yukxati', expense: 'Chiqim', income: 'Kirim', oylik: 'Oylik',
  material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Kutilmoqda', confirmed: 'Tasdiqlangan', rejected: "Rad etilgan",
};

router.get('/transactions', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string>;
    const filter: any = scoped();
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    const [transactions, objects] = await Promise.all([
      Transaction.find(filter).sort({ date: 1 }).lean(),
      ObjectModel.find(scoped()).select('name').lean(),
    ]);
    const objectName = new Map(objects.map(o => [String(o._id), o.name]));

    const header = ['Sana', 'Tur', 'Tavsif', 'Loyiha', 'Summa', 'Valyuta', 'Holat'];
    const rows = transactions.map(tx => {
      const amount = tx.type === 'transfer' ? '' : (tx.amount || 0);
      const desc = tx.type === 'transfer' ? `${tx.materialName || ''} (${tx.quantity || ''} ${tx.unit || ''})` : (tx.description || '');
      return [
        tx.date || '',
        TYPE_LABEL[tx.type] || tx.type,
        desc,
        tx.projectId ? objectName.get(String(tx.projectId)) || '' : '',
        amount,
        tx.currency || 'UZS',
        STATUS_LABEL[tx.status] || tx.status,
      ];
    });

    const sheet = xlsx.utils.aoa_to_sheet([header, ...rows]);
    // Ustun kengliklari — standart Excel torligida matn kesilib
    // ko'rinmasligi (masalan uzun tavsif/loyiha nomi) oldini olish uchun.
    sheet['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 36 }, { wch: 24 }, { wch: 14 }, { wch: 8 }, { wch: 14 },
    ];
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, sheet, 'Tranzaksiyalar');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = `1c-export-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[export1c]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/export1c/report?from&to&projectId — "Hisobotlar" sahifasidagi Excel eksport.
// Haqiqiy .xlsx, 3 varaq: tasdiqlangan chiqimlar, turlar bo'yicha xulosa, obyektlar byudjeti.
const EXP_TYPES = ['oylik', 'material', 'jihozlar', 'transport', 'boshqa', 'expense'];
router.get('/report', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { from, to, projectId } = req.query as Record<string, string>;
    const filter: any = scoped({ type: { $in: EXP_TYPES }, status: 'confirmed' });
    if (from || to) { filter.date = {}; if (from) filter.date.$gte = String(from); if (to) filter.date.$lte = String(to); }
    if (projectId) filter.projectId = String(projectId);
    const [txs, objects, users] = await Promise.all([
      Transaction.find(filter).sort({ date: 1 }).lean(),
      ObjectModel.find(scoped()).select('name budget').lean(),
      User.find(scoped()).select('firstName lastName').lean(),
    ]);
    const objName = new Map(objects.map((o: any) => [String(o._id), o.name]));
    const userName = new Map(users.map((u: any) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim()]));

    const rows = txs.map((tx: any) => [
      tx.date || '', TYPE_LABEL[tx.type] || tx.type, tx.description || '',
      tx.projectId ? objName.get(String(tx.projectId)) || '' : (tx.objectLabel || ''),
      tx.toUserId ? userName.get(String(tx.toUserId)) || '' : (tx.recipientName || ''),
      tx.createdById ? userName.get(String(tx.createdById)) || '' : '',
      tx.amount || 0,
      tx.currency && tx.currency !== 'UZS' ? `${tx.originalAmount} ${tx.currency}` : '',
    ]);
    const total = txs.reduce((a: number, t: any) => a + (t.amount || 0), 0);
    const s1 = xlsx.utils.aoa_to_sheet([
      ['Sana', 'Tur', 'Tavsif', 'Obyekt', 'Kimga', 'Kiritgan', "Summa (so'm)", 'Asl valyuta'],
      ...rows,
      [], ['', '', '', '', '', 'JAMI', total, ''],
    ]);
    s1['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 14 }];

    const byType = new Map<string, number>();
    for (const t of txs as any[]) byType.set(t.type, (byType.get(t.type) || 0) + (t.amount || 0));
    const s2 = xlsx.utils.aoa_to_sheet([
      ['Tur', "Summa (so'm)", 'Ulushi %'],
      ...[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [TYPE_LABEL[k] || k, v, total ? Math.round((v / total) * 1000) / 10 : 0]),
      [], ['JAMI', total, 100],
    ]);
    s2['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 10 }];

    // Byudjet — obyekt bo'yicha BUTUN davr sarfi (byudjet umumiy limit)
    const allSpent = await Transaction.aggregate([
      { $match: scoped({ type: { $in: EXP_TYPES }, status: 'confirmed', projectId: { $exists: true, $ne: null } }) },
      { $group: { _id: '$projectId', spent: { $sum: '$amount' } } },
    ]);
    const spentBy = new Map(allSpent.map((r: any) => [String(r._id), r.spent]));
    const s3 = xlsx.utils.aoa_to_sheet([
      ['Obyekt', "Byudjet (so'm)", "Sarflangan (so'm)", 'Qoldiq', 'Foiz %'],
      ...objects.filter((o: any) => o.budget || spentBy.get(String(o._id))).map((o: any) => {
        const spent = spentBy.get(String(o._id)) || 0;
        const budget = o.budget || 0;
        return [o.name, budget, spent, budget ? budget - spent : '', budget ? Math.round((spent / budget) * 100) : ''];
      }),
    ]);
    s3['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 8 }];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, s1, 'Chiqimlar');
    xlsx.utils.book_append_sheet(wb, s2, "Turlar bo'yicha");
    xlsx.utils.book_append_sheet(wb, s3, 'Byudjet');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="hisobot-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('[report xlsx]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
