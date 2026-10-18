import { describe, it, expect, beforeEach } from "vitest";
import { companyAiLabel, companyBlocks, prefsLock, readCurrentUser, roleGroup, telegramCallNote } from "./aiAccess";

const status = { aiVoiceEnabled: true, planHasFeature: true, companyActive: true };
const prefs = (p: any = {}) => ({
  optOut: { calls: false, reminders: false, all: false }, callConsent: "granted", disabledChannels: [],
  status: { aiActive: true, attendanceEnabled: true, telegramLinked: true, planHasFeature: true }, ...p,
});

describe("rol guruhi", () => {
  it("rollarni izoh guruhiga ajratadi", () => {
    expect(roleGroup("direktor")).toBe("boss");
    expect(roleGroup("ishchi", true)).toBe("boss");
    expect(roleGroup("orinbosar")).toBe("deputy");
    expect(roleGroup("prorab")).toBe("foreman");
    expect(roleGroup("brigadir")).toBe("foreman");
    expect(roleGroup("ishchi")).toBe("worker");
    expect(roleGroup(undefined)).toBe("worker");
    expect(roleGroup("dasturchi", true)).toBe("developer");
  });
  describe("localStorage", () => {
    beforeEach(() => {
      // node muhitida localStorage yo'q — oddiy xotira o'rnatamiz
      const m = new Map<string, string>();
      (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, clear: () => m.clear() };
    });
    it("joriy foydalanuvchini o'qiydi, buzuq bo'lsa bo'sh", () => {
      expect(readCurrentUser()).toEqual({});
      localStorage.setItem("currentUser", JSON.stringify({ role: "prorab", isOwner: false }));
      expect(readCurrentUser()).toEqual({ role: "prorab", isOwner: false });
      localStorage.setItem("currentUser", "{buzuq");
      expect(readCurrentUser()).toEqual({});
    });
  });
});

describe("firma AI holati (rost sabab)", () => {
  it("hammasi joyida — ishlayapti", () => {
    const b = companyBlocks({ status, settings: { enabled: true } });
    expect(b).toEqual([]);
    expect(companyAiLabel(b)).toBe("on");
  });
  it("firmada yoqilgan, lekin server o'chiq — 'O'chiq' emas, 'to'xtagan'", () => {
    const b = companyBlocks({ status: { ...status, aiVoiceEnabled: false }, settings: { enabled: true } });
    expect(b).toEqual(["server"]);
    expect(companyAiLabel(b)).toBe("blocked");
  });
  it("bir nechta sabab tartib bilan", () => {
    const b = companyBlocks({ status: { aiVoiceEnabled: false, planHasFeature: false, companyActive: false }, settings: { enabled: false } });
    expect(b).toEqual(["plan", "inactive", "server", "company"]);
    expect(companyAiLabel(b)).toBe("off");
  });
});

describe("shaxsiy sozlamalar: nega o'chiq", () => {
  it("AI firmada o'chiq — hamma joy qulf, tarif sababi alohida", () => {
    expect(prefsLock(prefs({ status: { aiActive: false, planHasFeature: true } }), "channels")).toBe("aiOff");
    expect(prefsLock(prefs({ status: { aiActive: false, planHasFeature: false } }), "consent")).toBe("plan");
    // xodim: faqat ko'rish (eslatmani bekor qilish mumkin)
    expect(prefsLock(prefs({ status: { aiActive: true, planHasFeature: true, canEdit: false } }), "channels")).toBe("managed");
    expect(prefsLock(prefs({ status: { aiActive: true, planHasFeature: true, canEdit: false } }), "reminders")).toBe(null);
  });
  it("saqlanayotganda — busy (eslatmalar bundan mustasno)", () => {
    expect(prefsLock(prefs(), "channels", true)).toBe("busy");
    expect(prefsLock(prefs(), "reminders", true)).toBeNull();
  });
  it("'Hammasidan' voz kechilgan — kanallar va alohida voz kechishlar qulf, o'zi emas", () => {
    const p = prefs({ optOut: { calls: false, reminders: false, all: true } });
    expect(prefsLock(p, "channels")).toBe("optOutAll");
    expect(prefsLock(p, "quiet")).toBe("optOutAll");
    expect(prefsLock(p, "optOut")).toBe("optOutAll");
    expect(prefsLock(p, "optOutAll")).toBeNull();
    expect(prefsLock(p, "consent")).toBeNull();
  });
  it("status kelmasa (eski server) — qulf yo'q", () => {
    expect(prefsLock(prefs({ status: undefined }), "channels")).toBeNull();
  });
  it("Telegram qo'ng'irog'i izohi", () => {
    expect(telegramCallNote(prefs())).toBeNull();
    expect(telegramCallNote(prefs({ status: { telegramLinked: false } }))).toBe("notLinked");
    expect(telegramCallNote(prefs({ callConsent: "none" }))).toBe("noConsent");
    expect(telegramCallNote(prefs({ callConsent: "none", disabledChannels: ["telegram_call"] }))).toBeNull();
  });
});
