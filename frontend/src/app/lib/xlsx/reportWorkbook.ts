// "Hisobotlar" sahifasining Excel fayli (owner 2026-10-22: "Excel'ga yuklangan hamma narsa tartibsiz — tushunarli
// va tartibli qil"). Toza funksiya: ekranda ko'rinib turgan ma'lumotdan (filtrlangan davr/obyekt) varaqlar quradi —
// server shart emas, telefonda/oflayn ham ishlaydi. Ustun nomlari doim o'zbekcha (buxgalter uchun bir xil fayl).
//
// Varaqlar: Umumiy (muqova: kompaniya, davr, asosiy ko'rsatkichlar, turlar va obyektlar bo'yicha xulosa),
// Chiqimlar, Kirimlar, Obyektlar bo'yicha, Xodimlar bo'yicha, Davomat (agar yuklangan bo'lsa).
import type { AppUser, Expense, Project } from '../../App';
import { buildXlsx, dateSerial, tableSheet, tashkentSerial, tashkentTimeOfDay, type Cell, type CellInput, type SheetDef, type StyleName } from './writer';

export const TYPE_LABEL: Record<string, string> = {
  oylik: 'Oylik', material: 'Material', jihozlar: 'Jihozlar', transport: 'Transport', boshqa: 'Boshqa', expense: 'Boshqa', income: 'Kirim',
};
export const TYPE_ORDER = ['oylik', 'material', 'jihozlar', 'transport', 'boshqa'] as const;
export const ROLE_LABEL: Record<string, string> = {
  direktor: 'Direktor', orinbosar: "O'rinbosar", prorab: 'Prorab', brigadir: 'Brigadir', ishchi: 'Ishchi', dasturchi: 'Dasturchi',
};
export const STATUS_LABEL: Record<string, string> = { pending: 'Kutilmoqda', confirmed: 'Tasdiqlangan', rejected: 'Rad etilgan' };
export const PROJECT_STATUS_LABEL: Record<string, string> = { active: 'Faol', paused: "To'xtatilgan", completed: 'Yakunlangan' };
export const ATT_STATUS_LABEL: Record<string, string> = { present: 'Vaqtida', late: 'Kechikdi', absent: 'Kelmadi', half: 'Yarim kun' };

export interface AttendanceRow {
  userId: string; date: string; checkIn?: string | null; checkOut?: string | null;
  workHours?: number | null; status?: string; note?: string;
}

export interface ReportInput {
  companyName: string;
  /** "YYYY-MM-DD" yoki "" (cheklanmagan) */
  from: string; to: string;
  /** "Barcha obyektlar" yoki tanlangan obyekt nomi */
  projectLabel: string;
  generatedAt: Date;
  /** Davr va obyekt bo'yicha filtrlangan TASDIQLANGAN chiqimlar */
  expenses: Expense[];
  /** Davr va obyekt bo'yicha filtrlangan TASDIQLANGAN kirimlar */
  incomes: Expense[];
  includeIncome: boolean;
  /** Byudjet sarfi uchun — obyekt bo'yicha butun davrdagi tasdiqlangan chiqimlar (ixtiyoriy) */
  allTimeExpenses?: Expense[];
  users: AppUser[];
  /** Hisobotga kiradigan obyektlar (tanlangan bo'lsa — faqat o'sha) */
  projects: Project[];
  /** null/undefined — davomat yuklanmagan (varaq qo'shilmaydi) */
  attendance?: AttendanceRow[] | null;
}

export const SHEET = {
  summary: 'Umumiy', expenses: 'Chiqimlar', incomes: 'Kirimlar', objects: "Obyektlar bo'yicha", people: "Xodimlar bo'yicha", attendance: 'Davomat',
} as const;

