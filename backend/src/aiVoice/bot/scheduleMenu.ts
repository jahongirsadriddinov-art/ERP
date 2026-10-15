import type { AiSchedulePatch, AiSettingsData, AiShift, IsoDate } from '../contracts';
import {
  canEditSchedule, deriveCallTime, effectiveShift, getEmployeeOverride, getSettingsFresh, saveSettings, updateSchedule,
  validateSettingsUpdate,
} from '../settings';
import { mirrorWriteToLegacyAudit, writeToolAudit } from '../audit';
import { isObjectIdString, newCorrelationId } from '../lib/ids';
import { addDays, isHHmm, isIsoDate, localDate, parseHHmm } from '../lib/zonedTime';
import { getBotInstance } from './instance';
import { ta } from './i18n';
import { answer, closeButtons, companyAllowsAi, type CallbackActor } from './guard';

// Ish jadvali menyusi (owner decision 2026-10-13): /jadval buyrug'i yoki ai:s:* tugmalari. Faqat SHU
// firmaning direktori / egasi / (ruxsat bo'lsa) o'rinbosari. Qoralama xotirada (chat bo'yicha, 30 daqiqa);
// "Saqlash" — settings.updateSchedule (sayt bilan bir xil validatsiya va optimistik versiya) va
// AI yoqish/o'chirish — validateSettingsUpdate + saveSettings; har saqlashda audit yozuvi.
//
// callback_data (≤64 bayt): ai:s:m (asosiy), t (vaqt), T:HHMM, c (boshqa vaqt), w (kunlar), W:<1-7>,
// k / e (sanalar ro'yxati), K:a / E:a (qo'shish), K:r:YYYYMMDD / E:r:YYYYMMDD (o'chirish),
// A:1|0 (AI), D:1|0 (ertalabki davomat so'rovi), h (keyingi smena), S (saqlash), X (yopish).

const DRAFT_TTL_MS = 30 * 60_000;
const BOSS_ROLES = ['direktor', 'orinbosar'];
export const TIME_PRESETS = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'];
const MAX_FUTURE_DAYS = 730;
const LIST_MAX = 24;

/** attendance — ertalabki AI davomat so'rovi (settings.attendance.enabled); egasi uni ham botdan yoqadi. */
interface SchedState { workStart: string; workdays: number[]; skip: IsoDate[]; extra: IsoDate[]; enabled: boolean; attendance?: boolean }
interface Draft {
  chatId: number;
  userId: string;
  companyId: string;
  shiftId: string;
  shiftName: string;
  shiftCount: number;
  callLeadMin: number;
  absentCutoff: string;
  orig: SchedState;
  cur: SchedState;
  awaiting: null | 'time' | 'skip' | 'extra';
  expiresAt: number;
}

const drafts = new Map<number, Draft>();

export interface ScheduleEditor { userId: string; role: string; isOwner: boolean; companyId: string; lang?: string }

export function scheduleAwaiting(chatId: number, now = Date.now()): boolean {
  const d = drafts.get(chatId);
  if (!d) return false;
  if (d.expiresAt <= now) { drafts.delete(chatId); return false; }
  return d.awaiting !== null;
}
export function clearScheduleDraft(chatId: number): void { drafts.delete(chatId); }
/** Faqat testlar uchun. */
export function __scheduleDrafts() { return drafts; }

/** Ruxsat: firma AI funksiyasiga ega va faol, foydalanuvchi rahbar va canEditSchedule (DB'dan yangi sozlama). */
export async function checkScheduleEditor(e: ScheduleEditor): Promise<{ ok: true; settings: AiSettingsData } | { ok: false; reason: 'feature' | 'forbidden' }> {
  if (!isObjectIdString(e.companyId) || e.role === 'dasturchi') return { ok: false, reason: 'forbidden' };
  if (!e.isOwner && !BOSS_ROLES.includes(e.role)) return { ok: false, reason: 'forbidden' };
  if (!(await companyAllowsAi(e.companyId))) return { ok: false, reason: 'feature' };
  const settings = await getSettingsFresh(e.companyId);
  if (!canEditSchedule({ role: e.role, isOwner: e.isOwner }, settings)) return { ok: false, reason: 'forbidden' };
  return { ok: true, settings };
}

