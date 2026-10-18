// Chat ro'yxati modeli — sof funksiyalar (React'siz, unit-testlanadi):
// suhbatlar ro'yxati, o'qilmaganlar, jildlar (rolga qarab), saralash, vaqt yorliqlari.
import type { AppUser, Group, Msg, Role } from "../App";

export type FolderId = "all" | "unread" | "bosses" | "prorabs" | "workers" | "groups";
export const FOLDER_IDS: FolderId[] = ["all", "unread", "bosses", "prorabs", "workers", "groups"];
// Sozlamada yoqib/o'chirsa bo'ladigan jildlar ("Hammasi" doim ko'rinadi)
export const TOGGLEABLE_FOLDERS: FolderId[] = ["unread", "bosses", "prorabs", "workers", "groups"];

const ROLE_FOLDER: Partial<Record<Role, FolderId>> = {
  direktor: "bosses", orinbosar: "bosses",
  prorab: "prorabs", brigadir: "prorabs",
  ishchi: "workers",
};

export type ChatKind = "dm" | "group" | "support";
export interface ChatEntry {
  key: string;            // "u:<id>" | "g:<id>"
  kind: ChatKind;
  user?: AppUser;
  group?: Group;
  last?: Msg;
  lastTs: number;         // 0 — xabar yo'q
  unread: number;
  name: string;
}

export const userKey = (id: string) => `u:${id}`;
export const groupKey = (id: string) => `g:${id}`;

const ts = (iso?: string) => { const n = iso ? Date.parse(iso) : NaN; return Number.isFinite(n) ? n : 0; };

/** DM o'qilmaganmi — server `read` + mahalliy "hammasini o'qildi" vaqti (socket kechiksa ham darhol 0 bo'lsin). */
export function isDmUnread(m: Msg, meId: string, readAllAt = 0): boolean {
  if (m.deleted || m.groupId || m.toUserId !== meId || m.read) return false;
  return !(readAllAt && ts(m.timestamp) <= readAllAt);
}

/** Guruh xabari o'qilmaganmi — har bir foydalanuvchi uchun mahalliy "oxirgi ko'rgan vaqt" bo'yicha. */
export function isGroupUnread(m: Msg, meId: string, seenAt: number): boolean {
  if (m.deleted || !m.groupId || m.fromUserId === meId || m.type === "video_event") return false;
  return ts(m.timestamp) > seenAt;
}

export interface BuildInput {
  me: AppUser;
  users: AppUser[];
  groups: Group[];
  messages: Msg[];
  groupSeen: Record<string, number>;
  baseline: number;       // shu vaqtdan oldingi guruh xabarlari "o'qilgan" (birinchi ochilish)
  readAllAt: number;
  supportName: string;
}

/** Barcha suhbatlar — BITTA o'tishda (N kontakt × M xabar emas). */
export function buildEntries(inp: BuildInput): ChatEntry[] {
  const { me, users, groups, messages, groupSeen, baseline, readAllAt } = inp;
  const lastByGroup = new Map<string, Msg>();
  const lastByUser = new Map<string, Msg>();
  const unreadByUser = new Map<string, number>();
  const unreadByGroup = new Map<string, number>();
  for (const m of messages) {
    if (m.deleted) continue;
    if (m.groupId) {
      lastByGroup.set(m.groupId, m);
      const seen = Math.max(groupSeen[m.groupId] || 0, baseline, readAllAt);
      if (isGroupUnread(m, me.id, seen)) unreadByGroup.set(m.groupId, (unreadByGroup.get(m.groupId) || 0) + 1);
    } else {
      const other = m.fromUserId === me.id ? m.toUserId : m.fromUserId;
      if (!other) continue;
      lastByUser.set(other, m);
      if (isDmUnread(m, me.id, readAllAt)) unreadByUser.set(other, (unreadByUser.get(other) || 0) + 1);
    }
  }
  const out: ChatEntry[] = [];
  for (const g of groups) {
    const last = lastByGroup.get(g.id);
    out.push({
      key: groupKey(g.id), kind: g.devSupport ? "support" : "group", group: g, last,
      lastTs: ts(last?.timestamp), unread: unreadByGroup.get(g.id) || 0,
      name: g.devSupport ? inp.supportName : g.name,
    });
  }
  for (const u of users) {
    if (u.id === me.id) continue;
    const last = lastByUser.get(u.id);
    out.push({ key: userKey(u.id), kind: "dm", user: u, last, lastTs: ts(last?.timestamp), unread: unreadByUser.get(u.id) || 0, name: u.name || "" });
  }
  return out;
}

export function inFolder(e: ChatEntry, f: FolderId): boolean {
  switch (f) {
    case "all": return true;
    case "unread": return e.unread > 0;
    case "groups": return e.kind === "group";
    default: return e.kind === "dm" && !!e.user && ROLE_FOLDER[e.user.role] === f;
  }
}

export type SortMode = "recent" | "unread";

