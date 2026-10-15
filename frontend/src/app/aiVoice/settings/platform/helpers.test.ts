import { describe, it, expect } from "vitest";
import { archiveFileName, companyPatch, draftOf, filterCompanies, fmtBytes, normalizeArchives, normalizeCompanies, pickList, rangeOfDays, usageRows, validateLimits } from "./helpers";

const limits = { userSessionsPerHour: 6, companyMinutesPerDay: 120, monthlyBudgetUsd: 20, hardStop: true, botMsgsPer10Min: 20, toolCallsPerSession: 30 };

describe("platforma yordamchilari", () => {
  it("ro'yxatni turli shakllardan oladi", () => {
    expect(pickList([1], ["x"])).toEqual([1]);
    expect(pickList({ companies: [2] }, ["companies"])).toEqual([2]);
    expect(pickList({ nope: 1 }, ["companies"])).toEqual([]);
    expect(pickList(null, ["companies"])).toEqual([]);
  });
  it("firmalarni normallashtiradi (id/companyId, usage turli shakllarda)", () => {
    const list = normalizeCompanies({ companies: [
      { companyId: "a", name: "Alfa", aiEnabled: true, usage: { month: { costUsdMicros: 5e6, budgetUsd: 20 }, totals: { sessions: 3 } }, limits },
      { id: "b", companyName: "Beta", enabled: false },
      { name: "id yo'q" },
    ] });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "a", name: "Alfa", aiEnabled: true, usage: { monthCostUsdMicros: 5e6, sessions: 3, budgetUsd: 20 } });
    expect(list[1]).toMatchObject({ id: "b", name: "Beta", aiEnabled: false, usage: { monthCostUsdMicros: 0, sessions: 0 } });
  });
  it("server /platform/companies shakli: {items}, xarajat va byudjet tepada", () => {
    const [c] = normalizeCompanies({ page: 1, limit: 30, total: 1, items: [
      { companyId: "c1", name: "Jondor", status: "ACTIVE", planHasFeature: true, aiEnabled: true, attendanceEnabled: true, monthCostUsdMicros: 4_200_000, monthlyBudgetUsd: 20 },
    ] });
    expect(c).toMatchObject({ id: "c1", aiEnabled: true, planHasFeature: true, status: "ACTIVE", attendanceEnabled: true, usage: { monthCostUsdMicros: 4_200_000, budgetUsd: 20 } });
  });
  it("qidiruv va xarajat bo'yicha tartib", () => {
    const list = normalizeCompanies([{ id: "1", name: "Bino", usage: { costUsdMicros: 1 } }, { id: "2", name: "Asos", usage: { costUsdMicros: 9 } }, { id: "3", name: "Uy" }]);
    expect(filterCompanies(list, "").map((c) => c.id)).toEqual(["2", "1", "3"]);
    expect(filterCompanies(list, "bi").map((c) => c.id)).toEqual(["1"]);
  });
  it("faqat o'zgargan bo'limlar PATCH ga ketadi (enabled/brain/limits/provider)", () => {
    const s = draftOf({ enabled: false, limits, brain: { provider: "gemini", fallback: "none", effort: "low" } });
    expect(companyPatch(s, { ...s })).toEqual({});
    expect(companyPatch(s, { ...s, enabled: true })).toEqual({ enabled: true });
    const d = { ...s, limits: { ...limits, monthlyBudgetUsd: 50 } };
    expect(companyPatch(s, d)).toEqual({ limits: d.limits });
    // bo'sh model nomi "o'zgarish" emas
    expect(companyPatch(s, { ...s, provider: { ...s.provider, textModel: "" } })).toEqual({});
    expect(companyPatch(s, { ...s, provider: { ...s.provider, textModel: "gemini-2.5-flash" } }).provider).toEqual({ primary: "gemini_live", fallback: "gemini_cascade", textModel: "gemini-2.5-flash" });
  });
  it("standart qiymatlar (sozlama kelmasa)", () => {
    expect(draftOf(null)).toMatchObject({ enabled: false, brain: { provider: "gemini" }, limits: { monthlyBudgetUsd: 20 }, provider: { primary: "gemini_live" } });
  });
  it("davr va sarf qatorlari", () => {
    expect(rangeOfDays(7, "2026-10-15")).toEqual({ from: "2026-10-09", to: "2026-10-15" });
    expect(rangeOfDays(1, "2026-03-01")).toEqual({ from: "2026-03-01", to: "2026-03-01" });
    expect(usageRows({ companies: [{ companyId: "a", costUsdMicros: 1 }, { companyId: "b", costUsdMicros: 5 }] }).map((r) => r.companyId)).toEqual(["b", "a"]);
    expect(usageRows({ byCompany: [{ companyId: "x", costUsdMicros: 1 }] })).toHaveLength(1);
    expect(usageRows(null)).toEqual([]);
  });
  it("limit chegaralari", () => {
    expect(validateLimits(limits)).toBe(true);
    expect(validateLimits({ ...limits, monthlyBudgetUsd: 10001 })).toBe(false);
    expect(validateLimits({ ...limits, botMsgsPer10Min: 0 })).toBe(false);
    expect(validateLimits({ ...limits, userSessionsPerHour: NaN })).toBe(false);
    expect(validateLimits(undefined)).toBe(true);
  });
  it("arxivlar: normallashtirish, yangisi yuqorida, hajm va fayl nomi", () => {
    const a = normalizeArchives({ archives: [
      { id: "x", periodFrom: "2026-10-01", periodTo: "2026-10-07", size: 2048, createdAt: "2026-10-08" },
      { id: "y", periodFrom: "2026-10-08", periodTo: "2026-10-14", size: 10, createdAt: "2026-10-15", companyName: "Jondor Iris" },
      { periodFrom: "id yo'q" },
    ] });
    expect(a.map((x) => x.id)).toEqual(["y", "x"]);
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(archiveFileName(a[0])).toBe("ai-suhbatlar_Jondor-Iris_2026-10-08_2026-10-14.jsonl.gz");
  });
  it("server arxiv shakli: bitta kun + qism, fayl nomi serverdan", () => {
    const a = normalizeArchives({ page: 1, limit: 30, total: 2, items: [
      { id: "p1", companyId: "c1", period: "2026-10-07", part: 1, status: "done", fileName: "ai-c1-2026-10-07-p1.jsonl.gz", size: 100, counts: { conversations: 4, events: 30 }, createdAt: "2026-10-15T00:10:00Z" },
      { id: "p2", companyId: "c1", period: "2026-10-08", part: 0, size: 50, createdAt: "2026-10-16T00:10:00Z" },
    ] });
    expect(a.map((x) => x.id)).toEqual(["p2", "p1"]);
    expect(a[1]).toMatchObject({ periodFrom: "2026-10-07", periodTo: "2026-10-07", part: 1, conversations: 4 });
    expect(archiveFileName(a[1])).toBe("ai-c1-2026-10-07-p1.jsonl.gz");
    expect(archiveFileName(a[0])).toBe("ai-suhbatlar_firma_2026-10-08.jsonl.gz");
  });
});
