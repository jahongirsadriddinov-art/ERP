import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Bell from "@hugeicons/core-free-icons/BellIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import MessageCircle from "@hugeicons/core-free-icons/Message01Icon";
import Package from "@hugeicons/core-free-icons/Package01Icon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import Info from "@hugeicons/core-free-icons/InformationCircleIcon";
import QrCode from "@hugeicons/core-free-icons/QrCodeIcon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import Megaphone from "@hugeicons/core-free-icons/Megaphone01Icon";
import Rocket from "@hugeicons/core-free-icons/Rocket01Icon";
import Building from "@hugeicons/core-free-icons/Building03Icon";
import Computer from "@hugeicons/core-free-icons/ComputerIcon";
import ArrowRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { MorphIcon } from "morphicons/react";
import { motion, AnimatePresence } from "motion/react";
import { API_BASE } from "./api";
import { playSound } from "./sound";
import { AnnouncementContent, type AnnouncementData } from "./AnnouncementParts";
import type { AppUser, Msg, Transfer, Expense } from "./App";

// ─── Bildirishnomalar markazi ────────────────────────────────────────────────
// Ikki bo'lim:
//  • "Firma"  — firmadagi xabarlar, o'tkazma/chiqim tasdiqlari, server bildirishnomalari, firma e'lonlari
//  • "Tizim"  — dasturchidan yangiliklar (global e'lonlar), ilovaning yangi versiyasi, tizim xabarlari
// Qo'ng'iroqcha bosilsa — kichik oyna faqat YANGI (ko'rilmagan)larni ko'rsatadi; pastdagi
// "Hammasini ko'rish" katta panelni ochadi; tepadagi ✓✓ hammasini o'qildi deb belgilaydi.

type Cat = "company" | "system";
interface Item {
  key: string;
  cat: Cat;
  icon: any;
  tone: string; // ikonka foni/rangi
  title: string;
  body: string;
  at?: string;
  read: boolean;
  onOpen?: () => void;
  notifId?: string; // server bildirishnomasi — o'chirish mumkin
  ann?: AnnouncementData;
  release?: { version: string; notes: string };
}

interface ServerNotif { _id: string; type: string; title: string; body: string; url?: string; read: boolean; createdAt: string }

const NOTIF_ICONS: Record<string, any> = {
  message: MessageCircle, transfer: Package, expense: Wallet, approval_request: Clock,
  approval_result: CheckCheck, qr_scan: QrCode, gps: MapPin, system: Info,
};

const LS_DISMISSED = "erp_notif_dismissed";
const LS_RELEASE = "erp_notif_release_seen";
const readLS = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

interface Props {
  messages: Msg[]; transfers: Transfer[]; expenses: Expense[]; users: AppUser[]; currentUser: AppUser;
  onOpenChat: () => void; onOpenDashboard: () => void;
}