/** Qadalganlar tepada (qadalgan tartibida), keyin — oxirgi xabar / o'qilmagan bo'yicha; xabarsizlar — ism bo'yicha. */
export function sortEntries(list: ChatEntry[], sort: SortMode, pinned: string[]): ChatEntry[] {
  const pinIdx = new Map(pinned.map((k, i) => [k, i]));
  return [...list].sort((a, b) => {
    const pa = pinIdx.get(a.key), pb = pinIdx.get(b.key);
    if (pa !== undefined || pb !== undefined) {
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    }
    if (sort === "unread" && (a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
    if (a.lastTs !== b.lastTs) return b.lastTs - a.lastTs;
    return a.name.localeCompare(b.name);
  });
}

export function matchesQuery(e: ChatEntry, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return e.name.toLowerCase().includes(s) || (e.user?.phone || "").replace(/\s/g, "").includes(s.replace(/\s/g, ""));
}

/** Jild yorlig'idagi son — shu jilddagi o'qilmagan SUHBATLAR soni (Telegram kabi). */
export function folderUnreadChats(list: ChatEntry[], f: FolderId, muted: Set<string>): number {
  let n = 0;
  for (const e of list) if (e.unread > 0 && !muted.has(e.key) && inFolder(e, f)) n++;
  return n;
}

/**
 * Pastki navbar (Chat) belgisi — ro'yxatdagi suhbatlar bilan AYNAN bir xil
 * mantiq: faqat ro'yxatda ko'rinadigan, ovozsiz bo'lmagan suhbatlarning
 * o'qilmagan xabarlari. (Avval xom `messages` sanalardi — o'chirilgan
 * foydalanuvchi/AI xabari ham belgiga tushib, "O'qilmagan" jildi bo'sh edi.)
 */
export function navUnreadCount(list: ChatEntry[], muted: Set<string>): number {
  let n = 0;
  for (const e of list) if (e.unread > 0 && !muted.has(e.key)) n += e.unread;
  return n;
}

// ─── Vaqt (Toshkent) ────────────────────────────────────────────────────────
const TZ = "Asia/Tashkent";
const UZ_WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const locale = (lang: string) => (lang.startsWith("ru") ? "ru-RU" : "uz-UZ");

export function tashkentDayKey(t: number): string {
  try { return new Date(t).toLocaleDateString("en-CA", { timeZone: TZ }); } catch { return new Date(t).toISOString().slice(0, 10); }
}

export function fmtClock(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: TZ }); } catch { return ""; }
}

/** Ro'yxatdagi vaqt: bugun — HH:MM, shu hafta — hafta kuni, eskiroq — kun.oy(.yil). */
export function listTime(t: number, lang: string, now = Date.now()): string {
  if (!t) return "";
  const dk = tashkentDayKey(t);
  if (dk === tashkentDayKey(now)) return fmtClock(new Date(t).toISOString());
  const days = (now - t) / 86_400_000;
  try {
    if (days < 6.5) {
      // Brauzerlarda o'zbekcha lokal ma'lumoti ko'pincha yo'q ("Thu" chiqadi) — o'zimiz
      if (!lang.startsWith("ru")) return UZ_WD[new Date(Date.parse(dk + "T12:00:00Z")).getUTCDay()];
      return new Date(t).toLocaleDateString("ru-RU", { weekday: "short", timeZone: TZ });
    }
    const sameYear = dk.slice(0, 4) === tashkentDayKey(now).slice(0, 4);
    return new Date(t).toLocaleDateString(locale(lang), sameYear ? { day: "2-digit", month: "2-digit", timeZone: TZ } : { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: TZ });
  } catch { return dk; }
}

/** Thread'dagi sana ajratgichi: "Bugun" / "Kecha" / "16 oktyabr" (boshqa yil bo'lsa yil bilan). */
export function dayLabel(t: number, lang: string, tt: (k: string) => string, now = Date.now()): string {
  const dk = tashkentDayKey(t);
  if (dk === tashkentDayKey(now)) return tt("chatUi.today");
  if (dk === tashkentDayKey(now - 86_400_000)) return tt("chatUi.yesterday");
  const sameYear = dk.slice(0, 4) === tashkentDayKey(now).slice(0, 4);
  if (!lang.startsWith("ru")) {
    const [y, mo, d] = dk.split("-").map(Number);
    return `${d}-${UZ_MONTHS[mo - 1]}${sameYear ? "" : ` ${y}`}`;
  }
  try {
    return new Date(t).toLocaleDateString(locale(lang), sameYear ? { day: "numeric", month: "long", timeZone: TZ } : { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
  } catch { return dk; }
}

/** Avatar rangi — ism bo'yicha barqaror (Telegram kabi har xil rang). */
const AVATAR_COLORS = ["#E17076", "#F29D50", "#A695E7", "#7BC862", "#6EC9CB", "#65AADD", "#EE7AAE", "#D4A33B"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
export function initials(name: string): string {
  return (name || "").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}
