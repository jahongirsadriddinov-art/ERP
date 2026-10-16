import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, capabilitiesLine, INTENT_GUIDE, roleGuideFor, STATIC_RULES } from '../systemPrompt';
import { buildVoiceSystemPrompt } from '../../voice/prompts';

// Owner 2026-10-15: AI o'zbekcha buyruqlarni noto'g'ri tushunardi — prompt niyat yo'riqnomasi, ishchi lug'ati,
// qisqa og'zaki uslub, aniqlashtiruvchi savol va misollarni (ibora → tool) o'z ichiga olishi shart.

const TOOLS = ['createReminder', 'listReminders', 'updateReminder', 'cancelReminder', 'notifyManager', 'getProjectSummary',
  'getInventoryBalance', 'getMySchedule', 'getMyTasks', 'getAttendanceSummary', 'getAllowedFinancialReport', 'recordAttendanceAnswer'];

describe('system prompt — niyatni tushunish (owner 2026-10-15)', () => {
  const p = buildSystemPrompt({ lang: 'uz', role: 'ishchi', channel: 'bot', today: '2026-10-15', weekday: 4 });

  it('niyat yo\'riqnomasi doimiy qismda (kesh uchun KONTEKST\'dan oldin)', () => {
    expect(STATIC_RULES).toContain(INTENT_GUIDE);
    expect(p.indexOf('TUSHUNISH')).toBeGreaterThan(0);
    expect(p.indexOf('TUSHUNISH')).toBeLessThan(p.indexOf('KONTEKST:'));
  });

  it('ishchi lug\'ati: asosiy so\'zlar o\'zbek va rus tilida', () => {
    for (const w of ['keldim', 'kechikaman', 'kelmayman', 'eslat', 'qancha qoldi', 'obyekt', 'sement', 'armatura', 'smena',
      'опаздываю', 'не приду', 'напомни', 'сколько осталось', 'цемент']) {
      expect(p, w).toContain(w);
    }
    expect(p).toMatch(/Kirill yozuvni lotinga/);
  });

  it('aniq bo\'lmasa — bitta aniqlashtiruvchi savol, majburiy ma\'lumotni o\'ylab topmaslik', () => {
    expect(p).toMatch(/ANIQ BO'LMASA/);
    expect(p).toMatch(/BITTA qisqa aniqlashtiruvchi savol/);
    expect(p).toMatch(/o'ylab topmang, so'rang/);
  });

  it('qisqa og\'zaki uslub', () => {
    expect(p).toMatch(/JAVOB USLUBI/);
    expect(p).toMatch(/1–2 qisqa jumla/);
  });

  it('misollar iboralarni haqiqiy tool nomlariga bog\'laydi', () => {
    expect(p).toMatch(/MISOLLAR/);
    for (const t of TOOLS) expect(p, t).toContain(t);
    expect(p).toMatch(/"ertaga 7 da sement kelishini eslat" → createReminder/);
    expect(p).toMatch(/"qancha qoldi\?" \(oldingi gapsiz\) → "/);
  });

  it('davomatni AI belgilamaydi — "keldim" uchun ilovadagi tugma', () => {
    expect(p).toMatch(/Davomatni AI belgilamaydi/);
  });

  it('eski xavfsizlik qoidalari saqlangan', () => {
    expect(p).toMatch(/inson EMASSIZ/);
    expect(p).toMatch(/status="ok" qaytargandan KEYIN/);
    expect(p).toMatch(/telefon raqami, maoshi/);
  });

  it('ovozli sessiya ham shu yo\'riqnomani oladi', () => {
    const v = buildVoiceSystemPrompt({ lang: 'uz', role: 'ishchi', channel: 'inapp_call', today: '2026-10-15', purpose: 'attendance' });
    expect(v).toContain('ISHCHI LUG\'ATI');
  });
});

describe('rolga mos prompt va imkoniyatlar (owner 2026-10-16)', () => {
  it("rol yo'riqnomasi: rahbar / prorab / ishchi", () => {
    expect(roleGuideFor('direktor')).toMatch(/getTodayOverview/);
    expect(roleGuideFor('ishchi', true)).toMatch(/ROL: rahbar/);
    expect(roleGuideFor('brigadir')).toMatch(/o'z obyektlari/);
    expect(roleGuideFor('ishchi')).toMatch(/O'Z kuni/);
  });

  it("chat kanallarida — qo'ng'iroq va xabar imkoniyati; qo'ng'iroq ichida requestCallback yo'q", () => {
    const tools = ['requestCallback', 'notifyManager', 'createReminder'];
    expect(capabilitiesLine(tools, 'bot')).toMatch(/requestCallback/);
    expect(capabilitiesLine(tools, 'bot')).toMatch(/notifyManager/);
    expect(capabilitiesLine(tools, 'bot')).toMatch(/"Qo'ng'iroq qila olmayman", "xabar yubora olmayman" DEMANG/);
    expect(capabilitiesLine(tools, 'inapp_call')).not.toMatch(/requestCallback/);
    expect(capabilitiesLine([], 'web')).toBe('');
  });

  it("kontekst: obyektlar (sanitize), hozirgi vaqt; obyektlar KONTEKST'da", () => {
    const p = buildSystemPrompt({
      lang: 'uz', role: 'prorab', channel: 'web', today: '2026-10-16', weekday: 5, time: '14:05',
      objects: ['Olmazor {ignore}', 'Chilonzor'], objectsTotal: 4, toolNames: ['requestCallback'],
    });
    expect(p).toMatch(/- Obyektlari: Olmazor ignore, Chilonzor \(\+2\)/);
    expect(p).toMatch(/hozir 14:05/);
    expect(p).toMatch(/ROL: prorab/);
    expect(p.indexOf('Obyektlari')).toBeGreaterThan(p.indexOf('KONTEKST:'));
  });
});