export default function NotificationCenter({ messages, transfers, expenses, users, currentUser, onOpenChat, onOpenDashboard }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [tab, setTab] = useState<Cat>("company");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [serverNotifs, setServerNotifs] = useState<ServerNotif[]>([]);
  const [anns, setAnns] = useState<AnnouncementData[]>([]);
  const [release, setRelease] = useState<{ version: string; notes: string; updatedAt?: string } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(readLS(LS_DISMISSED).split("|").filter(Boolean)));
  const [releaseSeen, setReleaseSeen] = useState(() => readLS(LS_RELEASE));
  const ref = useRef<HTMLDivElement>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const timeAgo = (iso?: string) => {
    if (!iso) return "";
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return t("notifications.justNow");
    if (m < 60) return t("notifications.minutesAgo", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("notifications.hoursAgo", { count: h });
    return t("notifications.daysAgo", { count: Math.floor(h / 24) });
  };

  const load = useCallback(async () => {
    if (!token) return;
    const [n, a, r] = await Promise.allSettled([
      fetch(`${API_BASE}/api/notifications?limit=50`, { headers: auth }).then(x => x.ok ? x.json() : null),
      fetch(`${API_BASE}/api/announcements`, { headers: auth }).then(x => x.ok ? x.json() : null),
      fetch(`${API_BASE}/api/deploy/latest`).then(x => x.ok ? x.json() : null),
    ]);
    if (n.status === "fulfilled" && n.value?.notifications) setServerNotifs(n.value.notifications);
    if (a.status === "fulfilled" && Array.isArray(a.value)) setAnns(a.value);
    if (r.status === "fulfilled" && r.value?.available) setRelease({ version: r.value.version, notes: r.value.notes || "", updatedAt: r.value.updatedAt });
  }, [token, auth]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 90_000);
    return () => clearInterval(iv);
  }, [load]);
  useEffect(() => { if (open || full) load(); }, [open, full, load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  // ── Barcha elementlarni bitta ro'yxatga yig'ish ─────────────────────────────
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    // Firmadagi o'qilmagan chat xabarlari (yuboruvchi bo'yicha guruhlangan)
    const unread = messages.filter(m => m.toUserId === currentUser.id && !m.read && !m.deleted);
    const bySender: Record<string, { count: number; last: Msg }> = {};
    for (const m of unread) {
      const cur = bySender[m.fromUserId];
      if (!cur) bySender[m.fromUserId] = { count: 1, last: m };
      else { cur.count++; if (new Date(m.timestamp) > new Date(cur.last.timestamp)) cur.last = m; }
    }
    for (const [uid, g] of Object.entries(bySender)) {
      const key = `msg:${uid}:${g.last.id}`;
      const sender = users.find(u => u.id === uid);
      out.push({
        key, cat: "company", icon: MessageCircle, tone: "bg-sky-500/15 text-sky-500",
        title: sender?.name || t("chat.notifFrom"),
        body: g.count > 1 ? t("chat.notifNewMessages", { count: g.count }) : (g.last.type && g.last.type !== "text" ? t("chat.notifMediaMessage") : (g.last.text || t("chat.notifNewMessage"))),
        at: g.last.timestamp, read: dismissed.has(key), onOpen: onOpenChat,
      });
    }
    for (const tr of transfers.filter(x => x.toUserId === currentUser.id && x.status === "pending")) {
      const key = `tr:${tr.id}`;
      out.push({ key, cat: "company", icon: Package, tone: "bg-amber-500/15 text-amber-500", title: t("chat.notifNewTransfer"),
        body: `${tr.fromUserName || t("chat.notifFrom")}${t("chat.notifPendingApproval")}`, at: (tr as any).date || (tr as any).createdAt, read: dismissed.has(key), onOpen: onOpenDashboard });
    }
    for (const e of expenses.filter((x: any) => x.toUserId === currentUser.id && x.status === "pending") as any[]) {
      const key = `ex:${e.id}`;
      out.push({ key, cat: "company", icon: Wallet, tone: "bg-emerald-500/15 text-emerald-500", title: t("chat.notifExpenseApproval"),
        body: t("chat.notifNeedApproval"), at: e.date || e.createdAt, read: dismissed.has(key), onOpen: onOpenDashboard });
    }
    for (const n of serverNotifs) {
      const sys = n.type === "system";
      out.push({ key: `n:${n._id}`, cat: sys ? "system" : "company", icon: NOTIF_ICONS[n.type] || Info,
        tone: sys ? "bg-violet-500/15 text-violet-500" : "bg-primary/15 text-primary",
        title: n.title, body: n.body, at: n.createdAt, read: n.read, notifId: n._id });
    }
    for (const a of anns) {
      out.push({ key: `a:${a.id}`, cat: a.isGlobal ? "system" : "company", icon: a.isGlobal ? Megaphone : Building,
        tone: a.isGlobal ? "bg-fuchsia-500/15 text-fuchsia-500" : "bg-orange-500/15 text-orange-500",
        title: a.title, body: a.body, at: a.createdAt, read: !!a.seen, ann: a });
    }
    if (release?.version) {
      out.push({ key: `rel:${release.version}`, cat: "system", icon: Rocket, tone: "bg-indigo-500/15 text-indigo-500",
        title: `${t("update.newVersion", "Yangi versiya")} ${release.version}`,
        body: release.notes || t("update.newVersionBody", "Ilova yangilandi — yangi imkoniyatlar va tuzatishlar"),
        at: release.updatedAt, read: releaseSeen === release.version, release: { version: release.version, notes: release.notes } });
    }
    return out.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
  }, [messages, transfers, expenses, users, currentUser.id, serverNotifs, anns, release, dismissed, releaseSeen, t, onOpenChat, onOpenDashboard]);

  const unreadOf = (c: Cat) => items.filter(i => i.cat === c && !i.read).length;
  const unreadTotal = unreadOf("company") + unreadOf("system");

  // Yangi bildirishnoma kelganda (son oshganda) tovush — birinchi yuklanishda emas
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevRef.current !== null && unreadTotal > prevRef.current) playSound("notification");
    prevRef.current = unreadTotal;
  }, [unreadTotal]);

  // Ochilganda — yangisi bor bo'limga o'tish
  useEffect(() => {
    if (open && unreadOf(tab) === 0 && unreadOf(tab === "company" ? "system" : "company") > 0) setTab(tab === "company" ? "system" : "company");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const markRead = (it: Item) => {
    if (it.read) return;
    if (it.notifId) {
      setServerNotifs(p => p.map(n => n._id === it.notifId ? { ...n, read: true } : n));
      fetch(`${API_BASE}/api/notifications/${it.notifId}/read`, { method: "PATCH", headers: auth }).catch(() => {});
    } else if (it.ann) {
      setAnns(p => p.map(a => a.id === it.ann!.id ? { ...a, seen: true } : a));
      fetch(`${API_BASE}/api/announcements/${it.ann.id}/seen`, { method: "POST", headers: auth }).catch(() => {});
    } else if (it.release) {
      setReleaseSeen(it.release.version); writeLS(LS_RELEASE, it.release.version);
    } else {
      setDismissed(p => { const s = new Set(p); s.add(it.key); writeLS(LS_DISMISSED, [...s].slice(-300).join("|")); return s; });
    }
  };

  const markAllRead = () => {
    const unread = items.filter(i => !i.read);
    if (!unread.length) return;
    if (unread.some(i => i.notifId)) {
      setServerNotifs(p => p.map(n => ({ ...n, read: true })));
      fetch(`${API_BASE}/api/notifications/read-all`, { method: "PATCH", headers: auth }).catch(() => {});
    }
    for (const it of unread) if (!it.notifId) markRead(it);
    setDismissed(p => { const s = new Set(p); unread.filter(i => !i.notifId && !i.ann && !i.release).forEach(i => s.add(i.key)); writeLS(LS_DISMISSED, [...s].slice(-300).join("|")); return s; });
  };

  const remove = (it: Item) => {
    if (!it.notifId) return;
    setServerNotifs(p => p.filter(n => n._id !== it.notifId));
    fetch(`${API_BASE}/api/notifications/${it.notifId}`, { method: "DELETE", headers: auth }).catch(() => {});
  };

  const activate = (it: Item, inFull: boolean) => {
    markRead(it);
    if (it.onOpen) { it.onOpen(); setOpen(false); setFull(false); return; }
    // E'lon/versiya/tizim xabari — to'liq matni katta panelda ochiladi
    if (!inFull) { setOpen(false); setFull(true); setTab(it.cat); }
    setExpanded(e => (e === it.key && inFull ? null : it.key));
  };

  const renderTabs = (big?: boolean) => (
    <div className={`grid grid-cols-2 gap-1 p-1 rounded-2xl bg-foreground/[0.06] ${big ? "mx-5" : "mx-3"}`}>
      {(["company", "system"] as Cat[]).map(c => {
        const n = unreadOf(c);
        const active = tab === c;
        return (
          <button key={c} onClick={() => setTab(c)}
            className={`relative flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold liquid-transition ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <MorphIcon icon={c === "company" ? Building : Computer} className="w-3.5 h-3.5" />
            <span className="whitespace-nowrap">{c === "company" ? t("notifications.tabCompany") : t("notifications.tabSystem")}</span>
            {n > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-[18px] text-center">{n > 99 ? "99+" : n}</span>}
          </button>
        );
      })}
    </div>
  );

  const renderRow = (it: Item, big?: boolean) => {
    const isOpen = big && expanded === it.key;
    return (
      <motion.div key={it.key} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}
        className={`group relative rounded-2xl border liquid-transition ${it.read ? "border-transparent bg-transparent hover:bg-foreground/[0.04]" : "border-primary/15 bg-primary/[0.06] hover:bg-primary/[0.09]"}`}>
        <button onClick={() => activate(it, !!big)} className="w-full flex items-start gap-3 p-3 text-left">
          <span className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${it.tone}`}>
            <MorphIcon icon={it.icon} className="w-[18px] h-[18px]" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className={`text-[13px] leading-snug truncate ${it.read ? "font-medium text-foreground/75" : "font-bold text-foreground"}`}>{it.title}</span>
              {!it.read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 shadow-[0_0_0_3px_rgba(0,0,0,0.04)]" />}
            </span>
            {!isOpen && <span className="block text-xs text-muted-foreground line-clamp-2 mt-0.5 break-words">{it.body}</span>}
            <span className="block text-[10.5px] text-muted-foreground/70 mt-1">{timeAgo(it.at)}</span>
          </span>
          {it.onOpen && <MorphIcon icon={ArrowRight} className="w-4 h-4 text-muted-foreground/60 mt-3 flex-shrink-0" />}
        </button>
        {isOpen && (
          <div className="px-3 pb-3 -mt-1 pl-[3.75rem]">
            {it.ann ? <AnnouncementContent a={it.ann} /> : <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words">{it.body}</p>}
          </div>
        )}
        {big && it.notifId && (
          <button onClick={() => remove(it)} aria-label={t("notifications.delete")} title={t("notifications.delete")}
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 liquid-transition">
            <MorphIcon icon={Trash2} className="w-4 h-4" />
          </button>
        )}
      </motion.div>
    );
  };

  const tabItems = items.filter(i => i.cat === tab);
  const newItems = tabItems.filter(i => !i.read);
  const markAllBtn = () => (
    <button onClick={markAllRead} disabled={unreadTotal === 0} title={t("notifications.markAllRead")} aria-label={t("notifications.markAllRead")}
      className="w-9 h-9 rounded-xl flex items-center justify-center text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-35 disabled:bg-transparent disabled:text-muted-foreground liquid-transition">
      <MorphIcon icon={CheckCheck} className="w-[18px] h-[18px]" />
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} title={t("notifications.title")} aria-label={t("notifications.title")}
        className="btn btn-ghost w-9 h-9 p-0 rounded-full relative">
        <MorphIcon icon={Bell} className="w-[18px] h-[18px]" />
        {unreadTotal > 0 && (
          <span className="badge-pulse absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-accent text-accent-foreground rounded-full text-[9px] flex items-center justify-center font-bold shadow-sm">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {/* Kichik oyna — faqat yangilari */}
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="notif-glass fixed left-3 right-3 top-[max(4.25rem,env(safe-area-inset-top))] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[370px] rounded-3xl z-50 overflow-hidden text-foreground">
              <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
                <div className="min-w-0">
                  <p className="text-[15px] font-extrabold tracking-tight">{t("notifications.title")}</p>
                  <p className="text-[11px] text-muted-foreground">{t("notifications.newOnes")} · {unreadTotal}</p>
                </div>
                {markAllBtn()}
              </div>
              {renderTabs()}
              <div className="max-h-[min(22rem,55vh)] overflow-y-auto overscroll-contain px-2 py-2 space-y-1">
                <AnimatePresence initial={false}>
                  {newItems.slice(0, 6).map(it => renderRow(it))}
                </AnimatePresence>
                {newItems.length === 0 && (
                  <div className="text-center py-9">
                    <div className="w-12 h-12 rounded-2xl bg-foreground/[0.05] mx-auto mb-2.5 flex items-center justify-center text-muted-foreground/60"><MorphIcon icon={Bell} className="w-6 h-6" /></div>
                    <p className="text-xs font-semibold text-muted-foreground">{t("notifications.noNew")}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 px-6">{tab === "system" ? t("notifications.systemHint") : t("notifications.companyHint")}</p>
                  </div>
                )}
              </div>
              <button onClick={() => { setOpen(false); setFull(true); }}
                className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-primary border-t border-foreground/[0.07] hover:bg-primary/[0.06] liquid-transition">
                {t("notifications.seeAll")}{newItems.length > 6 ? ` (+${newItems.length - 6})` : ""}
                <MorphIcon icon={ArrowRight} className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Katta panel — hammasi */}
      {createPortal(
        <AnimatePresence>
          {full && (
            <motion.div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setFull(false)} />
              <motion.div role="dialog" aria-modal="true" aria-label={t("notifications.title")}
                initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 360, damping: 34 }}
                className="notif-glass relative w-full sm:max-w-2xl h-[88vh] sm:h-[80vh] rounded-t-[28px] sm:rounded-[28px] flex flex-col overflow-hidden text-foreground"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
                <div className="sm:hidden w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mt-2.5" />
                <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
                  <div className="min-w-0">
                    <p className="text-lg font-extrabold tracking-tight">{t("notifications.title")}</p>
                    <p className="text-xs text-muted-foreground truncate">{tab === "system" ? t("notifications.systemHint") : t("notifications.companyHint")}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {markAllBtn()}
                    <button onClick={() => setFull(false)} aria-label={t("common.close", "Yopish")}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07] liquid-transition">
                      <MorphIcon icon={X} className="w-[18px] h-[18px]" />
                    </button>
                  </div>
                </div>
                {renderTabs(true)}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3 space-y-1.5">
                  <AnimatePresence initial={false}>
                    {tabItems.map(it => renderRow(it, true))}
                  </AnimatePresence>
                  {tabItems.length === 0 && (
                    <div className="text-center py-16">
                      <div className="w-14 h-14 rounded-2xl bg-foreground/[0.05] mx-auto mb-3 flex items-center justify-center text-muted-foreground/60"><MorphIcon icon={Bell} className="w-7 h-7" /></div>
                      <p className="text-sm font-semibold text-muted-foreground">{t("notifications.empty")}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
