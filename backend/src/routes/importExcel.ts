import { Router } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { checkRoleAssign, type GuardCaller } from '../utils/userGuards';
import { isValidUzPhone, normalizePhone } from '../utils/tokens';
import { num } from '../smeta/excelTable';
import { logAudit } from '../services/audit';

// ─── Excel'dan import (owner 2026-10-19) ─────────────────────────────────────────────────────────────────────
// Yangi firma xodimlar, obyektlar va materiallarni bitta fayl bilan kiritadi. Avval "ko'rib chiqish" (commit=0) —
// har qator tekshiriladi va xatolar ko'rsatiladi; keyin "saqlash" (commit=1). Lavozim qoidalari (checkRoleAssign),
// telefon bandligi va firma doirasi qo'lda qo'shishdagi bilan bir xil. Ustunlar sarlavha bo'yicha (uz/ru) topiladi.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

type Kind = 'employees' | 'objects' | 'materials';
const MAX_ROWS = 2000;

const COLS: Record<Kind, Record<string, RegExp>> = {
  employees: {
    fio: /^(f\.?\s*i\.?\s*o|ф\.?\s*и\.?\s*о|fio|фио)\b/i,
    firstName: /^(ism|исм|имя|name|first)/i,
    lastName: /familiya|фамилия|фамилия|last/i,
    phone: /telefon|телефон|phone|raqam|рақам/i,
    role: /lavozim|лавозим|rol|роль|должност/i,
    salary: /oylik|maosh|маош|оклад|зарплат|salary/i,
    brigade: /brigada|бригада/i,
  },
  objects: {
    name: /nomi|номи|obyekt|объект|название|name/i,
    location: /manzil|манзил|адрес|joy|location/i,
    budget: /byudjet|бюджет|budget|summa|сумма/i,
    start: /boshlan|бошлан|начал|start/i,
    end: /tugash|тугаш|оконч|deadline|end/i,
  },
  materials: {
    object: /obyekt|объект|object/i,
    name: /material|nomi|номи|наимен|name/i,
    unit: /birlik|бирлик|o['ʻ`’]?lchov|ед\.?\s*изм|unit/i,
    needed: /miqdor|миқдор|kerak|керак|кол[-.\s]*во|количеств|qty|quantity/i,
    price: /narx|нарх|цена|price/i,
  },
};

const ROLE_MAP: Array<[RegExp, string]> = [
  [/prorab|прораб/i, 'prorab'], [/brigadir|бригадир/i, 'brigadir'],
  [/o['ʻ`’]?rinbosar|ўринбосар|заместит/i, 'orinbosar'], [/ishchi|ишчи|рабоч|worker/i, 'ishchi'],
];
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

function readSheet(buf: Buffer): unknown[][] {
  const wb = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const sh = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' }) as unknown[][];
}

function mapHeader(rows: unknown[][], kind: Kind): { row: number; cols: Record<string, number> } | null {
  const want = COLS[kind];
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols: Record<string, number> = {};
    (rows[r] || []).forEach((cell, c) => {
      const text = norm(cell);
      if (!text || text.length > 60) return;
      for (const [k, re] of Object.entries(want)) if (cols[k] === undefined && re.test(text)) { cols[k] = c; break; }
    });
    const ok = kind === 'employees' ? (cols.phone !== undefined && (cols.firstName !== undefined || cols.fio !== undefined))
      : kind === 'objects' ? cols.name !== undefined
        : cols.name !== undefined && cols.needed !== undefined;
    if (ok) return { row: r, cols };
  }
  return null;
}

const asDate = (v: unknown): string | undefined => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = norm(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!m) return undefined;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
};

export interface ParsedImport { kind: Kind; rows: any[]; errors: Array<{ row: number; error: string }> }

export function parseImportRows(kind: Kind, rows: unknown[][]): ParsedImport {
  const h = mapHeader(rows, kind);
  if (!h) return { kind, rows: [], errors: [{ row: 0, error: 'Sarlavha qatori topilmadi — shablondan foydalaning' }] };
  const out: any[] = [];
  const errors: ParsedImport['errors'] = [];
  const at = (row: unknown[], k: string) => (h.cols[k] === undefined ? '' : row[h.cols[k]]);
  for (let r = h.row + 1; r < rows.length && out.length + errors.length < MAX_ROWS; r++) {
    const row = rows[r] || [];
    // Faqat tartib raqami bor (yoki butunlay bo'sh) qator — o'tkazib yuboriladi
    if (!Object.values(h.cols).some((c) => norm(row[c]))) continue;
    const line = r + 1;
    if (kind === 'employees') {
      let firstName = norm(at(row, 'firstName')), lastName = norm(at(row, 'lastName'));
      if (!firstName && h.cols.fio !== undefined) { const p = norm(at(row, 'fio')).split(' '); lastName = p[0] || ''; firstName = p[1] || p[0] || ''; }
      const rawPhone = norm(at(row, 'phone')).replace(/[^\d+]/g, '');
      const phone = rawPhone.length === 9 ? `+998${rawPhone}` : rawPhone;
      if (!firstName) { errors.push({ row: line, error: 'Ism yo\'q' }); continue; }
      if (!isValidUzPhone(phone)) { errors.push({ row: line, error: `Telefon noto'g'ri: ${rawPhone || '—'}` }); continue; }
      const roleText = norm(at(row, 'role'));
      const role = ROLE_MAP.find(([re]) => re.test(roleText))?.[1] || 'ishchi';
      const salary = num(at(row, 'salary'));
      out.push({ line, firstName: firstName.slice(0, 60), lastName: lastName.slice(0, 60), phone: normalizePhone(phone), role, baseSalary: salary && salary > 0 ? salary : undefined, brigade: norm(at(row, 'brigade')).slice(0, 60) || undefined });
    } else if (kind === 'objects') {
      const name = norm(at(row, 'name'));
      if (name.length < 2) { errors.push({ row: line, error: 'Obyekt nomi yo\'q' }); continue; }
      const budget = num(at(row, 'budget'));
      out.push({ line, name: name.slice(0, 200), location: norm(at(row, 'location')).slice(0, 200) || undefined, budget: budget && budget > 0 ? budget : undefined, startDate: asDate(at(row, 'start')), endDate: asDate(at(row, 'end')) });
    } else {
      const name = norm(at(row, 'name'));
      const needed = num(at(row, 'needed'));
      if (!name) { errors.push({ row: line, error: 'Material nomi yo\'q' }); continue; }
      if (!(needed && needed > 0)) { errors.push({ row: line, error: 'Miqdor noto\'g\'ri' }); continue; }
      const price = num(at(row, 'price'));
      out.push({ line, object: norm(at(row, 'object')).slice(0, 200), name: name.slice(0, 200), unit: norm(at(row, 'unit')).slice(0, 20) || 'dona', needed, price: price && price > 0 ? price : undefined });
    }
  }
  return { kind, rows: out, errors };
}

const TEMPLATES: Record<Kind, unknown[][]> = {
  employees: [['Ism', 'Familiya', 'Telefon', 'Lavozim', 'Oylik', 'Brigada'], ['Ali', 'Valiyev', '+998901234567', 'ishchi', 3000000, '1-brigada'], ['Vali', 'Aliyev', '901234568', 'prorab', 6000000, '']],
  objects: [['Obyekt nomi', 'Manzil', 'Byudjet', 'Boshlanish', 'Tugash'], ['Olmazor 12-uy', 'Toshkent, Olmazor', 1500000000, '2026-11-01', '2027-06-30']],
  materials: [['Obyekt', 'Material', 'Birlik', 'Miqdor', 'Narx'], ['Olmazor 12-uy', 'Sement M400', 'tonna', 120, 1100000], ['Olmazor 12-uy', "G'isht", 'dona', 50000, 1200]],
};

router.get('/template/:kind', (req, res) => {
  const kind = req.params.kind as Kind;
  if (!TEMPLATES[kind]) return res.status(404).json({ error: 'Topilmadi' });
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(TEMPLATES[kind]), 'Import');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="import-${kind}.xlsx"`);
  res.send(buf);
});

router.post('/:kind', upload.single('file'), async (req, res) => {
  try {
    const kind = req.params.kind as Kind;
    if (!COLS[kind]) return res.status(404).json({ error: 'Topilmadi' });
    if (!req.file) return res.status(400).json({ error: 'Excel fayl yuklang' });
    let rows: unknown[][];
    try { rows = readSheet(req.file.buffer); } catch { return res.status(400).json({ error: "Faylni o'qib bo'lmadi — .xlsx formatida yuklang" }); }
    const parsed = parseImportRows(kind, rows);
    const commit = String(req.query.commit || '') === '1';
    const t = getTenant();
    const caller: GuardCaller = { userId: String(t?.userId), role: String(t?.role), companyId: t?.companyId, isOwner: t?.isOwner, isDeveloper: t?.isDeveloper };

    // Saqlashdan oldin ham tekshiriladigan narsalar: lavozim huquqi, telefon bandligi, obyekt mavjudligi
    const errors = [...parsed.errors];
    let valid = parsed.rows;
    if (kind === 'employees') {
      const phones = valid.map((r) => r.phone);
      const taken = new Set((await User.find({ phone: { $in: phones } }).select('phone').lean()).map((u: any) => u.phone));
      const seen = new Set<string>();
      valid = valid.filter((r) => {
        const roleErr = checkRoleAssign(caller, r.role);
        if (roleErr) { errors.push({ row: r.line, error: roleErr.error }); return false; }
        if (taken.has(r.phone) || seen.has(r.phone)) { errors.push({ row: r.line, error: `Raqam band: ${r.phone}` }); return false; }
        seen.add(r.phone);
        return true;
      });
    } else if (kind === 'objects') {
      const existing = new Set((await ObjectModel.find(scoped({})).select('name').lean()).map((o: any) => norm(o.name).toLowerCase()));
      valid = valid.filter((r) => { if (existing.has(r.name.toLowerCase())) { errors.push({ row: r.line, error: `Obyekt allaqachon bor: ${r.name}` }); return false; } return true; });
    } else {
      const objs: any[] = await ObjectModel.find(scoped({})).select('name').lean();
      const byName = new Map(objs.map((o) => [norm(o.name).toLowerCase(), String(o._id)]));
      const single = objs.length === 1 ? String(objs[0]._id) : '';
      valid = valid.filter((r) => {
        r.objectId = byName.get(r.object.toLowerCase()) || (!r.object && single) || '';
        if (!r.objectId) { errors.push({ row: r.line, error: `Obyekt topilmadi: ${r.object || '—'}` }); return false; }
        return true;
      });
    }

    if (!commit) return res.json({ kind, valid: valid.length, errors: errors.sort((a, b) => a.row - b.row).slice(0, 200), preview: valid.slice(0, 20) });

    let created = 0;
    for (const r of valid) {
      try {
        if (kind === 'employees') {
          await User.create(stamped({ firstName: r.firstName, lastName: r.lastName || '', phone: r.phone, role: r.role, projectIds: [],
            ...(r.baseSalary ? { baseSalary: r.baseSalary } : {}), ...(r.brigade ? { brigade: r.brigade } : {}) }));
        } else if (kind === 'objects') {
          await ObjectModel.create(stamped({ name: r.name, location: r.location, budget: r.budget, status: 'active',
            ...(r.startDate ? { startDate: new Date(r.startDate) } : {}), ...(r.endDate ? { endDate: new Date(r.endDate) } : {}) }));
        } else {
          const ex: any = await Material.findOne(scoped({ objectId: r.objectId, name: r.name }));
          if (ex) { ex.needed = (ex.needed || 0) + r.needed; ex.remaining = Math.max(0, ex.needed - (ex.sent || 0)); if (r.price) ex.price = r.price; await ex.save(); }
          else await Material.create(stamped({ objectId: r.objectId, name: r.name, unit: r.unit, needed: r.needed, sent: 0, remaining: r.needed, ...(r.price ? { price: r.price } : {}) }));
        }
        created++;
      } catch (e: any) {
        errors.push({ row: r.line, error: e?.code === 11000 ? 'Takroriy yozuv' : 'Saqlanmadi' });
      }
    }
    const actor: any = await User.findById(t?.userId).select('firstName lastName role').lean().catch(() => null);
    if (actor) {
      logAudit({ userId: String(t?.userId), userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'create', entity: 'import', entityId: kind, description: `Excel import (${kind}): ${created} ta qo'shildi, ${errors.length} ta xato`, companyId: t?.companyId, req }).catch(() => undefined);
    }
    res.json({ kind, created, errors: errors.sort((a, b) => a.row - b.row).slice(0, 200) });
  } catch (err) {
    console.error('[import]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
