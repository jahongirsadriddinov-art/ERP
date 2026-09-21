import { Router } from 'express';
import Transaction from '../models/Transaction';
import ObjectModel from '../models/Object';
import { scoped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';

const router = Router();

// GET /api/export1c/transactions — buxgalteriya (1C va shunga o'xshash
// dasturlar) uchun tranzaksiyalarni CSV sifatida eksport qiladi. HAQIQIY
// 1C tarmoq integratsiyasi (uning o'z "CommerceML" almashuv serveri, canli
// API) EMAS — bu qasddan shunday: firma ma'lumotlari hech qanday tashqi
// xizmatga yubormaydi, faqat direktor o'zi yuklab olib, 1C'ga (yoki
// Excel'ga) O'ZI import qiladi ("boshqalar bilmasligi kerak" talabi bilan
// mos — hech kim, hatto bizning serverimiz ham, bu faylni birov bilan
// baham ko'rmaydi, faqat so'ragan admin brauzeriga tushadi).
function csvEscape(v: any): string {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/transactions', requireOwnerOrAdmin, async (req, res) => {
  try {
    const t = getTenant();
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

    const TYPE_LABEL: Record<string, string> = {
      transfer: 'Material yukxati', expense: 'Chiqim', income: 'Kirim', oylik: 'Oylik',
      material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa',
    };

    const header = ['Sana', 'Tur', 'Tavsif', 'Loyiha', 'Summa', 'Valyuta', 'Holat'].join(';');
    const rows = transactions.map(tx => {
      const amount = tx.type === 'transfer' ? '' : (tx.amount || 0);
      const desc = tx.type === 'transfer' ? `${tx.materialName || ''} (${tx.quantity || ''} ${tx.unit || ''})` : (tx.description || '');
      return [
        tx.date || '',
        TYPE_LABEL[tx.type] || tx.type,
        csvEscape(desc),
        csvEscape(tx.projectId ? objectName.get(String(tx.projectId)) || '' : ''),
        amount,
        tx.currency || 'UZS',
        tx.status,
      ].join(';');
    });

    // ﻿ (BOM) — Excel/1C Windows'da UTF-8'ni to'g'ri (kirillcha/lotincha
    // harflar buzilmasdan) ochishi uchun standart amaliyot.
    const csv = '﻿' + [header, ...rows].join('\r\n');
    const filename = `1c-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[export1c]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