function stateOf(sh: AiShift, enabled: boolean, attendance: boolean): SchedState {
  return { workStart: sh.workStart, workdays: [...sh.workdays].sort(), skip: [...sh.skipDates].sort(), extra: [...sh.extraWorkDates].sort(), enabled, attendance };
}

function newDraft(chatId: number, e: ScheduleEditor, s: AiSettingsData, shiftIdx = 0): Draft {
  const shifts = s.attendance.shifts;
  const i = Math.min(Math.max(0, shiftIdx), shifts.length - 1);
  const sh = shifts[i];
  const st = stateOf(sh, s.enabled, s.attendance.enabled);
  return {
    chatId, userId: e.userId, companyId: e.companyId, shiftId: sh.id, shiftName: sh.name, shiftCount: shifts.length,
    callLeadMin: sh.callLeadMin, absentCutoff: sh.absentCutoff, orig: st, cur: { ...st, workdays: [...st.workdays], skip: [...st.skip], extra: [...st.extra] },
    awaiting: null, expiresAt: Date.now() + DRAFT_TTL_MS,
  };
}

const sameList = (a: (string | number)[], b: (string | number)[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
const isDirty = (d: Draft) => d.cur.workStart !== d.orig.workStart || !sameList(d.cur.workdays, d.orig.workdays)
  || !sameList(d.cur.skip, d.orig.skip) || !sameList(d.cur.extra, d.orig.extra) || d.cur.enabled !== d.orig.enabled
  || !!d.cur.attendance !== !!d.orig.attendance;

const fmtDate = (d: IsoDate) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

// ───────────── Kiritishni tahlil qilish (sof, test qilinadi) ─────────────

/** "7:45", "07.45", "0745" emas — HH:MM yoki H:MM (":" yoki "."). */
export function parseUserTime(input: string): string | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(input || ''));
  if (!m) return null;
  const v = `${m[1].padStart(2, '0')}:${m[2]}`;
  return isHHmm(v) ? v : null;
}

/**
 * "DD.MM" yoki "DD.MM.YYYY" (".", "/", "-"), vergul/bo'shliq bilan bir nechta. Yilsiz sana o'tgan
 * bo'lsa — keyingi yil. O'tgan, mavjud bo'lmagan yoki 2 yildan uzoq sana — bad.
 */
export function parseUserDates(input: string, today: IsoDate): { ok: IsoDate[]; bad: string[] } {
  const ok: IsoDate[] = [];
  const bad: string[] = [];
  const parts = String(input || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 31);
  const maxDate = addDays(today, MAX_FUTURE_DAYS);
  for (const p of parts) {
    const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(p);
    if (!m) { bad.push(p.slice(0, 20)); continue; }
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    let iso = `${y}-${mm}-${dd}`;
    if (!m[3] && isIsoDate(iso) && iso < today) { y += 1; iso = `${y}-${mm}-${dd}`; }
    if (!isIsoDate(iso) || iso < today || iso > maxDate) { bad.push(p.slice(0, 20)); continue; }
    if (!ok.includes(iso)) ok.push(iso);
  }
  return { ok, bad };
}

/** Qoralama → settings.updateSchedule patch'i (faqat o'zgargan maydonlar). */
export function draftPatch(orig: SchedState, cur: SchedState): AiSchedulePatch {
  const patch: AiSchedulePatch = {};
  if (cur.workStart !== orig.workStart) patch.workStart = cur.workStart;
  if (!sameList(cur.workdays, orig.workdays)) patch.workdays = [...cur.workdays].sort() as AiSchedulePatch['workdays'];
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const as = minus(cur.skip, orig.skip), rs = minus(orig.skip, cur.skip);
  const ae = minus(cur.extra, orig.extra), re = minus(orig.extra, cur.extra);
  if (as.length) patch.addSkipDates = as;
  if (rs.length) patch.removeSkipDates = rs;
  if (ae.length) patch.addExtraWorkDates = ae;
  if (re.length) patch.removeExtraWorkDates = re;
  return patch;
}

