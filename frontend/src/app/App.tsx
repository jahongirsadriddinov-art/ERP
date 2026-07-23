import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import {
  Building2, Users, HardHat, Package, Plus, ArrowLeft,
  CheckCircle, Clock, AlertTriangle, ChevronRight, MapPin,
  Phone, User, X, Check, Download, BarChart2,
  DollarSign, MessageCircle, ChevronDown, ChevronUp, Send,
  TrendingDown, Wallet, LogOut, Camera, Home, UserPlus, Edit, Trash, Search, AlertCircle, ChevronLeft, Loader2, Paperclip, Mic, Video as VideoIcon, Image as ImageIcon, FileText, CornerDownLeft, Share2, SquareCheck, Trash2, MoreHorizontal, Upload, Palette, Sun, Moon, Monitor, PhoneOff, MicOff, VideoOff, Users2, Copy, Bell, Pin, PinOff, CheckCheck, Languages
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { API_BASE, parseSmetaFile, uploadChatMedia } from "./api";
import { connectSocket, getSocket, disconnectSocket } from "./socket";
import { motion, AnimatePresence } from "motion/react";
import { setSiteLanguage, SiteLang, langLabel } from "./i18n";
import LanguageSwitcher from "./i18n/LanguageSwitcher";

// recharts og'ir kutubxona — faqat "Hisobotlar" bo'limiga kirilganda yuklanadi
// (boshlang'ich bundle hajmini kamaytiradi, sayt tezroq ochiladi).
const ReportsPage = lazy(() => import("./ReportsPage"));
// Kamdan-kam ishlatiladigan (rol/hodisaga bog'liq) og'ir sahifalar — faqat
// chindan kerak bo'lganda yuklanadi (unused JS ni kamaytiradi).
const CallOverlay = lazy(() => import("./CallOverlay"));
const RegisterWizard = lazy(() => import("./RegisterWizard"));
const DeveloperPanel = lazy(() => import("./DeveloperPanel"));
const AIAssistant = lazy(() => import("./AIAssistant"));

// ─── Mobil pastki navbar ko'rinishini boshqarish ────────────────────────────────
// Katta (ekranning pastigacha yetadigan) modallar ochilganda floating pastki
// navbar orqadan "ko'rinib qolmasligi" uchun — istalgan chuqurlikdagi modal
// komponenti `useModalPresence()`ni chaqirsa yetarli, prop-drilling shart emas.
let openModalCount = 0;
const modalListeners = new Set<(open: boolean) => void>();
function notifyModalListeners() { modalListeners.forEach(l => l(openModalCount > 0)); }
function useAnyBigModalOpen() {
  const [open, setOpen] = useState(openModalCount > 0);
  useEffect(() => {
    modalListeners.add(setOpen);
    return () => { modalListeners.delete(setOpen); };
  }, []);
  return open;
}
export function useModalPresence() {
  useEffect(() => {
    openModalCount++; notifyModalListeners();
    return () => { openModalCount--; notifyModalListeners(); };
  }, []);
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type Role = "direktor" | "orinbosar" | "prorab" | "brigadir" | "ishchi" | "dasturchi";
type NavPage = "dashboard" | "finance" | "reports" | "chat" | "profile";
export type ExpType = "oylik" | "material" | "jihozlar" | "transport" | "boshqa";
type TStatus = "pending" | "confirmed" | "rejected";
type EStatus = "pending" | "confirmed";

export interface AppUser {
  id: string; name: string; role: Role; phone: string;
  avatar?: string; brigade?: string; projectIds: string[];
  isOwner?: boolean; companyId?: string; language?: SiteLang;
}
export interface Project {
  id: string; name: string; location: string; foremanId: string;
  startDate: string; status: "active" | "paused" | "completed";
  budget: number; pdfFile?: string; requiredMaterials: ReqMat[];
  smeta?: SmetaResult; // deterministik parser natijasi (barcha bo'limlar)
}
interface ReqMat { id: string; name: string; quantity: number;  unit: string;
  category: string;
  price?: number;
}
interface Transfer {
  id: string; materialName: string; quantity: number; unit: string;
  fromUserId: string; toUserId: string; projectId: string;
  sentDate: string; status: TStatus; confirmedDate?: string;
  note?: string; defect?: string;
  date?: string;
  fromUserName?: string;
  price?: number; // yuboruvchi kiritgan birlik narxi (so'm) — tasdiqlanganda chiqim shundan hisoblanadi
}
export interface Expense {
  id: string; type: ExpType; amount: number; toUserId?: string;
  projectId: string; description: string; date: string;
  status: EStatus; createdById: string; confirmedById?: string;
}
export interface Msg {
  id: string; fromUserId: string; toUserId: string; groupId?: string;
  text: string; timestamp: string; read: boolean;
  type?: 'text'|'image'|'video'|'file'|'audio'|'location';
  mediaUrl?: string; fileName?: string; fileSize?: number;
  location?: { lat: number; lng: number };
  replyToId?: string; edited?: boolean; pinned?: boolean; deleted?: boolean;
}
interface Group {
  id: string; name: string; avatar?: string;
  memberIds: string[]; adminIds: string[]; createdBy: string;
  devSupport?: boolean;
}
export interface ActiveCall {
  direction: 'out'|'in';
  mode: 'voice'|'video';
  peerId?: string;       // 1:1 (yoki incoming'da chaqiruvchi)
  groupId?: string;      // guruh qo'ng'irog'i
  memberIds?: string[];  // guruhda chaqiriladigan a'zolar
  offer?: any;           // incoming SDP offer
  fromName?: string;
}

// ─── Smeta (deterministik parser natijasi — POST /api/smeta/parse) ─────────────
interface SmetaResourceRow { index:number; shifr:string|null; shifrNote:string|null; rawName:string; shortName:string; unit:string; qty:number; price:number|null; total:number|null; group:string; category?:string; warnings:string[]; }
interface SmetaNormRow { index:string; shifr:string|null; name:string; unit:string; perUnit:number; byProject:number; }
interface SmetaWorkRow { index:number; shifr:string|null; shifrNote:string|null; name:string; unit:string; volume:number|null; section:string|null; norms:SmetaNormRow[]; warnings:string[]; }
interface SmetaGroupTotal { group:string; declared:number; computed:number; diff:number; passed:boolean; }
interface SmetaResult { meta:any; resources:SmetaResourceRow[]; works:SmetaWorkRow[]; totals:SmetaGroupTotal[]; validation:{ok:boolean; checks:any[]; warnings:string[]; errors:string[]}; }

const SMETA_GROUP_LABEL: Record<string,string> = {
  labor:"Трудовые ресурсы", general:"Ресурсы общего назначения", machinery:"Строительные машины",
  material:"Материальные ресурсы", equipment:"Оборудование",
};
const SMETA_GROUP_ORDER = ["labor","general","machinery","material","equipment"];

// To'liq aniqlik — HECH NIMANI YAXLITLAMAYDI (kasr, tiyin, manfiy saqlanadi). null → "-".
function fmtNum(n: number|null|undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  const neg = n < 0; const abs = Math.abs(n);
  let s = abs.toString();
  if (s.includes("e")) s = abs.toFixed(12).replace(/0+$/,"").replace(/\.$/,"");
  const [int, dec] = s.split(".");
  const intF = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg?"-":"") + intF + (dec ? "," + dec : "");
}

// ─── Constants ────────────────────────────────────────────────────────────────
export const ROLE_LABELS: Record<Role, string> = {
  direktor: "Direktor", orinbosar: "O'rinbosar",
  prorab: "Prorab", brigadir: "Brigadir", ishchi: "Ishchi", dasturchi: "Dasturchi"
};
const ROLE_COLORS: Record<Role, string> = {
  direktor: "bg-red-500/15 text-red-700 dark:text-red-300",
  orinbosar: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  prorab: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  brigadir: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  ishchi: "bg-green-500/15 text-green-800 dark:text-green-300",
  dasturchi: "bg-slate-800/15 text-slate-700 dark:text-slate-200"
};
export const EXP_LABELS: Record<ExpType, string> = {
  oylik: "Oylik", material: "Material",
  jihozlar: "Jihozlar", transport: "Transport", boshqa: "Boshqa"
};
export const CHART_COLORS = ["#1B3A6B", "#D2440F", "#1B7A4B", "#F0A500", "#7B2D8B"];
export const fmt = (n?: number) => (n || 0).toLocaleString("uz-UZ") + " so'm";

// CSV eksport — Excel'da to'g'ridan-to'g'ri ochiladi. Uchinchi tomon xlsx
// kutubxonasi ATAYLAB ishlatilmadi (npm'dagi "xlsx" paketida tuzatilmagan
// xavfsizlik zaifligi bor — prototype pollution/ReDoS, hech qanday fix yo'q).
// CSV hech qanday tashqi kodsiz, xavfsiz va Excel/Google Sheets/LibreOffice
// hammasida bir xil ochiladi. BOM — Excel'da o'zbek/rus harflari to'g'ri
// (krakozyabra bo'lmasdan) ko'rinishi uchun shart.
function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map(r => r.map(csvCell).join(";"));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
export function exportExpensesToCsv(expenses: Expense[], users: AppUser[], projects: Project[], filename: string) {
  const headers = ["Sana", "Tavsif", "Turi", "Kimga", "Obyekt", "Summa (so'm)", "Holati", "Kim qo'shdi", "Kim tasdiqladi"];
  const rows = expenses.map(e => {
    const to = users.find(u => u.id === e.toUserId);
    const proj = projects.find(p => p.id === e.projectId);
    const creator = users.find(u => u.id === e.createdById);
    const confirmer = users.find(u => u.id === e.confirmedById);
    return [
      e.date, e.description || EXP_LABELS[e.type], EXP_LABELS[e.type],
      to?.name || "-", proj?.name || "-", e.amount,
      e.status === "confirmed" ? "Tasdiqlangan" : "Kutilmoqda",
      creator?.name || "-", confirmer?.name || "-",
    ];
  });
  downloadCsv(filename, headers, rows);
}
export const isAdmin = (r: Role) => r === "direktor" || r === "orinbosar" || r === "dasturchi";
const DEV_PHONE = "+998900960890"; // dasturchi raqami — parol bilan kiradi (Telegram kod emas)

// ─── Seed Data ────────────────────────────────────────────────────────────────
const SEED_USERS: AppUser[] = [
  { id: "u1", name: "Karimov Bobur", role: "direktor", phone: "+998901001111", projectIds: ["p1","p2","p3"] },
  { id: "u2", name: "Toshmatov Sardor", role: "orinbosar", phone: "+998912002222", projectIds: ["p1","p2","p3"] },
  { id: "u3", name: "Rahimov Ulugbek", role: "prorab", phone: "+998903003333", brigade: "1-Brigada", projectIds: ["p1","p3"] },
  { id: "u4", name: "Nazarov Sherzod", role: "prorab", phone: "+998904004444", brigade: "2-Brigada", projectIds: ["p2"] },
  { id: "u5", name: "Yusupov Anvar", role: "brigadir", phone: "+998935005555", brigade: "1-Brigada", projectIds: ["p1"] },
  { id: "u6", name: "Xasanov Lochin", role: "brigadir", phone: "+998936006666", brigade: "2-Brigada", projectIds: ["p2"] },
  { id: "u7", name: "Abdullayev Muxammad", role: "ishchi", phone: "+998977007777", brigade: "1-Brigada", projectIds: ["p1"] },
  { id: "u8", name: "Sotvoldiyev Sarvar", role: "ishchi", phone: "+998978008888", brigade: "1-Brigada", projectIds: ["p1"] },
  { id: "u9", name: "Razzaqov Doniyor", role: "ishchi", phone: "+998979009999", brigade: "2-Brigada", projectIds: ["p2"] },
  { id: "u10", name: "Qurbonov Jasur", role: "ishchi", phone: "+998971001010", brigade: "2-Brigada", projectIds: ["p2"] },
];
const SEED_PROJECTS: Project[] = [
  { id: "p1", name: "Yunusobod 15-mavze", location: "Toshkent, Yunusobod", foremanId: "u3",
    startDate: "2026-03-15", status: "active", budget: 850000000, pdfFile: "yunusobod.pdf",
    requiredMaterials: [
      { id: "m1", name: "G'isht M-150", quantity: 50000, unit: "dona", category: "Qurilish" },
      { id: "m2", name: "Tsement M-400", quantity: 200, unit: "qop", category: "Qurilish" },
      { id: "m3", name: "Armatura 12mm", quantity: 5000, unit: "kg", category: "Metal" },
    ]},
  { id: "p2", name: "Sergeli savdo markazi", location: "Toshkent, Sergeli", foremanId: "u4",
    startDate: "2026-01-20", status: "active", budget: 1200000000, pdfFile: "sergeli.pdf",
    requiredMaterials: [
      { id: "m4", name: "Beton konstruksiya", quantity: 120, unit: "dona", category: "Konstruksiya" },
      { id: "m5", name: "Oyna 6mm", quantity: 400, unit: "m²", category: "Qurilish" },
    ]},
  { id: "p3", name: "Chilonzor ko'p qavatli", location: "Toshkent, Chilonzor", foremanId: "u3",
    startDate: "2026-05-01", status: "paused", budget: 600000000,
    requiredMaterials: [
      { id: "m6", name: "G'isht M-200", quantity: 100000, unit: "dona", category: "Qurilish" },
    ]},
];
const SEED_TRANSFERS: Transfer[] = [
  { id: "t1", materialName: "G'isht M-150", quantity: 20000, unit: "dona", fromUserId: "u2", toUserId: "u3", projectId: "p1", sentDate: "2026-06-10", status: "confirmed", confirmedDate: "2026-06-11" },
  { id: "t2", materialName: "Tsement M-400", quantity: 80, unit: "qop", fromUserId: "u2", toUserId: "u3", projectId: "p1", sentDate: "2026-06-15", status: "pending" },
  { id: "t3", materialName: "Beton konstruksiya", quantity: 50, unit: "dona", fromUserId: "u4", toUserId: "u6", projectId: "p2", sentDate: "2026-06-12", status: "confirmed", confirmedDate: "2026-06-14", defect: "3 ta konstruksiyada yoriq" },
  { id: "t4", materialName: "Oyna 6mm", quantity: 100, unit: "m²", fromUserId: "u4", toUserId: "u6", projectId: "p2", sentDate: "2026-06-20", status: "pending" },
  { id: "t5", materialName: "Armatura 12mm", quantity: 2000, unit: "kg", fromUserId: "u3", toUserId: "u5", projectId: "p1", sentDate: "2026-06-21", status: "pending" },
];
const SEED_EXPENSES: Expense[] = [
  { id: "e1", type: "oylik", amount: 5000000, toUserId: "u3", projectId: "p1", description: "Iyun oyligi – Prorab Rahimov", date: "2026-06-01", status: "confirmed", createdById: "u1", confirmedById: "u3" },
  { id: "e2", type: "oylik", amount: 3500000, toUserId: "u5", projectId: "p1", description: "Iyun oyligi – Brigadir Yusupov", date: "2026-06-01", status: "confirmed", createdById: "u1", confirmedById: "u5" },
  { id: "e3", type: "oylik", amount: 2500000, toUserId: "u7", projectId: "p1", description: "Iyun oyligi – Abdullayev", date: "2026-06-01", status: "pending", createdById: "u1" },
  { id: "e4", type: "oylik", amount: 2500000, toUserId: "u8", projectId: "p1", description: "Iyun oyligi – Sotvoldiyev", date: "2026-06-01", status: "pending", createdById: "u1" },
  { id: "e5", type: "material", amount: 45000000, projectId: "p1", description: "G'isht M-150 xarid (20,000 dona)", date: "2026-06-10", status: "confirmed", createdById: "u2" },
  { id: "e6", type: "material", amount: 12000000, projectId: "p2", description: "Beton konstruksiya xarid", date: "2026-06-12", status: "confirmed", createdById: "u2" },
  { id: "e7", type: "oylik", amount: 5000000, toUserId: "u4", projectId: "p2", description: "Iyun oyligi – Prorab Nazarov", date: "2026-06-01", status: "confirmed", createdById: "u1", confirmedById: "u4" },
  { id: "e8", type: "transport", amount: 2800000, projectId: "p1", description: "Material tashish (yuk mashina)", date: "2026-06-15", status: "confirmed", createdById: "u2" },
  { id: "e9", type: "jihozlar", amount: 8500000, projectId: "p2", description: "Arra va burg'u jihozlar", date: "2026-06-18", status: "confirmed", createdById: "u2" },
  { id: "e10", type: "boshqa", amount: 1200000, projectId: "p3", description: "Loyiha hujjatlari", date: "2026-06-05", status: "confirmed", createdById: "u1" },
];
const SEED_MSGS: Msg[] = [
  { id: "msg1", fromUserId: "u3", toUserId: "u1", text: "Direktor, Yunusobod obyektida tsement tugay deyapti", timestamp: "2026-06-22T09:00:00", read: false },
  { id: "msg2", fromUserId: "u1", toUserId: "u3", text: "Yaxshi, bugun yuboritaman", timestamp: "2026-06-22T09:15:00", read: true },
  { id: "msg3", fromUserId: "u5", toUserId: "u3", text: "Prorab, armatura qachon keladi?", timestamp: "2026-06-22T10:30:00", read: false },
  { id: "msg4", fromUserId: "u4", toUserId: "u2", text: "O'rinbosar, Sergeli obyektida oyna kerak", timestamp: "2026-06-22T08:00:00", read: false },
];

// ─── Small Components ─────────────────────────────────────────────────────────
function Avatar({ user, size = "md" }: { user: AppUser; size?: "sm"|"md"|"lg" }) {
  const sz = { sm: "w-7 h-7 text-sm md:text-xs", md: "w-9 h-9 text-sm md:text-xs", lg: "w-16 h-16 text-xl" }[size];
  if (user.avatar) return <img src={user.avatar} alt={user.name} className={`${sz} rounded-full object-cover flex-shrink-0`}/>;
  const initials = user.name.split(" ").map(w => w[0]).slice(0,2).join("");
  return (
    <div className={`${sz} rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary dark:text-white flex-shrink-0 select-none`}>
      {initials}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>;
}

// ─── Notification Bell (liquid-glass dropdown, real data) ─────────────────────
function timeAgoShort(iso?: string): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "hozir";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}s`;
  return `${Math.floor(h / 24)}k`;
}

function NotificationBell({ messages, transfers, expenses, users, currentUser, onOpenChat, onOpenDashboard }:
  { messages: Msg[]; transfers: Transfer[]; expenses: Expense[]; users: AppUser[]; currentUser: AppUser;
    onOpenChat: () => void; onOpenDashboard: () => void; }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const unread = messages.filter(m => m.toUserId === currentUser.id && !m.read && !m.deleted);
  const bySender = Object.values(unread.reduce((acc: Record<string, { userId: string; count: number; last: Msg }>, m) => {
    const cur = acc[m.fromUserId];
    if (!cur) acc[m.fromUserId] = { userId: m.fromUserId, count: 1, last: m };
    else { cur.count++; if (new Date(m.timestamp) > new Date(cur.last.timestamp)) cur.last = m; }
    return acc;
  }, {}));
  const pendingTransfers = transfers.filter(t => t.toUserId === currentUser.id && t.status === "pending");
  const pendingExpenses = expenses.filter((e: any) => e.toUserId === currentUser.id && e.status === "pending");
  const badgeCount = unread.length + pendingTransfers.length + pendingExpenses.length;
  const hasAny = bySender.length + pendingTransfers.length + pendingExpenses.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} title="Bildirishnomalar"
        className="btn btn-ghost w-9 h-9 p-0 rounded-full relative">
        <Bell className="w-[18px] h-[18px]"/>
        {badgeCount > 0 && (
          <span className="badge-pulse absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-accent text-accent-foreground rounded-full text-[9px] flex items-center justify-center font-bold shadow-sm">{badgeCount}</span>
        )}
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden z-50 liquid-glass">
          <div className="px-4 py-3 border-b border-white/10"><p className="text-sm font-bold text-white">Bildirishnomalar</p></div>
          <div className="max-h-80 overflow-y-auto scrollbar-hide divide-y divide-white/5">
            {!hasAny && <p className="text-center text-xs text-white/50 py-8">Bildirishnoma yo'q</p>}
            {bySender.map(u => {
              const sender = users.find(x => x.id === u.userId);
              return (
                <button key={u.userId} onClick={() => { onOpenChat(); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left transition-colors">
                  <div className="w-9 h-9 rounded-full bg-primary/25 text-primary flex items-center justify-center flex-shrink-0"><MessageCircle className="w-4 h-4"/></div>
                  <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-white truncate">{sender?.name || "Foydalanuvchi"}</p><p className="text-[11px] text-white/60 truncate">{u.count > 1 ? `${u.count} ta yangi xabar` : (u.last.type && u.last.type !== "text" ? "📎 Media xabar" : (u.last.text || "Yangi xabar"))}</p></div>
                  <span className="text-[10px] text-white/40 flex-shrink-0">{timeAgoShort(u.last.timestamp)}</span>
                </button>
              );
            })}
            {pendingTransfers.map(t => (
              <button key={t.id} onClick={() => { onOpenDashboard(); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left transition-colors">
                <div className="w-9 h-9 rounded-full bg-amber-500/25 text-amber-300 flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4"/></div>
                <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-white">Yangi o'tkazma</p><p className="text-[11px] text-white/60 truncate">{t.fromUserName || "Xodim"}dan tasdiq kutilmoqda</p></div>
              </button>
            ))}
            {pendingExpenses.map((e: any) => (
              <button key={e.id} onClick={() => { onOpenDashboard(); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left transition-colors">
                <div className="w-9 h-9 rounded-full bg-green-500/25 text-green-300 flex items-center justify-center flex-shrink-0"><Wallet className="w-4 h-4"/></div>
                <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-white">Chiqim tasdiqlash</p><p className="text-[11px] text-white/60 truncate">Sizning tasdiqingiz kerak</p></div>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Add User Modal ────────────────────────────────────────────────────────────
function AddUserModal({ currentUser, users, projects, onClose, onAdd }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; onClose: () => void; onAdd: (u: AppUser) => Promise<{ ok: boolean; error?: string }> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "", phone: "+998 ", role: "ishchi" as Role,
    brigade: currentUser.brigade ?? "", newBrigade: "", projectIds: [] as string[]
  });
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Role options based on who's adding
  const allowedRoles: Role[] = currentUser.role === "brigadir"
    ? ["ishchi"]
    : currentUser.role === "prorab"
    ? ["brigadir", "ishchi"]
    : ["orinbosar", "prorab", "brigadir", "ishchi"];

  const brigades = [...new Set(users.filter(u => u.brigade).map(u => u.brigade!))];
  if (currentUser.brigade && !brigades.includes(currentUser.brigade)) brigades.push(currentUser.brigade);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = form.phone.replace(/\D/g, "");
    if (phone.length < 9) { setErr(t('addUser.phoneInvalid')); return; }
    if (!form.name.trim()) { setErr(t('addUser.nameRequired')); return; }
    if (users.find(u => u.phone.replace(/\D/g,"") === phone)) { setErr(t('addUser.phoneTaken')); return; }

    const newUser: AppUser = {
      id: `u${Date.now()}`,
      name: form.name.trim(),
      phone: form.phone,
      role: form.role,
      brigade: (form.role === "brigadir" || form.role === "ishchi") ? (form.brigade === "__new__" ? form.newBrigade : form.brigade) : undefined,
      projectIds: form.projectIds
    };
    setErr(""); setSubmitting(true);
    const result = await onAdd(newUser);
    setSubmitting(false);
    if (result.ok) onClose();
    else setErr(result.error || t('addUser.notAdded'));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(27,58,107,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary"/>{t('addUser.title')}</h3>
          <button aria-label={t('common.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>{err}</div>}
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.nameLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={t('addUser.namePlaceholder')} value={form.name} onChange={e => { setErr(""); setForm({...form, name: e.target.value}); }} required/>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.phoneLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              value={form.phone} onChange={e => {
                setErr("");
                const val = e.target.value;
                if (val.startsWith("+998 ")) setForm({...form, phone: val});
                else if (val === "+998") setForm({...form, phone: "+998 "});
              }} required/>
            <p className="text-sm md:text-xs text-muted-foreground mt-1">{t('addUser.smsHint')}</p>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.positionLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {(form.role === "brigadir" || form.role === "ishchi") && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.brigadeLabel')}</label>
              {currentUser.role === "brigadir" ? (
                <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-muted font-medium" value={currentUser.brigade} readOnly/>
              ) : (
                <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.brigade} onChange={e => setForm({...form, brigade: e.target.value})}>
                  <option value="">{t('addUser.selectPlaceholder')}</option>
                  {brigades.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="__new__">{t('addUser.newBrigade')}</option>
                </select>
              )}
              {form.brigade === "__new__" && (
                <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background mt-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={t('addUser.newBrigadePlaceholder')} onChange={e => setForm({...form, newBrigade: e.target.value})}/>
              )}
            </div>
          )}
          {isAdmin(currentUser.role) && form.role !== "orinbosar" && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.objects')}</label>
              <div className="space-y-1 max-h-28 overflow-y-auto border border-border rounded p-2">
                {projects.map(p => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={form.projectIds.includes(p.id)}
                      onChange={e => setForm({...form, projectIds: e.target.checked ? [...form.projectIds, p.id] : form.projectIds.filter(id => id !== p.id)})}
                      className="w-3 h-3 accent-primary"/>
                    <span className="text-sm md:text-xs">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={submitting} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50">{t('addUser.cancel')}</button>
            <button type="submit" disabled={submitting} className="flex-1 text-sm md:text-xs bg-primary text-white rounded px-3 py-2 hover:bg-primary/90 transition-colors font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}{t('common.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Object Modal ────────────────────────────────────────────────────────
function AddObjectModal({ users, onClose, onAdd }:
  { users: AppUser[]; onClose: () => void; onAdd: (p: Project) => void }) {
  const [form, setForm] = useState({ name: "", budget: "", location: "", foremanId: "" });
  const [smeta, setSmeta] = useState<File|null>(null);
  const [loading, setLoading] = useState(false);
  const [smetaMsg, setSmetaMsg] = useState("");
  const [smetaPercent, setSmetaPercent] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(API_BASE + '/api/objects', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name: form.name, budget: form.budget ? Number(form.budget) : undefined, location: form.location || undefined, foremanId: form.foremanId || undefined})
      });
      if (!res.ok) throw new Error();
      const obj = await res.json();
      
      let finalMats: any[] = [];
      let finalBudget = obj.budget;

      let smetaResult: SmetaResult | undefined;
      if (smeta) {
        setSmetaMsg('Smeta tahlil qilinmoqda...');
        try {
          smetaResult = await parseSmetaFile(smeta, obj.id || obj._id);
          finalMats = smetaResult!.resources.filter(r => r.group === 'material');
          finalBudget = smetaResult!.meta?.totalWithoutVat ?? finalBudget;
        } catch (e) {
          // Obyekt yaratildi, lekin smeta o'qilmadi — ogohlantirib davom etamiz
          setSmetaMsg((e as Error).message || 'Smeta o\'qilmadi');
        }
      }

      const newP: Project = {
        id: obj._id,
        name: obj.name,
        budget: finalBudget || 0,
        location: form.location,
        status: 'active',
        foremanId: form.foremanId,
        startDate: new Date().toISOString().split('T')[0],
        requiredMaterials: finalMats.map((m:any) => ({ id: String(m.index ?? m.id), name: m.rawName ?? m.name, quantity: m.qty ?? m.needed, unit: m.unit, category: m.category || 'Qurilish', price: m.price ?? undefined })),
        smeta: smetaResult,
      };
      onAdd(newP);
    } catch(err) {
      alert("Xatolik");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-accent"/>Yangi Obyekt</h3>
          <button aria-label="Yopish" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div><label className="text-sm md:text-xs font-medium block mb-1">Nomi *</label><input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Masalan: 5-uy qurilishi" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">Manzil</label><input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Toshkent sh..." value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">Budjet (so'm)</label><input type="number" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder="50000000" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Prorab biriktirish</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" value={form.foremanId} onChange={e=>setForm({...form,foremanId:e.target.value})}>
              <option value="">— tanlang —</option>
              {users.filter(u=>u.role==="prorab").map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Smeta yuklash (ixtiyoriy)</label>
            <input type="file" accept=".pdf" className="w-full text-sm md:text-xs border border-border rounded px-3 py-1.5 bg-input-background file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm md:text-xs file:bg-primary file:text-white hover:file:bg-primary/90" onChange={e=>setSmeta(e.target.files?.[0]||null)}/>
            {loading && smeta && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin"/>{smetaMsg || 'Yuklanmoqda...'}</div>
                {smetaPercent > 0 && <div className="w-full bg-muted rounded-full h-1 mt-1"><div className="bg-accent h-1 rounded-full liquid-transition" style={{width:`${smetaPercent}%`}}/></div>}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted">Bekor</button><button type="submit" disabled={loading} className="flex-1 text-sm md:text-xs bg-accent text-white rounded px-3 py-2 font-semibold hover:bg-accent/90">{loading?'Yuklanmoqda...':"Qo'shish"}</button></div>
        </form>
      </div>
    </div>
  );
}

// ─── Send Transfer Modal ───────────────────────────────────────────────────────
function SendTransferModal({ currentUser, projects, allUsers, onClose, onSend, initialTransfer }:
  { currentUser: AppUser; projects: Project[]; allUsers: AppUser[]; onClose: () => void; onSend: (t: Transfer) => void; initialTransfer?: Partial<Transfer> }) {
  const { t } = useTranslation();
  useModalPresence();
  type SelMat = { name: string; unit: string; quantity: string; price: string };

  const [projectId, setProjectId] = useState(initialTransfer?.projectId || "");
  const [selMats, setSelMats] = useState<SelMat[]>(
    initialTransfer?.materialName
      ? [{ name: initialTransfer.materialName, unit: initialTransfer.unit || "", quantity: "1", price: "" }]
      : []
  );
  const [showCustom, setShowCustom] = useState(false);
  const [customMats, setCustomMats] = useState<SelMat[]>([{ name: "", unit: "", quantity: "1", price: "" }]);
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const [matSearch, setMatSearch] = useState("");

  // Qaysi rol bo'lishidan qat'iy nazar barcha obyektlar tanlash uchun ko'rinadi —
  // faqat smetadan tanlash (pastda) rahbar/o'rinbosar bilan cheklangan.
  const myProjects = projects;
  const canBrowseSmeta = isAdmin(currentUser.role);
  const selProj = projects.find(p => p.id === projectId);
  const targets = allUsers.filter(u => u.id !== currentUser.id && (isAdmin(currentUser.role) || u.projectIds.some(pid => pid === projectId)));

  const toggleMat = (m: ReqMat) => {
    const exists = selMats.find(s => s.name === m.name);
    if (exists) setSelMats(prev => prev.filter(s => s.name !== m.name));
    else setSelMats(prev => [...prev, { name: m.name, unit: m.unit, quantity: "1", price: "" }]);
  };
  const updateMat = (name: string, field: "quantity" | "price", val: string) =>
    setSelMats(prev => prev.map(m => m.name === name ? { ...m, [field]: val } : m));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const mats = [...selMats];
    if (showCustom || !canBrowseSmeta) {
      customMats.forEach(cm => {
        if (cm.name.trim() && cm.quantity) mats.push(cm);
      });
    }
    if (mats.length === 0) return;
    mats.forEach((mat, i) => {
      onSend({
        id: `t${Date.now() + i}`,
        materialName: mat.name,
        quantity: +mat.quantity || 1,
        unit: mat.unit,
        fromUserId: currentUser.id,
        toUserId,
        projectId,
        sentDate: new Date().toISOString().split("T")[0],
        status: "pending",
        price: mat.price ? Number(mat.price) : undefined,
        note: note || undefined
      });
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] overflow-hidden animate-slide-up-fade flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border flex-shrink-0" style={{ background: "linear-gradient(to right, rgba(27,58,107,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><Send className="w-4 h-4 text-primary"/>{t('sendTransfer.title')}</h3>
          <button aria-label={t('sendTransfer.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Project */}
          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('sendTransfer.objectLabel')}</label>
            <select className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none"
              value={projectId} onChange={e => { setProjectId(e.target.value); setSelMats([]); setShowCustom(false); setCustomMats([{ name: "", unit: "", quantity: "1", price: "" }]); }} required>
              <option value="">{t('sendTransfer.selectPlaceholder')}</option>
              {myProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Multi-select materials */}
          {selProj && (
            <div>
              <label className="text-[11px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('sendTransfer.materialsLabel')}</label>

              {/* Tanlangan materiallar — yuqorida, hajmi/narxi bilan */}
              {selMats.length > 0 && (
                <div className="mb-2 space-y-2">
                  {selMats.map(sel => (
                    <div key={sel.name} className="surface p-2.5 border-primary/30">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="w-4 h-4 text-primary flex-shrink-0"/>
                        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{sel.name}</span>
                        <span className="chip bg-muted text-muted-foreground">{sel.unit || "—"}</span>
                        <button type="button" onClick={() => setSelMats(prev => prev.filter(s => s.name !== sel.name))}
                          className="btn btn-ghost w-6 h-6 p-0 rounded-lg text-muted-foreground"><X className="w-3.5 h-3.5"/></button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1 font-semibold uppercase">{t('sendTransfer.quantityLabel')}</label>
                          <input type="number" min="1" placeholder="1"
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                            value={sel.quantity} onChange={e => updateMat(sel.name, "quantity", e.target.value)}/>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1 font-semibold uppercase">{t('sendTransfer.priceLabel')}</label>
                          <input type="number" min="0" placeholder="0"
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                            value={sel.price} onChange={e => updateMat(sel.name, "price", e.target.value)}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Smetadan tanlash — faqat rahbar/o'rinbosar uchun (prorab/brigadir/ishchi
                  faqat o'zi qo'shgan material yuboradi, smeta ro'yxatini ko'rmaydi) */}
              {canBrowseSmeta && (
                <>
                  <div className="relative mb-2">
                    <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"/>
                    <input value={matSearch} onChange={e => setMatSearch(e.target.value)}
                      placeholder={t('sendTransfer.searchPlaceholder')}
                      className="w-full text-sm border border-border rounded-lg pl-9 pr-3 py-2.5 bg-input-background focus:outline-none"/>
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50 shadow-sm max-h-56 overflow-y-auto scrollbar-hide">
                    {(() => {
                      const q = matSearch.trim().toLowerCase();
                      const list = selProj.requiredMaterials.filter(m =>
                        !selMats.some(s => s.name === m.name) && (!q || m.name.toLowerCase().includes(q))
                      );
                      if (list.length === 0) return (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          {q ? t('sendTransfer.notFoundManual') : selProj.requiredMaterials.length === 0 ? t('sendTransfer.noSmeta') : t('sendTransfer.allSelected')}
                        </div>
                      );
                      return list.map(m => (
                        <button type="button" key={m.id} onClick={() => { toggleMat(m); setMatSearch(""); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 cursor-pointer bg-card hover:bg-muted/40 liquid-transition text-left">
                          <Plus className="w-4 h-4 text-primary flex-shrink-0"/>
                          <span className="text-sm flex-1 min-w-0 truncate font-medium">{m.name}</span>
                          <span className="text-[10px] text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded-full flex-shrink-0">{m.unit}</span>
                        </button>
                      ));
                    })()}
                  </div>
                </>
              )}

              {/* Boshqa material qo'shish — smeta ro'yxatidan alohida, doim ko'rinadigan
                  bo'lak (avval smeta scroll ichida "pastda qolib" ko'rinmay qolar edi).
                  Rahbar/o'rinbosar uchun ixtiyoriy (checkbox), boshqa rollar uchun
                  yagona yo'l bo'lgani sababli doim ochiq. */}
              <div className={`mt-2 rounded-xl border border-border/60 liquid-transition ${showCustom ? "bg-primary/5" : "bg-card hover:bg-muted/30"}`}>
                {canBrowseSmeta ? (
                  <label className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={showCustom} onChange={e => setShowCustom(e.target.checked)}
                      className="w-4 h-4 accent-primary rounded flex-shrink-0"/>
                    <span className="text-sm italic text-muted-foreground">{t('sendTransfer.otherMaterialCheckbox')}</span>
                  </label>
                ) : (
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-3 pt-3">{t('sendTransfer.writeManually')}</p>
                )}
                {(showCustom || !canBrowseSmeta) && (
                    <div className="px-3 pb-3 space-y-4 border-t border-border/30 pt-3">
                      {customMats.map((cm, i) => (
                        <div key={i} className="space-y-2 relative pr-7 bg-muted/40 p-2 rounded-xl border border-border/40">
                          <input placeholder={t('sendTransfer.materialNamePlaceholder')} required={(showCustom || !canBrowseSmeta) && i === 0}
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                            value={cm.name} onChange={e => {
                              const newMats = [...customMats];
                              newMats[i].name = e.target.value;
                              setCustomMats(newMats);
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                setCustomMats([...customMats, { name: "", unit: "", quantity: "1", price: "" }]);
                              }
                            }}
                          />
                          <div className="grid grid-cols-3 gap-1.5">
                            <input type="number" min="1" placeholder={t('sendTransfer.quantityPlaceholder')} required={(showCustom || !canBrowseSmeta) && cm.name.trim() !== ""}
                              className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                              value={cm.quantity} onChange={e => {
                                const newMats = [...customMats];
                                newMats[i].quantity = e.target.value;
                                setCustomMats(newMats);
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  setCustomMats([...customMats, { name: "", unit: "", quantity: "1", price: "" }]);
                                }
                              }}
                            />
                            <input placeholder={t('sendTransfer.unitPlaceholder')} required={(showCustom || !canBrowseSmeta) && cm.name.trim() !== ""}
                              className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                              value={cm.unit} onChange={e => {
                                const newMats = [...customMats];
                                newMats[i].unit = e.target.value;
                                setCustomMats(newMats);
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  setCustomMats([...customMats, { name: "", unit: "", quantity: "1", price: "" }]);
                                }
                              }}
                            />
                            <input type="number" min="0" placeholder={t('sendTransfer.pricePlaceholder')}
                              className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                              value={cm.price} onChange={e => {
                                const newMats = [...customMats];
                                newMats[i].price = e.target.value;
                                setCustomMats(newMats);
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  setCustomMats([...customMats, { name: "", unit: "", quantity: "1", price: "" }]);
                                }
                              }}
                            />
                          </div>
                          {customMats.length > 1 && (
                            <button type="button" onClick={() => setCustomMats(customMats.filter((_, idx) => idx !== i))}
                              className="absolute top-1/2 right-1 -translate-y-1/2 p-1.5 text-red-500 hover:bg-red-500/100/10 rounded-lg liquid-transition">
                              <X className="w-4 h-4"/>
                            </button>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setCustomMats([...customMats, { name: "", unit: "", quantity: "1", price: "" }])}
                        className="text-xs text-primary font-semibold flex items-center gap-1 mt-2 hover:underline">
                        <Plus className="w-3 h-3"/> {t('sendTransfer.addMore')}
                      </button>
                    </div>
                  )}
                </div>
              {selMats.length > 0 || customMats.some(m => m.name.trim()) ? (
                <p className="mt-1.5 text-[10px] text-primary font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3 h-3"/>{t('sendTransfer.materialsSelected', { count: selMats.length + customMats.filter(m => m.name.trim()).length })}
                </p>
              ) : null}
            </div>
          )}

          {/* Recipient */}
          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('sendTransfer.toLabel')}</label>
            <select className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none"
              value={toUserId} onChange={e => setToUserId(e.target.value)} required>
              <option value="">{t('sendTransfer.selectPlaceholder')}</option>
              {targets.map(u => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('sendTransfer.noteLabel')} <span className="normal-case font-normal">{t('sendTransfer.optional')}</span></label>
            <input className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none"
              placeholder={t('sendTransfer.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)}/>
          </div>
        </div>

          <div className="flex gap-2 p-4 pt-3 border-t border-border flex-shrink-0">
            <button type="button" onClick={onClose} className="flex-1 text-sm border border-border rounded-xl px-3 py-2.5 hover:bg-muted liquid-transition font-medium">{t('sendTransfer.cancel')}</button>
            <button type="submit"
              disabled={selMats.length === 0 && !customMats.some(m => m.name.trim())}
              className="flex-1 text-sm text-white rounded-xl px-3 py-2.5 font-bold liquid-transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              style={{ background: "linear-gradient(135deg, #1B3A6B 0%, #243F6E 100%)" }}>
              {t('sendTransfer.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Expense Modal ─────────────────────────────────────────────────────────
function AddExpenseModal({ currentUser, projects, allUsers, onClose, onAdd }:
  { currentUser: AppUser; projects: Project[]; allUsers: AppUser[]; onClose: () => void; onAdd: (e: Expense) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ type: "oylik" as ExpType, amount: "", projectId: projects[0]?.id || "", description: "", toUserId: "", date: new Date().toISOString().split("T")[0] });
  const [err, setErr] = useState("");
  const [boshqaRows, setBoshqaRows] = useState<{ name: string; price: string }[]>([{ name: "", price: "" }]);

  const boshqaTotal = boshqaRows.reduce((s, r) => s + (Number(r.price) || 0), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");

    if (form.type === "boshqa") {
      const valid = boshqaRows.filter(r => r.name.trim() && r.price);
      if (valid.length === 0) { setErr(t('addExpense.errNeedMaterial')); return; }
      onAdd({
        id: `e${Date.now()}`,
        type: "boshqa",
        amount: boshqaTotal,
        toUserId: form.toUserId || undefined,
        projectId: form.projectId,
        description: valid.map(r => `${r.name}: ${Number(r.price).toLocaleString()} so'm`).join("; "),
        date: form.date,
        status: form.toUserId ? "pending" : "confirmed",
        createdById: currentUser.id
      });
      onClose();
      return;
    }

    if (!form.amount || +form.amount <= 0) { setErr(t('addExpense.errAmountRequired')); return; }
    if (form.type === "oylik" && !form.toUserId) { setErr(t('addExpense.errSalaryRecipient')); return; }
    onAdd({
      id: `e${Date.now()}`,
      type: form.type,
      amount: +form.amount,
      toUserId: form.toUserId || undefined,
      projectId: form.projectId,
      description: form.description,
      date: form.date,
      status: form.toUserId ? "pending" : "confirmed",
      createdById: currentUser.id
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] overflow-y-auto scrollbar-hide animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><TrendingDown className="w-4 h-4 text-accent"/>{t('addExpense.title')}</h3>
          <button aria-label={t('addExpense.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {err && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>{err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.typeLabel')}</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.type} onChange={e => { setErr(""); setForm({...form, type: e.target.value as ExpType, toUserId: "", description: ""}); }}>
                {(Object.keys(EXP_LABELS) as ExpType[]).map(k => <option key={k} value={k}>{EXP_LABELS[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.dateLabel')}</label>
              <input type="date" className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.date} onChange={e => setForm({...form, date: e.target.value})} required/>
            </div>
          </div>

          {/* Boshqa: dynamic material rows — replaces amount + description fields */}
          {form.type === "boshqa" ? (
            <div>
              <label className="text-[10px] font-bold block mb-2 text-muted-foreground uppercase tracking-wider">{t('addExpense.materialsLabel')}</label>
              <div className="space-y-2">
                {boshqaRows.map((row, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input placeholder={t('addExpense.materialPlaceholder', { n: i + 1 })}
                      className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-input-background focus:outline-none"
                      value={row.name} onChange={e => { const r = [...boshqaRows]; r[i] = {...r[i], name: e.target.value}; setBoshqaRows(r); }}/>
                    <input type="number" min="0" placeholder={t('addExpense.pricePlaceholder')}
                      className="w-28 text-sm border border-border rounded-lg px-2.5 py-2 bg-input-background focus:outline-none"
                      value={row.price} onChange={e => { const r = [...boshqaRows]; r[i] = {...r[i], price: e.target.value}; setBoshqaRows(r); }}/>
                    {boshqaRows.length > 1 && (
                      <button type="button" onClick={() => setBoshqaRows(rows => rows.filter((_, j) => j !== i))}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-red-500/10 liquid-transition">
                        <X className="w-3.5 h-3.5"/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setBoshqaRows(r => [...r, { name: "", price: "" }])}
                className="mt-2.5 flex items-center gap-1.5 text-sm text-primary hover:bg-primary/5 px-2.5 py-1.5 rounded-lg liquid-transition font-semibold">
                <Plus className="w-3.5 h-3.5"/>{t('addExpense.addRow')}
              </button>
              {boshqaTotal > 0 && (
                <div className="mt-2.5 flex items-center justify-between p-3 rounded-xl border border-accent/20" style={{ background: "rgba(217,70,15,0.05)" }}>
                  <span className="text-xs text-muted-foreground font-semibold">{t('addExpense.totalPayment')}</span>
                  <span className="text-sm font-bold text-accent">{boshqaTotal.toLocaleString()} so'm</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.amountLabel')}</label>
                <input type="number" min="1" className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                  placeholder={t('addExpense.amountPlaceholder')} value={form.amount} onChange={e => { setErr(""); setForm({...form, amount: e.target.value}); }} required/>
              </div>
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
                  {t('addExpense.descLabel')} <span className="normal-case font-normal">{t('addExpense.optional')}</span>
                </label>
                <input className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                  placeholder={t('addExpense.descPlaceholder')} value={form.description} onChange={e => { setErr(""); setForm({...form, description: e.target.value}); }}/>
              </div>
            </>
          )}

          {projects.length > 0 && (
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.objectLabel')}</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.projectId} onChange={e => setForm({...form, projectId: e.target.value})}>
                <option value="">{t('addExpense.objectNone')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
              {t('addExpense.toLabel')} {form.type === "oylik" ? <span className="text-accent normal-case">*</span> : <span className="normal-case font-normal">{t('addExpense.optional')}</span>}
            </label>
            <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
              value={form.toUserId} onChange={e => { setErr(""); setForm({...form, toUserId: e.target.value}); }}>
              <option value="">{t('addExpense.toSelectPlaceholder')}</option>
              {allUsers.filter(u => u.id !== currentUser.id).map(u => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]})</option>)}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm border border-border rounded-xl px-3 py-2.5 hover:bg-muted liquid-transition font-medium">{t('addExpense.cancel')}</button>
            <button type="submit" className="flex-1 text-sm text-white rounded-xl px-3 py-2.5 font-bold liquid-transition shadow-sm"
              style={{ background: "linear-gradient(135deg, #D2440F 0%, #c03d0d 100%)" }}>
              {t('addExpense.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Transfer Row (used in My Transfers lists) ────────────────────────────────
function TransferRow({ t, currentUser, allUsers, projects, onConfirm, onReject }:
  { t: Transfer; currentUser: AppUser; allUsers: AppUser[]; projects: Project[];
    onConfirm: (id: string, defect?: string) => void; onReject: (id: string) => void }) {
  const [defect, setDefect] = useState("");
  const from = allUsers.find(u => u.id === t.fromUserId);
  const to = allUsers.find(u => u.id === t.toUserId);
  const proj = projects.find(p => p.id === t.projectId);
  const isSender = t.fromUserId === currentUser.id;
  const isReceiver = t.toUserId === currentUser.id;
  const canConfirm = isReceiver && t.status === "pending";

  const statusBadge = {
    pending: <span className="text-[9px] bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><Clock className="w-2.5 h-2.5"/>Kutilmoqda</span>,
    confirmed: <span className="text-[9px] bg-green-500/15 text-green-800 dark:text-green-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><CheckCircle className="w-2.5 h-2.5"/>Tasdiqlandi</span>,
    rejected: <span className="text-[9px] bg-red-500/15 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><X className="w-2.5 h-2.5"/>Rad etildi</span>,
  }[t.status];

  return (
    <div className={`border rounded-xl p-3 text-sm md:text-xs space-y-2 shadow-sm liquid-transition ${t.status === "confirmed" ? "border-green-500/25 bg-green-500/8" : t.status === "rejected" ? "border-red-500/25 bg-red-500/8" : "border-amber-500/25 bg-amber-500/8"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">{t.materialName}</p>
          <p className="text-muted-foreground font-mono text-sm md:text-xs">
            {t.quantity.toLocaleString()} {t.unit}
            {!!t.price && <span className="ml-1.5 text-primary font-semibold">· {(t.price * t.quantity).toLocaleString()} so'm</span>}
          </p>
          <p className="text-sm md:text-xs text-muted-foreground mt-0.5">
            {isSender ? <><span className="text-foreground font-medium">Siz</span> → {to?.name}</> : <>{from?.name} → <span className="text-foreground font-medium">Siz</span></>}
          </p>
          <p className="text-sm md:text-xs text-muted-foreground">{proj?.name} • {t.date || t.sentDate}</p>
          {t.note && <p className="text-sm md:text-xs text-muted-foreground italic">{t.note}</p>}
          {t.defect && <p className="text-sm md:text-xs text-amber-700 flex items-center gap-1 mt-0.5"><AlertTriangle className="w-2.5 h-2.5"/>{t.defect}</p>}
          {t.status === "confirmed" && isSender && t.confirmedDate && (
            <p className="text-sm md:text-xs text-green-800 dark:text-green-400 font-medium mt-0.5">✓ {to?.name} tasdiqladi ({t.confirmedDate})</p>
          )}
        </div>
        <div className="flex-shrink-0">{statusBadge}</div>
      </div>
      {canConfirm && (
        <div className="space-y-1.5">
          <textarea rows={1} placeholder="Kamchilik yoki eslatma (ixtiyoriy)..." value={defect} onChange={e => setDefect(e.target.value)}
            className="w-full text-sm md:text-xs border border-border rounded px-2 py-1.5 bg-input-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"/>
          <div className="flex gap-1.5">
            <button onClick={() => onConfirm(t.id, defect || undefined)}
              className="flex-1 flex items-center justify-center gap-1 text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold">
              <Check className="w-3 h-3"/>Qabul qilish
            </button>
            <button onClick={() => onReject(t.id)}
              className="flex items-center justify-center gap-1 text-sm md:text-xs bg-red-500/15 text-red-700 dark:text-red-300 rounded px-2.5 py-1.5 hover:bg-red-500/100/25 font-semibold">
              <X className="w-3 h-3"/>Rad
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── My Transfers Panel ────────────────────────────────────────────────────────
function MyTransfersPanel({ currentUser, transfers, allUsers, projects, onConfirm, onReject, onSend }:
  { currentUser: AppUser; transfers: Transfer[]; allUsers: AppUser[]; projects: Project[];
    onConfirm: (id: string, d?: string) => void; onReject: (id: string) => void; onSend: () => void }) {
  const [tab, setTab] = useState<"inbox"|"sent">("inbox");
  const inbox = transfers.filter(t => t.toUserId === currentUser.id);
  const sent = transfers.filter(t => t.fromUserId === currentUser.id);
  const pendingCount = inbox.filter(t => t.status === "pending").length;
  const shown = tab === "inbox" ? inbox : sent;

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="surface flex items-center justify-between px-4 py-3 flex-shrink-0">
        <h2 className="text-sm font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">Materiallar</h2>
        <button onClick={onSend} className="btn btn-primary flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-full">
          <Send className="w-3.5 h-3.5"/>Yuborish
        </button>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.05 }}
        className="nav-pill-desktop flex p-1 rounded-full flex-shrink-0 w-fit">
        <button onClick={() => setTab("inbox")} className={`relative flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-semibold liquid-transition ${tab==="inbox"?"bg-primary/15 text-primary":"text-muted-foreground hover:text-foreground"}`}>
          Kirgan
          {pendingCount > 0 && <span className="text-[9px] bg-accent text-white px-1.5 py-0.5 rounded-full font-bold badge-pulse">{pendingCount}</span>}
        </button>
        <button onClick={() => setTab("sent")} className={`relative flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-semibold liquid-transition ${tab==="sent"?"bg-primary/15 text-primary":"text-muted-foreground hover:text-foreground"}`}>
          Yuborilgan
          <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-semibold">{sent.length}</span>
        </button>
      </motion.div>
      <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide">
        {shown.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground"><Package className="w-8 h-8 mx-auto mb-2 opacity-30"/><p className="text-sm md:text-xs">Hech narsa yo'q</p></div>
        ) : shown.map(t => (
          <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={allUsers} projects={projects} onConfirm={onConfirm} onReject={onReject}/>
        ))}
      </div>
    </div>
  );
}

// ─── Edit User Modal ─────────────────────────────────────────────────────────────
function EditUserModal({ user, currentUser, onClose, onUpdate }: { user: AppUser; currentUser: AppUser; onClose: () => void; onUpdate: (u: AppUser) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: user.name, role: user.role, phone: user.phone, brigade: user.brigade || "" });
  // "Direktor" va "dasturchi" lavozimini FAQAT dasturchi paneli o'zgartira oladi —
  // oddiy admin (direktor/o'rinbosar) tahrirlash oynasidan xodimni direktor yoki
  // dasturchi qilib qo'ya olmasligi kerak (imtiyoz eskalatsiyasi xatosi edi).
  const editableRoles: Role[] = currentUser.role === "dasturchi"
    ? (Object.keys(ROLE_LABELS) as Role[])
    : (["orinbosar", "prorab", "brigadir", "ishchi"] as Role[]);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg border border-border shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Edit className="w-4 h-4 text-primary"/>{t('editUser.title')}</h3>
          <button aria-label={t('editUser.close')} onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onUpdate({...user, ...form}); onClose(); }} className="p-4 space-y-3">
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.nameLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              placeholder={t('editUser.namePlaceholder')} value={form.name} onChange={e => setForm({...form, name: e.target.value})} required autoFocus
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.phoneLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
              placeholder="+998901234567" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} required
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.positionLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {editableRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              {!editableRoles.includes(form.role) && <option value={form.role}>{ROLE_LABELS[form.role]}</option>}
            </select>
          </div>
          {["ishchi", "brigadir"].includes(form.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.brigadeLabel')}</label>
              <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.brigade} onChange={e => setForm({...form, brigade: e.target.value})}/>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted transition-colors">{t('editUser.cancel')}</button>
            <button type="submit" className="flex-1 text-sm md:text-xs bg-primary text-white rounded px-3 py-2 hover:bg-primary/90 font-semibold">{t('editUser.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Dashboard (Admin) ────────────────────────────────────────────────────────
function AdminDashboard({ currentUser, users, projects, transfers, setUsers, onSendTransfer, onConfirmTransfer, onRejectTransfer, onSelectProject, onAddUser, onUpdateUser, onDeleteUser, onAddProject }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; transfers: Transfer[];
    setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
    onSendTransfer: (t: Transfer) => void; onConfirmTransfer: (id: string, d?: string) => void;
    onRejectTransfer: (id: string) => void; onSelectProject: (p: Project) => void; onAddUser: (u: AppUser) => Promise<{ ok: boolean; error?: string }>;
    onUpdateUser: (u: AppUser) => void; onDeleteUser: (id: string) => void;
    onAddProject: (p: Project) => void;
  }) {
  const { t } = useTranslation();
  const [showAddUser, setShowAddUser] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showAddObject, setShowAddObject] = useState(false);
  const [editUser, setEditUser] = useState<AppUser|null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem("admin_activeTab") || "rahbariyat";
  });
  
  useEffect(() => {
    localStorage.setItem("admin_activeTab", activeTab);
  }, [activeTab]);

  const brigades = [...new Set(users.filter(u => u.brigade).map(u => u.brigade!))];

  const sections = [
    { key: "rahbariyat", label: t('dashboard.leadership'), icon: Building2 },
    { key: "boshxodimlar", label: t('dashboard.topStaff'), icon: Users },
    { key: "brigadalar", label: t('dashboard.brigades'), icon: HardHat },
    { key: "faolobyektlar", label: t('dashboard.activeObjects'), icon: Package },
  ];

  const toggle = (key: string) => setActiveTab(prev => prev === key ? "" : key);

  return (
    <>
    {/* Desktop: 4-column grid */}
    <div className="h-full hidden md:grid md:grid-cols-2 xl:grid-cols-4 gap-3 overflow-hidden bg-background p-3">
      {/* Col 1 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="icon-chip w-6 h-6"><Building2 className="w-3.5 h-3.5"/></div>
          <h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.leadership')}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          {users.filter(u => u.role === "direktor").map(u => (
            <div key={u.id} className="mb-2">
              <div className="bg-primary text-white rounded-md p-3 flex items-center gap-2">
                <Avatar user={u} size="sm"/><div><p className="text-sm md:text-xs font-semibold">{u.name}</p><p className="text-sm md:text-xs text-white/70">{ROLE_LABELS[u.role]}</p></div>
              </div>
              {users.filter(u2 => u2.role === "orinbosar").map(u2 => (
                <div key={u2.id} className="ml-4 mt-2 border-l-2 border-dashed border-primary/30 pl-3">
                  <div className="bg-secondary rounded-md p-3 flex items-center gap-2">
                    <Avatar user={u2} size="sm"/><div><p className="text-sm md:text-xs font-semibold">{u2.name}</p><p className="text-sm md:text-xs text-muted-foreground">{ROLE_LABELS[u2.role]}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u2.phone}</p></div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('dashboard.staffShort')}</p>
              <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-[9px] bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold"><UserPlus className="w-2.5 h-2.5"/>{t('common.add')}</button>
            </div>
            {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
              <div key={r} className="flex items-center justify-between py-1">
                <span className="text-sm md:text-xs text-muted-foreground">{ROLE_LABELS[r]}</span>
                <span className="text-sm md:text-xs font-mono font-semibold">{users.filter(u=>u.role===r).length}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Col 2 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.05 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip w-6 h-6"><Users className="w-3.5 h-3.5"/></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.topStaff')}</h2></div>
          <button onClick={() => setShowAddUser(true)} className="text-sm md:text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold flex items-center gap-1"><UserPlus className="w-2.5 h-2.5"/>{t('common.add')}</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-border/50">
          {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
            <div key={u.id} className="flex items-center gap-2.5 py-2 px-3 hover:bg-muted/40 transition-colors group">
              <Avatar user={u} size="sm"/>
              <div className="flex-1 min-w-0"><p className="text-sm md:text-xs font-semibold truncate">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p>{u.brigade&&<p className="text-[9px] text-muted-foreground">{u.brigade}</p>}</div>
              <RoleBadge role={u.role}/>
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button aria-label={t('common.edit')} onClick={() => setEditUser(u)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><Edit className="w-3 h-3"/></button>
                <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(u.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><Trash className="w-3 h-3"/></button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Col 3 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.10 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip w-6 h-6"><HardHat className="w-3.5 h-3.5"/></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.brigades')}</h2></div>
          <button onClick={() => setShowSend(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2 py-1 rounded hover:bg-primary/90 font-semibold"><Send className="w-2.5 h-2.5"/>{t('dashboard.send')}</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          {brigades.map(brigade => (
            <div key={brigade} className="mb-3">
              <div className="flex items-center justify-between px-3 py-1.5 bg-secondary rounded-md mb-1">
                <span className="text-[11px] font-semibold text-secondary-foreground">{brigade}</span>
                <span className="text-sm md:text-xs text-muted-foreground">{t('dashboard.peopleCount', { count: users.filter(u=>u.brigade===brigade).length })}</span>
              </div>
              {users.filter(u => u.brigade===brigade).map(m => (
                <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group">
                  <Avatar user={m} size="sm"/>
                  <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                  <RoleBadge role={m.role}/>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><Edit className="w-3 h-3"/></button>
                    <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><Trash className="w-3 h-3"/></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-sm md:text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase mb-2 flex items-center gap-1"><Package className="w-2.5 h-2.5"/>{t('dashboard.incomingShort')}</p>
              {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").map(t => (
                <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={projects} onConfirm={onConfirmTransfer} onReject={onRejectTransfer}/>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">{t('dashboard.allWorkers')}</p>
            {users.filter(u => u.role==="ishchi").map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group mb-1">
                <Avatar user={m} size="sm"/>
                <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                <RoleBadge role={m.role}/>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><Edit className="w-3 h-3"/></button>
                  <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><Trash className="w-3 h-3"/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Col 4 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.15 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip icon-chip-accent w-6 h-6"><Package className="w-3.5 h-3.5"/></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.activeObjects')}</h2></div>
          <button onClick={()=>setShowAddObject(true)} className="text-sm md:text-xs bg-accent text-white px-2 py-1 rounded hover:bg-accent/90 font-semibold flex items-center gap-1 dark:bg-accent/10 dark:text-accent dark:hover:bg-accent/20"><Plus className="w-2.5 h-2.5"/>{t('common.add')}</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {[["active",t('dashboard.statusActive'),"text-green-800 dark:text-green-400"],["paused",t('dashboard.statusPausedShort'),"text-amber-500"],["completed",t('dashboard.statusCompleted'),"text-blue-500"]].map(([s,l,c])=>(
              <div key={s} className="bg-muted/40 rounded-lg p-2 text-center">
                <p className={`text-sm font-bold font-mono ${c}`}>{projects.filter(p=>p.status===s).length}</p>
                <p className="text-[9px] text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          {projects.map(p => {
            const pend = transfers.filter(t=>t.projectId===p.id&&t.status==="pending").length;
            const foreman = users.find(u=>u.id===p.foremanId);
            return (
              <div key={p.id} onClick={()=>onSelectProject(p)} className="surface rounded-xl p-3 cursor-pointer hover:border-primary/40 liquid-transition group mb-2">
                <div className="flex items-start justify-between gap-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1"><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status==="active"?"bg-green-500":p.status==="paused"?"bg-amber-400":"bg-blue-400"}`}/><p className="text-sm md:text-xs font-semibold truncate">{p.name}</p></div>
                    <p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-2.5 h-2.5"/>{p.location}</p>
                    {foreman&&<p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><HardHat className="w-2.5 h-2.5"/>{foreman.name}</p>}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-0.5"/>
                </div>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                  <span className="text-[9px] text-muted-foreground font-mono">{fmt(p.budget)}</span>
                  {pend>0&&<span className="ml-auto text-[9px] bg-amber-500/15 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded font-semibold">{t('dashboard.pendingCount', { count: pend })}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>

    {/* Mobile: Accordion */}
    <div className="flex flex-col md:hidden overflow-y-auto scrollbar-hide bg-background pb-4">
      {sections.map(section => {
        const isOpen = activeTab === section.key;
        return (
          <div key={section.key} className="border-b border-border/50">
            {/* Header — always visible */}
            <button
              onClick={() => toggle(section.key)}
              className={`w-full flex items-center justify-between px-4 py-4 transition-colors ${isOpen ? "bg-primary text-white" : "bg-card hover:bg-muted/30"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isOpen ? "bg-white/20" : "bg-primary/10"}`}>
                  <section.icon className={`w-4 h-4 ${isOpen ? "text-white" : "text-primary"}`}/>
                </div>
                <span className={`text-sm font-bold tracking-wide font-['Roboto_Slab',serif] ${isOpen ? "text-white" : "text-foreground"}`}>{section.label}</span>
              </div>
              <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isOpen ? "rotate-180 text-white" : "text-muted-foreground"}`}/>
            </button>

            {/* Content — only visible when open */}
            {isOpen && (
              <div className="animate-slide-up-fade max-h-[52vh] overflow-y-auto scrollbar-hide">
                {section.key === "rahbariyat" && (
                  <div className="p-4 space-y-3">
                    {users.filter(u => u.role === "direktor").map(u => (
                      <div key={u.id}>
                        <div className="bg-primary text-white rounded-xl p-3 flex items-center gap-3">
                          <Avatar user={u} size="sm"/>
                          <div><p className="text-sm font-semibold">{u.name}</p><p className="text-[11px] text-white/70">{ROLE_LABELS[u.role]}</p></div>
                        </div>
                        {users.filter(u2 => u2.role === "orinbosar").map(u2 => (
                          <div key={u2.id} className="ml-6 mt-2 border-l-2 border-dashed border-primary/30 pl-3">
                            <div className="bg-secondary rounded-xl p-3 flex items-center gap-2">
                              <Avatar user={u2} size="sm"/>
                              <div><p className="text-sm font-semibold">{u2.name}</p><p className="text-sm md:text-xs text-muted-foreground">{ROLE_LABELS[u2.role]}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u2.phone}</p></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-3 border-t border-border">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('dashboard.staffCount')}</p>
                        <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full hover:bg-primary/20 font-semibold"><UserPlus className="w-3 h-3"/>{t('common.add')}</button>
                      </div>
                      {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
                        <div key={r} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                          <span className="text-sm text-muted-foreground">{ROLE_LABELS[r]}</span>
                          <span className="text-sm font-mono font-bold">{users.filter(u=>u.role===r).length}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {section.key === "boshxodimlar" && (
                  <div>
                    <div className="flex justify-end px-4 py-2 border-b border-border/30">
                      <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><UserPlus className="w-3 h-3"/>{t('common.add')}</button>
                    </div>
                    {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
                      <div key={u.id} className="flex items-center gap-3 py-3 px-4 border-b border-border/40 hover:bg-muted/30">
                        <Avatar user={u} size="sm"/>
                        <div className="flex-1"><p className="text-sm font-semibold">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p></div>
                        <RoleBadge role={u.role}/>
                        <div className="flex gap-1">
                          <button aria-label={t('common.edit')} onClick={() => setEditUser(u)} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><Edit className="w-4 h-4"/></button>
                          <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(u.id); }} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><Trash className="w-4 h-4"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {section.key === "brigadalar" && (
                  <div className="p-4 space-y-3">
                    <div className="flex justify-end">
                      <button onClick={() => setShowSend(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><Send className="w-3 h-3"/>{t('dashboard.send')}</button>
                    </div>
                    {brigades.map(brigade => (
                      <div key={brigade} className="bg-muted/30 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-secondary">
                          <span className="text-sm md:text-xs font-semibold">{brigade}</span>
                          <span className="text-sm md:text-xs text-muted-foreground">{t('dashboard.peopleCount', { count: users.filter(u=>u.brigade===brigade).length })}</span>
                        </div>
                        {users.filter(u => u.brigade===brigade).map(m => (
                          <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 border-t border-border/30">
                            <Avatar user={m} size="sm"/>
                            <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                            <RoleBadge role={m.role}/>
                            <div className="flex gap-1">
                              <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><Edit className="w-3.5 h-3.5"/></button>
                              <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><Trash className="w-3.5 h-3.5"/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-border">
                      <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">{t('dashboard.allWorkers')}</p>
                      {users.filter(u => u.role==="ishchi").map(m => (
                        <div key={m.id} className="flex items-center gap-3 py-2.5 px-2 border-b border-border/30">
                          <Avatar user={m} size="sm"/>
                          <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                          <RoleBadge role={m.role}/>
                          <div className="flex gap-1">
                            <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><Edit className="w-3.5 h-3.5"/></button>
                            <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><Trash className="w-3.5 h-3.5"/></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-sm md:text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase mb-2 flex items-center gap-1"><Package className="w-3 h-3"/>{t('dashboard.incomingMaterials')}</p>
                        {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").map(t => (
                          <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={projects} onConfirm={onConfirmTransfer} onReject={onRejectTransfer}/>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {section.key === "faolobyektlar" && (
                  <div className="p-4">
                    <div className="flex justify-end mb-3">
                      <button onClick={()=>setShowAddObject(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-accent text-white px-3 py-1.5 rounded-full font-semibold"><Plus className="w-3 h-3"/>{t('common.add')}</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[["active",t('dashboard.statusActive'),"text-green-800 dark:text-green-400","bg-green-500/10"],["paused",t('dashboard.statusPausedFull'),"text-amber-500","bg-amber-500/10"],["completed",t('dashboard.statusCompleted'),"text-blue-500 dark:text-blue-400","bg-blue-500/10"]].map(([s,l,c,bg])=>(
                        <div key={s} className={`${bg} border border-border rounded-xl p-3 text-center`}>
                          <p className={`text-lg font-bold font-mono ${c}`}>{projects.filter(p=>p.status===s).length}</p>
                          <p className="text-sm md:text-xs text-muted-foreground">{l}</p>
                        </div>
                      ))}
                    </div>
                    {projects.map(p => {
                      const pend = transfers.filter(t=>t.projectId===p.id&&t.status==="pending").length;
                      const foreman = users.find(u=>u.id===p.foremanId);
                      return (
                        <div key={p.id} onClick={()=>onSelectProject(p)} className="surface rounded-xl p-4 cursor-pointer hover:border-primary/50 liquid-transition mb-3 active:scale-98">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status==="active"?"bg-green-500":p.status==="paused"?"bg-amber-400":"bg-blue-400"}`}/><p className="text-sm font-semibold">{p.name}</p></div>
                              <p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3"/>{p.location}</p>
                              {foreman&&<p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><HardHat className="w-3 h-3"/>{foreman.name}</p>}
                            </div>
                            <ChevronRight className="w-5 h-5 text-muted-foreground mt-0.5"/>
                          </div>
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                            <span className="text-sm md:text-xs text-muted-foreground font-mono">{fmt(p.budget)}</span>
                            {pend>0&&<span className="ml-auto text-sm md:text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">{t('dashboard.pendingCount', { count: pend })}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>

      {showAddUser && <AddUserModal currentUser={currentUser} users={users} projects={projects} onClose={()=>setShowAddUser(false)} onAdd={onAddUser}/>}
      {editUser && <EditUserModal currentUser={currentUser} user={editUser} onClose={()=>setEditUser(null)} onUpdate={u=>{onUpdateUser(u);setEditUser(null);}}/>}
      {showSend && <SendTransferModal currentUser={currentUser} projects={projects} allUsers={users} onClose={()=>setShowSend(false)} onSend={t=>{onSendTransfer(t);setShowSend(false);}}/>}
      {showAddObject && <AddObjectModal users={users} onClose={()=>setShowAddObject(false)} onAdd={p=>{onAddProject(p);setShowAddObject(false);}}/>}
    </>
  );
}

// ─── Object Detail ─────────────────────────────────────────────────────────────
// ─── Smeta natijasi ko'rinishi — barcha bo'limlar, to'liq aniqlik ─────────────
function SmetaResultView({ smeta }: { smeta: SmetaResult }) {
  const [openGroup, setOpenGroup] = useState<string | null>("material");
  const [openWork, setOpenWork] = useState<number | null>(null);
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({});

  const byGroup: Record<string, SmetaResourceRow[]> = {};
  for (const r of smeta.resources) (byGroup[r.group] = byGroup[r.group] || []).push(r);
  const groupSum = (rows: SmetaResourceRow[]) => rows.reduce((s, r) => s + (r.total || 0), 0);
  const budget = smeta.meta?.totalWithoutVat ?? smeta.resources.reduce((s, r) => s + (r.total || 0), 0);
  const vat = smeta.meta?.totalWithVat;

  const sections: { name: string; works: SmetaWorkRow[] }[] = [];
  for (const w of smeta.works) {
    const sec = w.section || "— (bo'limsiz)";
    let s = sections.find(x => x.name === sec);
    if (!s) { s = { name: sec, works: [] }; sections.push(s); }
    s.works.push(w);
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3 p-4 pb-24 animate-slide-up-fade">
      {/* Meta + byudjet (parser natijasidan) */}
      <div className="glass-card rounded-xl p-4 border border-border">
        {smeta.meta?.objectName && <p className="text-sm font-bold leading-snug">{smeta.meta.objectName}</p>}
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Resurs summasi (byudjet)</span><span className="font-mono font-bold text-primary">{fmtNum(budget)} so'm</span></div>
          {vat != null && <div className="flex justify-between"><span className="text-muted-foreground">НДС bilan</span><span className="font-mono">{fmtNum(vat)} so'm</span></div>}
        </div>
        <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg ${smeta.validation.ok ? "bg-green-500/15 text-green-800 dark:text-green-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}>
          {smeta.validation.ok ? `✓ Tekshiruv o'tdi — ${smeta.resources.length} resurs, guruh summalari mos` : `⚠ ${smeta.validation.errors.length} xato`}
          {smeta.validation.warnings.length > 0 && ` · ${smeta.validation.warnings.length} ogohlantirish`}
        </div>
      </div>

      {/* A: РЕСУРСНЫЙ РАСЧЕТ — 5 alohida guruh */}
      <p className="text-sm font-bold px-1 pt-1">РЕСУРСНЫЙ РАСЧЕТ <span className="text-muted-foreground">({smeta.resources.length} qator)</span></p>
      {SMETA_GROUP_ORDER.filter(g => byGroup[g]?.length).map(g => {
        const rows = byGroup[g]; const sum = groupSum(rows); const open = openGroup === g;
        return (
          <div key={g} className="glass-card rounded-xl border border-border overflow-hidden">
            <button onClick={() => setOpenGroup(open ? null : g)} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/30">
              <span className="text-sm font-semibold text-left">{SMETA_GROUP_LABEL[g]} <span className="text-muted-foreground font-normal">({rows.length})</span></span>
              <span className="flex items-center gap-2"><span className="font-mono text-sm font-bold">{fmtNum(sum)}</span>{open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}</span>
            </button>
            {open && (
              <div className="overflow-x-auto scrollbar-hide border-t border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground"><tr>
                    <th className="px-2 py-1.5">№</th><th className="px-2 py-1.5">Шифр</th><th className="px-2 py-1.5">Наименование</th>
                    <th className="px-2 py-1.5">Ед.</th><th className="px-2 py-1.5 text-right">Кол-во</th><th className="px-2 py-1.5 text-right">Цена</th><th className="px-2 py-1.5 text-right">Сумма</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.index} className={`border-t border-border/50 ${(r.total != null && r.total < 0) || r.qty < 0 ? "bg-red-500/5" : ""}`}>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.index}</td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.shifr || "-"}</td>
                        <td className="px-2 py-1.5 min-w-[200px] whitespace-normal" title={r.rawName}>{r.rawName}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.unit}</td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{fmtNum(r.qty)}</td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{fmtNum(r.price)}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold whitespace-nowrap">{fmtNum(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/30 font-bold"><td className="px-2 py-1.5" colSpan={6}>ИТОГО ПО ГРУППЕ:</td><td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{fmtNum(sum)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <div className="glass-card rounded-xl border-2 border-primary/30 px-4 py-3 flex items-center justify-between bg-primary/5">
        <span className="text-sm font-bold">ИТОГО ПО РЕСУРСНОМУ РАСЧЕТУ</span>
        <span className="font-mono text-base font-bold text-primary">{fmtNum(budget)}</span>
      </div>

      {/* B: РЕСУРСНАЯ ВЕДОМОСТЬ — ishlar (bo'limlarga guruhlangan) */}
      {smeta.works.length > 0 && <p className="text-sm font-bold px-1 pt-2">РЕСУРСНАЯ ВЕДОМОСТЬ / Ishlar <span className="text-muted-foreground">({smeta.works.length})</span></p>}
      {sections.map((sec, si) => {
        const so = openSection[sec.name] ?? (si === 0);
        return (
          <div key={sec.name} className="glass-card rounded-xl border border-border overflow-hidden">
            <button onClick={() => setOpenSection(p => ({ ...p, [sec.name]: !so }))} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/20 hover:bg-muted/40">
              <span className="text-sm font-semibold text-left">{sec.name} <span className="text-muted-foreground font-normal">({sec.works.length})</span></span>
              {so ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
            </button>
            {so && sec.works.map(w => {
              const wo = openWork === w.index;
              return (
                <div key={w.index} className="border-t border-border/50">
                  <button onClick={() => setOpenWork(wo ? null : w.index)} className="w-full flex items-start justify-between gap-2 px-4 py-2 hover:bg-muted/20 text-left">
                    <span className="text-xs leading-snug"><span className="text-muted-foreground">{w.index}.</span> {w.shifr && <span className="font-mono text-primary">{w.shifr} </span>}{w.name} <span className="text-muted-foreground">[{w.unit}]</span></span>
                    <span className="flex items-center gap-1 shrink-0"><span className="text-[10px] text-muted-foreground whitespace-nowrap">{w.norms.length} n.</span>{wo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
                  </button>
                  {wo && w.norms.length > 0 && (
                    <div className="overflow-x-auto scrollbar-hide px-4 pb-2">
                      <table className="w-full text-left text-[11px]">
                        <thead className="text-muted-foreground"><tr><th className="py-1 pr-2">№</th><th className="pr-2">Шифр</th><th className="pr-2">Наименование</th><th className="pr-2">Ед.</th><th className="text-right pr-2">На ед.</th><th className="text-right">По проекту</th></tr></thead>
                        <tbody>
                          {w.norms.map(n => (
                            <tr key={n.index} className="border-t border-border/40">
                              <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{n.index}</td>
                              <td className="pr-2 font-mono text-muted-foreground">{n.shifr || "-"}</td>
                              <td className="pr-2 min-w-[160px] whitespace-normal">{n.name}</td>
                              <td className="pr-2 whitespace-nowrap">{n.unit}</td>
                              <td className="text-right pr-2 font-mono whitespace-nowrap">{fmtNum(n.perUnit)}</td>
                              <td className="text-right font-mono whitespace-nowrap">{fmtNum(n.byProject)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ObjectDetailPage({ project, currentUser, users, transfers, onBack, onSendTransfer, onConfirm, onReject, onSmetaUploaded, onUpdateStatus }:
  { project: Project; currentUser: AppUser; users: AppUser[]; transfers: Transfer[];
    onBack: () => void; onSendTransfer: (t: Transfer) => void; onConfirm: (id: string, d?: string) => void; onReject: (id: string) => void; onSmetaUploaded: (pid: string, result: SmetaResult) => void;
    onUpdateStatus: (pid: string, status: "active"|"paused"|"completed") => void;
  }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"required"|"smeta"|"pending"|"confirmed">("required");
  const [showSend, setShowSend] = useState(false);
  const [uploadingSmeta, setUploadingSmeta] = useState(false);
  const [smetaMsg, setSmetaMsg] = useState("");
  const [smetaPercent, setSmetaPercent] = useState(0);
  const [matSearch, setMatSearch] = useState("");
  const [selectedMat, setSelectedMat] = useState<ReqMat | null>(null);
  const projT = transfers.filter(t => t.projectId === project.id);
  const pendT = projT.filter(t => t.status === "pending");
  const confT = projT.filter(t => t.status === "confirmed");
  const foreman = users.find(u => u.id === project.foremanId);
  const [initialTransferData, setInitialTransferData] = useState<Partial<Transfer> | undefined>();
  // Qidiruv (kiril+lotin) — real vaqtda material nomi bo'yicha filtr
  const filteredMats = project.requiredMaterials.filter(m => m.name.toLowerCase().includes(matSearch.trim().toLowerCase()));
  
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background/50">
      <div className="glass border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0 z-10 sticky top-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm md:text-xs text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4"/>{t('common.back')}</button>
        <div className="w-px h-4 bg-border"/>
        <Building2 className="w-4 h-4 text-primary flex-shrink-0"/>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate flex items-center gap-2">
            {project.name}
            <select
              className="text-xs bg-transparent border-none font-semibold focus:outline-none cursor-pointer liquid-transition outline-none"
              style={{ color: project.status === "active" ? "#22c55e" : project.status === "paused" ? "#f59e0b" : "#3b82f6" }}
              value={project.status}
              onChange={async (e) => {
                const newStatus = e.target.value as "active"|"paused"|"completed";
                try {
                  const res = await fetch(`${API_BASE}/api/objects/${project.id}/status`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus })
                  });
                  if (res.ok) { onUpdateStatus(project.id, newStatus); }
                } catch(err) { toast.error(t('common.error')); }
              }}
            >
              <option value="active" className="text-green-600">{t('objectDetail.statusActive')}</option>
              <option value="paused" className="text-amber-500">{t('objectDetail.statusPaused')}</option>
              <option value="completed" className="text-blue-500">{t('objectDetail.statusCompleted')}</option>
            </select>
          </p>
          <p className="text-sm md:text-xs text-muted-foreground">{project.location}</p>
        </div>
        {project.pdfFile && <button className="flex items-center gap-1 text-sm md:text-xs bg-accent text-white px-2.5 py-1.5 rounded hover:bg-accent/90 font-medium flex-shrink-0 dark:bg-accent/10 dark:text-accent dark:hover:bg-accent/20"><Download className="w-3.5 h-3.5"/>PDF</button>}
        <div className="flex items-center gap-2 flex-shrink-0">
          <input type="file" id="smeta-upload" className="hidden" accept=".pdf" onChange={async e=>{
            const file = e.target.files?.[0];
            if(!file) return;
            setUploadingSmeta(true); setSmetaMsg(t('objectDetail.analyzing')); setSmetaPercent(40);
            try {
              const result = await parseSmetaFile(file, project.id);
              onSmetaUploaded(project.id, result);
              const matN = result.resources.filter((r:any)=>r.group==='material').length;
              setSmetaMsg(`✓ ${result.resources.length} resurs, ${matN} material`);
              setSmetaPercent(100);
              setTab("smeta");
              setTimeout(() => { setUploadingSmeta(false); setSmetaMsg(''); setSmetaPercent(0); }, 2500);
            } catch (err) {
              setSmetaMsg(`✗ ${(err as Error).message || t('objectDetail.smetaFailedGeneric')}`);
              setSmetaPercent(0);
              setTimeout(() => { setUploadingSmeta(false); setSmetaMsg(''); }, 4000);
            }
            e.target.value='';
          }}/>
          <label htmlFor="smeta-upload" className={`flex flex-col items-center gap-0.5 text-sm md:text-xs px-2.5 py-1.5 rounded-lg font-medium cursor-pointer liquid-transition min-w-[120px] ${uploadingSmeta ? (smetaMsg.startsWith('✓') ? "bg-green-500/15 text-green-800 dark:text-green-400 cursor-not-allowed" : smetaMsg.startsWith('✗') ? "bg-destructive/15 text-destructive cursor-not-allowed" : "bg-accent text-white cursor-wait dark:bg-accent/10 dark:text-accent") : "bg-accent text-white hover:bg-accent/90 dark:bg-accent/10 dark:text-accent dark:hover:bg-accent/20"}`}>
            {uploadingSmeta ? (
              <>
                <div className="flex items-center gap-1 text-center">
                  {smetaMsg.startsWith('✓') ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0"/> : smetaMsg.startsWith('✗') ? <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/> : <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0"/>}
                  <span className="truncate max-w-[180px]">{smetaMsg.replace(/^[✓✗]\s*/, '') || t('objectDetail.uploading')}</span>
                </div>
                {smetaPercent > 0 && !smetaMsg.startsWith('✗') && <div className="w-full bg-accent/20 rounded-full h-1 mt-0.5"><div className={`${smetaMsg.startsWith('✓') ? 'bg-green-500' : 'bg-accent'} h-1 rounded-full liquid-transition`} style={{width:`${smetaPercent}%`}}/></div>}
              </>
            ) : <><Download className="w-3.5 h-3.5"/>{t('objectDetail.smetaUpload')}</>}
          </label>
          <button onClick={()=>{setInitialTransferData(undefined);setShowSend(true);}} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2.5 py-1.5 rounded hover:bg-primary/90 font-medium liquid-transition shadow-sm"><Send className="w-3.5 h-3.5"/>{t('common.send')}</button>
        </div>
      </div>
      <div className="glass border-b border-border px-3 py-2 flex gap-1 flex-shrink-0 z-10 sticky top-[53px] overflow-x-auto scrollbar-hide">
        {([["required",t('objectDetail.tabRequired'),project.requiredMaterials.length], ...(project.smeta ? [["smeta",t('objectDetail.tabSmeta'),project.smeta.resources.length] as [string,string,number]] : []), ["pending",t('objectDetail.tabPending'),pendT.length],["confirmed",t('objectDetail.tabConfirmed'),confT.length]] as [string,string,number][]).map(([k,l,c])=>(
          <button key={k} onClick={()=>setTab(k as any)} className={`relative flex items-center gap-1.5 text-sm md:text-xs py-2 px-3 rounded-full font-medium liquid-transition whitespace-nowrap ${tab===k?"text-primary":"text-muted-foreground hover:text-foreground"}`}>
            {tab===k && (
              <motion.div layoutId="objectDetailTabPill" className="absolute inset-0 rounded-full bg-primary/10 -z-10"
                transition={{ type: "spring", stiffness: 480, damping: 34 }}/>
            )}
            {l}<span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${tab===k?"bg-primary text-white":"bg-muted text-muted-foreground"}`}>{c}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {tab==="smeta" && project.smeta && <SmetaResultView smeta={project.smeta}/>}
        {tab==="required" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Kompakt tepa: qidiruv + soni + byudjet (bitta yupqa qator) */}
            <div className="flex-shrink-0 flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50 bg-muted/10">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"/>
                <input type="text" placeholder={t('objectDetail.searchMaterial')} value={matSearch} onChange={e=>setMatSearch(e.target.value)} className="w-full pl-7 pr-2 py-1 text-[11px] bg-input-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"/>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{filteredMats.length} ta · {fmt(project.budget)}</span>
            </div>
            {/* Zich jadval — barcha materiallar minimal joyda */}
            <div className="flex-1 overflow-y-auto scrollbar-hide pb-20 sm:pb-2">
              <table className="w-full text-left border-collapse text-[11px] leading-tight">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 font-semibold">{t('objectDetail.colName')}</th>
                    <th className="px-2 py-1 font-semibold whitespace-nowrap">{t('objectDetail.colUnit')}</th>
                    <th className="px-2 py-1 font-semibold text-right whitespace-nowrap">{t('objectDetail.colQty')}</th>
                    <th className="px-2 py-1 font-semibold text-right whitespace-nowrap">{t('objectDetail.colPrice')}</th>
                    <th className="px-2 py-1 font-semibold text-right whitespace-nowrap">{t('objectDetail.colAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMats.map(m => {
                    const total = m.price != null ? m.price * m.quantity : null;
                    return (
                      <tr key={m.id} onClick={() => setSelectedMat(m)} className="cursor-pointer hover:bg-muted/30 border-b border-border/25">
                        <td className="px-2 py-0.5 font-medium text-primary whitespace-normal leading-tight" title={m.name}>{m.name}</td>
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap">{m.unit}</td>
                        <td className="px-2 py-0.5 font-mono text-right whitespace-nowrap">{fmtNum(m.quantity)}</td>
                        <td className="px-2 py-0.5 font-mono text-right whitespace-nowrap">{m.price != null ? fmtNum(m.price) : "-"}</td>
                        <td className="px-2 py-0.5 font-mono text-right font-semibold whitespace-nowrap">{total != null ? fmtNum(total) : "-"}</td>
                      </tr>
                    );
                  })}
                  {filteredMats.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{project.requiredMaterials.length === 0 ? t('objectDetail.noSmeta') : t('common.notFound')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab==="pending" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {pendT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-400 opacity-50"/><p className="text-sm md:text-xs">{t('objectDetail.noPending')}</p></div>
            :pendT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
        {tab==="confirmed" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {confT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><Package className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm md:text-xs">{t('objectDetail.noConfirmed')}</p></div>
            :confT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
      </div>
      {showSend && <SendTransferModal currentUser={currentUser} projects={[project]} allUsers={users} onClose={()=>setShowSend(false)} onSend={t=>{onSendTransfer(t);setShowSend(false);}} initialTransfer={initialTransferData}/>}
      {selectedMat && <MaterialDetailsModal mat={selectedMat} confT={confT} pendT={pendT} onClose={() => setSelectedMat(null)} onSend={() => {
        setInitialTransferData({ projectId: project.id, materialName: selectedMat.name, unit: selectedMat.unit });
        setShowSend(true);
      }} />}
    </div>
  );
}

// ─── Material Details Modal ───────────────────────────────────────────────────
function MaterialDetailsModal({ mat, confT, pendT, onClose, onSend }: { mat: ReqMat; confT: Transfer[]; pendT: Transfer[]; onClose: () => void; onSend?: () => void; }) {
  // `t` diqqat: bu komponentda transfer o'zgaruvchisi sifatida ham ishlatiladi
  // (.filter/.map(t=>...)), shuning uchun tarjima funksiyasi `tt` deb nomlangan.
  const { t: tt } = useTranslation();
  useModalPresence();
  const sent = confT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const pending = pendT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const totalSpent = sent * (mat.price || 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex flex-col justify-end sm:justify-center sm:items-center backdrop-blur-sm liquid-transition">
      <div className="bg-background/90 backdrop-blur-xl w-full sm:w-[450px] sm:rounded-2xl rounded-t-[2rem] overflow-hidden animate-slide-up-fade flex flex-col shadow-2xl border border-white/20">
        <div className="p-5 border-b border-border/50 flex justify-between items-center bg-card/50">
          <h3 className="font-semibold text-base truncate pr-4">{mat.name}</h3>
          <div className="flex items-center gap-2">
            {onSend && <button onClick={()=>{onClose(); onSend();}} className="flex items-center gap-1.5 bg-primary text-white text-sm md:text-xs px-3 py-1.5 rounded-full hover:bg-primary/90 font-medium liquid-transition shadow-md shadow-primary/20"><Send className="w-3 h-3"/>{tt('common.send')}</button>}
            <button aria-label={tt('common.close')} onClick={onClose} className="p-1.5 text-muted-foreground hover:bg-muted/50 rounded-full liquid-transition bg-muted/20"><X className="w-4 h-4"/></button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-muted p-2.5 rounded-lg border border-border">
              <p className="text-sm md:text-xs text-muted-foreground mb-1">{tt('materialDetails.planned')}</p>
              <p className="font-semibold text-sm">{mat.quantity.toLocaleString()} <span className="text-sm md:text-xs font-normal">{mat.unit}</span></p>
              {mat.price ? <p className="text-sm md:text-xs text-muted-foreground mt-1">{tt('materialDetails.priceLabel', { price: fmt(mat.price), unit: mat.unit })}</p> : <p className="text-sm md:text-xs text-muted-foreground mt-1">{tt('materialDetails.noPriceSet')}</p>}
            </div>
            <div className="bg-green-500/10 p-2.5 rounded-lg border border-green-500/20">
              <p className="text-sm md:text-xs text-green-700 dark:text-green-400 mb-1">{tt('materialDetails.delivered')}</p>
              <p className="font-semibold text-sm text-green-700 dark:text-green-400">{sent.toLocaleString()} <span className="text-sm md:text-xs font-normal">{mat.unit}</span></p>
              {(mat.price ?? 0) > 0 && <p className="text-sm md:text-xs text-green-700/70 mt-1">{tt('materialDetails.totalSpent', { amount: fmt(totalSpent) })}</p>}
            </div>
          </div>

          <h4 className="text-sm md:text-xs font-semibold mb-2">{tt('materialDetails.history')}</h4>
          {confT.filter(t=>t.materialName===mat.name).length === 0 && pendT.filter(t=>t.materialName===mat.name).length === 0 ? (
             <p className="text-sm md:text-xs text-muted-foreground py-4 text-center">{tt('materialDetails.noHistory')}</p>
          ) : (
            <div className="space-y-2">
              {pendT.filter(t=>t.materialName===mat.name).map(t => (
                <div key={t.id} className="border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded p-2 text-sm md:text-xs">
                  <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-500 mb-1"><span>{t.quantity.toLocaleString()} {t.unit} {tt('materialDetails.pendingSuffix')}</span><span>{(t.date || t.sentDate || '').split('T')[0]}</span></div>
                  <p className="text-sm md:text-xs text-amber-700/70">{tt('materialDetails.sender', { name: t.fromUserName })}</p>
                </div>
              ))}
              {confT.filter(t=>t.materialName===mat.name).map(t => (
                <div key={t.id} className="border border-border bg-card rounded p-2 text-sm md:text-xs">
                  <div className="flex justify-between font-semibold mb-1"><span>{t.quantity.toLocaleString()} {t.unit}</span><span className="text-muted-foreground text-sm md:text-xs">{t.confirmedDate?.split('T')[0] || (t.date || t.sentDate || '').split('T')[0]}</span></div>
                  <p className="text-sm md:text-xs text-muted-foreground">{tt('materialDetails.sender', { name: t.fromUserName })}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Finance Page ──────────────────────────────────────────────────────────────
function FinancePage({ currentUser, users, projects, expenses, onAddExpense, onConfirm }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; expenses: Expense[]; onAddExpense: (e: Expense) => void; onConfirm: (id: string) => void }) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"all"|ExpType>("all");
  const [projFilter, setProjFilter] = useState("all");
  const [detailExp, setDetailExp] = useState<Expense|null>(null);

  const filteredExpenses = expenses.filter(e => (filter==="all"||e.type===filter) && (projFilter==="all"||e.projectId===projFilter));

  const totalExpense = expenses.filter(e=>e.status==="confirmed").reduce((a,e)=>a+e.amount,0);
  const pendingMe = expenses.filter(e=>e.toUserId===currentUser.id&&e.status==="pending").length;
  const typeClr: Record<string,string> = {
    oylik:"bg-blue-500/15 text-blue-700 dark:text-blue-300",
    material:"bg-orange-500/15 text-orange-800 dark:text-orange-300",
    jihozlar:"bg-purple-500/15 text-purple-700 dark:text-purple-300",
    transport:"bg-teal-500/15 text-teal-700 dark:text-teal-300",
    boshqa:"bg-muted text-muted-foreground"
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      {/* Header */}
      <div className="surface px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-bold font-['Roboto_Slab',serif]">{t('finance.title')}</h2>
          <p className="text-sm md:text-xs text-muted-foreground">{t('finance.totalConfirmed')} <span className="font-semibold text-accent">{fmt(totalExpense)}</span></p>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingMe>0&&<span className="text-sm md:text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-full font-semibold flex items-center gap-1 badge-pulse"><Clock className="w-3 h-3"/>{t('finance.pendingCount', { count: pendingMe })}</span>}
          <button onClick={()=>setShowAdd(true)} className="btn btn-accent flex items-center gap-1 text-sm md:text-xs px-3 py-1.5 rounded-full"><Plus className="w-3 h-3"/>{t('finance.addExpense')}</button>
        </div>
      </div>

      {/* Filters */}
      <div className="surface px-4 py-2.5 flex gap-2 flex-wrap flex-shrink-0">
        <select className="text-sm md:text-xs border border-border rounded-full px-3 py-1.5 bg-input-background focus:outline-none" value={projFilter} onChange={e=>setProjFilter(e.target.value)}>
          <option value="all">{t('finance.allObjects')}</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={()=>setFilter("all")} className={`text-sm md:text-xs px-3 py-1.5 rounded-full font-medium liquid-transition ${filter==="all"?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{t('finance.all')}</button>
          {(Object.keys(EXP_LABELS) as ExpType[]).map(k=><button key={k} onClick={()=>setFilter(k)} className={`text-sm md:text-xs px-3 py-1.5 rounded-full font-medium liquid-transition ${filter===k?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{EXP_LABELS[k]}</button>)}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 scrollbar-hide">
        {filteredExpenses.length===0
          ? <div className="text-center py-10 text-muted-foreground"><Wallet className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm md:text-xs">{t('finance.notFound')}</p></div>
          : filteredExpenses.map(e=>{
              const to=users.find(u=>u.id===e.toUserId);
              const proj=projects.find(p=>p.id===e.projectId);
              const creator=users.find(u=>u.id===e.createdById);
              const canConfirm=e.toUserId===currentUser.id&&e.status==="pending";
              return (
                <button key={e.id} onClick={()=>setDetailExp(e)} className="w-full text-left surface rounded-2xl p-3 text-sm md:text-xs hover:bg-muted/20 liquid-transition" style={{ borderLeft: `4px solid ${e.status==="confirmed"?"#22c55e":"#f59e0b"}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${typeClr[e.type] || "bg-muted text-muted-foreground"}`}>{EXP_LABELS[e.type as ExpType] || e.type}</span>
                      </div>
                      <p className="font-semibold text-foreground">{e.description || EXP_LABELS[e.type as ExpType]}</p>
                      <p className="text-sm md:text-xs text-muted-foreground mt-0.5">{proj?.name || "—"} • {e.date}</p>
                      {to&&<p className="text-sm md:text-xs text-muted-foreground">{t('finance.to')} <span className="font-medium">{to.name}</span></p>}
                      {creator&&<p className="text-sm md:text-xs text-muted-foreground">{t('finance.createdBy')} {creator.name}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-accent">{fmt(e.amount)}</p>
                      {e.status==="confirmed"
                        ?<p className="text-[9px] text-green-800 dark:text-green-400 font-semibold mt-1 flex items-center gap-0.5 justify-end"><CheckCircle className="w-2.5 h-2.5"/>{t('finance.confirmed')}</p>
                        :<p className="text-[9px] text-amber-800 dark:text-amber-400 font-semibold mt-1 flex items-center gap-0.5 justify-end"><Clock className="w-2.5 h-2.5"/>{t('finance.pending')}</p>}
                    </div>
                  </div>
                  {canConfirm&&<button onClick={e2=>{e2.stopPropagation();onConfirm(e.id);}} className="mt-2 w-full text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><Check className="w-3 h-3"/>{t('finance.confirmAction')}</button>}
                </button>
              );
            })
        }
      </div>

      {showAdd&&<AddExpenseModal currentUser={currentUser} projects={projects} allUsers={users} onClose={()=>setShowAdd(false)} onAdd={onAddExpense}/>}
      {detailExp&&<ExpenseDetailModal expense={detailExp} users={users} projects={projects} onClose={()=>setDetailExp(null)}/>}
    </div>
  );
}

function ExpenseDetailModal({ expense, users, projects, onClose }: { expense: Expense; users: AppUser[]; projects: Project[]; onClose: () => void }) {
  const { t } = useTranslation();
  const to = users.find(u => u.id === expense.toUserId);
  const proj = projects.find(p => p.id === expense.projectId);
  const creator = users.find(u => u.id === expense.createdById);
  const confirmer = users.find(u => u.id === expense.confirmedById);
  const rows: [string, string][] = [
    [t('reports.table.date'), expense.date],
    [t('reports.table.type'), EXP_LABELS[expense.type]],
    [t('finance.to'), to?.name || "—"],
    [t('reports.table.project'), proj?.name || "—"],
    [t('finance.createdBy'), creator?.name || "—"],
    ...(confirmer ? [[t('finance.confirmedBy'), confirmer.name] as [string, string]] : []),
  ];
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm overflow-hidden animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><Wallet className="w-4 h-4 text-accent"/>{t('finance.detailTitle')}</h3>
          <button aria-label={t('common.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <p className="text-base font-bold text-foreground">{expense.description || EXP_LABELS[expense.type]}</p>
            <p className="text-lg font-bold text-accent font-mono mt-1">{fmt(expense.amount)}</p>
          </div>
          <div className="surface divide-y divide-border/50 overflow-hidden">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-3 py-2 text-sm md:text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{value}</span>
              </div>
            ))}
          </div>
          <button onClick={() => exportExpensesToCsv([expense], users, projects, `chiqim_${expense.date}.csv`)}
            className="btn btn-outline w-full flex items-center justify-center gap-1.5 text-sm md:text-xs py-2.5 rounded-full">
            <Download className="w-3.5 h-3.5"/>{t('reports.exportExcel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Voice Message Player ─────────────────────────────────────────────────────
export function VoicePlayer({ src, mine }: { src: string; mine?: boolean }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (playing) { a.pause(); } else { a.play().catch(() => {}); }
    setPlaying(!playing);
  };
  const fmtTime = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

  // "Waveform" ko'rinishi — haqiqiy audio amplitudasi emas (bu client-side og'ir
  // dekodlashni talab qiladi), balki src'ga bog'liq DETERMINISTIK naqsh — shu
  // xabar uchun har safar bir xil chiqadi, faqat vizual jihatdan WhatsApp uslubiga
  // yaqinlashtiradi.
  const bars = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
    return Array.from({ length: 28 }, () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return 0.22 + ((seed >>> 8) / 0xFFFFFF) * 0.78;
    });
  }, [src]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (audioRef.current?.duration) audioRef.current.currentTime = pct * audioRef.current.duration;
  };

  return (
    <div className="flex items-center gap-2 mb-1 min-w-[200px] max-w-[250px]">
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        onTimeUpdate={e => { const a = e.target as HTMLAudioElement; setCurrentTime(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0); }}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime=0; }}
      />
      <button onClick={toggle} aria-label={playing ? t('chat.pause') : t('chat.play')}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-all
          ${mine ? "bg-white/25 text-white hover:bg-white/35" : "bg-primary/15 text-primary hover:bg-primary/25"}`}>
        {playing
          ? <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 ml-0.5"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="relative h-6 flex items-center gap-[2px] cursor-pointer" onClick={seek}>
          {bars.map((h, i) => {
            const played = (i / bars.length) * 100 <= progress;
            const activeColor = mine ? "bg-white" : "bg-primary";
            const idleColor = mine ? "bg-white/30" : "bg-current/20";
            return (
              <div key={i} className={`flex-1 rounded-full transition-colors ${played ? activeColor : idleColor}`}
                style={{ height: `${Math.round(h * 100)}%` }}/>
            );
          })}
        </div>
        <div className={`flex justify-between text-[9px] ${mine ? "text-white/70" : "text-current/50"}`}>
          <span>{fmtTime(currentTime)}</span>
          <span>{duration > 0 ? fmtTime(duration) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Chat Page ─────────────────────────────────────────────────────────────────
function ChatPage({ currentUser, users, messages, groups, onlineUsers, onSend, onMarkRead, onEdit, onDelete, onPin, onChatOpen, onCreateGroup, onStartCall, canModifyMessages, onGetDevSupport }:
  {
    currentUser: AppUser; users: AppUser[]; messages: Msg[];
    groups: Group[]; onlineUsers: string[];
    onSend: (m: Msg) => void; onMarkRead: (id: string) => void;
    onEdit: (id: string, text: string) => void;
    onDelete: (id: string) => void;
    onPin: (id: string) => void;
    onChatOpen: (open: boolean) => void;
    onCreateGroup: (name: string, memberIds: string[]) => Promise<any>;
    onStartCall: (mode: 'voice'|'video', target: { peer?: AppUser; group?: Group }) => void;
    canModifyMessages?: boolean;
    onGetDevSupport?: () => Promise<Group|null>;
  }
) {
  const [selUser, setSelUser] = useState<AppUser|null>(null);
  const [selGroup, setSelGroup] = useState<Group|null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [text, setText] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{msgId:string; x:number; y:number}|null>(null);
  const [replyTo, setReplyTo] = useState<Msg|null>(null);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editText, setEditText] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForward, setShowForward] = useState<Msg|null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);

  const mediaRecRef = useRef<MediaRecorder|null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const fileImgRef = useRef<HTMLInputElement>(null);
  const fileAllRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const contacts = users.filter(u => u.id !== currentUser.id);
  const userById = (id: string) => users.find(u => u.id === id);
  const isOnline = (id: string) => onlineUsers.includes(id);

  // Har bir guruh/kontakt uchun oxirgi xabar + o'qilmagan sonini BITTA o'tishda
  // hisoblaymiz. Avval sidebar'dagi HAR BIR qator butun `messages` massivini
  // o'zi alohida filter qilardi (N kontakt × M xabar) — har renderda, hatto
  // shunchaki matn yozayotganda ham — xabar tarixi o'sgani sari sezilarli
  // sekinlashardi ("chat sekin ketyapti").
  const { lastByGroup, lastByUser, unreadByUser } = useMemo(() => {
    const lastByGroup = new Map<string, Msg>();
    const lastByUser = new Map<string, Msg>();
    const unreadByUser = new Map<string, number>();
    for (const m of messages) {
      if (m.deleted) continue;
      if (m.groupId) {
        lastByGroup.set(m.groupId, m);
      } else {
        const other = m.fromUserId === currentUser.id ? m.toUserId : m.fromUserId;
        if (!other) continue;
        lastByUser.set(other, m);
        if (m.toUserId === currentUser.id && !m.read) {
          unreadByUser.set(other, (unreadByUser.get(other) || 0) + 1);
        }
      }
    }
    return { lastByGroup, lastByUser, unreadByUser };
  }, [messages, currentUser.id]);
  const unread = (uid: string) => unreadByUser.get(uid) || 0;

  const thread = useMemo(() => (
    selGroup
      ? messages.filter(m => !m.deleted && m.groupId === selGroup.id)
      : selUser
        ? messages.filter(m =>
            !m.deleted && !m.groupId &&
            ((m.fromUserId===currentUser.id && m.toUserId===selUser.id) ||
             (m.fromUserId===selUser.id && m.toUserId===currentUser.id)))
        : []
  ), [messages, selGroup?.id, selUser?.id, currentUser.id]);
  const pinned = thread.filter(m => m.pinned).slice(-1)[0] ?? null;

  const closeChat = () => { setSelUser(null); setSelGroup(null); setSelectMode(false); setSelected(new Set()); };

  useEffect(() => { onChatOpen(!!(selUser || selGroup)); }, [selUser, selGroup]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (selUser && unread(selUser.id) > 0) onMarkRead(selUser.id);
  }, [thread.length, selUser, selGroup]);

  const doSend = (extras: Partial<Msg> = {}) => {
    if (!selUser && !selGroup) return;
    const msgText = (extras.text !== undefined ? extras.text : text).trim();
    if (!msgText && !extras.mediaUrl && !extras.location) return;
    const msg: Msg = {
      id: `msg${Date.now()}`,
      fromUserId: currentUser.id,
      toUserId: selGroup ? '' : selUser!.id,
      ...(selGroup ? { groupId: selGroup.id } : {}),
      text: msgText,
      timestamp: new Date().toISOString(),
      read: false,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
      ...extras,
    };
    onSend(msg);
    setText(""); setReplyTo(null); setShowAttach(false);
  };

  // Media serverga yuklanadi — blob emas, qabul qiluvchi ham ko'radi
  const sendMedia = async (blob: Blob | File, type: NonNullable<Msg['type']>, label: string, filename?: string) => {
    if (!selUser && !selGroup) return;
    try {
      const up = await uploadChatMedia(blob, filename);
      doSend({ type, text: label, mediaUrl: up.url, fileName: up.fileName, fileSize: up.fileSize });
    } catch { toast("Media yuklanmadi"); }
  };

  const startRec = async () => {
    if (!selUser && !selGroup) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendMedia(blob, 'audio', '🎤 Ovozli xabar', 'voice.webm');
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRecRef.current = mr;
      setIsRecording(true); setRecSec(0);
      timerRef.current = setInterval(() => setRecSec(s => s + 1), 1000);
    } catch { toast.error("Mikrofon ruxsati kerak"); }
  };
  const stopRec = () => {
    mediaRecRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  };
  const cancelRec = () => {
    if (mediaRecRef.current?.state === 'recording') {
      mediaRecRef.current.ondataavailable = null;
      mediaRecRef.current.onstop = null;
      mediaRecRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false); audioChunksRef.current = [];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || (!selUser && !selGroup)) return;
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    sendMedia(file, isImg ? 'image' : isVid ? 'video' : 'file',
      isImg ? '🖼️ Rasm' : isVid ? '🎥 Video' : `📎 ${file.name}`, file.name);
    e.target.value = '';
    setShowAttach(false);
  };

  const sendLocation = () => {
    if (!navigator.geolocation) { toast.error("Brauzer geolokatsiyani qo'llab-quvvatlamaydi"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => doSend({ type: 'location', text: '📍 Lokatsiya', location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => toast.error("Lokatsiya ruxsati berilmadi")
    );
    setShowAttach(false);
  };

  const ctxMsg = ctxMenu ? (messages.find(m => m.id === ctxMenu.msgId) ?? null) : null;
  const ctxMine = ctxMsg?.fromUserId === currentUser.id;

  const startLongPress = (msgId: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressRef.current = setTimeout(() => setCtxMenu({ msgId, x: touch.clientX, y: touch.clientY }), 500);
  };
  const endLongPress = () => { if (longPressRef.current) clearTimeout(longPressRef.current); };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const saveEdit = () => {
    if (editingId && editText.trim()) onEdit(editingId, editText.trim());
    setEditingId(null); setEditText("");
  };

  const fmtTime = (sec: number) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  const fmtSize = (n?: number) => n == null ? '' : n > 1e6 ? `${(n/1e6).toFixed(1)} MB` : `${Math.round(n/1e3)} KB`;
  const findMsg = (id: string) => messages.find(m => m.id === id) ?? null;

  const renderBubble = (m: Msg, mine: boolean) => {
    if (m.deleted) return <p className="italic opacity-50 text-xs">Xabar o'chirildi</p>;
    const replyMsg = m.replyToId ? findMsg(m.replyToId) : null;
    return (
      <>
        {/* Guruhda — yuboruvchi nomi (o'zganiki) */}
        {selGroup && !mine && (
          <p className="text-[11px] font-bold mb-0.5" style={{ color: 'var(--primary)' }}>{userById(m.fromUserId)?.name || 'Nomaʼlum'}</p>
        )}
        {replyMsg && (
          <div className={`border-l-2 ${mine?'border-white/50':'border-primary/50'} pl-2 mb-1.5 opacity-75 max-w-full`}>
            <p className="text-[10px] font-semibold">{replyMsg.fromUserId===currentUser.id?'Siz':userById(replyMsg.fromUserId)?.name}</p>
            <p className="text-[10px] truncate">{replyMsg.type==='audio'?'🎤 Ovoz':replyMsg.type==='image'?'🖼️ Rasm':replyMsg.type==='location'?'📍 Joylashuv':replyMsg.text}</p>
          </div>
        )}
        {m.type==='image' && m.mediaUrl && (
          <img src={m.mediaUrl} alt="Rasm" loading="lazy" decoding="async" className="rounded-xl max-w-full max-h-52 object-cover mb-1 cursor-pointer" onClick={()=>window.open(m.mediaUrl,'_blank')}/>
        )}
        {m.type==='video' && m.mediaUrl && (
          <video src={m.mediaUrl} controls preload="metadata" className="rounded-xl max-w-full max-h-52 mb-1"/>
        )}
        {m.type==='audio' && m.mediaUrl && (
          <VoicePlayer src={m.mediaUrl} mine={mine}/>
        )}
        {m.type==='file' && m.mediaUrl && (
          <a href={m.mediaUrl} download={m.fileName} className="flex items-center gap-2 mb-1 hover:opacity-75 transition-opacity">
            <FileText className="w-5 h-5 flex-shrink-0"/>
            <div className="min-w-0"><p className="text-xs font-medium truncate max-w-[150px]">{m.fileName}</p><p className="text-[10px] opacity-60">{fmtSize(m.fileSize)}</p></div>
          </a>
        )}
        {m.type==='location' && m.location && (
          <a href={`https://maps.google.com/?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/10 rounded-xl px-3 py-2 mb-1 hover:bg-black/20 transition-colors">
            <MapPin className="w-4 h-4 text-green-400 flex-shrink-0"/>
            <div><p className="text-xs font-medium">Lokatsiya</p><p className="text-[10px] opacity-70">{m.location.lat.toFixed(4)}, {m.location.lng.toFixed(4)}</p></div>
          </a>
        )}
        {m.text && !['🖼️ Rasm','🎥 Video','🎤 Ovozli xabar','📍 Lokatsiya'].includes(m.text) && (
          <p className="leading-relaxed whitespace-pre-wrap break-words text-sm md:text-xs">{m.text}</p>
        )}
      </>
    );
  };

  return (
    <div className="flex h-full w-full" onClick={() => { setCtxMenu(null); setShowAttach(false); }}>
      <input ref={fileImgRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange}/>
      <input ref={fileAllRef} type="file" accept="*/*" className="hidden" onChange={handleFileChange}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange}/>

      {/* Contacts List */}
      <div className={`${(selUser||selGroup)?'hidden md:flex':'flex'} w-full md:w-64 flex-shrink-0 border-r border-border flex-col bg-card/60 backdrop-blur-xl`}>
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
          <p className="text-base font-bold">Xabarlar</p>
          <button onClick={() => setShowNewGroup(true)} title="Yangi guruh" className="btn btn-primary w-8 h-8 p-0 rounded-full"><Users2 className="w-4 h-4"/></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {/* Guruhlar */}
          {groups.filter(g => !g.devSupport).map(g => {
            const last = lastByGroup.get(g.id);
            const lastText = last ? `${userById(last.fromUserId)?.name?.split(' ')[0] || ''}: ${last.type&&last.type!=='text'?(last.type==='audio'?'🎤 Ovoz':last.type==='image'?'🖼️ Rasm':last.type==='video'?'🎥 Video':last.type==='location'?'📍 Joylashuv':`📎 ${last.fileName??'Fayl'}`):last.text}` : `${g.memberIds.length} a'zo`;
            return (
              <button key={g.id} onClick={() => { setSelGroup(g); setSelUser(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-2.5 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 transition-colors text-left ${selGroup?.id===g.id?'bg-secondary/60':''}`}>
                <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {g.avatar ? <img src={g.avatar} className="w-full h-full object-cover"/> : <Users2 className="w-[18px] h-[18px]"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">{g.name}</p>
                    {last && <p className="text-[10px] text-muted-foreground ml-1 flex-shrink-0">{new Date(last.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"})}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{lastText}</p>
                </div>
              </button>
            );
          })}
          {/* devSupport — ko'rinishi: to'g'ridan-to'g'ri chat (guruh emas) */}
          {groups.filter(g => g.devSupport).map(g => {
            const last = lastByGroup.get(g.id);
            const lastText = last ? `${last.type&&last.type!=='text'?(last.type==='audio'?'🎤 Ovoz':last.type==='image'?'🖼️ Rasm':last.type==='video'?'🎥 Video':last.type==='location'?'📍 Joylashuv':`📎 ${last.fileName??'Fayl'}`):last.text}` : 'Texnik yordam';
            return (
              <button key={g.id} onClick={() => { setSelGroup(g); setSelUser(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-2.5 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 transition-colors text-left ${selGroup?.id===g.id?'bg-secondary/60':''}`}>
                <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0 text-xl">🛠</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">Dasturchi</p>
                    {last && <p className="text-[10px] text-muted-foreground ml-1 flex-shrink-0">{new Date(last.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"})}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{lastText}</p>
                </div>
              </button>
            );
          })}
          {/* Dasturchi virtual entry — only for company members who don't yet have devSupport group */}
          {currentUser.role !== 'dasturchi' && currentUser.companyId && onGetDevSupport && !groups.some(g => g.devSupport) && (
            <button onClick={async () => { const g = await onGetDevSupport(); if (g) { setSelGroup(g); setSelUser(null); } }}
              className="w-full flex items-center gap-2.5 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 transition-colors text-left">
              <div className="w-9 h-9 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center flex-shrink-0 text-lg">🛠</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">Dasturchi</p>
                <p className="text-xs text-muted-foreground truncate">Texnik yordam</p>
              </div>
            </button>
          )}
          {contacts.length===0 && groups.length===0 && <p className="text-center text-xs text-muted-foreground py-8">Kontaktlar yo'q</p>}
          {contacts.length===0 && groups.length>0 && <p className="text-center text-xs text-muted-foreground py-4 px-3">Bu kompaniyada boshqa foydalanuvchi yo'q</p>}
          {contacts.map(u => {
            const last = lastByUser.get(u.id);
            const ur = unread(u.id);
            const lastText = last ? (last.type==='audio'?'🎤 Ovoz':last.type==='image'?'🖼️ Rasm':last.type==='video'?'🎥 Video':last.type==='location'?'📍 Joylashuv':last.type==='file'?`📎 ${last.fileName??'Fayl'}`:last.text) : '...';
            return (
              <button key={u.id} onClick={() => { setSelUser(u); setSelGroup(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-2.5 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 transition-colors text-left ${selUser?.id===u.id?'bg-secondary/60':''}`}>
                <div className="relative flex-shrink-0">
                  <Avatar user={u} size="sm"/>
                  {isOnline(u.id) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-card"/>}
                  {ur>0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent rounded-full text-[9px] text-white flex items-center justify-center font-bold">{ur}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">{u.name}</p>
                    {last && <p className="text-[10px] text-muted-foreground ml-1 flex-shrink-0">{new Date(last.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"})}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{isOnline(u.id) && !last ? "onlayn" : lastText}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail View */}
      <div className={`${!(selUser||selGroup)?'hidden md:flex':'flex'} flex-1 flex-col overflow-hidden bg-background/50`} onClick={e=>e.stopPropagation()}>
        {!(selUser||selGroup) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center animate-pop-in"><MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-20"/><p className="text-sm">Suhbatdosh tanlang</p></div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="glass border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0 z-10">
              <button onClick={closeChat} aria-label="Orqaga" className="md:hidden p-2 -ml-2 mr-1 text-muted-foreground hover:bg-muted rounded-full transition-colors">
                <ChevronLeft className="w-5 h-5"/>
              </button>
              {selGroup ? (
                selGroup.devSupport
                  ? <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0 text-xl">🛠</div>
                  : <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {selGroup.avatar ? <img src={selGroup.avatar} className="w-full h-full object-cover"/> : <Users2 className="w-[18px] h-[18px]"/>}
                    </div>
              ) : <div className="relative"><Avatar user={selUser!} size="sm"/>{isOnline(selUser!.id) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-card"/>}</div>}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{selGroup ? (selGroup.devSupport ? 'Dasturchi' : selGroup.name) : selUser!.name}</p>
                {selGroup
                  ? <p className="text-[11px] text-muted-foreground truncate">{selGroup.devSupport ? 'Texnik yordam' : `${selGroup.memberIds.length} a'zo`}</p>
                  : <p className="text-[11px] text-muted-foreground">{isOnline(selUser!.id) ? <span className="text-green-800 dark:text-green-400">onlayn</span> : ROLE_LABELS[selUser!.role]}</p>}
              </div>
              {!selectMode && !selGroup?.devSupport && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => onStartCall('voice', { peer: selUser || undefined, group: selGroup || undefined })} title="Ovozli qo'ng'iroq" className="btn btn-ghost w-9 h-9 p-0 rounded-full text-primary"><Phone className="w-[18px] h-[18px]"/></button>
                  <button onClick={() => onStartCall('video', { peer: selUser || undefined, group: selGroup || undefined })} title="Video qo'ng'iroq" className="btn btn-ghost w-9 h-9 p-0 rounded-full text-primary"><VideoIcon className="w-[18px] h-[18px]"/></button>
                </div>
              )}
              {selectMode && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">{selected.size} ta</span>
                  {selected.size>0 && <>
                    <button aria-label="Uzatish" onClick={() => { const msg=messages.find(m=>m.id===[...selected][0]); if(msg) setShowForward(msg); }} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><Share2 className="w-4 h-4"/></button>
                    <button aria-label="Tanlanganlarni o'chirish" onClick={() => { selected.forEach(id=>onDelete(id)); setSelectMode(false); setSelected(new Set()); }} className="p-2 hover:bg-red-500/100/10 rounded-full text-red-500"><Trash2 className="w-4 h-4"/></button>
                  </>}
                  <button aria-label="Tanlashni bekor qilish" onClick={() => { setSelectMode(false); setSelected(new Set()); }} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><X className="w-4 h-4"/></button>
                </div>
              )}
            </div>

            {/* Pinned */}
            {pinned && (
              <div className="bg-primary/5 border-b border-primary/10 px-4 py-2 flex items-center gap-2">
                <div className="w-0.5 h-7 bg-primary rounded-full flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-primary">📌 Muhim xabar</p>
                  <p className="text-xs text-muted-foreground truncate">{pinned.type==='audio'?'🎤 Ovoz':pinned.type==='image'?'🖼️ Rasm':pinned.type==='location'?'📍 Joylashuv':pinned.text}</p>
                </div>
                <button aria-label="Qadalgan xabarni yopish" onClick={()=>onPin(pinned.id)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-3.5 h-3.5"/></button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scrollbar-hide relative" onClick={()=>{setCtxMenu(null);setShowAttach(false);}}>
              <div className="min-h-full flex flex-col justify-end gap-1.5 max-w-3xl mx-auto w-full p-3">
              {thread.length===0 && <div className="text-center py-8 text-muted-foreground text-sm">Xabar yo'q. Birinchi bo'ling!</div>}
              {thread.map(m => {
                const mine = m.fromUserId===currentUser.id;
                const isSel = selected.has(m.id);
                return (
                  <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'} ${selectMode?'pl-8 relative':''}`}
                    onClick={e=>{e.stopPropagation();if(selectMode)toggleSelect(m.id);}}>
                    {selectMode && (
                      <div className={`absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all ${isSel?'bg-primary border-primary':'bg-card border-border'}`}
                        onClick={e=>{e.stopPropagation();toggleSelect(m.id);}}>
                        {isSel && <Check className="w-3 h-3 text-white"/>}
                      </div>
                    )}
                    <div
                      onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!selectMode)setCtxMenu({msgId:m.id,x:e.clientX,y:e.clientY});}}
                      onTouchStart={e=>{if(!selectMode)startLongPress(m.id,e);}}
                      onTouchEnd={endLongPress} onTouchMove={endLongPress}
                      className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm cursor-pointer liquid-transition
                        ${mine?'bg-gradient-to-br from-primary to-primary/90 text-white rounded-br-sm':'bg-card/90 backdrop-blur-md border border-white/20 rounded-bl-sm'}
                        ${isSel?'ring-2 ring-primary ring-offset-1':''}
                        ${m.pinned?'ring-1 ring-amber-400/50':''}`}
                    >
                      {renderBubble(m, mine)}
                      <div className={`flex items-center justify-end gap-1 mt-1 ${mine?'text-white/60':'text-muted-foreground'}`}>
                        {m.edited && <span className="text-[9px] italic">tahrirlangan</span>}
                        {m.pinned && <span className="text-[9px]">📌</span>}
                        <span className="text-[9px]">{new Date(m.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"})}</span>
                        {mine && (m.read ? <CheckCheck className="w-3.5 h-3.5"/> : <Check className="w-3 h-3"/>)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef}/>
              </div>

              {/* Context Menu — document.body'ga portal qilinadi, chunki bu sahifa
                  `.page-enter` animatsiyasi ichida (will-change: transform) joylashgan
                  va CSS spec bo'yicha will-change:transform ham position:fixed uchun
                  YANGI containing block yaratadi — natijada menyu haqiqiy viewport'ga
                  emas, shu animatsiyalangan ota-elementga nisbatan joylashib, telefon
                  va noutbukda "kesilib qolgan"/joyidan siljigan holatda ko'rinardi. */}
              {ctxMenu && ctxMsg && createPortal(
                (() => {
                  const canEdit = canModifyMessages && !ctxMsg.deleted;
                  const rows = 4 + (canEdit ? 1 : 0) + (canModifyMessages ? 1 : 0);
                  const menuW = 176;
                  const menuH = rows * 36 + 12 + (canModifyMessages ? 9 : 0);
                  const vw = window.innerWidth, vh = window.innerHeight;
                  const left = Math.min(Math.max(8, ctxMenu.x), vw - menuW - 8);
                  const top = Math.min(Math.max(8, ctxMenu.y), vh - menuH - 8);
                  const itemCls = "flex items-center gap-2.5 px-3 py-2 hover:bg-primary/10 hover:text-primary rounded-lg cursor-pointer text-xs text-foreground/85 transition-colors";
                  return (
                    <div className="fixed z-[70] w-44 glass p-1.5 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-pop-in"
                      style={{ top, left }}
                      onClick={e=>e.stopPropagation()}>
                      <div onClick={()=>{setReplyTo(ctxMsg);setCtxMenu(null);}} className={itemCls}><CornerDownLeft className="w-3.5 h-3.5"/>Reply</div>
                      {canEdit && (
                        <div onClick={()=>{setEditingId(ctxMsg.id);setEditText(ctxMsg.text);setCtxMenu(null);}} className={itemCls}><Edit className="w-3.5 h-3.5"/>Edit</div>
                      )}
                      <div onClick={()=>{onPin(ctxMsg.id);setCtxMenu(null);}} className={itemCls}>
                        {ctxMsg.pinned ? <PinOff className="w-3.5 h-3.5"/> : <Pin className="w-3.5 h-3.5"/>}{ctxMsg.pinned?'Unpin':'Pin'}
                      </div>
                      <div onClick={()=>{setShowForward(ctxMsg);setCtxMenu(null);}} className={itemCls}><Share2 className="w-3.5 h-3.5"/>Forward</div>
                      <div onClick={()=>{setSelectMode(true);setSelected(new Set([ctxMsg.id]));setCtxMenu(null);}} className={itemCls}><SquareCheck className="w-3.5 h-3.5"/>Select</div>
                      {canModifyMessages && (
                        <>
                          <div className="h-px bg-border/60 my-0.5"/>
                          <div onClick={()=>{onDelete(ctxMsg.id);setCtxMenu(null);}} className="flex items-center gap-2.5 px-3 py-2 hover:bg-red-500/10 text-red-500 rounded-lg cursor-pointer text-xs transition-colors"><Trash2 className="w-3.5 h-3.5"/>Delete</div>
                        </>
                      )}
                    </div>
                  );
                })(),
                document.body
              )}
            </div>

            {/* Reply preview */}
            {replyTo && !editingId && (
              <div className="flex items-center gap-2 bg-muted/60 px-4 py-2 border-t border-border/30 flex-shrink-0">
                <div className="w-0.5 h-7 bg-primary rounded-full flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-primary">{replyTo.fromUserId===currentUser.id?'Siz':userById(replyTo.fromUserId)?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{replyTo.type==='audio'?'🎤 Ovoz':replyTo.type==='image'?'🖼️ Rasm':replyTo.text}</p>
                </div>
                <button aria-label="Javobni bekor qilish" onClick={()=>setReplyTo(null)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-4 h-4"/></button>
              </div>
            )}

            {/* Edit preview */}
            {editingId && (
              <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 border-t border-amber-500/25 flex-shrink-0">
                <Edit className="w-4 h-4 text-amber-600 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-400">Tahrirlash</p>
                  <p className="text-xs text-muted-foreground truncate">{messages.find(m=>m.id===editingId)?.text}</p>
                </div>
                <button aria-label="Tahrirlashni bekor qilish" onClick={()=>{setEditingId(null);setEditText("");}} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-4 h-4"/></button>
              </div>
            )}

            {/* Input — suzuvchi kapsula (sayt bo'ylab bir xil "pill" tili) */}
            {!selectMode && (
              <div className="px-3 flex-shrink-0 relative" style={{ paddingTop: '0.5rem', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }} onClick={e=>e.stopPropagation()}>
                {showAttach && (
                  <div className="absolute bottom-[4.5rem] left-3 glass p-2 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-slide-up-fade z-50 min-w-[190px]" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>fileImgRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><ImageIcon className="w-4 h-4 text-blue-500"/>Rasm / Video</button>
                    <button onClick={()=>camRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><Camera className="w-4 h-4 text-rose-500"/>Kamera</button>
                    <button onClick={()=>fileAllRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><FileText className="w-4 h-4 text-orange-500"/>Fayl</button>
                    <button onClick={sendLocation} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><MapPin className="w-4 h-4 text-green-500"/>Lokatsiya</button>
                  </div>
                )}
                <div className="nav-pill-desktop flex gap-1 items-end rounded-full px-1.5 py-1.5 max-w-3xl mx-auto">
                  {!isRecording && (
                    <button onClick={()=>setShowAttach(!showAttach)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:bg-white/10 rounded-full transition-colors">
                      <Paperclip className="w-5 h-5"/>
                    </button>
                  )}
                  {isRecording ? (
                    <div className="flex-1 flex items-center gap-3 px-3 py-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>
                      <span className="text-sm font-mono text-red-500">{fmtTime(recSec)}</span>
                      <span className="text-xs text-red-400/80 flex-1">Yozilmoqda...</span>
                    </div>
                  ) : (
                    <textarea rows={1}
                      className="flex-1 resize-none text-sm bg-transparent focus:outline-none max-h-28 overflow-y-auto leading-relaxed px-2 py-2.5"
                      placeholder="Xabar yozing..."
                      value={editingId ? editText : text}
                      onChange={e=>{if(editingId)setEditText(e.target.value);else setText(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,112)+'px';}}
                      onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editingId)saveEdit();else doSend();}}}
                    />
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isRecording ? (
                      <>
                        <button aria-label="Yozishni bekor qilish" onClick={cancelRec} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-white/10 rounded-full transition-colors"><X className="w-4 h-4"/></button>
                        <button aria-label="Ovozli xabarni yuborish" onClick={stopRec} className="w-9 h-9 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-full flex items-center justify-center active:scale-95 liquid-transition shadow-md shadow-red-500/30"><Send className="w-4 h-4 ml-0.5"/></button>
                      </>
                    ) : (editingId ? editText : text).trim() ? (
                      <button aria-label="Xabar yuborish" onClick={()=>{if(editingId)saveEdit();else doSend();}} className="w-9 h-9 bg-gradient-to-br from-primary to-primary/80 text-white rounded-full flex items-center justify-center active:scale-95 liquid-transition shadow-md shadow-primary/30"><Send className="w-4 h-4 ml-0.5"/></button>
                    ) : (
                      <button aria-label="Ovozli xabar yozish" onClick={startRec} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-white/10 rounded-full transition-colors"><Mic className="w-5 h-5"/></button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Forward dialog */}
      {showForward && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={()=>setShowForward(null)}>
          <div className="glass-modal rounded-t-3xl sm:rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm">Kimga yuborish?</h3>
              <button aria-label="Yopish" onClick={()=>setShowForward(null)} className="p-1.5 hover:bg-muted rounded-full"><X className="w-4 h-4"/></button>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-hide">
              {contacts.map(u => (
                <button key={u.id} onClick={()=>{
                  onSend({id:`msg${Date.now()}`,fromUserId:currentUser.id,toUserId:u.id,text:showForward!.text,timestamp:new Date().toISOString(),read:false,type:showForward!.type,mediaUrl:showForward!.mediaUrl,fileName:showForward!.fileName,location:showForward!.location});
                  setShowForward(null);
                }} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-left">
                  <Avatar user={u} size="sm"/>
                  <div><p className="text-sm font-medium">{u.name}</p><RoleBadge role={u.role}/></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Yangi guruh yaratish */}
      {showNewGroup && (
        <GroupCreateModal contacts={contacts} onClose={() => setShowNewGroup(false)}
          onCreate={async (name, ids) => { const g = await onCreateGroup(name, ids); setShowNewGroup(false); if (g) { setSelGroup(g); setSelUser(null); } }}/>
      )}
    </div>
  );
}

// ─── Yangi guruh modal ──────────────────────────────────────────────────────────
function GroupCreateModal({ contacts, onClose, onCreate }:
  { contacts: AppUser[]; onClose: () => void; onCreate: (name: string, memberIds: string[]) => void }) {
  useModalPresence();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const toggle = (id: string) => setSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const filtered = contacts.filter(u => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={onClose}>
      <div className="glass-modal rounded-t-3xl sm:rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-2"><Users2 className="w-4 h-4 text-primary"/>Yangi guruh</h3>
          <button aria-label="Yopish" onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><X className="w-4 h-4"/></button>
        </div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Guruh nomi *" autoFocus
          className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none mb-2"/>
        <div className="relative mb-2">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="A'zo qidirish..." className="w-full text-sm border border-border rounded-lg pl-9 pr-3 py-2 bg-input-background focus:outline-none"/>
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto scrollbar-hide mb-3">
          {filtered.map(u => (
            <button key={u.id} type="button" onClick={()=>toggle(u.id)}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors text-left ${sel.has(u.id)?'bg-primary/10':'hover:bg-muted/40'}`}>
              <Avatar user={u} size="sm"/>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{u.name}</p></div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${sel.has(u.id)?'bg-primary border-primary':'border-border'}`}>{sel.has(u.id) && <Check className="w-3 h-3 text-white"/>}</div>
            </button>
          ))}
        </div>
        <button disabled={!name.trim() || sel.size===0} onClick={()=>onCreate(name.trim(), Array.from(sel))}
          className="btn btn-primary w-full py-2.5 disabled:opacity-40">Yaratish ({sel.size})</button>
      </div>
    </div>
  );
}

// ─── Profile Page ──────────────────────────────────────────────────────────────
// ─── Design constants ─────────────────────────────────────────────────────────
const BG_TEMPLATES = [
  { id: "default", name: "Standart", value: "" },
  { id: "navy",    name: "Klassik",  value: "linear-gradient(135deg, #1B3A6B 0%, #D9460F 100%)" },
  { id: "midnight",name: "Tun",      value: "linear-gradient(135deg, #0F0C29 0%, #302B63 60%, #24243E 100%)" },
  { id: "aurora",  name: "Aurora",   value: "linear-gradient(135deg, #4776E6 0%, #8E54E9 100%)" },
  { id: "ocean",   name: "Okean",    value: "linear-gradient(135deg, #0F2027 0%, #203A43 50%, #2C5364 100%)" },
  { id: "sunset",  name: "G'urub",   value: "linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)" },
  { id: "forest",  name: "O'rmon",   value: "linear-gradient(135deg, #134E5E 0%, #71B280 100%)" },
  { id: "candy",   name: "Konfet",   value: "linear-gradient(135deg, #FC466B 0%, #3F5EFB 100%)" },
  { id: "gold",    name: "Oltin",    value: "linear-gradient(135deg, #F7971E 0%, #FFD200 100%)" },
  { id: "emerald", name: "Zumrad",   value: "linear-gradient(135deg, #0F9B58 0%, #00B4D8 100%)" },
  { id: "galaxy",  name: "Galaktika",value: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  { id: "sakura",  name: "Sakura",   value: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
  { id: "arctic",  name: "Arktik",   value: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" },
  { id: "lava",    name: "Lava",     value: "linear-gradient(135deg, #f83600 0%, #f9d423 100%)" },
  { id: "peach",   name: "Shaftoli", value: "linear-gradient(135deg, #FFECD2 0%, #FCB69F 100%)" },
];

// To'liq CSS-var to'plamini quradi (bitta tema × rejim uchun)
type VarInput = {
  primary: string; accent: string; secondary: string; secondaryFg: string;
  bg: string; card: string; fg: string; muted: string; mutedFg: string;
  border: string; input: string; ring: string;
};
function themeVars(p: VarInput): Record<string, string> {
  return {
    "--primary": p.primary, "--primary-foreground": "#ffffff",
    "--accent": p.accent, "--accent-foreground": "#ffffff",
    "--secondary": p.secondary, "--secondary-foreground": p.secondaryFg,
    "--background": p.bg, "--card": p.card, "--card-foreground": p.fg,
    "--popover": p.card, "--popover-foreground": p.fg, "--foreground": p.fg,
    "--muted": p.muted, "--muted-foreground": p.mutedFg,
    "--border": p.border, "--input-background": p.input, "--ring": p.ring,
    "--sidebar": p.card, "--sidebar-primary": p.accent,
  };
}

const DARK_BORDER = "rgba(255,255,255,0.10)";
const COLOR_THEMES = [
  { id: "navy", name: "Klassik", primary: "#1B3A6B", accent: "#D2440F",
    light: themeVars({ primary:"#1B3A6B", accent:"#D2440F", secondary:"#E4EAF3", secondaryFg:"#1B3A6B", bg:"#F4F6FA", card:"#FFFFFF", fg:"#0F1A2E", muted:"#EAEEF5", mutedFg:"#5C6B84", border:"rgba(15,26,46,0.10)", input:"#EDF1F7", ring:"#1B3A6B" }),
    dark:  themeVars({ primary:"#3E6DB5", accent:"#F26A3D", secondary:"#1E2A40", secondaryFg:"#CBD5E1", bg:"#0B1220", card:"#131C2E", fg:"#E6ECF5", muted:"#1A2436", mutedFg:"#8A9CB8", border:DARK_BORDER, input:"#1A2436", ring:"#5B8DD6" }) },
  { id: "ocean", name: "Okean", primary: "#0369A1", accent: "#0B7CAF",
    light: themeVars({ primary:"#0369A1", accent:"#0B7CAF", secondary:"#E0F2FE", secondaryFg:"#075985", bg:"#F1F9FE", card:"#FFFFFF", fg:"#0C2536", muted:"#E4F3FB", mutedFg:"#4E6E7E", border:"rgba(3,105,161,0.10)", input:"#E8F5FF", ring:"#0369A1" }),
    dark:  themeVars({ primary:"#2A94D6", accent:"#22C3E6", secondary:"#102838", secondaryFg:"#BAE0F5", bg:"#071620", card:"#0E2130", fg:"#E1F0F7", muted:"#12293A", mutedFg:"#7F9DB0", border:DARK_BORDER, input:"#12293A", ring:"#38BDF8" }) },
  { id: "forest", name: "O'rmon", primary: "#166534", accent: "#12863D",
    light: themeVars({ primary:"#166534", accent:"#12863D", secondary:"#DCFCE7", secondaryFg:"#14532D", bg:"#F1FBF4", card:"#FFFFFF", fg:"#0E2A18", muted:"#E4F6EA", mutedFg:"#4B6B57", border:"rgba(22,101,52,0.10)", input:"#E9F8EF", ring:"#166534" }),
    dark:  themeVars({ primary:"#2E9E5B", accent:"#22C55E", secondary:"#12281B", secondaryFg:"#BBF7D0", bg:"#08160E", card:"#0F2418", fg:"#E2F3E8", muted:"#132A1D", mutedFg:"#83AE92", border:DARK_BORDER, input:"#132A1D", ring:"#34D399" }) },
  { id: "purple", name: "Binafsha", primary: "#6D28D9", accent: "#7C3AED",
    light: themeVars({ primary:"#6D28D9", accent:"#7C3AED", secondary:"#EDE9FE", secondaryFg:"#5B21B6", bg:"#F7F5FF", card:"#FFFFFF", fg:"#241542", muted:"#F0ECFE", mutedFg:"#665A82", border:"rgba(91,33,182,0.10)", input:"#F0EEFF", ring:"#6D28D9" }),
    dark:  themeVars({ primary:"#7C4DE0", accent:"#A78BFA", secondary:"#241640", secondaryFg:"#DDD6FE", bg:"#120A22", card:"#1B1230", fg:"#ECE7F7", muted:"#201538", mutedFg:"#9C8BC0", border:DARK_BORDER, input:"#201538", ring:"#A78BFA" }) },
  { id: "rose", name: "Atirgul", primary: "#BE123C", accent: "#E11D48",
    light: themeVars({ primary:"#BE123C", accent:"#E11D48", secondary:"#FFE4E6", secondaryFg:"#9F1239", bg:"#FFF5F6", card:"#FFFFFF", fg:"#3A1420", muted:"#FDECEE", mutedFg:"#86616A", border:"rgba(159,18,57,0.10)", input:"#FFF0F1", ring:"#BE123C" }),
    dark:  themeVars({ primary:"#E24B6A", accent:"#F43F5E", secondary:"#351720", secondaryFg:"#FECDD3", bg:"#1E0A10", card:"#2B1119", fg:"#F7E7EB", muted:"#33161F", mutedFg:"#C08D97", border:DARK_BORDER, input:"#33161F", ring:"#FB7185" }) },
  { id: "slate", name: "Tosh", primary: "#334155", accent: "#475569",
    light: themeVars({ primary:"#334155", accent:"#475569", secondary:"#E2E8F0", secondaryFg:"#1E293B", bg:"#F4F6F9", card:"#FFFFFF", fg:"#111827", muted:"#EBEFF4", mutedFg:"#5A6577", border:"rgba(30,41,59,0.10)", input:"#EEF2F7", ring:"#334155" }),
    dark:  themeVars({ primary:"#64748B", accent:"#94A3B8", secondary:"#1E2836", secondaryFg:"#CBD5E1", bg:"#0B1017", card:"#131A24", fg:"#E6EAF0", muted:"#18202C", mutedFg:"#8A97A8", border:DARK_BORDER, input:"#18202C", ring:"#94A3B8" }) },
  { id: "amber", name: "Oltin rang", primary: "#B45309", accent: "#B16105",
    light: themeVars({ primary:"#B45309", accent:"#B16105", secondary:"#FEF3C7", secondaryFg:"#92400E", bg:"#FFFBEB", card:"#FFFFFF", fg:"#2E1D06", muted:"#FBF2D8", mutedFg:"#7A6A48", border:"rgba(146,64,14,0.10)", input:"#FFF8E0", ring:"#B45309" }),
    dark:  themeVars({ primary:"#B87A1C", accent:"#F59E0B", secondary:"#2C2110", secondaryFg:"#FDE68A", bg:"#15100A", card:"#221A0E", fg:"#F5ECD8", muted:"#271F10", mutedFg:"#B39B6E", border:DARK_BORDER, input:"#271F10", ring:"#FBBF24" }) },
  { id: "teal", name: "Moviy-yashil", primary: "#0F766E", accent: "#0C8479",
    light: themeVars({ primary:"#0F766E", accent:"#0C8479", secondary:"#CCFBF1", secondaryFg:"#115E59", bg:"#F0FDFA", card:"#FFFFFF", fg:"#0A2A28", muted:"#E0F5F1", mutedFg:"#4B6E6A", border:"rgba(15,118,110,0.10)", input:"#E8FBF7", ring:"#0F766E" }),
    dark:  themeVars({ primary:"#1AA093", accent:"#14B8A6", secondary:"#0F2A28", secondaryFg:"#99F6E4", bg:"#051614", card:"#0D2422", fg:"#DDF3F0", muted:"#112B28", mutedFg:"#7BA9A3", border:DARK_BORDER, input:"#112B28", ring:"#2DD4BF" }) },
];

// Galereyadan/kameradan yuklangan rasm (ayniqsa telefon fotosi, ko'pincha bir
// necha MB) to'g'ridan-to'g'ri base64 sifatida localStorage'ga yozilsa, brauzer
// kvotasidan (odatda ~5-10MB) chiqib ketib localStorage.setItem jim-jimgina
// xato tashlaydi — natijada rasm "yuklandi" deyiladi-yu, aslida saqlanmay,
// ekranda ko'rinmay qoladi. Shu yerda canvas orqali kichraytirib/JPEG'ga
// siqib qaytaramiz — hajmi kvotadan doim kichik bo'ladi.
function resizeImageFile(file: File, maxDim: number, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("O'qib bo'lmadi"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Rasm ochilmadi"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function ProfilePage({ currentUser, projects, onUpdateAvatar, onLogout, onUpdateUser, onCompanyNameChange, onCompanyLogoChange, onBgChange, onColorThemeChange, colorTheme, themeMode, onThemeModeChange, canEditCompany }:
  { currentUser: AppUser; projects: Project[]; onUpdateAvatar: (url: string) => void; onLogout: () => void; onUpdateUser: (u: AppUser) => void; onCompanyNameChange: (name: string) => void; onCompanyLogoChange: (logo: string) => void; onBgChange: (bg: string) => void; onColorThemeChange: (id: string) => void; colorTheme: string; themeMode: "light"|"dark"|"system"; onThemeModeChange: (m: "light"|"dark"|"system") => void; canEditCompany?: boolean }) {
  const { t, i18n } = useTranslation();
  const changeLanguage = async (lang: SiteLang) => {
    setSiteLanguage(lang);
    onUpdateUser({ ...currentUser, language: lang });
    try {
      await fetch(`${API_BASE}/api/users/${currentUser.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
      toast.success(t('profile.languageSaved'));
    } catch { /* mahalliy o'zgarish saqlanadi, keyingi sinxronlashda serverga yetadi */ }
  };
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ name: currentUser.name, phone: currentUser.phone });
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState(() => localStorage.getItem("erp_companyName") || "QurilishERP");
  const [companyLogo, setCompanyLogo] = useState(() => localStorage.getItem("erp_companyLogo") || "");
  const [profileBg, setProfileBg] = useState(() => localStorage.getItem("erp_profileBg") || "");
  const [editingBrand, setEditingBrand] = useState(false);
  const [brandInput, setBrandInput] = useState(companyName);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const url = await resizeImageFile(file, 500, 0.85);
      onUpdateAvatar(url);
    } catch { toast.error("Rasmni yuklab bo'lmadi"); }
    finally { e.target.value = ""; }
  };
  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const url = await resizeImageFile(file, 500, 0.9);
      setCompanyLogo(url); localStorage.setItem("erp_companyLogo", url); onCompanyLogoChange(url);
    } catch { toast.error("Logotipni yuklab bo'lmadi"); }
    finally { e.target.value = ""; }
  };
  const handleBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const url = await resizeImageFile(file, 1600, 0.82);
      setProfileBg(url); localStorage.setItem("erp_profileBg", url); onBgChange(url);
    } catch { toast.error("Fon rasmini yuklab bo'lmadi — fayl juda katta yoki buzilgan bo'lishi mumkin"); }
    finally { e.target.value = ""; }
  };
  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    onUpdateUser({...currentUser, name: form.name, phone: form.phone});
    setIsEditing(false);
  };
  const saveBrand = () => {
    setCompanyName(brandInput);
    localStorage.setItem("erp_companyName", brandInput);
    onCompanyNameChange(brandInput);
    setEditingBrand(false);
  };

  const applyBgTemplate = (value: string) => {
    setProfileBg(value);
    localStorage.setItem("erp_profileBg", value);
    onBgChange(value);
  };

  const bgIsImage = profileBg && !profileBg.startsWith('linear-gradient') && !profileBg.startsWith('radial-gradient');
  const bannerStyle = profileBg
    ? bgIsImage
      ? { backgroundImage: `url(${profileBg})`, backgroundSize: "cover" as const, backgroundPosition: "center" as const }
      : { background: profileBg }
    : { background: "linear-gradient(135deg, #1B3A6B 0%, #D2440F 100%)" };

  const perms: [string, boolean][] = [
    ["Barcha moliya va hisobotlarni ko'rish", isAdmin(currentUser.role)],
    ["Chiqim qo'shish", isAdmin(currentUser.role)],
    ["Yangi foydalanuvchi qo'shish", isAdmin(currentUser.role)||currentUser.role==="brigadir"],
    ["Material yuborish", true],
    ["Material tasdiqlash", true],
    ["Oylik to'lovini tasdiqlash", !isAdmin(currentUser.role)],
  ];

  const activeTheme = COLOR_THEMES.find(t => t.id === colorTheme) || COLOR_THEMES[0];
  const [activePanel, setActivePanel] = useState<null | "bg" | "appearance" | "color" | "perms" | "projects" | "language">(null);
  const APPEARANCE_LABELS: Record<string, string> = { light: "Yorug'", dark: "Qorong'i", system: "Tizim" };
  const myProjectCount = (currentUser.projectIds || []).length;

  // ── Har bo'lim uchun alohida ekran (rasmdagi "Personal/General/..." kabi) ──
  if (activePanel) {
    const panelTitle = {
      bg: "Fon mavzular", appearance: "Ko'rinish rejimi", color: "Rang mavzusi",
      perms: "Ruxsatlar", projects: "Obyektlarim", language: t('profile.language'),
    }[activePanel];
    return (
      <motion.div key={activePanel} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 28 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="overflow-y-auto scrollbar-hide max-w-lg md:max-w-2xl xl:max-w-3xl mx-auto w-full pb-10">
        <div className="flex items-center gap-2 px-4 py-4 sticky top-0 bg-background/80 backdrop-blur-xl z-10">
          <button onClick={() => setActivePanel(null)} aria-label="Orqaga" className="btn btn-ghost w-9 h-9 p-0 rounded-full flex-shrink-0"><ChevronLeft className="w-5 h-5"/></button>
          <h2 className="text-base font-bold">{panelTitle}</h2>
        </div>
        <div className="px-4 space-y-4">
          {activePanel === "bg" && (
            <div className="surface overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex-1">Fon rasmini tanlang</p>
                <span className="text-[10px] text-muted-foreground hidden sm:block">Butun site ga qo'llaniladi</span>
              </div>
              <div className="p-3">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-7 gap-2">
                  {BG_TEMPLATES.map(t => {
                    const isCurrent = t.id === "default" ? (!profileBg || profileBg === "") : profileBg === t.value;
                    return (
                      <button key={t.id} onClick={() => applyBgTemplate(t.value)}
                        className={`relative rounded-lg sm:rounded-xl overflow-hidden border-2 liquid-transition ${isCurrent ? "border-primary shadow-md scale-[1.05]" : "border-transparent hover:border-primary/40"}`}
                        style={{ aspectRatio: "4/3", background: t.value || "var(--background)" }}>
                        {t.id === "default" && <div className="absolute inset-0 flex items-center justify-center bg-muted/60"><span className="text-[8px] text-muted-foreground font-semibold">Yo'q</span></div>}
                        {isCurrent && <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-white/95 rounded-full flex items-center justify-center shadow"><Check className="w-2 h-2 text-primary"/></div>}
                        {t.id !== "default" && <div className="absolute inset-x-0 bottom-0 py-0.5" style={{ background: "rgba(0,0,0,0.38)" }}><p className="text-center text-[7px] sm:text-[8px] text-white font-semibold">{t.name}</p></div>}
                      </button>
                    );
                  })}
                  <button onClick={() => bgRef.current?.click()}
                    className="relative rounded-lg sm:rounded-xl overflow-hidden border-2 border-dashed border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/40 flex flex-col items-center justify-center gap-0.5 liquid-transition"
                    style={{ aspectRatio: "4/3" }}>
                    <Upload className="w-3.5 h-3.5 text-muted-foreground"/>
                    <p className="text-[7px] sm:text-[8px] text-muted-foreground font-semibold">Rasm</p>
                  </button>
                </div>
              </div>
            </div>
          )}
          {activePanel === "appearance" && (
            <div className="surface overflow-hidden">
              <div className="p-3">
                <div className="grid grid-cols-3 gap-2">
                  {([["light","Yorug'",Sun],["dark","Qorong'i",Moon],["system","Tizim",Monitor]] as [ "light"|"dark"|"system", string, React.ElementType ][]).map(([m,label,Icon]) => (
                    <button key={m} onClick={() => onThemeModeChange(m)}
                      className={`btn flex flex-col items-center gap-1.5 py-3 rounded-xl border ${themeMode===m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                      <Icon className="w-5 h-5"/>
                      <span className="text-[11px] font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activePanel === "color" && (
            <div className="surface overflow-hidden">
              <div className="px-3 py-3">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3">
                  {COLOR_THEMES.map(t => (
                    <button key={t.id} onClick={() => onColorThemeChange(t.id)} title={t.name}
                      className="flex flex-col items-center gap-1.5 group">
                      <div
                        className="w-14 h-14 sm:w-12 sm:h-12 rounded-2xl liquid-transition group-hover:scale-105 active:scale-95 relative"
                        style={{
                          background: `linear-gradient(135deg, ${t.primary} 0%, ${t.accent} 100%)`,
                          boxShadow: colorTheme === t.id
                            ? `0 0 0 2px var(--card), 0 0 0 4px ${t.primary}, 0 3px 10px ${t.primary}50`
                            : "0 2px 5px rgba(0,0,0,0.18)",
                          transform: colorTheme === t.id ? "scale(1.08)" : undefined,
                        }}>
                        {colorTheme === t.id && <Check className="w-5 h-5 text-white absolute inset-0 m-auto drop-shadow"/>}
                      </div>
                      <span className="text-[11px] text-muted-foreground font-medium leading-none text-center">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activePanel === "perms" && (
            <div className="surface overflow-hidden">
              {perms.map(([label, has]) => (
                <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/20 liquid-transition">
                  <span className="text-sm text-foreground">{label}</span>
                  {has ? <CheckCircle className="w-4 h-4 text-green-500"/> : <X className="w-4 h-4 text-muted-foreground/30"/>}
                </div>
              ))}
            </div>
          )}
          {activePanel === "projects" && (
            <div className="surface overflow-hidden">
              {(!currentUser.projectIds || currentUser.projectIds.length === 0)
                ? <p className="px-4 py-4 text-sm text-muted-foreground text-center">Tayinlangan yo'q</p>
                : projects.filter(p => currentUser.projectIds.includes(p.id)).map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-primary"/>
                    </div>
                    <span className="text-sm truncate font-medium">{p.name}</span>
                  </div>
                ))
              }
            </div>
          )}
          {activePanel === "language" && (
            <div className="surface overflow-hidden p-5 flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground text-center">{t('profile.languageHint')}</p>
              <LanguageSwitcher value={i18n.language as SiteLang} onChange={changeLanguage}/>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="overflow-y-auto scrollbar-hide max-w-lg mx-auto w-full pb-10">

      {/* ── Company Banner ─────────────────────────── */}
      <motion.div initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden" style={{ ...bannerStyle, height: 210 }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.58) 100%)" }}/>
        {canEditCompany && (
          <button onClick={() => bgRef.current?.click()}
            className="absolute top-4 right-4 flex items-center gap-1.5 text-white text-xs px-3 py-2 rounded-full border border-white/25 liquid-transition hover:bg-white/20 active:scale-95"
            style={{ background: "rgba(0,0,0,0.30)", backdropFilter: "blur(12px)" }}>
            <Upload className="w-3.5 h-3.5"/>Rasm yuklash
          </button>
        )}
        <input ref={bgRef} type="file" accept="image/*" className="hidden" onChange={handleBgFile}/>
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-5 flex items-end gap-4">
          <div className="relative flex-shrink-0">
            <div className="w-16 h-16 rounded-2xl border-2 border-white/80 shadow-2xl overflow-hidden bg-white flex items-center justify-center">
              {companyLogo ? <img src={companyLogo} alt="Logo" className="w-full h-full object-contain p-1"/> : <Building2 className="w-8 h-8 text-primary"/>}
            </div>
            {canEditCompany && (
              <button onClick={() => logoRef.current?.click()} aria-label="Logotipni almashtirish"
                className="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-white text-primary rounded-full flex items-center justify-center border border-border shadow-lg hover:bg-primary hover:text-white liquid-transition">
                <Camera className="w-3 h-3"/>
              </button>
            )}
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile}/>
          </div>
          <div className="flex-1 pb-0.5">
            {canEditCompany && editingBrand ? (
              <div className="flex items-center gap-2">
                <input className="flex-1 text-white font-bold text-lg bg-transparent border-b-2 border-white/60 focus:border-white focus:outline-none pb-0.5"
                  value={brandInput} onChange={e => setBrandInput(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && saveBrand()}/>
                <button aria-label="Saqlash" onClick={saveBrand} className="w-7 h-7 bg-white/20 text-white rounded-full flex items-center justify-center border border-white/30 hover:bg-white/30 liquid-transition"><Check className="w-3.5 h-3.5"/></button>
                <button aria-label="Bekor qilish" onClick={() => setEditingBrand(false)} className="w-7 h-7 bg-black/20 text-white rounded-full flex items-center justify-center hover:bg-black/30 liquid-transition"><X className="w-3.5 h-3.5"/></button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-white font-bold text-xl drop-shadow-lg">{companyName}</p>
                {canEditCompany && (
                  <button onClick={() => { setBrandInput(companyName); setEditingBrand(true); }} aria-label="Nomni tahrirlash"
                    className="p-1 text-white/60 hover:text-white rounded-lg hover:bg-white/10 liquid-transition">
                    <Edit className="w-3.5 h-3.5"/>
                  </button>
                )}
              </div>
            )}
            <p className="text-white/65 text-xs mt-0.5">{t('profile.constructionCompany')}</p>
          </div>
        </div>
      </motion.div>

      <div className="px-4 mt-4 space-y-4">

        {/* ── Profile Card ──────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.02 }}
          className="surface p-5 text-center relative">
          {isAdmin(currentUser.role) && !isEditing && (
            <button aria-label={t('common.edit')} onClick={() => setIsEditing(true)} className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded-lg liquid-transition"><Edit className="w-4 h-4"/></button>
          )}
          <div className="relative inline-block mb-3">
            <Avatar user={currentUser} size="lg"/>
            <button onClick={() => fileRef.current?.click()} aria-label="Rasmni almashtirish" className="absolute bottom-0 right-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center hover:bg-primary/90 border-2 border-white shadow-lg liquid-transition">
              <Camera className="w-3.5 h-3.5"/>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          {isEditing ? (
            <div className="space-y-3.5 mt-5 text-left animate-slide-up-fade">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1.5 ml-1 uppercase tracking-wider font-bold">{t('profile.nameLabel')}</label>
                <div className="relative">
                  <User className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"/>
                  <input className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition shadow-inner"
                    value={form.name} onChange={e => setForm({...form, name: e.target.value})}/>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1.5 ml-1 uppercase tracking-wider font-bold">{t('profile.phoneLabel')}</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"/>
                  <input className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition shadow-inner font-mono"
                    value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}/>
                </div>
              </div>
              {form.phone !== currentUser.phone && (
                <div className="bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs p-3 rounded-2xl flex items-start gap-2 text-left"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/><p>Raqamni o'zgartirsangiz, Telegram bot orqali qayta tasdiqlashingiz shart!</p></div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setIsEditing(false)} className="flex-1 text-sm font-semibold py-3 rounded-full border border-border/60 text-muted-foreground hover:bg-muted liquid-transition">{t('common.cancel')}</button>
                <button onClick={handleSave} className="flex-1 bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-bold py-3 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">{t('profile.save')}</button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold font-['Roboto_Slab',serif]">{currentUser.name}</h2>
              <div className="flex justify-center mt-2"><RoleBadge role={currentUser.role}/></div>
              <p className="text-xs text-muted-foreground mt-2 font-mono">{currentUser.phone}</p>
              {currentUser.brigade && <p className="text-xs text-muted-foreground mt-1">{currentUser.brigade}</p>}
            </>
          )}
        </motion.div>

        {/* ── Sozlamalar menyusi (har biri alohida ekranga olib boradi) ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.06 }}
          className="surface overflow-hidden">
          {[
            { key: "bg" as const, icon: Palette, label: t('profile.bgThemes'), hint: null as string|null,
              swatch: (bannerStyle as any).background ? { background: (bannerStyle as any).background } : { backgroundImage: (bannerStyle as any).backgroundImage, backgroundSize: 'cover' } },
            { key: "appearance" as const, icon: themeMode === "light" ? Sun : themeMode === "dark" ? Moon : Monitor, label: t('profile.appearanceMode'), hint: APPEARANCE_LABELS[themeMode], swatch: null },
            { key: "color" as const, icon: Palette, label: t('profile.colorTheme'), hint: activeTheme.name, swatch: { background: `linear-gradient(135deg, ${activeTheme.primary}, ${activeTheme.accent})` } },
            { key: "language" as const, icon: Languages, label: t('profile.language'), hint: langLabel(i18n.language as SiteLang), swatch: null },
            { key: "perms" as const, icon: CheckCircle, label: t('profile.permissions'), hint: `${perms.filter(([,has])=>has).length}/${perms.length}`, swatch: null },
            { key: "projects" as const, icon: Building2, label: t('profile.myObjects'), hint: String(myProjectCount), swatch: null },
          ].map((row, i) => (
            <button key={row.key} onClick={() => setActivePanel(row.key)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 liquid-transition text-left ${i > 0 ? "border-t border-border/50" : ""}`}>
              {row.swatch
                ? <div className="w-10 h-10 rounded-xl flex-shrink-0" style={row.swatch}/>
                : <div className="icon-chip"><row.icon className="w-4 h-4"/></div>}
              <span className="text-sm font-medium flex-1">{row.label}</span>
              {row.hint && <span className="text-xs text-muted-foreground">{row.hint}</span>}
              <ChevronRight className="w-4 h-4 text-muted-foreground/60"/>
            </button>
          ))}
        </motion.div>

        <motion.button initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.26 }}
          onClick={() => { localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
          className="w-full flex items-center justify-center gap-2.5 text-sm border-2 border-border rounded-2xl px-4 py-3.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 liquid-transition font-semibold">
          <LogOut className="w-4 h-4"/>{t('profile.logout')}
        </motion.button>
      </div>
    </div>
  );
}

// ─── Bottom Finance Bar ──────────────────────────────────────────────────────────────
function BottomFinanceBar({ expenses, projects }: { expenses: Expense[]; projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const confirmed = expenses.filter(e=>e.status==="confirmed");
  const total = confirmed.reduce((a,e)=>a+e.amount,0);
  const byProj = projects.map(p=>({name:p.name,amount:confirmed.filter(e=>e.projectId===p.id).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.amount>0);
  const byType = (Object.keys(EXP_LABELS) as ExpType[]).map(k=>({name:EXP_LABELS[k],amount:confirmed.filter(e=>e.type===k).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.amount>0);
  return (
    <div className="flex-shrink-0 border-b border-white/10 bg-gradient-to-r from-primary to-primary/95 text-white z-20 shadow-md">
      {open&&(
        <div className="border-b border-white/10 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><p className="text-sm md:text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Obyektlar bo'yicha</p>
            {byProj.map(d=><div key={d.name} className="flex items-center justify-between py-0.5"><span className="text-sm md:text-xs text-white/80 truncate mr-4">{d.name}</span><span className="text-sm md:text-xs font-mono font-semibold text-white flex-shrink-0">{fmt(d.amount)}</span></div>)}
          </div>
          <div><p className="text-sm md:text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Tur bo'yicha</p>
            {byType.map(d=><div key={d.name} className="flex items-center justify-between py-0.5"><span className="text-sm md:text-xs text-white/80">{d.name}</span><span className="text-sm md:text-xs font-mono font-semibold text-white">{fmt(d.amount)}</span></div>)}
          </div>
        </div>
      )}
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-2"><TrendingDown className="w-4 h-4 text-white/70"/><span className="text-sm md:text-xs text-white/70">Jami chiqimlar</span></div>
        <div className="flex items-center gap-2"><span className="text-sm font-bold font-mono">{fmt(total)}</span>{open?<ChevronUp className="w-4 h-4 text-white/60"/>:<ChevronDown className="w-4 h-4 text-white/60"/>}</div>
      </button>
    </div>
  );
}

// ─── OTP kod qutilar (4 xonali kod uchun) — auto-advance, backspace, paste ──────
function OtpBoxes({ value, onChange, length = 4, autoFocus, error }: { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean; error?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join(""));
  };
  const handleChange = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, "").slice(-1);
    setAt(i, d);
    if (d && i < length - 1) refs.current[i + 1]?.focus();
  };
  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (text) { e.preventDefault(); onChange(text); refs.current[Math.min(text.length, length - 1)]?.focus(); }
  };

  return (
    <div className="flex justify-center gap-2.5">
      {digits.map((d, i) => (
        <input key={i} ref={el => { refs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1}
          value={d}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          autoFocus={autoFocus && i === 0}
          className={`w-14 h-16 text-center text-2xl font-bold rounded-2xl border bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 shadow-inner liquid-transition ${error ? "border-red-500/50" : "border-border/50"}`}
        />
      ))}
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onRegister }: { onLogin: (u: any, company?: any) => void; onRegister?: () => void }) {
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState("+998 ");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "devpass" | "blocked">("phone");
  const [blockedReason, setBlockedReason] = useState<'pending'|'expired'|'rejected'|null>(null);
  const [error, setError] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [loginCompanyName] = useState(() => localStorage.getItem("erp_companyName") || "QurilishERP");
  const [loginCompanyLogo] = useState(() => localStorage.getItem("erp_companyLogo") || "");

  useEffect(() => {
    if (step === "code" && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [step, timeLeft]);

  const handlePhoneSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPhone = phone.replace(/\s+/g, "");
    if (cleanPhone.length < 13) {
      setError(t('login.phoneInvalid'));
      return;
    }
    setError("");

    // Dasturchi raqami — Telegram kod emas, parol so'raladi
    if (cleanPhone === DEV_PHONE) {
      setStep("devpass");
      return;
    }

    try {
      const res = await fetch(API_BASE + "/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('login.genericError'));
        return;
      }
      setStep("code");
      setTimeLeft(120);
    } catch (err) {
      setError(t('login.serverError'));
    }
  };

  const handleCodeSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPhone = phone.replace(/\s+/g, "");
    try {
      const res = await fetch(API_BASE + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone, code })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.subscriptionStatus) {
          setBlockedReason(data.subscriptionStatus);
          setStep("blocked");
          return;
        }
        setError(data.error || t('login.genericError'));
        return;
      }
      const u = {
        id: data.user.id || data.user._id,
        name: data.user.firstName + (data.user.lastName ? " " + data.user.lastName : ""),
        phone: data.user.phone,
        role: data.user.role,
        projectIds: data.user.projectIds || [],
        isOwner: data.user.isOwner || false,
        companyId: data.user.companyId,
        language: data.user.language,
      };
      localStorage.setItem("token", data.token);
      localStorage.setItem("currentUser", JSON.stringify(u));
      if (data.user.language) setSiteLanguage(data.user.language);
      onLogin(u, data.company);
    } catch (err) {
      setError(t('login.serverError'));
    }
  };

  // 4 xona to'lganda avtomatik yuborish (OTP qutilar bilan qulay oqim)
  useEffect(() => {
    if (step === "code" && code.length === 4) handleCodeSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  // Dasturchi login: raqam + parol
  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = phone.replace(/\s+/g, "");
    try {
      const res = await fetch(API_BASE + "/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone, password })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('login.genericError')); return; }
      const u = {
        id: data.user.id || data.user._id,
        name: data.user.firstName + (data.user.lastName ? " " + data.user.lastName : ""),
        phone: data.user.phone,
        role: data.user.role,
        projectIds: data.user.projectIds || [],
        isOwner: false,
        companyId: undefined,
        language: data.user.language,
      };
      localStorage.setItem("token", data.token);
      localStorage.setItem("currentUser", JSON.stringify(u));
      if (data.user.language) setSiteLanguage(data.user.language);
      onLogin(u, data.company);
    } catch (err) {
      setError(t('login.serverError'));
    }
  };

  return (
    <main className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 py-8 liquid-transition relative overflow-y-auto scrollbar-hide" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      {/* Background decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[100px]" />

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="mb-8 text-center relative z-10">
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary/20 overflow-hidden">
          {loginCompanyLogo ? <img src={loginCompanyLogo} alt="Logo" className="w-full h-full object-contain p-1"/> : <Building2 className="w-8 h-8 text-white"/>}
        </div>
        <h1 className="text-3xl font-bold font-['Roboto_Slab',serif] bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">{loginCompanyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('login.subtitle')}</p>
      </motion.div>
      <div className="mb-4 relative z-10">
        <LanguageSwitcher size="sm" value={i18n.language as SiteLang} onChange={l => setSiteLanguage(l)}/>
      </div>
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.08 }}
        className="w-full max-w-sm space-y-4 glass p-7 rounded-[2rem] border border-white/20 shadow-2xl relative z-10 overflow-hidden">
        {error && <div className="bg-red-500/10 text-red-700 dark:text-red-400 text-sm md:text-xs p-3 rounded-lg border border-red-500/20 text-center">{error}</div>}

        <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 mb-4">
              <p className="text-sm md:text-xs text-muted-foreground leading-relaxed text-center">
                {t('login.botHintBefore')} <span className="font-semibold text-foreground">/start</span> {t('login.botHintAfter')}
              </p>
              <a href="https://t.me/qurilish_erp_bot" target="_blank" rel="noopener noreferrer" className="mt-2 text-sm md:text-xs font-semibold text-foreground flex items-center justify-center gap-1 hover:underline hover:text-primary">
                <Send className="w-3 h-3 text-primary"/> {t('login.goToBot', { handle: '@qurilish_erp_bot' })}
              </a>
            </div>
            <div>
              <label htmlFor="login-phone" className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground">{t('login.phoneLabel')}</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"/>
                <input id="login-phone" type="text" className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono liquid-transition shadow-inner"
                  value={phone} onChange={e => {
                    setError("");
                    const val = e.target.value;
                    if (val.startsWith("+998 ")) setPhone(val);
                    else if (val === "+998") setPhone("+998 ");
                  }} autoFocus/>
              </div>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-semibold py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">
              {t('login.getCode')}
            </button>
          </form>
        ) : step === "blocked" ? (
          <div className="space-y-4 text-center">
            <div className="flex flex-col items-center gap-3">
              {blockedReason === 'pending' ? (
                <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <Clock className="w-7 h-7 text-amber-500"/>
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-red-500"/>
                </div>
              )}
              {blockedReason === 'pending' && (
                <>
                  <p className="text-sm font-semibold">{t('login.subPendingTitle')}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('login.subPendingDesc')}</p>
                </>
              )}
              {(blockedReason === 'expired' || blockedReason === 'rejected') && (
                <>
                  <p className="text-sm font-semibold">{blockedReason === 'expired' ? t('login.subExpiredTitle') : t('login.subRejectedTitle')}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('login.subBlockedDesc')}</p>
                </>
              )}
            </div>
            <a href="https://t.me/Sadriddinov_Jahongir" target="_blank" rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-500 text-white text-sm font-semibold py-3.5 rounded-full min-h-[44px] active:scale-[0.98] transition-transform">
              <Send className="w-4 h-4"/> {t('login.contactAdmin', { handle: '@Sadriddinov_Jahongir' })}
            </a>
            <button type="button" onClick={() => { setStep("phone"); setBlockedReason(null); setError(""); }}
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2">
              {t('login.back')}
            </button>
          </div>
        ) : step === "devpass" ? (
          <form onSubmit={handleDevLogin} className="space-y-4">
            <div className="bg-slate-800/5 border border-slate-800/10 rounded-xl p-3 mb-2 text-center">
              <p className="text-sm md:text-xs text-muted-foreground">{t('login.devLoginTitle')}</p>
              <p className="text-xs font-mono text-foreground mt-1">{phone}</p>
            </div>
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground text-center">{t('login.passwordLabel')}</label>
              <input type="password" className="w-full text-base text-center border border-border/50 rounded-xl px-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition shadow-inner"
                placeholder="••••••••" value={password} onChange={e => { setError(""); setPassword(e.target.value); }} autoFocus/>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-semibold py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">
              {t('login.signIn')}
            </button>
            <button type="button" onClick={() => { setStep("phone"); setPassword(""); }} className="w-full text-sm md:text-xs text-muted-foreground hover:text-foreground py-2 liquid-transition">
              {t('login.changeNumber')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label className="text-sm md:text-xs font-medium block mb-2 text-muted-foreground text-center">{t('login.codeLabel')}</label>
              <OtpBoxes value={code} onChange={v => { setError(""); setCode(v); }} error={!!error} autoFocus/>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-semibold py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">
              {t('login.enterSystem')}
            </button>
            <div className="flex flex-col gap-2 pt-2">
              <button type="button" onClick={() => {
                if (timeLeft === 0) handlePhoneSubmit();
              }} className={`w-full text-sm md:text-xs font-medium py-2 rounded-lg liquid-transition ${timeLeft > 0 ? "text-muted-foreground/50 cursor-not-allowed" : "text-primary hover:bg-primary/10"}`}>
                {timeLeft > 0 ? t('login.resendCountdown', { time: `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` }) : t('login.resend')}
              </button>
              <button type="button" onClick={() => setStep("phone")} className="w-full text-sm md:text-xs text-muted-foreground hover:text-foreground py-2 liquid-transition">
                {t('login.changeNumber')}
              </button>
            </div>
          </form>
        )}
        </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* ─── Yangi firma ochish (mavjud formaga tegilmadi) ─────────────────── */}
      {onRegister && (
        <div className="w-full max-w-sm mt-5 relative z-10 animate-fade-in">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-xs text-muted-foreground">{t('login.or')}</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>
          <button type="button" onClick={onRegister}
            className="w-full text-sm font-semibold py-3 rounded-full border border-primary/30 text-foreground bg-primary/5 hover:bg-primary/10 liquid-transition flex items-center justify-center gap-2 min-h-[48px]">
            <Building2 className="w-4 h-4 text-primary" /> {t('login.newUser')}
          </button>
        </div>
      )}
    </main>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { t: tApp, i18n: i18nApp } = useTranslation();
  const anyBigModalOpen = useAnyBigModalOpen();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser|null>(()=>{
    const saved = localStorage.getItem("currentUser");
    return saved ? JSON.parse(saved) : null;
  });
  // Saqlangan hisobning tili (bu qurilmadagi oxirgi tanlovdan farqli bo'lishi
  // mumkin — masalan boshqa qurilmadan botda o'zgartirilgan bo'lsa) ustuvor.
  useEffect(() => {
    if (currentUser?.language && currentUser.language !== i18nApp.language) {
      setSiteLanguage(currentUser.language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.language]);
  // v1.2: kirish ekrani — login yoki yangi firma ochish (register wizard)
  const [authView, setAuthView] = useState<"login"|"register">(()=>{
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("rid") || sp.has("register")) return "register";
      if (localStorage.getItem("erp_reg")) return "register";
    }
    return "login";
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [activeCall, setActiveCall] = useState<ActiveCall|null>(null);
  const activeCallRef = useRef<ActiveCall|null>(null); activeCallRef.current = activeCall;
  const [chatIsOpen, setChatIsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [page, setPage] = useState<NavPage>(() => {
    return (localStorage.getItem("page") as NavPage) || "dashboard";
  });
  const [selProject, setSelProject] = useState<Project|null>(null);
  const [showSend, setShowSend] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [companyName, setCompanyName] = useState(() => localStorage.getItem("erp_companyName") || "QurilishERP");
  const [companyLogo, setCompanyLogo] = useState(() => localStorage.getItem("erp_companyLogo") || "");
  const [siteBg, setSiteBg] = useState(() => localStorage.getItem("erp_profileBg") || "");
  const [branchId, setBranchId] = useState(() => localStorage.getItem("erp_branchId") || "");
  // Firma brendini serverdan (login/register javobidan) qo'llaydi — endi brend
  // qurilma emas, FIRMAGA bog'liq. Boshqa firmaga kirsangiz to'g'ri brend chiqadi.
  const applyCompany = (company: any) => {
    if (company && company.name) {
      setCompanyName(company.name);
      setCompanyLogo(company.logoUrl || "");
      setBranchId(company.branchId || "");
      localStorage.setItem("erp_companyName", company.name);
      localStorage.setItem("erp_companyLogo", company.logoUrl || "");
      localStorage.setItem("erp_branchId", company.branchId || "");
    } else {
      // Firmasiz (legacy) foydalanuvchi — neytral default, boshqa firma brendi qolib ketmasin
      setCompanyName("QurilishERP");
      setCompanyLogo("");
      setBranchId("");
      localStorage.setItem("erp_companyName", "QurilishERP");
      localStorage.removeItem("erp_companyLogo");
      localStorage.removeItem("erp_branchId");
    }
  };
  const [colorTheme, setColorTheme] = useState(() => localStorage.getItem("erp_colorTheme") || "navy");
  const [themeMode, setThemeMode] = useState<"light"|"dark"|"system">(
    () => (localStorage.getItem("erp_themeMode") as "light"|"dark"|"system") || "system"
  );

  // Tanlangan rang temasi × rejim (light/dark/system) ni butun UI ga qo'llaydi.
  // `.dark` klassini <html> ga qo'yadi (barcha dark: utilitalar ishlashi uchun) va
  // per-tema CSS-var to'plamini yozadi. Bu eski konfliktli effektni almashtiradi.
  useEffect(() => {
    const t = COLOR_THEMES.find(x => x.id === colorTheme) || COLOR_THEMES[0];
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const isDark = themeMode === "dark" || (themeMode === "system" && mql.matches);
      const r = document.documentElement;
      r.classList.toggle("dark", isDark);
      const vars = isDark ? t.dark : t.light;
      for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
      r.style.colorScheme = isDark ? "dark" : "light";
    };

    apply();
    if (themeMode === "system") {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
  }, [colorTheme, themeMode]);

  const cycleThemeMode = () => {
    setThemeMode(prev => {
      const next = prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      localStorage.setItem("erp_themeMode", next);
      return next;
    });
  };

  const liveUser = currentUser ? (users.find(u => u.id === currentUser.id) ?? currentUser) : null;
  const selProjectMounted = useRef(false);

  // Socket handler'lari uchun yangi qiymatlar (stale closure'dan qochish)
  const usersRef = useRef(users); usersRef.current = users;
  const pageRef = useRef(page); pageRef.current = page;
  const chatOpenRef = useRef(chatIsOpen); chatOpenRef.current = chatIsOpen;

  useEffect(() => {
    localStorage.setItem("page", page);
  }, [page]);

  useEffect(() => {
    if (!selProjectMounted.current) { selProjectMounted.current = true; return; }
    if (selProject) {
      localStorage.setItem("selProjectId", selProject.id);
    } else {
      localStorage.removeItem("selProjectId");
    }
  }, [selProject]);

  useEffect(() => {
    if (liveUser) {
      setInitialLoading(true);
      // Fetch initial data when user logs in
      Promise.all([
        fetch(API_BASE + "/api/users").then(r => r.json()),
        fetch(API_BASE + "/api/objects").then(r => r.json()),
        fetch(API_BASE + "/api/transactions").then(r => r.json())
      ]).then(([uData, pData, tData]) => {
        if(Array.isArray(uData)) setUsers(uData.map(u => ({...u, id: u.id || u._id, projectIds: u.projectIds || []})));
        if(Array.isArray(pData)) {
          const formattedP = pData.map(p => {
            const mats = p.smeta?.resources?.length
              ? p.smeta.resources.filter((r:any) => r.group === 'material').map((m:any) => ({ id: String(m.index), name: m.rawName, quantity: m.qty, unit: m.unit, category: m.category || 'Qurilish', price: m.price ?? undefined }))
              : (p.materials || []).map((m:any) => ({ id: m._id || m.id, name: m.name, quantity: m.needed, unit: m.unit, category: 'Qurilish', price: m.price }));
            return { ...p, id: p.id || p._id, requiredMaterials: mats };
          });
          setProjects(formattedP);
          const savedId = localStorage.getItem("selProjectId");
          if (savedId && !selProject) {
            const found = formattedP.find((x: Project) => x.id === savedId);
            if (found) setSelProject(found);
          }
        }
        if(Array.isArray(tData)) {
          const formattedT = tData.map(t => ({...t, id: t.id || t._id}));
          setTransfers(formattedT.filter(t => t.type === 'transfer'));
          setIncomes(formattedT.filter(t => t.type === 'income'));
          setExpenses(formattedT.filter(t => t.type !== 'transfer' && t.type !== 'income'));
        }
      }).catch(console.error).finally(() => setInitialLoading(false));

      // Xabarlar + guruhlar (dastlabki yuklash)
      const fetchMsgs = () => {
        fetch(`${API_BASE}/api/messages?userId=${liveUser.id}`).then(r=>r.json()).then(mData => {
          if(Array.isArray(mData)) setMessages(mData.map(m => ({...m, id: m.id || m._id})));
        }).catch(console.error);
      };
      const fetchGroups = () => {
        fetch(`${API_BASE}/api/groups?userId=${liveUser.id}`).then(r=>r.json()).then(gData => {
          if(Array.isArray(gData)) setGroups(gData.map(g => ({...g, id: g.id || g._id})));
        }).catch(()=>{});
      };
      fetchMsgs();
      fetchGroups();

      // Browser bildirishnoma ruxsati
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(()=>{});
      }

      // ── Real-time (Socket.io) ──────────────────────────────────────────────
      const socket = connectSocket(liveUser.id);
      const withId = (p: any): Msg => ({ ...p, id: p.id || p._id });

      const onNew = (payload: any) => {
        const m = withId(payload);
        setMessages(prev => prev.some(x => x.id === m.id) ? prev.map(x => x.id===m.id?{...x,...m}:x) : [...prev, m]);
        if (m.fromUserId === liveUser.id) return;
        const sender = usersRef.current.find(u => u.id === m.fromUserId);
        const name = sender?.name || "Yangi xabar";
        const preview = m.type && m.type !== 'text' ? m.text : (m.text || "");
        const viewingChat = pageRef.current === 'chat' && chatOpenRef.current;
        if (!viewingChat) toast(name, { description: preview });
        if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
          try { new Notification(name, { body: preview }); } catch {}
        }
      };
      const onEdit = (payload: any) => setMessages(prev => prev.map(x => x.id===(payload.id||payload._id) ? {...x, ...withId(payload)} : x));
      const onDelete = (payload: any) => setMessages(prev => prev.map(x => x.id===payload.id ? {...x, deleted: true} : x));
      const onRead = ({ fromUserId, toUserId }: any) => setMessages(prev => prev.map(x => x.fromUserId===fromUserId && x.toUserId===toUserId ? {...x, read: true} : x));
      const onPresence = ({ online }: any) => setOnlineUsers(online || []);
      const onGroupNew = (g: any) => { const gg = {...g, id: g.id||g._id}; setGroups(prev => prev.some(x=>x.id===gg.id)?prev:[...prev, gg]); socket.emit("join:group", gg.id); toast("Yangi guruh: " + gg.name); };
      const onGroupUpdate = (g: any) => setGroups(prev => prev.map(x => x.id===(g.id||g._id) ? {...g, id: g.id||g._id} : x));
      const onGroupRemoved = ({ id }: any) => setGroups(prev => prev.filter(x => x.id !== id));

      // Transfer/chiqim tasdiqlash Telegram bot orqali ham bo'lishi mumkin —
      // socket orqali ochiq sessiyani darhol yangilaymiz (qayta login shart emas).
      const onTxUpdate = (payload: any) => {
        const t = { ...payload, id: payload.id || payload._id };
        if (t.type === 'transfer') setTransfers(prev => prev.map(x => x.id === t.id ? t : x));
        else if (t.type === 'income') setIncomes(prev => prev.map(x => x.id === t.id ? t : x));
        else setExpenses(prev => prev.map(x => x.id === t.id ? t : x));
      };
      const onTxNew = (payload: any) => {
        const t = { ...payload, id: payload.id || payload._id };
        if (t.type === 'transfer') setTransfers(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t]);
        else if (t.type === 'income') setIncomes(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t]);
        else setExpenses(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t]);
      };

      // Kiruvchi qo'ng'iroq (faol qo'ng'iroq bo'lmasa)
      const onCallOffer = (d: any) => {
        if (activeCallRef.current) return; // allaqachon qo'ng'iroqda — CallOverlay mesh'ni boshqaradi
        if (d.from === liveUser.id) return;
        setActiveCall({ direction: 'in', mode: d.mode || 'voice', peerId: d.from, groupId: d.groupId, offer: d.sdp, fromName: d.fromName });
      };

      // Til boshqa qurilmadan (masalan bot orqali) o'zgartirilsa — shu yerda ham
      // darhol yangi tilga o'tadi (va aksincha, sayt orqali o'zgartirsa botga ham boradi).
      const onLanguage = ({ language }: any) => {
        if (!language) return;
        setSiteLanguage(language);
        setCurrentUser(prev => {
          if (!prev) return prev;
          const updated = { ...prev, language };
          localStorage.setItem("currentUser", JSON.stringify(updated));
          return updated;
        });
      };

      socket.on("message:new", onNew);
      socket.on("message:edit", onEdit);
      socket.on("message:delete", onDelete);
      socket.on("message:read", onRead);
      socket.on("presence", onPresence);
      socket.on("group:new", onGroupNew);
      socket.on("group:update", onGroupUpdate);
      socket.on("group:removed", onGroupRemoved);
      socket.on("call:offer", onCallOffer);
      socket.on("transaction:update", onTxUpdate);
      socket.on("transaction:new", onTxNew);
      socket.on("user:language", onLanguage);

      // Fallback polling (socket uzilsa) — kamroq
      const fetchTx = () => {
        fetch(`${API_BASE}/api/transactions`).then(r=>r.json()).then(tData => {
          if (Array.isArray(tData)) {
            const formattedT = tData.map((t: any) => ({...t, id: t.id || t._id}));
            setTransfers(formattedT.filter((t: any) => t.type === 'transfer'));
            setIncomes(formattedT.filter((t: any) => t.type === 'income'));
            setExpenses(formattedT.filter((t: any) => t.type !== 'transfer' && t.type !== 'income'));
          }
        }).catch(()=>{});
      };
      const intv = setInterval(() => { fetchMsgs(); fetchGroups(); fetchTx(); }, 12000);
      return () => {
        clearInterval(intv);
        socket.off("message:new", onNew);
        socket.off("message:edit", onEdit);
        socket.off("message:delete", onDelete);
        socket.off("message:read", onRead);
        socket.off("presence", onPresence);
        socket.off("group:new", onGroupNew);
        socket.off("group:update", onGroupUpdate);
        socket.off("group:removed", onGroupRemoved);
        socket.off("call:offer", onCallOffer);
        socket.off("user:language", onLanguage);
        socket.off("transaction:update", onTxUpdate);
        socket.off("transaction:new", onTxNew);
      };
    }
  }, [liveUser?.id]);

  // Guruh room'lariga qo'shilish (guruhlar yangilanganda)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    groups.forEach(g => socket.emit("join:group", g.id));
  }, [groups.map(g => g.id).join(",")]);

  if (!liveUser) {
    return authView === "register"
      ? <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin"/></div>}>
          <RegisterWizard onBack={()=>setAuthView("login")} onDone={(u,company)=>{setCurrentUser(u);setPage("dashboard");setAuthView("login");applyCompany(company);}}/>
        </Suspense>
      : <LoginScreen onLogin={(u,company)=>{setCurrentUser(u);setPage("dashboard");applyCompany(company);}} onRegister={()=>setAuthView("register")}/>;
  }
  // Dasturchi (super-admin) — alohida panel: barcha firmalar va foydalanuvchilar
  if (liveUser.role === "dasturchi") return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin"/></div>}>
      <DeveloperPanel currentUser={liveUser} onLogout={()=>{setCurrentUser(null);setAuthView("login");}}/>
    </Suspense>
  );
  if (initialLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin"/></div>;

  const admin = isAdmin(liveUser.role);
  const unreadMsgs = messages.filter(m=>m.toUserId===liveUser.id&&!m.read).length;
  const pendingT = transfers.filter(t=>t.toUserId===liveUser.id&&t.status==="pending").length;
  const pendingE = expenses.filter(e=>e.toUserId===liveUser.id&&e.status==="pending").length;
  const totalNotifs = unreadMsgs + pendingT + pendingE;

  const handleSendTransfer = async (t: Transfer) => {
    try {
      const payload = {...t, type: "transfer", fromUserName: t.fromUserName || liveUser.name};
      const res = await fetch(API_BASE + "/api/transactions", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      if (res.ok) { const data = await res.json(); setTransfers(p=>[...p, {...data, id: data.id || data._id}]); }
    } catch(e) { console.error('Transfer yuborish xatosi:', e); }
  };
  const handleConfirmTransfer = async (id: string, defect?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/transactions/${id}/confirm`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({defect}) });
      if (res.ok) setTransfers(p=>p.map(t=>t.id===id?{...t,status:"confirmed",confirmedDate:new Date().toISOString().split("T")[0],defect}:t));
    } catch(e) { console.error('Transfer tasdiqlash xatosi:', e); }
  };
  const handleRejectTransfer = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/transactions/${id}/reject`, { method: "PATCH" });
      if (res.ok) setTransfers(p=>p.map(t=>t.id===id?{...t,status:"rejected"}:t));
    } catch(e) { console.error('Transfer rad etish xatosi:', e); }
  };
  const handleAddExpense = async (e: Expense) => {
    try {
      const payload = {
        type: e.type,
        amount: e.amount,
        description: e.description,
        projectId: e.projectId || undefined,
        toUserId: e.toUserId || undefined,
        createdById: e.createdById,
        date: e.date,
        status: e.status
      };
      const res = await fetch(API_BASE + "/api/transactions", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      if (res.ok) { const data = await res.json(); setExpenses(p=>[...p, {...data, id: data._id || data.id}]); }
      else {
        const errData = await res.json();
        console.error('Expense error:', errData);
        alert('Xatolik: ' + (errData.error || 'Nomalum xato'));
      }
    } catch(err) { console.error(err); }
  };
  const handleAddUser = async (u: AppUser): Promise<{ ok: boolean; error?: string }> => {
    try {
      const nameParts = u.name.trim().split(" ");
      const res = await fetch(API_BASE + "/api/auth/users", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({firstName: nameParts[0] || u.name, lastName: nameParts.slice(1).join(" ") || "", phone: u.phone, role: u.role, brigade: u.brigade, projectIds: u.projectIds || []}) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(p=>[...p, {...data, id: data.id || data._id, name: data.name || u.name, projectIds: u.projectIds || []}]);
        return { ok: true };
      }
      return { ok: false, error: data.error || "Foydalanuvchi qo'shilmadi" };
    } catch(err) {
      console.error('Foydalanuvchi qo\'shish xatosi:', err);
      return { ok: false, error: "Server bilan bog'lanib bo'lmadi" };
    }
  };
  const handleUpdateUser = async (u: AppUser) => {
    try {
      const payload = {
        firstName: u.name.trim().split(" ")[0] || u.name,
        lastName: u.name.trim().split(" ").slice(1).join(" ") || "",
        phone: u.phone,
        role: u.role,
        brigade: u.brigade,
        projectIds: u.projectIds || []
      };
      const res = await fetch(`${API_BASE}/api/auth/users/${u.id}`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setUsers(p => p.map(usr => usr.id === u.id ? u : usr));
      }
    } catch(err) { console.error(err); }
  };
  const handleDeleteUser = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/users/${id}`, { method: "DELETE" });
      if (res.ok) setUsers(p=>p.filter(u=>u.id!==id));
      else toast.error("O'chirib bo'lmadi — dasturchi panelidan tekshiring (@Sadriddinov_Jahongir)");
    } catch(err) { console.error(err); toast.error("Server bilan bog'lanib bo'lmadi"); }
  };

  const handleConfirmExpense = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/transactions/${id}/confirm`, {
        method: "PATCH",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ confirmedById: liveUser.id })
      });
      if (res.ok) setExpenses(p=>p.map(ex=>ex.id===id?{...ex,status:"confirmed",confirmedById:liveUser.id}:ex));
    } catch(err) { console.error(err); }
  };
  const handleSendMsg = async (m: Msg) => {
    try {
      const res = await fetch(API_BASE + "/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m)
      });
      if (res.ok) {
        const data = await res.json();
        const newMsg = {...data, id: data._id || data.id};
        setMessages(p => {
          if (p.some(x => x.id === newMsg.id)) return p;
          return [...p, newMsg];
        });
      }
    } catch (err) { console.error(err); }
  };
  const handleMarkRead = async (fromUserId: string) => {
    if (!liveUser) return;
    try {
      await fetch(API_BASE + "/api/messages/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId: liveUser.id })
      });
      setMessages(p=>p.map(m=>(m.fromUserId===fromUserId&&m.toUserId===liveUser.id)?{...m,read:true}:m));
    } catch (err) { console.error(err); }
  };
  const handleEditMsg = async (id: string, newText: string) => {
    setMessages(p => p.map(m => m.id === id ? {...m, text: newText, edited: true} : m));
    try { await fetch(`${API_BASE}/api/messages/${id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text: newText }) }); }
    catch (err) { console.error(err); }
  };
  const handleDeleteMsg = async (id: string) => {
    setMessages(p => p.map(m => m.id === id ? {...m, deleted: true, text: ''} : m));
    try { await fetch(`${API_BASE}/api/messages/${id}`, { method: "DELETE" }); }
    catch (err) { console.error(err); }
  };
  const handlePinMsg = async (id: string) => {
    const cur = messages.find(m => m.id === id);
    const next = !cur?.pinned;
    setMessages(p => p.map(m => m.id === id ? {...m, pinned: next} : m));
    try { await fetch(`${API_BASE}/api/messages/${id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ pinned: next }) }); }
    catch (err) { console.error(err); }
  };
  const handleCreateGroup = async (name: string, memberIds: string[]) => {
    try {
      const res = await fetch(`${API_BASE}/api/groups`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ name, memberIds, createdBy: liveUser.id })
      });
      if (res.ok) { const g = await res.json(); const gg = {...g, id: g.id || g._id}; setGroups(p => p.some(x=>x.id===gg.id)?p:[...p, gg]); getSocket()?.emit("join:group", gg.id); return gg; }
    } catch (err) { console.error(err); }
    return null;
  };
  const handleGetDevSupport = async (): Promise<Group|null> => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/dev-support`, { method: "POST" });
      if (res.ok) {
        const g = await res.json();
        const gg = {...g, id: g.id || g._id};
        setGroups(p => p.some(x=>x.id===gg.id)?p:[...p, gg]);
        getSocket()?.emit("join:group", gg.id);
        return gg;
      }
    } catch (err) { console.error(err); }
    return null;
  };
  const handleStartCall = (mode: 'voice'|'video', target: { peer?: AppUser; group?: Group }) => {
    if (target.group) setActiveCall({ direction: 'out', mode, groupId: target.group.id, memberIds: target.group.memberIds.filter(id => id !== liveUser.id) });
    else if (target.peer) setActiveCall({ direction: 'out', mode, peerId: target.peer.id });
  };
  const handleUpdateAvatar = (url: string) => setUsers(p=>p.map(u=>u.id===liveUser.id?{...u,avatar:url}:u));
  // Deterministik parser natijasini qabul qiladi: byudjet meta'dan, materiallar
  // 'material' guruhidan (to'liq aniq qty), butun natija proj.smeta'da saqlanadi.
  const handleSmetaUploaded = (projectId: string, result: SmetaResult) => {
    const mats = result.resources.filter(r => r.group === 'material');
    setProjects(p => p.map(proj => proj.id === projectId ? {
      ...proj,
      budget: result.meta?.totalWithoutVat ?? proj.budget,
      smeta: result,
      requiredMaterials: mats.map(m => ({ id: String(m.index), name: m.rawName, quantity: m.qty, unit: m.unit, category: m.category || 'Qurilish', price: m.price ?? undefined }))
    } : proj));
  };


  // Nav items based on role
  const NAV: { key: NavPage; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: "dashboard", label: tApp('nav.dashboard'), icon: Home },
    ...(admin ? [
      { key: "finance" as NavPage, label: tApp('nav.finance'), icon: DollarSign },
      { key: "reports" as NavPage, label: tApp('nav.reports'), icon: BarChart2 },
    ] : []),
    { key: "chat", label: tApp('nav.chat'), icon: MessageCircle, badge: unreadMsgs },
    { key: "profile", label: tApp('nav.profile'), icon: User },
  ];

  const currentProject = selProject ? (projects.find(p=>p.id===selProject.id)??selProject) : null;

  return (
    <div className={`h-[100dvh] flex flex-col overflow-hidden font-['Inter',sans-serif] ${siteBg ? 'with-bg' : ''}`} style={(() => { if (!siteBg) return { background: 'var(--background)' }; const isImg = !siteBg.startsWith('linear-gradient') && !siteBg.startsWith('radial-gradient'); return isImg ? { backgroundImage: `url(${siteBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : { background: siteBg }; })()}>
      {/* Header — 3 ta mustaqil "orolcha" pill (logo / nav / bell+avatar), orqada bar yo'q */}
      <header className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 z-50 sticky top-0">
        <div className="nav-pill-desktop flex items-center gap-2.5 px-3 py-2 rounded-full flex-shrink-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-accent to-accent/75 shadow-sm flex-shrink-0">
            {companyLogo ? <img src={companyLogo} alt="Logo" className="w-full h-full object-contain"/> : <Building2 className="w-3.5 h-3.5 text-white"/>}
          </div>
          <span className="text-sm font-bold tracking-tight hidden lg:block whitespace-nowrap">{companyName}</span>
        </div>
        <nav className="hidden sm:flex items-center gap-0.5 lg:gap-1 nav-pill-desktop px-1.5 py-1.5 rounded-full w-fit flex-shrink-0">
          {NAV.map(n=>(
            <button key={n.key} onClick={()=>{setPage(n.key);setSelProject(null);}}
              className={`relative flex items-center gap-1.5 lg:gap-2 text-sm md:text-[13px] lg:text-sm px-2.5 md:px-2.5 lg:px-4 py-2 lg:py-2.5 rounded-full z-10 liquid-transition whitespace-nowrap ${page===n.key?"text-primary font-semibold":"text-muted-foreground hover:text-foreground"}`}>
              {page===n.key && (
                <motion.div layoutId="desktopNavPill" className="absolute inset-0 rounded-full bg-primary/10 -z-10"
                  transition={{ type: "spring", stiffness: 480, damping: 34 }}/>
              )}
              <n.icon className="w-[18px] h-[18px] lg:w-5 lg:h-5 flex-shrink-0"/><span className="hidden md:inline">{n.label}</span>
              {!!n.badge && n.badge>0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-accent text-accent-foreground rounded-full text-[10px] flex items-center justify-center font-bold shadow-sm">{n.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-pill-desktop flex items-center gap-1 px-1.5 py-1.5 rounded-full flex-shrink-0 ml-auto">
          {(liveUser.role === 'direktor' || liveUser.role === 'orinbosar') && (
            <button onClick={() => setAiOpen(true)} title="AI Yordamchi" aria-label="AI Yordamchi"
              className="btn btn-ghost w-9 h-9 p-0 rounded-full">
              <span className="text-base leading-none">✨</span>
            </button>
          )}
          <NotificationBell messages={messages} transfers={transfers} expenses={expenses} users={users} currentUser={liveUser}
            onOpenChat={()=>{setPage("chat");setSelProject(null);}} onOpenDashboard={()=>{setPage("dashboard");setSelProject(null);}}/>
          <button onClick={cycleThemeMode} title={themeMode==="light"?"Yorug'":themeMode==="dark"?"Qorong'i":"Tizim bo'yicha"}
            className="btn btn-ghost w-9 h-9 p-0 rounded-full">
            {themeMode==="light"?<Sun className="w-[18px] h-[18px]"/>:themeMode==="dark"?<Moon className="w-[18px] h-[18px]"/>:<Monitor className="w-[18px] h-[18px]"/>}
          </button>
          <button onClick={()=>{setPage("profile");setSelProject(null);}} className="flex items-center gap-2 hover:bg-white/5 pl-1 pr-1 sm:pr-3 py-1 rounded-full liquid-transition">
            <Avatar user={liveUser} size="sm"/>
            <div className="hidden sm:block text-left">
              <p className="text-[11px] font-semibold leading-none">{liveUser.name.split(" ")[0]}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{ROLE_LABELS[liveUser.role]}</p>
            </div>
          </button>
        </div>
      </header>

      {/* Top bar — admin only (Mobile/Tablet only) */}
      <div className="block md:hidden">
        {admin && <BottomFinanceBar expenses={expenses} projects={projects}/>}
      </div>

      {/* Main */}
      <main key={`${page}:${selProject?.id || ''}`} className={`page-enter bg-background flex-1 overflow-hidden flex flex-col relative ${(page === 'chat' && chatIsOpen) ? '' : 'main-pb-safe'}`}>
        {/* Admin dashboard */}
        {page==="dashboard" && admin && !selProject && (
          <AdminDashboard currentUser={liveUser} users={users} projects={projects} transfers={transfers}
            setUsers={setUsers} onSendTransfer={handleSendTransfer} onConfirmTransfer={handleConfirmTransfer}
            onRejectTransfer={handleRejectTransfer} onSelectProject={p=>{setSelProject(p);}} onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser} onDeleteUser={handleDeleteUser}
            onAddProject={(project)=>{
              setProjects(p=>[...p, project]);
            }}/>
        )}
        {/* Non-admin dashboard: just their transfers */}
        {page==="dashboard" && !admin && !selProject && (
          <MyTransfersPanel currentUser={liveUser} transfers={transfers} allUsers={users} projects={projects}
            onConfirm={handleConfirmTransfer} onReject={handleRejectTransfer} onSend={()=>setShowSend(true)}/>
        )}
        {/* Object detail */}
        {page==="dashboard" && selProject && currentProject && (
          <ObjectDetailPage project={currentProject} currentUser={liveUser} users={users} transfers={transfers}
            onBack={()=>setSelProject(null)} onSendTransfer={handleSendTransfer} onConfirm={handleConfirmTransfer} onReject={handleRejectTransfer} onSmetaUploaded={handleSmetaUploaded}
            onUpdateStatus={(pid, newStatus) => {
              setProjects(prev => prev.map(p => p.id === pid ? {...p, status: newStatus} : p));
            }}
          />
        )}
        {page==="finance" && admin && (
          <FinancePage currentUser={liveUser} users={users} projects={projects} expenses={expenses}
            onAddExpense={handleAddExpense} onConfirm={handleConfirmExpense}/>
        )}
        {page==="reports" && admin && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin"/></div>}>
            <ReportsPage projects={projects} expenses={expenses} users={users}/>
          </Suspense>
        )}
        {page==="chat" && (
          <ChatPage currentUser={liveUser} users={users} messages={messages} groups={groups} onlineUsers={onlineUsers}
            onSend={handleSendMsg} onMarkRead={handleMarkRead}
            onEdit={handleEditMsg} onDelete={handleDeleteMsg} onPin={handlePinMsg}
            onChatOpen={open => setChatIsOpen(open)} onCreateGroup={handleCreateGroup} onStartCall={handleStartCall}
            canModifyMessages={liveUser.role === 'direktor' || liveUser.role === 'orinbosar'}
            onGetDevSupport={handleGetDevSupport}/>
        )}
        {page==="profile" && (
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            <ProfilePage currentUser={liveUser} projects={projects} onUpdateAvatar={handleUpdateAvatar} onUpdateUser={handleUpdateUser}
              onLogout={()=>{setCurrentUser(null);setSelProject(null);setPage("dashboard");}}
              onCompanyNameChange={name => setCompanyName(name)}
              onCompanyLogoChange={logo => setCompanyLogo(logo)}
              onBgChange={bg => setSiteBg(bg)}
              colorTheme={colorTheme}
              onColorThemeChange={id => { setColorTheme(id); localStorage.setItem("erp_colorTheme", id); }}
              themeMode={themeMode}
              onThemeModeChange={m => { setThemeMode(m); localStorage.setItem("erp_themeMode", m); }}
              canEditCompany={!!(liveUser.isOwner || liveUser.role === 'direktor')}/>
          </div>
        )}
      </main>

      {/* Bottom bar — admin only (Desktop only) */}
      <div className="hidden md:block">
        {admin && <BottomFinanceBar expenses={expenses} projects={projects}/>}
      </div>

      {/* Global send modal for non-admin */}
      {showSend && !admin && (
        <SendTransferModal currentUser={liveUser} projects={projects} allUsers={users}
          onClose={()=>setShowSend(false)} onSend={t=>{handleSendTransfer(t);setShowSend(false);}}/>
      )}

      {/* Mobile Bottom Navigation — iOS 26 "Liquid Glass" pill, spring-animated */}
      <nav className={`ios-bottom-bar flex items-center justify-around ${(page==='chat' && chatIsOpen) || anyBigModalOpen ? 'ios-bottom-bar-hidden' : ''}`}>
        {NAV.map(n => (
          <motion.button key={n.key} onClick={() => { setPage(n.key); setSelProject(null); }}
            whileTap={{ scale: 0.86 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            aria-label={n.label}
            aria-current={page===n.key ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 w-14 h-14 relative z-10 ${page===n.key?"text-white":"text-white/55"}`}
          >
            {page === n.key && (
              <motion.div
                layoutId="mobileNavLiquidPill"
                className="absolute w-11 h-11 rounded-full liquid-pill -z-10"
                transition={{ type: "spring", stiffness: 480, damping: 32 }}
              />
            )}
            <div className={`flex items-center justify-center w-8 h-8 transition-transform duration-300 ${page===n.key?"scale-110":""}`}>
              {n.key === "profile"
                ? <div className={`rounded-full ${page===n.key?"ring-2 ring-white/70":""}`}><Avatar user={liveUser} size="sm"/></div>
                : <n.icon className={`w-5 h-5 ${page===n.key?"fill-current":""}`}/>}
            </div>
            {!!n.badge && n.badge>0 && (
              <span className="badge-pulse absolute top-0 right-2 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center font-bold shadow-sm border border-black/50">{n.badge}</span>
            )}
          </motion.button>
        ))}
      </nav>

      {/* Qo'ng'iroq (WebRTC) */}
      {activeCall && (
        <Suspense fallback={null}>
          <CallOverlay currentUser={liveUser} users={users} call={activeCall} onClose={() => setActiveCall(null)}/>
        </Suspense>
      )}

      {/* AI Yordamchi — faqat direktor va o'rinbosar; endi FAQAT header'dagi ✨ tugmasidan ochiladi */}
      {(liveUser.role === 'direktor' || liveUser.role === 'orinbosar') && aiOpen && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin"/></div>}>
          <AIAssistant
            currentUser={liveUser}
            users={users}
            token={localStorage.getItem('token') || ''}
            open={aiOpen}
            onClose={() => setAiOpen(false)}
          />
        </Suspense>
      )}

      {/* Bildirishnoma toast'lari */}
      <Toaster position="top-center" richColors closeButton/>
    </div>
  );
}
