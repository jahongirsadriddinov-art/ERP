import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, colLetter, crc32, dateSerial, safeSheetName, tableSheet, tashkentTimeOfDay } from './writer';
import { buildReportSheets, buildReportXlsx, expensesSheets, periodLabel, reportFileName, SHEET, type ReportInput } from './reportWorkbook';

// ZIP'ni o'qish (faqat sinov uchun): markaziy katalogdan fayllarni ajratadi.
export function unzip(buf: Uint8Array): Record<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), crc = dv.getUint32(p + 16, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lnl = dv.getUint16(off + 26, true), lex = dv.getUint16(off + 28, true);
    const body = buf.subarray(off + 30 + lnl + lex, off + 30 + lnl + lex + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    expect(crc32(data)).toBe(crc);
    out[name] = dec.decode(data);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
const sheetNames = (files: Record<string, string>) => [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1].replace(/&apos;|&#39;/g, "'"));
const texts = (xml: string) => [...xml.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
const cellText = (sheet: { rows: any[][] }, r: number) => sheet.rows[r].map(c => c && typeof c === 'object' && !(c instanceof Date) ? c.v : c);

const users = [
  { id: 'u1', name: 'Ali Valiyev', role: 'direktor', phone: '+998901112233', projectIds: [] },
  { id: 'u2', name: 'Bobur Karimov', role: 'prorab', phone: '+998902223344', projectIds: [] },
  { id: 'u3', name: 'Sardor Usmonov', role: 'ishchi', phone: '+998903334455', projectIds: [] },
] as any[];
const projects = [
  { id: 'p1', name: 'Chilonzor 5-uy', status: 'active', budget: 10_000_000, location: '', foremanId: 'u2', startDate: '2026-01-01', requiredMaterials: [] },
  { id: 'p2', name: 'Olmazor maktab', status: 'paused', budget: 0, location: '', foremanId: 'u2', startDate: '2026-01-01', requiredMaterials: [] },
] as any[];
const ex = (id: string, o: any) => ({ id, type: 'material', amount: 0, projectId: 'p1', description: '', date: '2026-10-10', status: 'confirmed', createdById: 'u2', confirmedById: 'u1', ...o });
const expenses = [
  ex('e1', { type: 'material', amount: 1_500_000, description: 'Sement 30 qop', toUserId: 'u2' }),
  ex('e2', { type: 'oylik', amount: 3_000_000, description: 'Oktabr oyligi', toUserId: 'u3', date: '2026-10-15' }),
  ex('e3', { type: 'transport', amount: 400_000, projectId: 'p2', description: 'Kran', recipientName: 'Kamaz haydovchi', currency: 'USD', originalAmount: 32, source: 'bot' }),
  ex('e4', { type: 'boshqa', amount: 100_000, projectId: '', objectLabel: '', description: '=HYPERLINK("x")' }),
] as any[];
const incomes = [ex('i1', { type: 'material', amount: 20_000_000, description: 'Buyurtmachi avansi', date: '2026-10-05' })] as any[];
const input = (o: Partial<ReportInput> = {}): ReportInput => ({
  companyName: 'Jondor Iris Stroy', from: '2026-10-01', to: '2026-10-22', projectLabel: 'Barcha obyektlar',
  generatedAt: new Date('2026-10-22T07:30:00Z'), expenses, incomes, includeIncome: true, allTimeExpenses: expenses,
  users, projects,
  attendance: [
    { userId: 'u3', date: '2026-10-20', checkIn: '2026-10-20T03:05:00Z', checkOut: '2026-10-20T12:05:00Z', status: 'present' },
    { userId: 'u3', date: '2026-10-21', checkIn: '2026-10-21T04:00:00Z', checkOut: null, status: 'late' },
  ],
  ...o,
});

describe('xlsx writer', () => {
  it('helpers', () => {
    expect(colLetter(0)).toBe('A'); expect(colLetter(25)).toBe('Z'); expect(colLetter(26)).toBe('AA'); expect(colLetter(701)).toBe('ZZ');
    expect(dateSerial('2026-10-22')).toBe(46317);
    expect(dateSerial('1900-03-01')).toBe(61);
    expect(dateSerial('bad')).toBeNull();
    expect(tashkentTimeOfDay('2026-10-20T03:00:00Z')).toBeCloseTo(8 / 24, 6); // 08:00 Toshkent
    const used = new Set<string>();
    expect(safeSheetName('A/B:C*?', used)).toBe('A B C');
    expect(safeSheetName('x'.repeat(40), used)).toHaveLength(31);
    expect(safeSheetName('Chiqimlar', used)).toBe('Chiqimlar');
    expect(safeSheetName('chiqimlar', used)).toBe('chiqimlar (2)');
  });

  it('writes a valid package: frozen header, autofilter, number formats, inline strings, totals', async () => {
    const sh = tableSheet({ name: 'Test', title: 'Sinov', columns: [
      { header: 'Nomi', width: 20, total: 'JAMI' }, { header: 'Summa', width: 12, style: 'money', total: 'sum' }],
    rows: [['a & <b>', 1000], ['=1+1', 2500.5]] });
    const files = unzip(await buildXlsx([sh]));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', '_rels/.rels']));
    const x = files['xl/worksheets/sheet1.xml'];
    expect(x).toContain('<pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>');
    expect(x).toContain('<autoFilter ref="A4:B6"/>');
    expect(x).toContain('<f>SUBTOTAL(9,B5:B6)</f><v>3500.5</v>');
    expect(texts(x)).toEqual(['Sinov', 'Nomi', 'Summa', 'a & <b>', '=1+1', 'JAMI']);
    expect(x).not.toContain('<f>1+1'); // matn formula bo'lib ketmaydi
    expect(files['xl/styles.xml']).toContain('formatCode="#,##0"');
    expect(files['xl/styles.xml']).toContain('formatCode="dd.mm.yyyy"');
    expect(files['xl/workbook.xml']).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Test'!$A$4:$B$6</definedName>`);
  });

  it('works without compression too', async () => {
    const files = unzip(await buildXlsx([{ name: 'A', rows: [['x']] }], {}, undefined));
    expect(files['xl/worksheets/sheet1.xml']).toContain('<t>x</t>');
  });
});

describe('report workbook', () => {
  it('has a cover sheet then structured sheets in order', () => {
    const sheets = buildReportSheets(input());
    expect(sheets.map(s => s.name)).toEqual([SHEET.summary, SHEET.expenses, SHEET.incomes, SHEET.objects, SHEET.people, SHEET.attendance]);
    const noInc = buildReportSheets(input({ includeIncome: false, attendance: null }));
    expect(noInc.map(s => s.name)).toEqual([SHEET.summary, SHEET.expenses, SHEET.objects, SHEET.people]);
  });

  it('cover: company, period, totals, by type and by object', () => {
    const [cover] = buildReportSheets(input());
    const flat = cover.rows.map(r => cellText(cover, cover.rows.indexOf(r)));
    const row = (label: string) => flat.find(r => r[0] === label)!;
    expect(flat[0][0]).toBe('Moliyaviy hisobot');
    expect(flat[1][0]).toBe('Jondor Iris Stroy');
    expect(row('Davr')[1]).toBe('01.10.2026 — 22.10.2026');
    expect(row('Jami kirim')[1]).toBe(20_000_000);
    expect(row('Jami chiqim')[1]).toBe(5_000_000);
    expect(row('Sof natija (kirim − chiqim)')[1]).toBe(15_000_000);
    expect(row('Sof natija (kirim − chiqim)')[2]).toBe('Foyda');
    expect(row('Oylik')[1]).toBe(3_000_000);
    expect(row('Material')[2]).toBeCloseTo(0.3);
    const totals = flat.filter(r => r[0] === 'JAMI');
    expect(totals[0][1]).toBe(5_000_000); // turlar
    expect(totals[1].slice(1, 4)).toEqual([5_000_000, 20_000_000, 15_000_000]); // obyektlar
    expect(flat.some(r => r[0] === 'Olmazor maktab')).toBe(true);
    expect(flat.some(r => r[0] === 'Obyektga biriktirilmagan')).toBe(true);
  });

  it('expenses sheet: Uzbek headers, readable names, money/date formats, totals row', () => {
    const s = buildReportSheets(input())[1] as any;
    expect(cellText(s, 3)).toEqual(['№', 'Sana', 'Obyekt', 'Turi', 'Tavsif', 'Kimga', 'Lavozimi', "Summa (so'm)", 'Asl valyuta', 'Kiritgan', 'Tasdiqlagan', 'Manba', 'Holati', 'Izoh']);
    expect(s.freeze).toEqual({ rows: 4 });
    expect(s.autoFilter).toBe('A4:N8');
    const first = s.rows[4];
    expect(first[1]).toEqual({ v: dateSerial('2026-10-10'), s: 'date' });
    expect(cellText(s, 4).slice(2, 7)).toEqual(['Chilonzor 5-uy', 'Material', 'Sement 30 qop', 'Bobur Karimov', 'Prorab']);
    expect(first[7]).toEqual({ v: 1_500_000, s: 'money' });
    expect(cellText(s, 4).slice(9, 13)).toEqual(['Bobur Karimov', 'Ali Valiyev', 'Sayt / ilova', 'Tasdiqlangan']);
    const kran = s.rows.find((r: any[]) => cellText({ rows: [r] }, 0)[4] === 'Kran');
    expect(kran[8]).toEqual({ v: 32, s: 'usd' });
    expect(cellText({ rows: [kran] }, 0)[5]).toBe('Kamaz haydovchi');
    expect(cellText({ rows: [kran] }, 0)[11]).toBe('Telegram bot');
    const total = s.rows[s.totalRow - 1];
    expect(total[0].v).toBe('JAMI');
    expect(total[7]).toMatchObject({ v: 5_000_000, f: 'SUBTOTAL(9,H5:H8)' });
  });

  it('objects, people and attendance sheets aggregate correctly', () => {
    const sheets = buildReportSheets(input()) as any[];
    const obj = sheets.find(s => s.name === SHEET.objects);
    const p1 = obj.rows.find((r: any[]) => r[0] === 'Chilonzor 5-uy');
    // Obyekt, Holati, Oylik, Material, Jihozlar, Transport, Boshqa, Jami, Kirim, Farq, Byudjet, Butun davr, %
    expect(p1.map((c: any) => c && typeof c === 'object' ? c.v : c)).toEqual(['Chilonzor 5-uy', 'Faol', 3_000_000, 1_500_000, 0, 0, 0, 4_500_000, 20_000_000, 15_500_000, 10_000_000, 4_500_000, 0.45]);
    const people = sheets.find(s => s.name === SHEET.people);
    expect(cellText(people, 3)).toContain('Ishlagan soat');
    const sardor = people.rows.find((r: any[]) => r[0] === 'Sardor Usmonov');
    expect(sardor.slice(1, 10).map((c: any) => c && typeof c === 'object' ? c.v : c)).toEqual(['Ishchi', '+998903334455', 3_000_000, 0, 3_000_000, 1, 0, 2, 9]);
    const att = sheets.find(s => s.name === SHEET.attendance);
    expect(cellText(att, 3)).toEqual(['Sana', 'Xodim', 'Lavozimi', 'Keldi', 'Ketdi', 'Ishlagan (soat)', 'Holati', 'Izoh']);
    expect(cellText(att, 4)[6]).toBe('Ishda (chiqish qilinmagan)'); // 21-oktabr — eng yangisi tepada
    expect(cellText(att, 5)[6]).toBe('Vaqtida');
    expect(att.rows[5][3].v).toBeCloseTo((8 * 60 + 5) / 1440, 6); // 08:05 Toshkent
  });

  it('empty period still produces a readable file', async () => {
    const files = unzip(await buildReportXlsx(input({ expenses: [], incomes: [], attendance: [] })));
    expect(sheetNames(files)).toEqual(['Umumiy', 'Chiqimlar', 'Kirimlar', "Obyektlar bo'yicha", "Xodimlar bo'yicha", 'Davomat']);
    expect(texts(files['xl/worksheets/sheet2.xml'])).toContain("Tanlangan davrda tasdiqlangan chiqim yo'q");
  });

  it('single expense export and file name', () => {
    const [s] = expensesSheets([expenses[0]], users, projects, 'Firma') as any[];
    expect(s.rows[0][0].v).toBe('Chiqim tafsiloti');
    expect(cellText(s, 4).slice(1, 5)).toEqual(['Chilonzor 5-uy', 'Material', 'Sement 30 qop', 'Bobur Karimov']);
    expect(periodLabel('', '')).toBe('Butun davr');
    expect(reportFileName('Chilonzor 5/uy', '2026-10-01', '2026-10-22')).toBe('hisobot_Chilonzor-5uy_2026-10-01_2026-10-22.xlsx');
  });
});