const fmtDate = (ymd: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd); return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd; };
export function periodLabel(from: string, to: string): string {
  if (!from && !to) return 'Butun davr';
  if (from && to) return from === to ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(to)}`;
  return from ? `${fmtDate(from)} dan` : `${fmtDate(to)} gacha`;
}
const d = (ymd: string): Cell => { const s = dateSerial(ymd); return s == null ? { v: ymd || '' } : { v: s, s: 'date' }; };
const sum = (xs: Expense[]) => xs.reduce((a, e) => a + (e.amount || 0), 0);
const NO_OBJECT = 'Obyektga biriktirilmagan';

export function buildReportSheets(inp: ReportInput): SheetDef[] {
  const userById = new Map(inp.users.map(u => [u.id, u]));
  const projById = new Map(inp.projects.map(p => [p.id, p]));
  const uname = (id?: string) => (id && userById.get(id)?.name) || '';
  const urole = (id?: string) => { const r = id && userById.get(id)?.role; return r ? ROLE_LABEL[r] || r : ''; };
  const objName = (e: Expense) => (e.projectId && projById.get(e.projectId)?.name) || e.objectLabel || NO_OBJECT;
  const period = periodLabel(inp.from, inp.to);
  const subtitle = `${inp.companyName} · ${period} · ${inp.projectLabel}`;
  const byDate = (a: Expense, b: Expense) => a.date.localeCompare(b.date) || (b.amount || 0) - (a.amount || 0);
  const exps = [...inp.expenses].sort(byDate);
  const incs = inp.includeIncome ? [...inp.incomes].sort(byDate) : [];
  const totalExp = sum(exps), totalInc = sum(incs);
  const origCell = (e: Expense): CellInput =>
    e.currency && e.currency !== 'UZS' && e.originalAmount != null ? { v: e.originalAmount, s: e.currency === 'EUR' ? 'eur' : 'usd' } : '';
  const source = (e: Expense) => e.source === 'bot' ? 'Telegram bot' : 'Sayt / ilova';

  // ── Chiqimlar ──
  const expSheet = tableSheet({
    name: SHEET.expenses, title: 'Chiqimlar', subtitle,
    columns: [
      { header: '№', width: 6, style: 'int', total: 'JAMI' },
      { header: 'Sana', width: 12, style: 'date' },
      { header: 'Obyekt', width: 26 },
      { header: 'Turi', width: 12 },
      { header: 'Tavsif', width: 42 },
      { header: 'Kimga', width: 22 },
      { header: 'Lavozimi', width: 12 },
      { header: "Summa (so'm)", width: 16, style: 'money', total: 'sum' },
      { header: 'Asl valyuta', width: 14 },
      { header: 'Kiritgan', width: 20 },
      { header: 'Tasdiqlagan', width: 20 },
      { header: 'Manba', width: 14 },
      { header: 'Holati', width: 13 },
      { header: 'Izoh', width: 24 },
    ],
    rows: exps.map((e, i) => [
      i + 1, d(e.date), objName(e), TYPE_LABEL[e.type] || TYPE_LABEL.boshqa, e.description || TYPE_LABEL[e.type] || '',
      uname(e.toUserId) || e.recipientName || '', urole(e.toUserId), e.amount || 0, origCell(e),
      uname(e.createdById), uname(e.confirmedById), source(e), STATUS_LABEL[e.status] || e.status,
      e.anomaly ? { v: "G'ayrioddiy katta chiqim", s: 'warn' } : '',
    ]),
    emptyText: "Tanlangan davrda tasdiqlangan chiqim yo'q",
  });

  // ── Kirimlar ──
  const incSheet = inp.includeIncome ? tableSheet({
    name: SHEET.incomes, title: 'Kirimlar', subtitle,
    columns: [
      { header: '№', width: 6, style: 'int', total: 'JAMI' },
      { header: 'Sana', width: 12, style: 'date' },
      { header: 'Obyekt', width: 26 },
      { header: 'Tavsif', width: 42 },
      { header: 'Kimdan / kimga', width: 22 },
      { header: "Summa (so'm)", width: 16, style: 'money', total: 'sum' },
      { header: 'Asl valyuta', width: 14 },
      { header: 'Kiritgan', width: 20 },
      { header: 'Tasdiqlagan', width: 20 },
      { header: 'Holati', width: 13 },
    ],
    rows: incs.map((e, i) => [
      i + 1, d(e.date), objName(e), e.description || 'Kirim', uname(e.toUserId) || e.recipientName || '',
      e.amount || 0, origCell(e), uname(e.createdById), uname(e.confirmedById), STATUS_LABEL[e.status] || e.status,
    ]),
    emptyText: "Tanlangan davrda tasdiqlangan kirim yo'q",
  }) : null;

  // ── Obyektlar bo'yicha ──
  interface ObjAgg { name: string; project?: Project; byType: Record<string, number>; exp: number; inc: number; n: number }
  const objMap = new Map<string, ObjAgg>();
  const objKey = (e: Expense) => (e.projectId && projById.has(e.projectId)) ? `p:${e.projectId}` : `l:${e.objectLabel || NO_OBJECT}`;
  const getObj = (e: Expense): ObjAgg => {
    const k = objKey(e);
    let o = objMap.get(k);
    if (!o) { o = { name: objName(e), project: e.projectId ? projById.get(e.projectId) : undefined, byType: {}, exp: 0, inc: 0, n: 0 }; objMap.set(k, o); }
    return o;
  };
  for (const p of inp.projects) objMap.set(`p:${p.id}`, { name: p.name, project: p, byType: {}, exp: 0, inc: 0, n: 0 });
  for (const e of exps) { const o = getObj(e); const t = TYPE_ORDER.includes(e.type as any) ? e.type : 'boshqa'; o.byType[t] = (o.byType[t] || 0) + (e.amount || 0); o.exp += e.amount || 0; o.n++; }
  for (const e of incs) { const o = getObj(e); o.inc += e.amount || 0; o.n++; }
  const allTimeSpent = new Map<string, number>();
  for (const e of inp.allTimeExpenses || []) if (e.projectId) allTimeSpent.set(e.projectId, (allTimeSpent.get(e.projectId) || 0) + (e.amount || 0));
  const objs = [...objMap.values()].filter(o => o.n > 0 || (o.project?.budget || 0) > 0).sort((a, b) => b.exp - a.exp || b.inc - a.inc || a.name.localeCompare(b.name));
  const objCols = [
    { header: 'Obyekt', width: 28, total: 'JAMI' },
    { header: 'Holati', width: 13 },
    ...TYPE_ORDER.map(t => ({ header: `${TYPE_LABEL[t]} (so'm)`, width: 15, style: 'money' as StyleName, total: 'sum' })),
    { header: "Jami chiqim (so'm)", width: 17, style: 'moneyBold' as StyleName, total: 'sum' },
    ...(inp.includeIncome ? [
      { header: "Kirim (so'm)", width: 16, style: 'money' as StyleName, total: 'sum' },
      { header: "Farq: kirim − chiqim (so'm)", width: 19, style: 'moneySigned' as StyleName, total: 'sum' },
    ] : []),
    { header: "Byudjet (so'm)", width: 16, style: 'money' as StyleName, total: 'sum' },
    { header: "Butun davrda sarflangan (so'm)", width: 19, style: 'money' as StyleName, total: 'sum' },
    { header: 'Byudjet ishlatilgan', width: 12, style: 'pct' as StyleName },
  ];
  const objSheet = tableSheet({
    name: SHEET.objects, title: "Obyektlar bo'yicha", subtitle, columns: objCols,
    rows: objs.map(o => {
      const budget = o.project?.budget || 0;
      const spentAll = o.project ? (allTimeSpent.get(o.project.id) ?? 0) : 0;
      const pct: CellInput = budget > 0 && o.project && inp.allTimeExpenses ? { v: spentAll / budget, s: 'pct' } : '';
      return [
        o.name, o.project ? PROJECT_STATUS_LABEL[o.project.status] || o.project.status : '—',
        ...TYPE_ORDER.map(t => o.byType[t] || 0), o.exp,
        ...(inp.includeIncome ? [o.inc, o.inc - o.exp] : []),
        budget || '', o.project && inp.allTimeExpenses ? spentAll : '', pct,
      ];
    }),
    notes: ["Byudjet ustunlari obyektning butun davri bo'yicha (byudjet — obyektning umumiy limiti)."],
  });

  // ── Xodimlar bo'yicha ──
  interface PAgg { name: string; role: string; phone: string; salary: number; other: number; n: number; created: number; days: number; hours: number }
  const people = new Map<string, PAgg>();
  const getP = (key: string, name: string, role = '', phone = ''): PAgg => {
    let p = people.get(key);
    if (!p) { p = { name, role, phone, salary: 0, other: 0, n: 0, created: 0, days: 0, hours: 0 }; people.set(key, p); }
    return p;
  };
  const getUserP = (id: string) => { const u = userById.get(id); return getP(`u:${id}`, u?.name || "Noma'lum xodim", u ? ROLE_LABEL[u.role] || u.role : '', u?.phone || ''); };
  for (const e of exps) {
    const p = e.toUserId ? getUserP(e.toUserId) : e.recipientName ? getP(`n:${e.recipientName.trim().toLowerCase()}`, e.recipientName.trim(), 'Tashqi') : null;
    if (p) { if (e.type === 'oylik') p.salary += e.amount || 0; else p.other += e.amount || 0; p.n++; }
    if (e.createdById && userById.has(e.createdById)) getUserP(e.createdById).created += e.amount || 0;
  }
  const att = inp.attendance || null;
  const hoursOf = (a: AttendanceRow) => a.workHours != null ? a.workHours
    : a.checkIn && a.checkOut ? Math.max(0, (Date.parse(a.checkOut) - Date.parse(a.checkIn)) / 3600_000) : 0;
  if (att) for (const a of att) {
    if (!userById.has(a.userId) || !a.checkIn) continue;
    const p = getUserP(a.userId); p.days++; p.hours += hoursOf(a);
  }
  const peopleRows = [...people.values()].sort((a, b) => (b.salary + b.other) - (a.salary + a.other) || b.created - a.created || a.name.localeCompare(b.name));
  const peopleSheet = tableSheet({
    name: SHEET.people, title: "Xodimlar bo'yicha", subtitle,
    columns: [
      { header: 'Xodim', width: 26, total: 'JAMI' },
      { header: 'Lavozimi', width: 12 },
      { header: 'Telefon', width: 16 },
      { header: "Oylik (so'm)", width: 16, style: 'money', total: 'sum' },
      { header: "Boshqa to'lovlar (so'm)", width: 18, style: 'money', total: 'sum' },
      { header: "Jami olgan (so'm)", width: 17, style: 'moneyBold', total: 'sum' },
      { header: "To'lovlar soni", width: 11, style: 'int', total: 'sum' },
      { header: "O'zi kiritgan chiqimlar (so'm)", width: 19, style: 'money', total: 'sum' },
      ...(att ? [
        { header: 'Ishlagan kunlar', width: 11, style: 'int' as StyleName, total: 'sum' },
        { header: 'Ishlagan soat', width: 11, style: 'dec1' as StyleName, total: 'sum', totalStyle: 'dec1Bold' as StyleName },
      ] : []),
    ],
    rows: peopleRows.map(p => [
      p.name, p.role, p.phone, p.salary, p.other, p.salary + p.other, p.n, p.created,
      ...(att ? [p.days, Math.round(p.hours * 10) / 10] : []),
    ]),
    emptyText: "Tanlangan davrda xodimlarga to'lov yo'q",
  });

  // ── Davomat ──
  const attSheet = att ? tableSheet({
    name: SHEET.attendance, title: 'Davomat', subtitle,
    columns: [
      { header: 'Sana', width: 12, style: 'date', total: 'JAMI' },
      { header: 'Xodim', width: 26 },
      { header: 'Lavozimi', width: 12 },
      { header: 'Keldi', width: 9, style: 'time' },
      { header: 'Ketdi', width: 9, style: 'time' },
      { header: 'Ishlagan (soat)', width: 12, style: 'dec1', total: 'sum', totalStyle: 'dec1Bold' },
      { header: 'Holati', width: 18 },
      { header: 'Izoh', width: 30 },
    ],
    rows: [...att].filter(a => userById.has(a.userId))
      .sort((a, b) => b.date.localeCompare(a.date) || uname(a.userId).localeCompare(uname(b.userId)))
      .map(a => {
        const inT = tashkentTimeOfDay(a.checkIn), outT = tashkentTimeOfDay(a.checkOut);
        const status = a.checkIn && !a.checkOut ? 'Ishda (chiqish qilinmagan)' : ATT_STATUS_LABEL[a.status || ''] || (a.checkIn ? 'Keldi' : 'Kelmadi');
        return [d(a.date), uname(a.userId), urole(a.userId), inT ?? '', outT ?? '',
          a.checkIn && a.checkOut ? Math.round(hoursOf(a) * 10) / 10 : '', status, a.note || ''];
      }),
    emptyText: "Tanlangan davrda davomat yozuvi yo'q",
  }) : null;

  // ── Umumiy (muqova) ──
  const rows: CellInput[][] = [];
  const merges: string[] = [];
  const push = (r: CellInput[]) => { rows.push(r); return rows.length; };
  push([{ v: 'Moliyaviy hisobot', s: 'title' }]); merges.push('A1:E1');
  push([{ v: inp.companyName, s: 'subtitle' }]);
  push([]);
  push([{ v: "Hisobot ma'lumotlari", s: 'section' }, { v: '', s: 'section' }]);
  push([{ v: 'Davr', s: 'bold' }, period]);
  push([{ v: 'Obyekt', s: 'bold' }, inp.projectLabel]);
  push([{ v: 'Yaratilgan sana', s: 'bold' }, { v: tashkentSerial(inp.generatedAt), s: 'datetime' }]);
  push([{ v: 'Valyuta', s: 'bold' }, "So'm (UZS) — chet el valyutasidagi summalar so'mga aylantirilgan"]);
  push([]);
  push([{ v: "Asosiy ko'rsatkichlar", s: 'section' }, { v: '', s: 'section' }]);
  if (inp.includeIncome) push([{ v: 'Jami kirim', s: 'bold' }, { v: totalInc, s: 'moneyBig' }, { v: `${incs.length} ta amal`, s: 'muted' }]);
  push([{ v: 'Jami chiqim', s: 'bold' }, { v: totalExp, s: 'moneyBig' }, { v: `${exps.length} ta amal`, s: 'muted' }]);
  if (inp.includeIncome) push([{ v: 'Sof natija (kirim − chiqim)', s: 'bold' }, { v: totalInc - totalExp, s: 'moneyBigSigned' },
    { v: totalInc - totalExp >= 0 ? 'Foyda' : 'Zarar', s: totalInc - totalExp >= 0 ? 'good' : 'bad' }]);
  const days = inp.from && inp.to ? Math.round((Date.parse(inp.to) - Date.parse(inp.from)) / 86400000) + 1 : new Set(exps.map(e => e.date)).size;
  if (days > 0) push([{ v: "Kunlik o'rtacha chiqim", s: 'bold' }, { v: Math.round(totalExp / days), s: 'money' }, { v: `${days} kun`, s: 'muted' }]);
  push([]);

  push([{ v: "Chiqim turlari bo'yicha", s: 'section' }, ...Array(3).fill({ v: '', s: 'section' })]);
  push(['Turi', "Summa (so'm)", 'Ulushi', 'Amallar soni'].map(h => ({ v: h, s: 'header' as StyleName })));
  const typeRows = TYPE_ORDER.map(t => {
    const xs = exps.filter(e => (TYPE_ORDER.includes(e.type as any) ? e.type : 'boshqa') === t);
    return { t, v: sum(xs), n: xs.length };
  }).filter(r => r.n > 0).sort((a, b) => b.v - a.v);
  const typeFirst = rows.length + 1;
  for (const r of typeRows) push([TYPE_LABEL[r.t], { v: r.v, s: 'money' }, { v: totalExp ? r.v / totalExp : 0, s: 'pct' }, { v: r.n, s: 'int' }]);
  if (!typeRows.length) push([{ v: "Chiqim yo'q", s: 'muted' }]);
  else {
    const last = rows.length;
    push([{ v: 'JAMI', s: 'totalLabel' }, { v: totalExp, f: `SUM(B${typeFirst}:B${last})`, s: 'total' },
      { v: totalExp ? 1 : 0, s: 'pctBold' }, { v: exps.length, f: `SUM(D${typeFirst}:D${last})`, s: 'total' }]);
  }
  push([]);

  push([{ v: "Obyektlar bo'yicha", s: 'section' }, ...Array(inp.includeIncome ? 3 : 1).fill({ v: '', s: 'section' })]);
  push((inp.includeIncome ? ['Obyekt', "Chiqim (so'm)", "Kirim (so'm)", "Farq (so'm)"] : ['Obyekt', "Chiqim (so'm)"]).map(h => ({ v: h, s: 'header' as StyleName })));
  const objActive = objs.filter(o => o.n > 0);
  const objFirst = rows.length + 1;
  for (const o of objActive) push([o.name, { v: o.exp, s: 'money' }, ...(inp.includeIncome ? [{ v: o.inc, s: 'money' as StyleName }, { v: o.inc - o.exp, s: 'moneySigned' as StyleName }] : [])]);
  if (!objActive.length) push([{ v: "Ma'lumot yo'q", s: 'muted' }]);
  else {
    const last = rows.length;
    push([{ v: 'JAMI', s: 'totalLabel' }, { v: totalExp, f: `SUM(B${objFirst}:B${last})`, s: 'total' },
      ...(inp.includeIncome ? [{ v: totalInc, f: `SUM(C${objFirst}:C${last})`, s: 'total' as StyleName }, { v: totalInc - totalExp, f: `SUM(D${objFirst}:D${last})`, s: 'total' as StyleName }] : [])]);
  }
  push([]);

  const sheets: SheetDef[] = [expSheet, ...(incSheet ? [incSheet] : []), objSheet, peopleSheet, ...(attSheet ? [attSheet] : [])];
  const DESC: Record<string, string> = {
    [SHEET.expenses]: "har bir tasdiqlangan chiqim: sana, obyekt, turi, kimga, kim kiritgan/tasdiqlagan",
    [SHEET.incomes]: 'har bir tasdiqlangan kirim',
    [SHEET.objects]: "har obyekt: chiqim turlari, kirim, farq, byudjet",
    [SHEET.people]: "har xodim: oylik va boshqa to'lovlar" + (att ? ', ishlagan kun/soat' : ''),
    [SHEET.attendance]: 'kunlik kelish/ketish vaqtlari',
  };
  push([{ v: 'Fayldagi varaqlar', s: 'section' }, { v: '', s: 'section' }]);
  for (const s of sheets) push([{ v: s.name, s: 'bold' }, DESC[s.name] || '']);
  push([]);
  push([{ v: "Faqat tasdiqlangan amallar kiritilgan. Jadvallarda filtr bor — sarlavhadagi ▼ tugmasi bilan saralang/filtrlang.", s: 'muted' }]);

  const summary: SheetDef = { name: SHEET.summary, rows, cols: [34, 20, 16, 16, 16], merges, rowHeights: { 1: 26 } };
  return [summary, ...sheets];
}

