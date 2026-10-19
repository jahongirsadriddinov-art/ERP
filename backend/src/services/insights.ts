import Company from '../models/Company';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import CompanyDocument from '../models/CompanyDocument';
import Equipment from '../models/Equipment';
import EquipmentLog from '../models/EquipmentLog';
import User from '../models/User';
import Attendance from '../models/Attendance';
import { AlertLog, alertBosses } from './companyAlerts';
import { planFactFor } from './planFact';
import { median } from './expenseInsights';
import { tashkentHour, todayInTashkent } from '../utils/tz';

// ─── Biznes nazoratchilari (owner 2026-10-19) ───────────────────────────────────────────────────────────────
//  • O'g'irlikka qarshi: smetadan ortiq yuborilgan material, 48 soatdan beri qabul qilinmagan yuk, keskin sarf o'sishi;
//  • Narx monitoringi: material birlik narxi oxirgi hafta oldingi davrga nisbatan ≥10% o'zgarsa;
//  • Hujjat muddatlari: 30/7/1 kun qolganda eslatma, o'tib ketsa — jiddiy (o'qilmasa AI qo'ng'iroq qiladi);
//  • Texnika: servis sanasi/motor-soati, yoqilg'i sarfi me'yordan oshsa;
//  • Ertalabki brifing (08:00) — faqat XABAR (owner: "har doim telefon qilmasin").
// Har biri firma sozlamasida (Company.features) o'chirilishi mumkin. Ishga tushish belgisi bazada (qayta ishga
// tushganda takrorlanmaydi).

type Features = { briefing?: boolean; theft?: boolean; prices?: boolean; docs?: boolean; equipment?: boolean };
const on = (f: Features | undefined, k: keyof Features) => f?.[k] !== false;
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} so'm`;
const DAY = 86_400_000;

async function once(companyId: string, key: string, hours: number): Promise<boolean> {
  try {
    await AlertLog.create({ companyId, key: `run:${key}`, expiresAt: new Date(Date.now() + hours * 3600_000) });
    return true;
  } catch { return false; }
}

const normName = (s: string) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ── 1) O'g'irlikka qarshi ─────────────────────────────────────────────────────────────────────────────────────
export interface TheftFinding { kind: 'over_smeta' | 'unconfirmed' | 'spike'; objectId: string; objectName: string; text: string; severity: 'warning' | 'critical'; key: string }

export function overSmetaFindings(objName: string, objectId: string, mats: Array<{ name: string; unit: string; needed: number; sent: number }>): TheftFinding[] {
  const out: TheftFinding[] = [];
  for (const m of mats) {
    const need = Number(m.needed) || 0;
    const sent = Number(m.sent) || 0;
    if (need <= 0 || sent <= need * 1.15) continue;
    const pct = Math.round(((sent - need) / need) * 100);
    out.push({
      kind: 'over_smeta', objectId, objectName: objName, severity: pct >= 40 ? 'critical' : 'warning',
      key: `theft:over:${objectId}:${normName(m.name)}`,
      text: `${m.name}: smetada ${Math.round(need)} ${m.unit}, yuborilgan ${Math.round(sent)} ${m.unit} (+${pct}%).`,
    });
  }
  return out;
}

/** Oxirgi 7 kunlik miqdor oldingi 4 haftaning haftalik o'rtachasidan 3 baravar ko'p bo'lsa. */
export function spikeFinding(recent7: number, prev28: number): boolean {
  const weekly = prev28 / 4;
  return recent7 >= 10 && weekly > 0 && recent7 >= weekly * 3;
}