// ───────────── Ko'rinishlar ─────────────
type Kb = { text: string; callback_data: string }[][];
type View = 'main' | 'time' | 'days' | 'skip' | 'extra';

function render(d: Draft, view: View, lang: unknown, notice?: string): { text: string; kb: Kb } {
  const days = ta(lang, 'weekdays') as string[];
  const back = [{ text: ta(lang, 'schBtnBack'), callback_data: 'ai:s:m' }];
  const today = localDate();
  if (view === 'time') {
    const btn = (t: string) => ({ text: (t === d.cur.workStart ? '✅ ' : '') + t, callback_data: `ai:s:T:${t.replace(':', '')}` });
    return {
      text: `${ta(lang, 'schPickTime')}\n${ta(lang, 'schStart', { start: d.cur.workStart, call: deriveCallTime(d.cur.workStart, d.callLeadMin) })}`,
      kb: [TIME_PRESETS.slice(0, 4).map(btn), TIME_PRESETS.slice(4).map(btn), [{ text: ta(lang, 'schBtnCustomTime'), callback_data: 'ai:s:c' }], back],
    };
  }
  if (view === 'days') {
    const btn = (n: number) => ({ text: `${d.cur.workdays.includes(n) ? '✅' : '▫️'} ${days[n - 1]}`, callback_data: `ai:s:W:${n}` });
    return { text: ta(lang, 'schPickDays'), kb: [[1, 2, 3, 4].map(btn), [5, 6, 7].map(btn), back] };
  }
  if (view === 'skip' || view === 'extra') {
    const list = (view === 'skip' ? d.cur.skip : d.cur.extra).filter((x) => x >= today).slice(0, LIST_MAX);
    const key = view === 'skip' ? 'K' : 'E';
    const rows: Kb = [];
    for (let i = 0; i < list.length; i += 2) {
      rows.push(list.slice(i, i + 2).map((x) => ({ text: `❌ ${fmtDate(x)}`, callback_data: `ai:s:${key}:r:${x.replace(/-/g, '')}` })));
    }
    rows.push([{ text: ta(lang, 'schBtnAddDate'), callback_data: `ai:s:${key}:a` }], back);
    const head = ta(lang, view === 'skip' ? 'schSkipList' : 'schExtraList');
    return { text: [notice, head, list.length ? '' : ta(lang, 'schEmptyList')].filter((x) => x !== undefined).join('\n').trim(), kb: rows };
  }
  const daysText = d.cur.workdays.length ? [...d.cur.workdays].sort().map((n) => days[n - 1]).join(' ') : ta(lang, 'schNoDays');
  const lines = [
    notice,
    ta(lang, 'schTitle', { name: d.shiftName }),
    ta(lang, 'schStart', { start: d.cur.workStart, call: deriveCallTime(d.cur.workStart, d.callLeadMin) }),
    ta(lang, 'schDays', { days: daysText }),
    ta(lang, 'schSkip', { n: d.cur.skip.filter((x) => x >= today).length }),
    ta(lang, 'schExtra', { n: d.cur.extra.filter((x) => x >= today).length }),
    ta(lang, 'schAi', { on: d.cur.enabled }),
    ta(lang, 'schAtt', { on: !!d.cur.attendance }),
    isDirty(d) ? `\n${ta(lang, 'schDirty')}` : undefined,
  ].filter((x) => typeof x === 'string' && x);
  const kb: Kb = [
    [{ text: ta(lang, 'schBtnTime'), callback_data: 'ai:s:t' }, { text: ta(lang, 'schBtnDays'), callback_data: 'ai:s:w' }],
    [{ text: ta(lang, 'schBtnSkip'), callback_data: 'ai:s:k' }, { text: ta(lang, 'schBtnExtra'), callback_data: 'ai:s:e' }],
    [{ text: ta(lang, d.cur.enabled ? 'schBtnAiOff' : 'schBtnAiOn'), callback_data: `ai:s:A:${d.cur.enabled ? 0 : 1}` }],
    [{ text: ta(lang, d.cur.attendance ? 'schBtnAttOff' : 'schBtnAttOn'), callback_data: `ai:s:D:${d.cur.attendance ? 0 : 1}` }],
  ];
  if (d.shiftCount > 1) kb.push([{ text: ta(lang, 'schBtnShift', { name: d.shiftName.slice(0, 30) }), callback_data: 'ai:s:h' }]);
  kb.push([{ text: ta(lang, 'schBtnSave'), callback_data: 'ai:s:S' }, { text: ta(lang, 'schBtnClose'), callback_data: 'ai:s:X' }]);
  return { text: lines.join('\n'), kb };
}

