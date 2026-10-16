import { describe, it, expect } from "vitest";
import type { AiSettingsData, AiShift } from "./api";
import {
  addChannel, addDate, addShiftDate, callTimeOf, channelsUnique, dayStatus, diffPatch, isHHmm, isIsoDate, isoWeekdayOf,
  missingChannels, moveItem, normalizeHHmm, removeChannel, removeShiftDate, setChannelEnabled, todayTashkent, toggleCalendarDay, toggleWeekday,
  validateDraft, validateShift,
} from "./scheduleHelpers";

const shift = (p: Partial<AiShift> = {}): AiShift => ({
  id: "main", name: "Asosiy", objectIds: [], roles: ["ishchi"], workStart: "08:00", callLeadMin: 0, callTime: "08:00",
  workdays: [1, 2, 3, 4, 5, 6], lateAfterMin: 15, absentCutoff: "12:00", buttonWaitMin: 10, maxLateMin: 60,
  skipDates: [], extraWorkDates: [], ...p,
});
const settings = (p: Partial<AiSettingsData> = {}): AiSettingsData => ({
  companyId: "c1", enabled: false, language: "uz", voiceName: "Kore", timezone: "Asia/Tashkent",
  attendance: { enabled: false, suppressLegacyMorningReminder: true, orinbosarCanEditSchedule: true, shifts: [shift()] },
  calls: { maxAttemptsPerChannel: 2, backoffMin: [3, 10], ringTimeoutSec: 45, maxDurationSec: 120, assistantMaxDurationSec: 600, companyConcurrency: 3, minGapSec: 20, quietHours: { from: "21:00", to: "07:00" } },
  fallbackOrder: ["bot_message", "telegram_call", "inapp_call", "push", "notify_manager"],
  reminders: { defaultLeadMin: 0, defaultChannels: ["bot_message", "push"], maxActivePerUser: 50 },
  tools: { byRole: {}, allowOffShiftAssistant: false },
  provider: { primary: "gemini_live", fallback: "gemini_cascade" },
  brain: { provider: "gemini", fallback: "openrouter", effort: "low" },
  limits: { userSessionsPerHour: 6, companyMinutesPerDay: 120, monthlyBudgetUsd: 20, hardStop: true, botMsgsPer10Min: 20, toolCallsPerSession: 30 },
  privacy: { recordAudio: false, transcriptRetentionDays: 30, auditRetentionDays: 365 },
  version: 3, ...p,
});

describe("HH:mm", () => {
  it("faqat 00:00–23:59 to'liq formatni qabul qiladi", () => {
    for (const ok of ["00:00", "08:05", "23:59"]) expect(isHHmm(ok)).toBe(true);
    for (const bad of ["24:00", "8:00", "08:60", "08:5", "", "0800", null]) expect(isHHmm(bad)).toBe(false);
  });
  it("normalizeHHmm qisqa yozuvlarni to'g'rilaydi", () => {
    expect(normalizeHHmm("8:05")).toBe("08:05");
    expect(normalizeHHmm("0805")).toBe("08:05");
    expect(normalizeHHmm("805")).toBe("08:05");
    expect(normalizeHHmm(" 07:30 ")).toBe("07:30");
    expect(normalizeHHmm("25:00")).toBeNull();
    expect(normalizeHHmm("8:5")).toBeNull();
    expect(normalizeHHmm("abc")).toBeNull();
  });
  it("callTime = workStart − lead, yarim tundan o'tmaydi", () => {
    expect(callTimeOf("08:00", 15)).toBe("07:45");
    expect(callTimeOf("08:00", 0)).toBe("08:00");
    expect(callTimeOf("00:10", 30)).toBe("00:00");
  });
});

describe("hafta kunlari", () => {
  it("toggle qo'shadi/olib tashlaydi, saralangan va takrorsiz", () => {
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleWeekday([3, 1], 7)).toEqual([1, 3, 7]);
    expect(toggleWeekday([1, 1, 2], 5)).toEqual([1, 2, 5]);
    expect(toggleWeekday([], 1)).toEqual([1]);
  });
  it("ISO hafta kuni: 2026-10-12 — dushanba (1), 2026-10-18 — yakshanba (7)", () => {
    expect(isoWeekdayOf("2026-10-12")).toBe(1);
    expect(isoWeekdayOf("2026-10-18")).toBe(7);
  });
});