export async function theftChecks(companyId: string, now = new Date()): Promise<TheftFinding[]> {
  const objs: any[] = await ObjectModel.find({ companyId, status: { $ne: 'completed' } }).select('name').lean();
  if (!objs.length) return [];
  const byId = new Map(objs.map((o) => [String(o._id), String(o.name)]));
  const findings: TheftFinding[] = [];
  const mats: any[] = await Material.find({ objectId: { $in: objs.map((o) => o._id) } }).select('objectId name unit needed sent').lean();
  const matsBy = new Map<string, any[]>();
  for (const m of mats) { const k = String(m.objectId); if (!matsBy.has(k)) matsBy.set(k, []); matsBy.get(k)!.push(m); }
  for (const [oid, list] of matsBy) findings.push(...overSmetaFindings(byId.get(oid) || '', oid, list));

  const stale: any[] = await Transaction.find({
    companyId, type: 'transfer', status: 'pending', createdAt: { $lt: new Date(now.getTime() - 2 * DAY) },
  }).select('projectId materialName quantity unit toUserName createdAt').limit(50).lean();
  const staleBy = new Map<string, any[]>();
  for (const t of stale) { const k = String(t.projectId || ''); if (!staleBy.has(k)) staleBy.set(k, []); staleBy.get(k)!.push(t); }
  for (const [oid, list] of staleBy) {
    findings.push({
      kind: 'unconfirmed', objectId: oid, objectName: byId.get(oid) || '—', severity: 'warning',
      key: `theft:unconf:${oid}:${todayInTashkent()}`,
      text: `${list.length} ta yuk 48 soatdan beri qabul qilinmagan: ${list.slice(0, 3).map((t) => `${t.materialName} ${t.quantity} ${t.unit || ''} → ${t.toUserName || '—'}`).join('; ')}.`,
    });
  }

  const since = new Date(now.getTime() - 35 * DAY);
  const rows: any[] = await Transaction.find({ companyId, type: 'transfer', status: 'confirmed', createdAt: { $gte: since }, projectId: { $in: [...byId.keys()] } })
    .select('projectId materialName quantity unit createdAt').lean();
  const agg = new Map<string, { oid: string; name: string; unit: string; r7: number; p28: number }>();
  for (const t of rows) {
    const k = `${t.projectId}|${normName(t.materialName)}`;
    const a = agg.get(k) || { oid: String(t.projectId), name: String(t.materialName), unit: String(t.unit || ''), r7: 0, p28: 0 };
    const age = now.getTime() - new Date(t.createdAt).getTime();
    if (age <= 7 * DAY) a.r7 += Number(t.quantity) || 0; else a.p28 += Number(t.quantity) || 0;
    agg.set(k, a);
  }
  for (const a of agg.values()) {
    if (!spikeFinding(a.r7, a.p28)) continue;
    findings.push({
      kind: 'spike', objectId: a.oid, objectName: byId.get(a.oid) || '—', severity: 'warning',
      key: `theft:spike:${a.oid}:${normName(a.name)}`,
      text: `${a.name}: oxirgi 7 kunda ${Math.round(a.r7)} ${a.unit} — odatdagidan ~${Math.round(a.r7 / (a.p28 / 4))} baravar ko'p.`,
    });
  }
  return findings;
}

// ── 2) Narx monitoringi ───────────────────────────────────────────────────────────────────────────────────────
export interface PriceTrend { material: string; unit: string; lastPrice: number; recentAvg: number; prevAvg: number | null; changePct: number | null; samples: number; lastDate: string }

export function priceTrends(rows: Array<{ materialName: string; unit?: string; price: number; createdAt: Date | string }>, now = new Date()): PriceTrend[] {
  const by = new Map<string, Array<{ p: number; t: number; name: string; unit: string }>>();
  for (const r of rows) {
    const p = Number(r.price);
    if (!r.materialName || !(p > 0)) continue;
    const k = normName(r.materialName);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push({ p, t: new Date(r.createdAt).getTime(), name: String(r.materialName), unit: String(r.unit || '') });
  }
  const out: PriceTrend[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.t - b.t);
    const recent = list.filter((x) => now.getTime() - x.t <= 7 * DAY).map((x) => x.p);
    const prev = list.filter((x) => now.getTime() - x.t > 7 * DAY).map((x) => x.p);
    const last = list[list.length - 1];
    const recentAvg = recent.length ? median(recent) : last.p;
    const prevAvg = prev.length >= 2 ? median(prev) : null;
    out.push({
      material: last.name, unit: last.unit, lastPrice: last.p, recentAvg, prevAvg,
      changePct: prevAvg ? Math.round(((recentAvg - prevAvg) / prevAvg) * 1000) / 10 : null,
      samples: list.length, lastDate: new Date(last.t).toISOString().slice(0, 10),
    });
  }
  return out.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
}

export async function companyPriceTrends(companyId: string, now = new Date()): Promise<PriceTrend[]> {
  const rows: any[] = await Transaction.find({
    companyId, type: 'transfer', price: { $gt: 0 }, status: { $ne: 'rejected' }, createdAt: { $gte: new Date(now.getTime() - 60 * DAY) },
  }).select('materialName unit price createdAt').limit(5000).lean();
  return priceTrends(rows, now);
}

// ── 3) Hujjat muddatlari ──────────────────────────────────────────────────────────────────────────────────────
export function docStage(expiresAt: Date, now = new Date()): { stage: 'expired' | 'd1' | 'd7' | 'd30' | null; days: number } {
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
  if (days < 0) return { stage: 'expired', days };
  if (days <= 1) return { stage: 'd1', days };
  if (days <= 7) return { stage: 'd7', days };
  if (days <= 30) return { stage: 'd30', days };
  return { stage: null, days };
}