async function show(chatId: number, messageId: number | undefined, view: { text: string; kb: Kb }): Promise<void> {
  const bot = getBotInstance();
  if (!bot) return;
  const markup = { inline_keyboard: view.kb };
  if (messageId && bot.editMessageText) {
    const ok = await bot.editMessageText(view.text, { chat_id: chatId, message_id: messageId, reply_markup: markup })
      .then(() => true)
      .catch((e: any) => /message is not modified/i.test(String(e?.response?.body?.description || e?.message || '')));
    if (ok) return;
  }
  await bot.sendMessage(chatId, view.text, { reply_markup: markup }).catch(() => undefined);
}

// ───────────── Saqlash ─────────────
export type SaveOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; code: 'forbidden' | 'conflict' | 'invalid' | 'not_found'; errors?: string[] };

/** Qoralamani saqlaydi (sayt bilan bir xil yo'l). Qoralama yangi holatdan qayta quriladi. */
export async function saveDraft(d: Draft, e: ScheduleEditor): Promise<SaveOutcome> {
  const patch = draftPatch(d.orig, d.cur);
  const enabledChanged = d.cur.enabled !== d.orig.enabled;
  const attChanged = !!d.cur.attendance !== !!d.orig.attendance;
  if (!Object.keys(patch).length && !enabledChanged && !attChanged) return { ok: true, changed: false };
  const who = { userId: e.userId, role: e.role, isOwner: e.isOwner };
  if (Object.keys(patch).length) {
    const r = await updateSchedule(d.companyId, d.shiftId, patch, who);
    if (!r.ok) return { ok: false, code: r.code, errors: r.errors };
  }
  if (enabledChanged || attChanged) {
    // AI va ertalabki so'rov — bitta optimistik yozuv (sayt PUT /settings bilan bir xil validator)
    const sPatch: Record<string, unknown> = {
      ...(enabledChanged ? { enabled: d.cur.enabled } : {}),
      ...(attChanged ? { attendance: { enabled: !!d.cur.attendance } } : {}),
    };
    let saved = false;
    for (let attempt = 0; attempt < 2 && !saved; attempt++) {
      const fresh = await getSettingsFresh(d.companyId);
      if (!canEditSchedule(who, fresh)) return { ok: false, code: 'forbidden' };
      const v = validateSettingsUpdate(sPatch, fresh, who);
      if (!v.ok) return { ok: false, code: 'invalid', errors: v.errors };
      saved = (await saveSettings(d.companyId, v.value, fresh.version, e.userId)).ok;
    }
    if (!saved) return { ok: false, code: 'conflict' };
  }
  const args = {
    shiftId: d.shiftId, patch, ...(enabledChanged ? { enabled: d.cur.enabled } : {}), ...(attChanged ? { attendance: !!d.cur.attendance } : {}),
  };
  const summary = `Ish jadvali (bot): ${JSON.stringify(args).slice(0, 180)}`;
  try {
    await writeToolAudit({
      companyId: d.companyId, actorUserId: e.userId, actorRole: e.role, channel: 'bot', purpose: 'assistant',
      correlationId: newCorrelationId(), tool: 'bot.schedule', kind: 'write', args, status: 'ok', resultSummary: summary,
    });
    await mirrorWriteToLegacyAudit({
      companyId: d.companyId, actorUserId: e.userId, actorRole: e.role, tool: 'bot.schedule', channel: 'bot',
      entity: 'ai_settings', action: 'update', summary, args,
    });
  } catch (err) {
    console.error('[aiVoice/bot] jadval auditi xatosi:', (err as Error).message);
  }
  return { ok: true, changed: true };
}