export function reportFileName(projectLabel: string, from: string, to: string, generatedAt = new Date()): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 40);
  const range = from || to ? [from, to].filter(Boolean).join('_') : `butun-davr_${generatedAt.toISOString().slice(0, 10)}`;
  return `hisobot_${clean(projectLabel)}_${range}.xlsx`;
}

export async function buildReportXlsx(inp: ReportInput): Promise<Uint8Array> {
  return buildXlsx(buildReportSheets(inp), { title: `Moliyaviy hisobot — ${periodLabel(inp.from, inp.to)}`, author: inp.companyName, created: inp.generatedAt });
}

// ── Bitta/bir nechta chiqim (Moliya sahifasidagi "Excel'ga yuklab olish") ──
export function expensesSheets(expenses: Expense[], users: AppUser[], projects: Project[], companyName = ''): SheetDef[] {
  const userById = new Map(users.map(u => [u.id, u]));
  const projById = new Map(projects.map(p => [p.id, p]));
  const uname = (id?: string) => (id && userById.get(id)?.name) || '';
  const rows = [...expenses].sort((a, b) => a.date.localeCompare(b.date));
  const dates = rows.map(e => e.date).filter(Boolean);
  const sheet = tableSheet({
    name: SHEET.expenses, title: rows.length === 1 ? 'Chiqim tafsiloti' : 'Chiqimlar',
    subtitle: [companyName, dates.length ? periodLabel(dates[0], dates[dates.length - 1]) : ''].filter(Boolean).join(' · '),
    columns: [
      { header: 'Sana', width: 12, style: 'date', total: 'JAMI' },
      { header: 'Obyekt', width: 26 },
      { header: 'Turi', width: 12 },
      { header: 'Tavsif', width: 42 },
      { header: 'Kimga', width: 22 },
      { header: "Summa (so'm)", width: 16, style: 'money', total: 'sum' },
      { header: 'Asl valyuta', width: 14 },
      { header: 'Holati', width: 13 },
      { header: 'Kiritgan', width: 20 },
      { header: 'Tasdiqlagan', width: 20 },
    ],
    rows: rows.map(e => [
      d(e.date), (e.projectId && projById.get(e.projectId)?.name) || e.objectLabel || NO_OBJECT, TYPE_LABEL[e.type] || TYPE_LABEL.boshqa,
      e.description || TYPE_LABEL[e.type] || '', uname(e.toUserId) || e.recipientName || '', e.amount || 0,
      e.currency && e.currency !== 'UZS' && e.originalAmount != null ? { v: e.originalAmount, s: e.currency === 'EUR' ? 'eur' : 'usd' } : '',
      STATUS_LABEL[e.status] || e.status, uname(e.createdById), uname(e.confirmedById),
    ]),
  });
  return [sheet];
}