async function docChecks(companyId: string, now: Date) {
  const docs: any[] = await CompanyDocument.find({ companyId, expiresAt: { $ne: null, $lte: new Date(now.getTime() + 31 * DAY) } })
    .select('title category expiresAt objectId').limit(200).lean();
  for (const d of docs) {
    const { stage, days } = docStage(new Date(d.expiresAt), now);
    if (!stage) continue;
    const exp = new Date(d.expiresAt).toISOString().slice(0, 10);
    await alertBosses({
      companyId, key: `doc:${d._id}:${stage}`,
      title: stage === 'expired' ? `Hujjat muddati o'tdi: ${d.title}` : `Hujjat muddati tugayapti: ${d.title}`,
      body: stage === 'expired' ? `"${d.title}" ${exp} da tugagan. Yangilash kerak.` : `"${d.title}" ${exp} da tugaydi (${days} kun qoldi).`,
      severity: stage === 'expired' ? 'critical' : stage === 'd1' ? 'warning' : 'info',
      entity: 'document', entityId: String(d._id), url: '/documents', dedupeHours: stage === 'expired' ? 72 : 24 * 40,
    }).catch(() => undefined);
  }
}

// ── 4) Texnika ────────────────────────────────────────────────────────────────────────────────────────────────
/** Yoqilg'i sarfi: litr/soat me'yordan (yoki tarixiy medianadan) 1.5 baravar ko'p bo'lsa. */
export function fuelAnomaly(today: { hours?: number; fuel?: number }, history: Array<{ hours?: number; fuel?: number }>, norm?: number): number | null {
  if (!today.hours || !today.fuel || today.hours < 1) return null;
  const rate = today.fuel / today.hours;
  const hist = history.filter((h) => (h.hours || 0) >= 1 && (h.fuel || 0) > 0).map((h) => (h.fuel as number) / (h.hours as number));
  const base = norm && norm > 0 ? norm : hist.length >= 5 ? median(hist) : null;
  if (!base) return null;
  return rate >= base * 1.5 ? Math.round((rate / base) * 10) / 10 : null;
}

async function equipmentChecks(companyId: string, now: Date) {
  const eq: any[] = await Equipment.find({ companyId }).select('name nextServiceDate serviceIntervalHours lastServiceEngineHours engineHours fuelNormPerHour').lean();
  const today = todayInTashkent();
  for (const e of eq) {
    if (e.nextServiceDate) {
      const days = Math.ceil((new Date(e.nextServiceDate).getTime() - now.getTime()) / DAY);
      if (days <= 3) {
        await alertBosses({
          companyId, key: `eq:svc:${e._id}:${e.nextServiceDate}`, title: `Texnika servisi: ${e.name}`,
          body: days < 0 ? `Servis muddati ${e.nextServiceDate} da o'tib ketgan.` : `Servis ${e.nextServiceDate} da (${days} kun qoldi).`,
          severity: 'info', entity: 'equipment', entityId: String(e._id), url: '/equipment', dedupeHours: 24 * 10,
        }).catch(() => undefined);
      }
    }
    if (e.serviceIntervalHours && e.engineHours && e.engineHours - (e.lastServiceEngineHours || 0) >= e.serviceIntervalHours) {
      await alertBosses({
        companyId, key: `eq:hours:${e._id}:${Math.floor((e.engineHours || 0) / e.serviceIntervalHours)}`, title: `Texnika servisi: ${e.name}`,
        body: `${Math.round(e.engineHours - (e.lastServiceEngineHours || 0))} motor-soat ishladi — servis kerak (har ${e.serviceIntervalHours} soatda).`,
        severity: 'info', entity: 'equipment', entityId: String(e._id), url: '/equipment', dedupeHours: 24 * 30,
      }).catch(() => undefined);
    }
    const logs: any[] = await EquipmentLog.find({ equipmentId: String(e._id), date: { $gte: new Date(now.getTime() - 45 * DAY).toISOString().slice(0, 10) } })
      .select('date hours fuel').lean();
    const todays = logs.filter((l) => l.date === today);
    const sum = todays.reduce((s, l) => ({ hours: (s.hours || 0) + (l.hours || 0), fuel: (s.fuel || 0) + (l.fuel || 0) }), { hours: 0, fuel: 0 } as { hours: number; fuel: number });
    const x = fuelAnomaly(sum, logs.filter((l) => l.date !== today), e.fuelNormPerHour);
    if (x) {
      await alertBosses({
        companyId, key: `eq:fuel:${e._id}:${today}`, title: `Yoqilg'i sarfi: ${e.name}`,
        body: `Bugun ${Math.round(sum.fuel)} l / ${sum.hours} soat — me'yordan ~${x} baravar ko'p. Tekshiring.`,
        severity: 'warning', entity: 'equipment', entityId: String(e._id), url: '/equipment',
      }).catch(() => undefined);
    }
  }
}