// ───────────── Kirish nuqtalari ─────────────

/** /jadval yoki ai:s:m (qoralamasiz) — menyuni ochadi. Ruxsat yo'q bo'lsa tushuntirish yuboriladi. */
export async function openScheduleMenu(chatId: number, e: ScheduleEditor, messageId?: number): Promise<boolean> {
  const bot = getBotInstance();
  const chk = await checkScheduleEditor(e);
  if (!chk.ok) {
    let text = ta(e.lang, chk.reason === 'feature' ? 'schNoFeature' : 'schNoAccess') as string;
    if (chk.reason === 'forbidden') text += await ownScheduleNote(e).catch(() => '');
    await bot?.sendMessage(chatId, text).catch(() => undefined);
    return false;
  }
  const d = newDraft(chatId, e, chk.settings);
  drafts.set(chatId, d);
  await show(chatId, messageId, render(d, 'main', e.lang));
  return true;
}

/**
 * Rahbar bo'lmagan xodim /jadval yozsa — uning SHAXSIY ish jadvali (#5, bo'lsa) ko'rsatiladi: planner aynan
 * shu kunlar va vaqtda so'raydi. Shaxsiy jadval yo'q bo'lsa — bo'sh (firma jadvali amal qiladi).
 */
async function ownScheduleNote(e: ScheduleEditor): Promise<string> {
  if (!isObjectIdString(e.companyId) || e.role === 'dasturchi') return '';
  const ov = await getEmployeeOverride(e.companyId, e.userId);
  if (!ov) return '';
  const s = await getSettingsFresh(e.companyId);
  const sh = s.attendance.shifts[0];
  if (!sh) return '';
  const eff = effectiveShift(sh, ov);
  const lang = e.lang;
  const days = ta(lang, 'weekdays') as string[];
  const ru = lang === 'ru';
  return `

${ru ? '👤 Ваш личный график:' : '👤 Sizning shaxsiy ish jadvalingiz:'}
`
    + `${ta(lang, 'schStart', { start: eff.workStart, call: eff.callTime })}
`
    + `${ta(lang, 'schDays', { days: eff.workdays.map((n) => days[n - 1]).join(' ') })}`;
}

function toEditor(a: CallbackActor): ScheduleEditor {
  return { userId: a.userId, role: a.role, isOwner: a.isOwner, companyId: a.companyId, lang: a.lang };
}