describe("sanalar ro'yxati", () => {
  it("haqiqiy sanalarni tekshiradi", () => {
    expect(isIsoDate("2027-03-21")).toBe(true);
    expect(isIsoDate("2027-02-30")).toBe(false);
    expect(isIsoDate("2027-3-21")).toBe(false);
  });
  it("addDate takrorsiz, saralangan; noto'g'ri sana qo'shilmaydi", () => {
    expect(addDate(["2027-03-21"], "2027-01-01")).toEqual(["2027-01-01", "2027-03-21"]);
    expect(addDate(["2027-01-01"], "2027-01-01")).toEqual(["2027-01-01"]);
    expect(addDate(["2027-01-01"], "2027-13-01")).toEqual(["2027-01-01"]);
  });
  it("bir sana faqat bitta ro'yxatda (skip ↔ extra)", () => {
    let s = addShiftDate(shift(), "skip", "2027-03-21");
    expect(s.skipDates).toEqual(["2027-03-21"]);
    s = addShiftDate(s, "extra", "2027-03-21");
    expect(s.skipDates).toEqual([]);
    expect(s.extraWorkDates).toEqual(["2027-03-21"]);
    s = removeShiftDate(s, "extra", "2027-03-21");
    expect(s.extraWorkDates).toEqual([]);
  });
  it("kalendar kunini bosish: ish kuni → skip, dam olish kuni → extra, yana bosish — qaytaradi", () => {
    const mon = "2026-10-12", sun = "2026-10-18";
    let s = shift();
    expect(dayStatus(s, mon)).toBe("work");
    expect(dayStatus(s, sun)).toBe("off");
    s = toggleCalendarDay(s, mon);
    expect(dayStatus(s, mon)).toBe("skip");
    s = toggleCalendarDay(s, sun);
    expect(dayStatus(s, sun)).toBe("extra");
    s = toggleCalendarDay(toggleCalendarDay(s, mon), sun);
    expect(s.skipDates).toEqual([]);
    expect(s.extraWorkDates).toEqual([]);
  });
  it("Toshkent sanasi: UTC 19:30 — Toshkentda ertangi kun", () => {
    expect(todayTashkent(new Date("2026-10-13T19:30:00Z"))).toBe("2026-10-14");
    expect(todayTashkent(new Date("2026-10-13T18:59:00Z"))).toBe("2026-10-13");
  });
});

describe("kanal tartibi (fallback)", () => {
  it("takrorsizlik va ma'lum kanallar", () => {
    expect(channelsUnique(["bot_message", "push"])).toBe(true);
    expect(channelsUnique(["bot_message", "bot_message"])).toBe(false);
    expect(channelsUnique(["bot_message", "sms"])).toBe(false);
  });
  it("addChannel takror qo'shmaydi; remove/missing", () => {
    expect(addChannel(["push"], "push")).toEqual(["push"]);
    expect(addChannel(["push"], "bot_message")).toEqual(["push", "bot_message"]);
    expect(removeChannel(["push", "bot_message"], "push")).toEqual(["bot_message"]);
    expect(missingChannels(["push", "bot_message"])).toEqual(["telegram_call", "inapp_call", "notify_manager"]);
  });
  it("moveItem chegaradan chiqmaydi", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
  it("validateDraft takroriy tartibni ushlaydi", () => {
    expect(validateDraft(settings())).toEqual([]);
    expect(validateDraft(settings({ fallbackOrder: ["push", "push"] }))).toContain("fallbackOrder");
    expect(validateDraft(settings({ fallbackOrder: [] }))).toContain("fallbackOrder");
  });
  it("firma ko'rinishida limits yo'q — yiqilmaydi", () => {
    const { limits: _l, brain: _b, provider: _p, ...rest } = settings();
    expect(validateDraft(rest as any)).toEqual([]);
  });
});

describe("smena tekshiruvi", () => {
  it("xatolarni aniqlaydi", () => {
    expect(validateShift(shift())).toEqual([]);
    expect(validateShift(shift({ workStart: "8:00" }))).toContain("workStart");
    expect(validateShift(shift({ absentCutoff: "07:00" }))).toContain("absentCutoff");
    expect(validateShift(shift({ workdays: [] }))).toContain("workdays");
    expect(validateShift(shift({ skipDates: ["2027-01-01"], extraWorkDates: ["2027-01-01"] }))).toContain("dateConflict");
    expect(validateShift(shift({ workStart: "00:10", callLeadMin: 30 }))).toContain("callLead");
    expect(validateShift(shift({ maxLateMin: 999 }))).toContain("numbers");
  });
});

describe("diffPatch", () => {
  it("faqat o'zgargan bo'lim va kalitlar; timezone/version yuborilmaydi", () => {
    const a = settings();
    const b = settings({ attendance: { ...a.attendance, shifts: [shift({ workStart: "07:30", callLeadMin: 15, callTime: "08:00" })] }, version: 9 });
    const p = diffPatch(a, b);
    expect(Object.keys(p)).toEqual(["attendance"]);
    expect(Object.keys(p.attendance as object)).toEqual(["shifts"]);
    expect((p.attendance as any).shifts[0]).toMatchObject({ workStart: "07:30", callLeadMin: 15, callTime: "07:15" });
    expect(diffPatch(a, settings())).toEqual({});
    expect(diffPatch(a, settings({ enabled: true, limits: { ...a.limits, monthlyBudgetUsd: 50 } }))).toEqual({ enabled: true, limits: { monthlyBudgetUsd: 50 } });
  });
});

describe("setChannelEnabled", () => {
  it("yoqilganda standart joyiga qo'yadi, takrorlamaydi", () => {
    expect(setChannelEnabled(["bot_message", "push", "notify_manager"], "telegram_call", true)).toEqual(["bot_message", "telegram_call", "push", "notify_manager"]);
    expect(setChannelEnabled(["push"], "bot_message", true)).toEqual(["bot_message", "push"]);
    expect(setChannelEnabled(["bot_message"], "notify_manager", true)).toEqual(["bot_message", "notify_manager"]);
    expect(setChannelEnabled(["bot_message", "push"], "push", true)).toEqual(["bot_message", "push"]);
  });
  it("o'chirilganda olib tashlaydi, oxirgisini qoldiradi", () => {
    expect(setChannelEnabled(["bot_message", "telegram_call"], "telegram_call", false)).toEqual(["bot_message"]);
    expect(setChannelEnabled(["inapp_call"], "inapp_call", false)).toEqual(["inapp_call"]);
  });
});