// ── 5) Ertalabki brifing (faqat xabar) ────────────────────────────────────────────────────────────────────────
export async function buildBriefing(companyId: string, now = new Date()): Promise<string | null> {
  const yesterday = new Date(now.getTime() - DAY);
  const yDay = new Date(yesterday.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  const [workers, came, spendRows, pendingCount, pf] = await Promise.all([
    User.countDocuments({ companyId, role: { $in: ['ishchi', 'prorab', 'brigadir'] }, isBlocked: { $ne: true } }),
    Attendance.countDocuments({ companyId, date: yDay, checkIn: { $exists: true } }).catch(() => 0),
    Transaction.aggregate([
      { $match: { companyId, status: 'confirmed', type: { $in: ['expense', 'material', 'jihozlar', 'transport', 'boshqa', 'oylik'] }, date: yDay } },
      { $group: { _id: null, s: { $sum: { $ifNull: ['$uzsAmount', '$amount'] } } } },
    ]),
    Transaction.countDocuments({ companyId, status: 'pending', $or: [{ requiresAdminApproval: true }, { type: { $ne: 'transfer' } }] }),
    planFactFor({ companyId, status: { $ne: 'completed' } }, now).catch(() => []),
  ]);
  const risky = pf.filter((p) => p.status !== 'ok' && p.status !== 'no_plan').slice(0, 3);
  if (!workers && !pf.length) return null;
  const lines = [
    `☀️ Xayrli tong! Kechagi (${yDay}) xulosa:`,
    `👷 Ishga kelganlar: ${came} / ${workers}`,
    `💸 Tasdiqlangan xarajat: ${money(spendRows[0]?.s || 0)}`,
    `⏳ Tasdiq kutayotganlar: ${pendingCount}`,
  ];
  if (risky.length) {
    lines.push('', '📊 E\'tibor talab qiladigan obyektlar:');
    for (const p of risky) lines.push(`• ${p.name}: ${p.notes[0] || p.status} (bajarilish ${p.progressPct}%)`);
  } else if (pf.length) lines.push('', `📊 ${pf.length} ta faol obyekt — hammasi reja bo'yicha.`);
  return lines.join('\n');
}

// ── Rejalashtiruvchi ──────────────────────────────────────────────────────────────────────────────────────────
async function tick(now = new Date()) {
  const hour = tashkentHour(now);
  const today = todayInTashkent();
  const companies: any[] = await Company.find({ status: 'ACTIVE' }).select('_id features').lean();
  for (const c of companies) {
    const companyId = String(c._id);
    const f: Features | undefined = c.features;
    try {
      if (hour === 8 && on(f, 'briefing') && (await once(companyId, `briefing:${today}`, 20))) {
        const text = await buildBriefing(companyId, now);
        if (text) await alertBosses({ companyId, key: `briefing:${today}`, title: 'Kunlik brifing', body: text, severity: 'info', entity: 'briefing', entityId: today, url: '/' });
      }
      if (hour === 9 && on(f, 'docs') && (await once(companyId, `docs:${today}`, 20))) await docChecks(companyId, now);
      if (hour === 18 && on(f, 'equipment') && (await once(companyId, `equipment:${today}`, 20))) await equipmentChecks(companyId, now);
      if (hour === 19 && on(f, 'theft') && (await once(companyId, `theft:${today}`, 20))) {
        for (const x of await theftChecks(companyId, now)) {
          await alertBosses({
            companyId, key: x.key, title: `Material nazorati: ${x.objectName}`, body: x.text, severity: x.severity,
            entity: 'object', entityId: x.objectId, url: '/', dedupeHours: x.kind === 'unconfirmed' ? 20 : 24 * 7,
          }).catch(() => undefined);
        }
      }
      // Narxlar — har dushanba 10:00
      if (hour === 10 && new Date(now.getTime() + 5 * 3600_000).getUTCDay() === 1 && on(f, 'prices') && (await once(companyId, `prices:${today}`, 20))) {
        const moved = (await companyPriceTrends(companyId, now)).filter((p) => p.changePct !== null && Math.abs(p.changePct) >= 10).slice(0, 6);
        if (moved.length) {
          await alertBosses({
            companyId, key: `prices:${today}`, title: 'Material narxlari o\'zgardi',
            body: moved.map((p) => `${p.material}: ${p.changePct! > 0 ? '+' : ''}${p.changePct}% (${money(p.prevAvg!)} → ${money(p.recentAvg)} / ${p.unit})`).join('\n'),
            severity: 'info', entity: 'prices', entityId: today, url: '/reports',
          }).catch(() => undefined);
        }
      }
    } catch (e) {
      console.error('[insights]', companyId, (e as Error)?.message);
    }
  }
}

let started = false;
export function startInsights() {
  if (started) return;
  started = true;
  const run = () => { tick().catch((e) => console.error('[insights] tick:', e?.message)); };
  setTimeout(run, 60_000);
  setInterval(run, 10 * 60_000);
}