export async function handleScheduleCallback(query: any, a: CallbackActor, parts: string[]): Promise<boolean> {
  const bot = getBotInstance();
  const e = toEditor(a);
  const action = parts[2] || 'm';
  const chk = await checkScheduleEditor(e);
  if (!chk.ok) {
    drafts.delete(a.chatId);
    await answer(bot, query.id, ta(a.lang, chk.reason === 'feature' ? 'schNoFeature' : 'schNoAccess'), true);
    return true;
  }
  let d = drafts.get(a.chatId);
  const valid = !!d && d.userId === a.userId && d.companyId === a.companyId && d.expiresAt > Date.now();
  if (!valid) {
    drafts.delete(a.chatId);
    if (action === 'm') {
      await answer(bot, query.id);
      d = newDraft(a.chatId, e, chk.settings);
      drafts.set(a.chatId, d);
      await show(a.chatId, a.messageId, render(d, 'main', a.lang));
      return true;
    }
    await answer(bot, query.id, ta(a.lang, 'schExpired'), true);
    await closeButtons(bot, a, query);
    return true;
  }
  d = d as Draft;
  d.expiresAt = Date.now() + DRAFT_TTL_MS;
  const lang = a.lang;

  switch (action) {
    case 'm': d.awaiting = null; await answer(bot, query.id); await show(a.chatId, a.messageId, render(d, 'main', lang)); return true;
    case 't': d.awaiting = null; await answer(bot, query.id); await show(a.chatId, a.messageId, render(d, 'time', lang)); return true;
    case 'w': d.awaiting = null; await answer(bot, query.id); await show(a.chatId, a.messageId, render(d, 'days', lang)); return true;
    case 'k': d.awaiting = null; await answer(bot, query.id); await show(a.chatId, a.messageId, render(d, 'skip', lang)); return true;
    case 'e': d.awaiting = null; await answer(bot, query.id); await show(a.chatId, a.messageId, render(d, 'extra', lang)); return true;
    case 'T': {
      const raw = String(parts[3] || '');
      const t = /^\d{4}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : '';
      if (!isHHmm(t)) { await answer(bot, query.id, ta(lang, 'schBadTime'), true); return true; }
      if (parseHHmm(t) >= parseHHmm(d.absentCutoff)) { await answer(bot, query.id, ta(lang, 'schTimeAfterCutoff', { cutoff: d.absentCutoff }), true); return true; }
      d.cur.workStart = t;
      await answer(bot, query.id, t);
      await show(a.chatId, a.messageId, render(d, 'main', lang));
      return true;
    }
    case 'c':
      d.awaiting = 'time';
      await answer(bot, query.id);
      await bot?.sendMessage(a.chatId, ta(lang, 'schAskTime')).catch(() => undefined);
      return true;
    case 'W': {
      const n = Number(parts[3]);
      if (!Number.isInteger(n) || n < 1 || n > 7) { await answer(bot, query.id); return true; }
      // Oxirgi ish kunini o'chirib bo'lmaydi (sayt validatori bilan bir xil: kamida bitta kun)
      if (d.cur.workdays.length === 1 && d.cur.workdays[0] === n) { await answer(bot, query.id, ta(lang, 'schNeedDay'), true); return true; }
      d.cur.workdays = d.cur.workdays.includes(n) ? d.cur.workdays.filter((x) => x !== n) : [...d.cur.workdays, n].sort();
      await answer(bot, query.id);
      await show(a.chatId, a.messageId, render(d, 'days', lang));
      return true;
    }
    case 'K': case 'E': {
      const listKey = action === 'K' ? 'skip' : 'extra';
      if (parts[3] === 'a') {
        d.awaiting = listKey;
        await answer(bot, query.id);
        await bot?.sendMessage(a.chatId, ta(lang, 'schAskDate')).catch(() => undefined);
        return true;
      }
      if (parts[3] === 'r') {
        const raw = String(parts[4] || '');
        const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : '';
        if (isIsoDate(iso)) d.cur[listKey] = d.cur[listKey].filter((x) => x !== iso);
        await answer(bot, query.id);
        await show(a.chatId, a.messageId, render(d, listKey, lang));
        return true;
      }
      await answer(bot, query.id);
      return true;
    }
    case 'A':
      d.cur.enabled = parts[3] === '1';
      await answer(bot, query.id);
      await show(a.chatId, a.messageId, render(d, 'main', lang));
      return true;
    case 'D':
      d.cur.attendance = parts[3] === '1';
      await answer(bot, query.id);
      await show(a.chatId, a.messageId, render(d, 'main', lang));
      return true;
    case 'h': {
      const shifts = chk.settings.attendance.shifts;
      const idx = shifts.findIndex((s) => s.id === d!.shiftId);
      const next = newDraft(a.chatId, e, chk.settings, (idx + 1) % shifts.length);
      drafts.set(a.chatId, next);
      await answer(bot, query.id);
      await show(a.chatId, a.messageId, render(next, 'main', lang));
      return true;
    }
    case 'S': {
      const r = await saveDraft(d, e);
      if (!r.ok) {
        const msg = r.code === 'forbidden' ? ta(lang, 'schNoAccess')
          : r.code === 'conflict' ? ta(lang, 'schConflict')
            : r.code === 'not_found' ? ta(lang, 'schExpired')
              : ta(lang, 'schInvalid', { errors: (r.errors || []).join('; ').slice(0, 150) });
        await answer(bot, query.id, msg, true);
        return true;
      }
      const fresh = await getSettingsFresh(a.companyId);
      const idx = Math.max(0, fresh.attendance.shifts.findIndex((s) => s.id === d!.shiftId));
      const nd = newDraft(a.chatId, e, fresh, idx);
      drafts.set(a.chatId, nd);
      const note = ta(lang, r.changed ? 'schSaved' : 'schNothing');
      await answer(bot, query.id, note);
      await show(a.chatId, a.messageId, render(nd, 'main', lang, note));
      return true;
    }
    case 'X':
      drafts.delete(a.chatId);
      await answer(bot, query.id);
      await closeButtons(bot, a, query, ta(lang, 'schClosed'));
      return true;
    default:
      await answer(bot, query.id);
      return true;
  }
}

