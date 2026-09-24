import { Router } from 'express';
import * as xlsx from 'xlsx';
import Transaction from '../models/Transaction';
import ObjectModel from '../models/Object';
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

export default router;
