import { describe, it, expect } from "vitest";
import { buildEntries, inFolder, sortEntries, folderUnreadChats, navUnreadCount, listTime, matchesQuery, type ChatEntry } from "./chatModel";

const me: any = { id: "me", name: "Men", role: "direktor", phone: "", projectIds: [] };
const users: any[] = [
  me,
  { id: "d2", name: "Orinbosar Ali", role: "orinbosar", phone: "+998 90 111", projectIds: [] },
  { id: "p1", name: "Prorab Vali", role: "prorab", phone: "", projectIds: [] },
  { id: "b1", name: "Brigadir Soli", role: "brigadir", phone: "", projectIds: [] },
  { id: "w1", name: "Ishchi Karim", role: "ishchi", phone: "", projectIds: [] },
];
const groups: any[] = [{ id: "g1", name: "Obyekt 1", memberIds: ["me", "p1"], adminIds: [], createdBy: "me" }];
const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 5, min)).toISOString();
const msgs: any[] = [
  { id: "1", fromUserId: "p1", toUserId: "me", text: "a", timestamp: T(1), read: false },
  { id: "2", fromUserId: "p1", toUserId: "me", text: "b", timestamp: T(2), read: false },
  { id: "3", fromUserId: "me", toUserId: "w1", text: "c", timestamp: T(3), read: true },
  { id: "4", fromUserId: "p1", toUserId: "", groupId: "g1", text: "g", timestamp: T(4), read: false },
  { id: "5", fromUserId: "me", toUserId: "", groupId: "g1", text: "mine", timestamp: T(5), read: false },
];
const base = { me, users, groups, messages: msgs, groupSeen: {}, baseline: 0, readAllAt: 0, supportName: "Dasturchi" };
const byKey = (l: ChatEntry[]) => Object.fromEntries(l.map((e) => [e.key, e]));

describe("buildEntries", () => {
  it("DM va guruh o'qilmaganlarini sanaydi (o'z xabari hisoblanmaydi)", () => {
    const e = byKey(buildEntries(base));
    expect(e["u:p1"].unread).toBe(2);
    expect(e["u:w1"].unread).toBe(0);
    expect(e["g:g1"].unread).toBe(1);
    expect(e["u:me"]).toBeUndefined();
  });
  it("readAllAt va groupSeen — o'qilgan deb hisoblanadi", () => {
    const e = byKey(buildEntries({ ...base, readAllAt: Date.parse(T(10)) }));
    expect(e["u:p1"].unread).toBe(0);
    expect(e["g:g1"].unread).toBe(0);
    const e2 = byKey(buildEntries({ ...base, groupSeen: { g1: Date.parse(T(4)) } }));
    expect(e2["g:g1"].unread).toBe(0);
    expect(e2["u:p1"].unread).toBe(2);
  });
});

describe("jildlar", () => {
  const list = buildEntries(base);
  const keys = (f: any) => list.filter((e) => inFolder(e, f)).map((e) => e.key).sort();
  it("rolga qarab", () => {
    expect(keys("bosses")).toEqual(["u:d2"]);
    expect(keys("prorabs")).toEqual(["u:b1", "u:p1"]);
    expect(keys("workers")).toEqual(["u:w1"]);
    expect(keys("groups")).toEqual(["g:g1"]);
    expect(keys("unread")).toEqual(["g:g1", "u:p1"]);
    expect(keys("all")).toHaveLength(5);
  });
  it("jild soni — o'qilmagan suhbatlar, ovozsizlar hisobga olinmaydi", () => {
    expect(folderUnreadChats(list, "all", new Set())).toBe(2);
    expect(folderUnreadChats(list, "all", new Set(["g:g1"]))).toBe(1);
    expect(folderUnreadChats(list, "prorabs", new Set())).toBe(1);
  });
});

describe("saralash", () => {
  const list = buildEntries(base);
  it("oxirgi xabar bo'yicha, qadalganlar tepada", () => {
    expect(sortEntries(list, "recent", []).map((e) => e.key).slice(0, 3)).toEqual(["g:g1", "u:w1", "u:p1"]);
    expect(sortEntries(list, "recent", ["u:b1"])[0].key).toBe("u:b1");
  });
  it("avval o'qilmaganlar", () => {
    expect(sortEntries(list, "unread", []).map((e) => e.key).slice(0, 2)).toEqual(["g:g1", "u:p1"]);
  });
  it("qidiruv — ism yoki telefon", () => {
    const e = byKey(list);
    expect(matchesQuery(e["u:d2"], "ali")).toBe(true);
    expect(matchesQuery(e["u:d2"], "90111")).toBe(true);
    expect(matchesQuery(e["u:p1"], "karim")).toBe(false);
  });
});

describe("listTime", () => {
  it("bugun — soat, eski — sana", () => {
    const now = Date.parse("2026-10-16T10:00:00Z");
    expect(listTime(Date.parse("2026-10-16T05:07:00Z"), "uz", now)).toBe("10:07");
    expect(listTime(Date.parse("2026-08-01T05:00:00Z"), "uz", now)).toMatch(/01/);
    expect(listTime(0, "uz", now)).toBe("");
  });
});

describe("o'zbekcha sana yorliqlari (brauzer lokalisiz)", () => {
  it("hafta kuni va oy nomi", async () => {
    const { dayLabel } = await import("./chatModel");
    const now = Date.parse("2026-10-16T10:00:00Z"); // juma
    expect(listTime(Date.parse("2026-10-15T05:00:00Z"), "uz", now)).toBe("Pay");
    const tt = (k: string) => k;
    expect(dayLabel(Date.parse("2026-10-16T05:00:00Z"), "uz", tt, now)).toBe("chatUi.today");
    expect(dayLabel(Date.parse("2026-10-15T05:00:00Z"), "uz", tt, now)).toBe("chatUi.yesterday");
    expect(dayLabel(Date.parse("2026-09-03T05:00:00Z"), "uz", tt, now)).toBe("3-sentabr");
    expect(dayLabel(Date.parse("2025-09-03T05:00:00Z"), "uz", tt, now)).toBe("3-sentabr 2025");
  });
});

describe("navUnreadCount", () => {
  it("navbar belgisi ro'yxatdagi suhbatlar bilan mos (ro'yxatda yo'q yuboruvchi va ovozsiz sanalmaydi)", () => {
    const extra = [...msgs,
      { id: "x1", fromUserId: "ai-assistant", toUserId: "me", text: "ai", timestamp: T(6), read: false },
      { id: "x2", fromUserId: "gone", toUserId: "me", text: "eski", timestamp: T(7), read: false },
      { id: "x3", fromUserId: "w1", toUserId: "me", text: "del", timestamp: T(8), read: false, deleted: true },
    ];
    const l = buildEntries({ ...base, messages: extra });
    expect(navUnreadCount(l, new Set())).toBe(3);
    expect(navUnreadCount(l, new Set(["g:g1"]))).toBe(2);
    // belgi > 0 bo'lsa — "O'qilmagan" jildi bo'sh emas
    expect(l.filter((e) => inFolder(e, "unread")).length).toBeGreaterThan(0);
  });
});