/** Qoralama matn kutayotganda (boshqa vaqt yoki sana) kelgan xabar. true — qayta ishlandi. */
export async function handleScheduleText(msg: any, e: ScheduleEditor): Promise<boolean> {
  const chatId = Number(msg?.chat?.id);
  const d = drafts.get(chatId);
  if (!d || d.awaiting === null || d.userId !== e.userId || d.companyId !== e.companyId) return false;
  const bot = getBotInstance();
  const lang = e.lang;
  const chk = await checkScheduleEditor(e);
  if (!chk.ok) {
    drafts.delete(chatId);
    await bot?.sendMessage(chatId, ta(lang, chk.reason === 'feature' ? 'schNoFeature' : 'schNoAccess')).catch(() => undefined);
    return true;
  }
  d.expiresAt = Date.now() + DRAFT_TTL_MS;
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (d.awaiting === 'time') {
    const t = parseUserTime(text);
    if (!t) { await bot?.sendMessage(chatId, ta(lang, 'schBadTime')).catch(() => undefined); return true; }
    if (parseHHmm(t) >= parseHHmm(d.absentCutoff)) {
      await bot?.sendMessage(chatId, ta(lang, 'schTimeAfterCutoff', { cutoff: d.absentCutoff })).catch(() => undefined);
      return true;
    }
    d.cur.workStart = t;
    d.awaiting = null;
    await show(chatId, undefined, render(d, 'main', lang));
    return true;
  }
  const listKey = d.awaiting;
  const other = listKey === 'skip' ? 'extra' : 'skip';
  const { ok, bad } = parseUserDates(text, localDate());
  if (bad.length || !ok.length) {
    await bot?.sendMessage(chatId, ta(lang, 'schBadDate', { input: (bad[0] || text).slice(0, 20) })).catch(() => undefined);
    return true;
  }
  for (const x of ok) {
    if (!d.cur[listKey].includes(x)) d.cur[listKey].push(x);
    d.cur[other] = d.cur[other].filter((y) => y !== x);   // bir sana faqat bitta ro'yxatda (settings bilan bir xil)
  }
  d.cur[listKey].sort();
  d.awaiting = null;
  await show(chatId, undefined, render(d, listKey, lang));
  return true;
}
