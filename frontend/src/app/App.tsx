import { useState, useRef, useEffect } from "react";
import {
  Building2, Users, HardHat, Package, Plus, ArrowLeft,
  CheckCircle, Clock, AlertTriangle, ChevronRight, MapPin,
  Phone, User, X, Check, Download, BarChart2,
  DollarSign, MessageCircle, ChevronDown, ChevronUp, Send,
  TrendingDown, Wallet, LogOut, Camera, Home, UserPlus, Edit, Trash, Search, AlertCircle, ChevronLeft, Loader2, Paperclip, Mic, Video as VideoIcon, Image as ImageIcon, FileText, CornerDownLeft, Share2, SquareCheck, Trash2, MoreHorizontal, Upload, Palette, Sun, Moon, Monitor, PhoneOff, MicOff, VideoOff, Users2, Copy, Bell
} from "lucide-react";
import { toast, Toaster } from "sonner";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer
} from "recharts";
import { API_BASE, parseSmetaFile, uploadChatMedia } from "./api";
import { connectSocket, getSocket, disconnectSocket } from "./socket";
import { motion, AnimatePresence } from "motion/react";


// ─── Types ────────────────────────────────────────────────────────────────────
type Role = "direktor" | "orinbosar" | "prorab" | "brigadir" | "ishchi" | "dasturchi";
type NavPage = "dashboard" | "finance" | "reports" | "chat" | "profile";
type ExpType = "oylik" | "material" | "jihozlar" | "transport" | "boshqa";
type TStatus = "pending" | "confirmed" | "rejected";
type EStatus = "pending" | "confirmed";

interface AppUser {
  id: string; name: string; role: Role; phone: string;
  avatar?: string; brigade?: string; projectIds: string[];
  isOwner?: boolean; companyId?: string;
}
interface Project {
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
}
interface Expense {
  id: string; type: ExpType; amount: number; toUserId?: string;
  projectId: string; description: string; date: string;
  status: EStatus; createdById: string; confirmedById?: string;
}
interface Msg {
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
interface ActiveCall {
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
const ROLE_LABELS: Record<Role, string> = {
  direktor: "Direktor", orinbosar: "O'rinbosar",
  prorab: "Prorab", brigadir: "Brigadir", ishchi: "Ishchi", dasturchi: "Dasturchi"
};
const ROLE_COLORS: Record<Role, string> = {
  direktor: "bg-red-500/15 text-red-600 dark:text-red-300",
  orinbosar: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  prorab: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  brigadir: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  ishchi: "bg-green-500/15 text-green-600 dark:text-green-300",
  dasturchi: "bg-slate-800/15 text-slate-700 dark:text-slate-200"
};
const EXP_LABELS: Record<ExpType, string> = {
  oylik: "Oylik", material: "Material",
  jihozlar: "Jihozlar", transport: "Transport", boshqa: "Boshqa"
};
const CHART_COLORS = ["#1B3A6B", "#D9460F", "#1B7A4B", "#F0A500", "#7B2D8B"];
const fmt = (n?: number) => (n || 0).toLocaleString("uz-UZ") + " so'm";
const isAdmin = (r: Role) => r === "direktor" || r === "orinbosar" || r === "dasturchi";
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
    <div className={`${sz} rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary flex-shrink-0 select-none`}>
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
    if (phone.length < 9) { setErr("Telefon raqam noto'g'ri"); return; }
    if (!form.name.trim()) { setErr("Ism familiya kiritilishi shart"); return; }
    if (users.find(u => u.phone.replace(/\D/g,"") === phone)) { setErr("Bu telefon raqam allaqachon ro'yxatdan o'tgan"); return; }

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
    else setErr(result.error || "Foydalanuvchi qo'shilmadi");
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(27,58,107,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary"/>Yangi Foydalanuvchi</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>{err}</div>}
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Ism Familiya *</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Masalan: Aliyev Jasur" value={form.name} onChange={e => { setErr(""); setForm({...form, name: e.target.value}); }} required/>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Telefon raqam *</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              value={form.phone} onChange={e => { 
                setErr(""); 
                const val = e.target.value;
                if (val.startsWith("+998 ")) setForm({...form, phone: val});
                else if (val === "+998") setForm({...form, phone: "+998 "});
              }} required/>
            <p className="text-sm md:text-xs text-muted-foreground mt-1">SMS orqali tasdiqlash keyingi bosqichda</p>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Lavozim *</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {(form.role === "brigadir" || form.role === "ishchi") && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">Brigada *</label>
              {currentUser.role === "brigadir" ? (
                <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-muted font-medium" value={currentUser.brigade} readOnly/>
              ) : (
                <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.brigade} onChange={e => setForm({...form, brigade: e.target.value})}>
                  <option value="">Tanlang...</option>
                  {brigades.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="__new__">+ Yangi brigada</option>
                </select>
              )}
              {form.brigade === "__new__" && (
                <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background mt-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Brigada nomi (masalan: 3-Brigada)" onChange={e => setForm({...form, newBrigade: e.target.value})}/>
              )}
            </div>
          )}
          {isAdmin(currentUser.role) && form.role !== "orinbosar" && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">Obyektlar</label>
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
            <button type="button" onClick={onClose} disabled={submitting} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50">Bekor</button>
            <button type="submit" disabled={submitting} className="flex-1 text-sm md:text-xs bg-primary text-white rounded px-3 py-2 hover:bg-primary/90 transition-colors font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin"/>}Qo'shish
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
          smetaResult = await parseSmetaFile(smeta);
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
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

  const myProjects = isAdmin(currentUser.role) ? projects : projects.filter(p => currentUser.projectIds.includes(p.id));
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
    if (showCustom) {
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
        note: [mat.price ? `Narxi: ${Number(mat.price).toLocaleString()} so'm` : "", note].filter(Boolean).join(" | ") || undefined
      });
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] overflow-y-auto scrollbar-hide animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(27,58,107,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><Send className="w-4 h-4 text-primary"/>Material Yuborish</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {/* Project */}
          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Obyekt *</label>
            <select className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none"
              value={projectId} onChange={e => { setProjectId(e.target.value); setSelMats([]); setShowCustom(false); setCustomMats([{ name: "", unit: "", quantity: "1", price: "" }]); }} required>
              <option value="">Tanlang...</option>
              {myProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Multi-select materials */}
          {selProj && (
            <div>
              <label className="text-[11px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Materiallar *</label>

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
                          <label className="text-[10px] text-muted-foreground block mb-1 font-semibold uppercase">Hajmi (miqdor)</label>
                          <input type="number" min="1" placeholder="1"
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                            value={sel.quantity} onChange={e => updateMat(sel.name, "quantity", e.target.value)}/>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-1 font-semibold uppercase">Narxi (so'm)</label>
                          <input type="number" min="0" placeholder="0"
                            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                            value={sel.price} onChange={e => updateMat(sel.name, "price", e.target.value)}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Qidiruvli select */}
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"/>
                <input value={matSearch} onChange={e => setMatSearch(e.target.value)}
                  placeholder="Material qidirish..."
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
                      {q ? "Topilmadi — pastdan qo'lda kiriting" : selProj.requiredMaterials.length === 0 ? "Smeta yuklanmagan — qo'lda kiriting" : "Barchasi tanlandi"}
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

                {/* Custom material */}
                <div className={`liquid-transition ${showCustom ? "bg-primary/5" : "bg-card hover:bg-muted/30"}`}>
                  <label className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={showCustom} onChange={e => setShowCustom(e.target.checked)}
                      className="w-4 h-4 accent-primary rounded flex-shrink-0"/>
                    <span className="text-sm italic text-muted-foreground">Boshqa material...</span>
                  </label>
                  {showCustom && (
                    <div className="px-3 pb-3 space-y-4 border-t border-border/30 pt-3">
                      {customMats.map((cm, i) => (
                        <div key={i} className="space-y-2 relative pr-7 bg-muted/40 p-2 rounded-xl border border-border/40">
                          <input placeholder="Material nomi *" required={showCustom && i === 0}
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
                            <input type="number" min="1" placeholder="Miqdor *" required={showCustom && cm.name.trim() !== ""}
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
                            <input placeholder="O'lchov *" required={showCustom && cm.name.trim() !== ""}
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
                            <input type="number" min="0" placeholder="Narx"
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
                        <Plus className="w-3 h-3"/> Yana qo'shish (Yoki Enter bosing)
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {selMats.length > 0 || (showCustom && customMats.some(m => m.name.trim())) ? (
                <p className="mt-1.5 text-[10px] text-primary font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3 h-3"/>{selMats.length + (showCustom ? customMats.filter(m => m.name.trim()).length : 0)} material tanlandi
                </p>
              ) : null}
            </div>
          )}

          {/* Recipient */}
          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Kimga *</label>
            <select className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none"
              value={toUserId} onChange={e => setToUserId(e.target.value)} required>
              <option value="">Tanlang...</option>
              {targets.map(u => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role]}</option>)}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Izoh <span className="normal-case font-normal">(ixtiyoriy)</span></label>
            <input className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none"
              placeholder="Qo'shimcha ma'lumot..." value={note} onChange={e => setNote(e.target.value)}/>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm border border-border rounded-xl px-3 py-2.5 hover:bg-muted liquid-transition font-medium">Bekor</button>
            <button type="submit"
              disabled={selMats.length === 0 && (!showCustom || !customMats.some(m => m.name.trim()))}
              className="flex-1 text-sm text-white rounded-xl px-3 py-2.5 font-bold liquid-transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              style={{ background: "linear-gradient(135deg, #1B3A6B 0%, #243F6E 100%)" }}>
              Yuborish
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
  const [form, setForm] = useState({ type: "oylik" as ExpType, amount: "", projectId: projects[0]?.id || "", description: "", toUserId: "", date: new Date().toISOString().split("T")[0] });
  const [err, setErr] = useState("");
  const [boshqaRows, setBoshqaRows] = useState<{ name: string; price: string }[]>([{ name: "", price: "" }]);

  const boshqaTotal = boshqaRows.reduce((s, r) => s + (Number(r.price) || 0), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");

    if (form.type === "boshqa") {
      const valid = boshqaRows.filter(r => r.name.trim() && r.price);
      if (valid.length === 0) { setErr("Kamida bitta material va narx kiritilishi shart"); return; }
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

    if (!form.amount || +form.amount <= 0) { setErr("Summa kiritilishi shart"); return; }
    if (form.type === "oylik" && !form.toUserId) { setErr("Oylik uchun xodimni tanlang"); return; }
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
          <h3 className="font-bold text-sm flex items-center gap-2"><TrendingDown className="w-4 h-4 text-accent"/>Chiqim Qo'shish</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {err && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>{err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Tur *</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.type} onChange={e => { setErr(""); setForm({...form, type: e.target.value as ExpType, toUserId: "", description: ""}); }}>
                {(Object.keys(EXP_LABELS) as ExpType[]).map(k => <option key={k} value={k}>{EXP_LABELS[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Sana *</label>
              <input type="date" className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.date} onChange={e => setForm({...form, date: e.target.value})} required/>
            </div>
          </div>

          {/* Boshqa: dynamic material rows — replaces amount + description fields */}
          {form.type === "boshqa" ? (
            <div>
              <label className="text-[10px] font-bold block mb-2 text-muted-foreground uppercase tracking-wider">Materiallar va narxlar</label>
              <div className="space-y-2">
                {boshqaRows.map((row, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input placeholder={`Material ${i + 1}`}
                      className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-input-background focus:outline-none"
                      value={row.name} onChange={e => { const r = [...boshqaRows]; r[i] = {...r[i], name: e.target.value}; setBoshqaRows(r); }}/>
                    <input type="number" min="0" placeholder="Narx"
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
                <Plus className="w-3.5 h-3.5"/>Qo'shish
              </button>
              {boshqaTotal > 0 && (
                <div className="mt-2.5 flex items-center justify-between p-3 rounded-xl border border-accent/20" style={{ background: "rgba(217,70,15,0.05)" }}>
                  <span className="text-xs text-muted-foreground font-semibold">Jami to'lov:</span>
                  <span className="text-sm font-bold text-accent">{boshqaTotal.toLocaleString()} so'm</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Summa (so'm) *</label>
                <input type="number" min="1" className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                  placeholder="5 000 000" value={form.amount} onChange={e => { setErr(""); setForm({...form, amount: e.target.value}); }} required/>
              </div>
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
                  Tavsif <span className="normal-case font-normal">(ixtiyoriy)</span>
                </label>
                <input className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                  placeholder="To'lov maqsadi..." value={form.description} onChange={e => { setErr(""); setForm({...form, description: e.target.value}); }}/>
              </div>
            </>
          )}

          {projects.length > 0 && (
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">Obyekt</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.projectId} onChange={e => setForm({...form, projectId: e.target.value})}>
                <option value="">— umumiy —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
              Kimga {form.type === "oylik" ? <span className="text-accent normal-case">*</span> : <span className="normal-case font-normal">(ixtiyoriy)</span>}
            </label>
            <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
              value={form.toUserId} onChange={e => { setErr(""); setForm({...form, toUserId: e.target.value}); }}>
              <option value="">— tanlang —</option>
              {allUsers.filter(u => u.id !== currentUser.id).map(u => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]})</option>)}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm border border-border rounded-xl px-3 py-2.5 hover:bg-muted liquid-transition font-medium">Bekor</button>
            <button type="submit" className="flex-1 text-sm text-white rounded-xl px-3 py-2.5 font-bold liquid-transition shadow-sm"
              style={{ background: "linear-gradient(135deg, #D9460F 0%, #c03d0d 100%)" }}>
              Qo'shish
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
    pending: <span className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><Clock className="w-2.5 h-2.5"/>Kutilmoqda</span>,
    confirmed: <span className="text-[9px] bg-green-500/15 text-green-600 dark:text-green-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><CheckCircle className="w-2.5 h-2.5"/>Tasdiqlandi</span>,
    rejected: <span className="text-[9px] bg-red-500/15 text-red-600 dark:text-red-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><X className="w-2.5 h-2.5"/>Rad etildi</span>,
  }[t.status];

  return (
    <div className={`border rounded-xl p-3 text-sm md:text-xs space-y-2 shadow-sm liquid-transition ${t.status === "confirmed" ? "border-green-500/25 bg-green-500/8" : t.status === "rejected" ? "border-red-500/25 bg-red-500/8" : "border-amber-500/25 bg-amber-500/8"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">{t.materialName}</p>
          <p className="text-muted-foreground font-mono text-sm md:text-xs">{t.quantity.toLocaleString()} {t.unit}</p>
          <p className="text-sm md:text-xs text-muted-foreground mt-0.5">
            {isSender ? <><span className="text-foreground font-medium">Siz</span> → {to?.name}</> : <>{from?.name} → <span className="text-foreground font-medium">Siz</span></>}
          </p>
          <p className="text-sm md:text-xs text-muted-foreground">{proj?.name} • {t.date || t.sentDate}</p>
          {t.defect && <p className="text-sm md:text-xs text-amber-700 flex items-center gap-1 mt-0.5"><AlertTriangle className="w-2.5 h-2.5"/>{t.defect}</p>}
          {t.status === "confirmed" && isSender && t.confirmedDate && (
            <p className="text-sm md:text-xs text-green-600 font-medium mt-0.5">✓ {to?.name} tasdiqladi ({t.confirmedDate})</p>
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
              className="flex items-center justify-center gap-1 text-sm md:text-xs bg-red-500/15 text-red-600 dark:text-red-300 rounded px-2.5 py-1.5 hover:bg-red-500/100/25 font-semibold">
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border flex-shrink-0">
        <h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">Materiallar</h2>
        <button onClick={onSend} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2 py-1 rounded hover:bg-primary/90 font-semibold">
          <Send className="w-2.5 h-2.5"/>Yuborish
        </button>
      </div>
      <div className="flex border-b border-border bg-card flex-shrink-0">
        <button onClick={() => setTab("inbox")} className={`flex-1 flex items-center justify-center gap-1.5 text-sm md:text-xs py-2 border-b-2 font-medium transition-all ${tab==="inbox"?"border-primary text-primary":"border-transparent text-muted-foreground"}`}>
          Kirgan
          {pendingCount > 0 && <span className="text-[9px] bg-accent text-white px-1.5 py-0.5 rounded-full font-bold">{pendingCount}</span>}
        </button>
        <button onClick={() => setTab("sent")} className={`flex-1 flex items-center justify-center gap-1.5 text-sm md:text-xs py-2 border-b-2 font-medium transition-all ${tab==="sent"?"border-primary text-primary":"border-transparent text-muted-foreground"}`}>
          Yuborilgan
          <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-semibold">{sent.length}</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide">
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
  const [form, setForm] = useState({ name: user.name, role: user.role, phone: user.phone, brigade: user.brigade || "" });
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg border border-border shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Edit className="w-4 h-4 text-primary"/>Xodimni tahrirlash</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="w-4 h-4 text-muted-foreground"/></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onUpdate({...user, ...form}); onClose(); }} className="p-4 space-y-3">
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">To'liq ism *</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              placeholder="Masalan: Aliyev Vali" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required autoFocus
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Telefon *</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
              placeholder="+998901234567" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} required
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">Lavozim</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {(Object.keys(ROLE_LABELS) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {["ishchi", "brigadir"].includes(form.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">Brigada nomi (masalan: G'isht teruvchilar)</label>
              <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.brigade} onChange={e => setForm({...form, brigade: e.target.value})}/>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted transition-colors">Bekor</button>
            <button type="submit" className="flex-1 text-sm md:text-xs bg-primary text-white rounded px-3 py-2 hover:bg-primary/90 font-semibold">Saqlash</button>
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
    { key: "rahbariyat", label: "Rahbariyat", icon: Building2 },
    { key: "boshxodimlar", label: "Bosh Xodimlar", icon: Users },
    { key: "brigadalar", label: "Brigadalar", icon: HardHat },
    { key: "faolobyektlar", label: "Faol Obyektlar", icon: Package },
  ];

  const toggle = (key: string) => setActiveTab(prev => prev === key ? "" : key);

  return (
    <>
    {/* Desktop: 4-column grid */}
    <div className="h-full hidden md:grid md:grid-cols-2 xl:grid-cols-4 md:divide-x divide-border overflow-hidden bg-background">
      {/* Col 1 */}
      <div className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-card border-b border-border flex-shrink-0">
          <div className="w-6 h-6 bg-primary/10 rounded flex items-center justify-center"><Building2 className="w-3.5 h-3.5 text-primary"/></div>
          <h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">Rahbariyat</h2>
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
              <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Xodimlar</p>
              <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-[9px] bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold"><UserPlus className="w-2.5 h-2.5"/>Qo'shish</button>
            </div>
            {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
              <div key={r} className="flex items-center justify-between py-1">
                <span className="text-sm md:text-xs text-muted-foreground">{ROLE_LABELS[r]}</span>
                <span className="text-sm md:text-xs font-mono font-semibold">{users.filter(u=>u.role===r).length}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Col 2 */}
      <div className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="w-6 h-6 bg-primary/10 rounded flex items-center justify-center"><Users className="w-3.5 h-3.5 text-primary"/></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">Bosh Xodimlar</h2></div>
          <button onClick={() => setShowAddUser(true)} className="text-sm md:text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold flex items-center gap-1"><UserPlus className="w-2.5 h-2.5"/>Qo'shish</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-border/50">
          {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
            <div key={u.id} className="flex items-center gap-2.5 py-2 px-3 hover:bg-muted/40 transition-colors group">
              <Avatar user={u} size="sm"/>
              <div className="flex-1 min-w-0"><p className="text-sm md:text-xs font-semibold truncate">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p>{u.brigade&&<p className="text-[9px] text-muted-foreground">{u.brigade}</p>}</div>
              <RoleBadge role={u.role}/>
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setEditUser(u)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><Edit className="w-3 h-3"/></button>
                <button onClick={() => { if(confirm("O'chirishni tasdiqlaysizmi?")) onDeleteUser(u.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><Trash className="w-3 h-3"/></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Col 3 */}
      <div className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="w-6 h-6 bg-primary/10 rounded flex items-center justify-center"><HardHat className="w-3.5 h-3.5 text-primary"/></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">Brigadalar</h2></div>
          <button onClick={() => setShowSend(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2 py-1 rounded hover:bg-primary/90 font-semibold"><Send className="w-2.5 h-2.5"/>Yuborish</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          {brigades.map(brigade => (
            <div key={brigade} className="mb-3">
              <div className="flex items-center justify-between px-3 py-1.5 bg-secondary rounded-md mb-1">
                <span className="text-[11px] font-semibold text-secondary-foreground">{brigade}</span>
                <span className="text-sm md:text-xs text-muted-foreground">{users.filter(u=>u.brigade===brigade).length} kishi</span>
              </div>
              {users.filter(u => u.brigade===brigade).map(m => (
                <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group">
                  <Avatar user={m} size="sm"/>
                  <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                  <RoleBadge role={m.role}/>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><Edit className="w-3 h-3"/></button>
                    <button onClick={() => { if(confirm("O'chirishni tasdiqlaysizmi?")) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><Trash className="w-3 h-3"/></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-sm md:text-xs font-semibold text-amber-600 uppercase mb-2 flex items-center gap-1"><Package className="w-2.5 h-2.5"/>Sizga kelgan</p>
              {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").map(t => (
                <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={projects} onConfirm={onConfirmTransfer} onReject={onRejectTransfer}/>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">Barcha Ishchilar</p>
            {users.filter(u => u.role==="ishchi").map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group mb-1">
                <Avatar user={m} size="sm"/>
                <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                <RoleBadge role={m.role}/>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><Edit className="w-3 h-3"/></button>
                  <button onClick={() => { if(confirm("O'chirishni tasdiqlaysizmi?")) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><Trash className="w-3 h-3"/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Col 4 */}
      <div className="flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="w-6 h-6 bg-accent/15 rounded flex items-center justify-center"><Package className="w-3.5 h-3.5 text-accent"/></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">Faol Obyektlar</h2></div>
          <button onClick={()=>setShowAddObject(true)} className="text-sm md:text-xs bg-accent/10 text-accent px-2 py-1 rounded hover:bg-accent/20 font-semibold flex items-center gap-1"><Plus className="w-2.5 h-2.5"/>Qo'shish</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {[["active","Faol","text-green-600"],["paused","To'x.","text-amber-500"],["completed","Tugagan","text-blue-500"]].map(([s,l,c])=>(
              <div key={s} className="bg-card border border-border rounded p-2 text-center">
                <p className={`text-sm font-bold font-mono ${c}`}>{projects.filter(p=>p.status===s).length}</p>
                <p className="text-[9px] text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          {projects.map(p => {
            const pend = transfers.filter(t=>t.projectId===p.id&&t.status==="pending").length;
            const foreman = users.find(u=>u.id===p.foremanId);
            return (
              <div key={p.id} onClick={()=>onSelectProject(p)} className="border border-border rounded-md p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all bg-card group mb-2">
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
                  {pend>0&&<span className="ml-auto text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-300 px-1.5 py-0.5 rounded font-semibold">{pend} kutilmoqda</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
                        <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Xodimlar soni</p>
                        <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full hover:bg-primary/20 font-semibold"><UserPlus className="w-3 h-3"/>Qo'shish</button>
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
                      <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><UserPlus className="w-3 h-3"/>Qo'shish</button>
                    </div>
                    {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
                      <div key={u.id} className="flex items-center gap-3 py-3 px-4 border-b border-border/40 hover:bg-muted/30">
                        <Avatar user={u} size="sm"/>
                        <div className="flex-1"><p className="text-sm font-semibold">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p></div>
                        <RoleBadge role={u.role}/>
                        <div className="flex gap-1">
                          <button onClick={() => setEditUser(u)} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><Edit className="w-4 h-4"/></button>
                          <button onClick={() => { if(confirm("O'chirishni tasdiqlaysizmi?")) onDeleteUser(u.id); }} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><Trash className="w-4 h-4"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {section.key === "brigadalar" && (
                  <div className="p-4 space-y-3">
                    <div className="flex justify-end">
                      <button onClick={() => setShowSend(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><Send className="w-3 h-3"/>Yuborish</button>
                    </div>
                    {brigades.map(brigade => (
                      <div key={brigade} className="bg-muted/30 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-secondary">
                          <span className="text-sm md:text-xs font-semibold">{brigade}</span>
                          <span className="text-sm md:text-xs text-muted-foreground">{users.filter(u=>u.brigade===brigade).length} kishi</span>
                        </div>
                        {users.filter(u => u.brigade===brigade).map(m => (
                          <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 border-t border-border/30">
                            <Avatar user={m} size="sm"/>
                            <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                            <RoleBadge role={m.role}/>
                            <div className="flex gap-1">
                              <button onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><Edit className="w-3.5 h-3.5"/></button>
                              <button onClick={() => { if(confirm("O'chirishni tasdiqlaysizmi?")) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><Trash className="w-3.5 h-3.5"/></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-border">
                      <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">Barcha Ishchilar</p>
                      {users.filter(u => u.role==="ishchi").map(m => (
                        <div key={m.id} className="flex items-center gap-3 py-2.5 px-2 border-b border-border/30">
                          <Avatar user={m} size="sm"/>
                          <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                          <RoleBadge role={m.role}/>
                          <div className="flex gap-1">
                            <button onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><Edit className="w-3.5 h-3.5"/></button>
                            <button onClick={() => { if(confirm("O'chirishni tasdiqlaysizmi?")) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><Trash className="w-3.5 h-3.5"/></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-sm md:text-xs font-semibold text-amber-600 uppercase mb-2 flex items-center gap-1"><Package className="w-3 h-3"/>Sizga kelgan materiallar</p>
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
                      <button onClick={()=>setShowAddObject(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-accent text-white px-3 py-1.5 rounded-full font-semibold"><Plus className="w-3 h-3"/>Qo'shish</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[["active","Faol","text-green-600 dark:text-green-400","bg-green-500/10"],["paused","To'xtatilgan","text-amber-500","bg-amber-500/10"],["completed","Tugagan","text-blue-500 dark:text-blue-400","bg-blue-500/10"]].map(([s,l,c,bg])=>(
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
                        <div key={p.id} onClick={()=>onSelectProject(p)} className="border border-border rounded-xl p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all bg-card mb-3 active:scale-98">
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
                            {pend>0&&<span className="ml-auto text-sm md:text-xs bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">{pend} kutilmoqda</span>}
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
        <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg ${smeta.validation.ok ? "bg-green-500/15 text-green-600 dark:text-green-300" : "bg-amber-500/15 text-amber-600 dark:text-amber-300"}`}>
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
      <div className="glass-card border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0 z-10 sticky top-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm md:text-xs text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4"/>Orqaga</button>
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
                } catch(err) { alert("Xatolik"); }
              }}
            >
              <option value="active" className="text-green-600">Faol</option>
              <option value="paused" className="text-amber-500">To'xtatilgan</option>
              <option value="completed" className="text-blue-500">Tugagan</option>
            </select>
          </p>
          <p className="text-sm md:text-xs text-muted-foreground">{project.location}</p>
        </div>
        {project.pdfFile && <button className="flex items-center gap-1 text-sm md:text-xs bg-accent/10 text-accent px-2.5 py-1.5 rounded hover:bg-accent/20 font-medium flex-shrink-0"><Download className="w-3.5 h-3.5"/>PDF</button>}
        <div className="flex items-center gap-2 flex-shrink-0">
          <input type="file" id="smeta-upload" className="hidden" accept=".pdf" onChange={async e=>{
            const file = e.target.files?.[0];
            if(!file) return;
            setUploadingSmeta(true); setSmetaMsg('Tahlil qilinmoqda...'); setSmetaPercent(40);
            try {
              const result = await parseSmetaFile(file);
              onSmetaUploaded(project.id, result);
              const matN = result.resources.filter((r:any)=>r.group==='material').length;
              setSmetaMsg(`✓ ${result.resources.length} resurs, ${matN} material`);
              setSmetaPercent(100);
              setTab("smeta");
              setTimeout(() => { setUploadingSmeta(false); setSmetaMsg(''); setSmetaPercent(0); }, 2500);
            } catch (err) {
              setSmetaMsg(`✗ ${(err as Error).message || 'Smeta o\'qilmadi'}`);
              setSmetaPercent(0);
              setTimeout(() => { setUploadingSmeta(false); setSmetaMsg(''); }, 4000);
            }
            e.target.value='';
          }}/>
          <label htmlFor="smeta-upload" className={`flex flex-col items-center gap-0.5 text-sm md:text-xs px-2.5 py-1.5 rounded-lg font-medium cursor-pointer liquid-transition min-w-[120px] ${uploadingSmeta ? (smetaMsg.startsWith('✓') ? "bg-green-500/15 text-green-600 dark:text-green-400 cursor-not-allowed" : smetaMsg.startsWith('✗') ? "bg-destructive/15 text-destructive cursor-not-allowed" : "bg-accent/10 text-accent cursor-wait") : "bg-accent/10 text-accent hover:bg-accent/20"}`}>
            {uploadingSmeta ? (
              <>
                <div className="flex items-center gap-1 text-center">
                  {smetaMsg.startsWith('✓') ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0"/> : smetaMsg.startsWith('✗') ? <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/> : <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0"/>}
                  <span className="truncate max-w-[180px]">{smetaMsg.replace(/^[✓✗]\s*/, '') || 'Yuklanmoqda...'}</span>
                </div>
                {smetaPercent > 0 && !smetaMsg.startsWith('✗') && <div className="w-full bg-accent/20 rounded-full h-1 mt-0.5"><div className={`${smetaMsg.startsWith('✓') ? 'bg-green-500' : 'bg-accent'} h-1 rounded-full liquid-transition`} style={{width:`${smetaPercent}%`}}/></div>}
              </>
            ) : <><Download className="w-3.5 h-3.5"/>Smeta yuklash</>}
          </label>
          <button onClick={()=>{setInitialTransferData(undefined);setShowSend(true);}} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2.5 py-1.5 rounded hover:bg-primary/90 font-medium liquid-transition shadow-sm"><Send className="w-3.5 h-3.5"/>Yuborish</button>
        </div>
      </div>
      <div className="glass-card border-b border-border px-4 flex flex-shrink-0 z-10 sticky top-[53px]">
        {([["required","Talab",project.requiredMaterials.length], ...(project.smeta ? [["smeta","Smeta",project.smeta.resources.length] as [string,string,number]] : []), ["pending","Kutilmoqda",pendT.length],["confirmed","Tasdiqlangan",confT.length]] as [string,string,number][]).map(([k,l,c])=>(
          <button key={k} onClick={()=>setTab(k as any)} className={`flex items-center gap-1.5 text-sm md:text-xs py-2.5 px-3 border-b-2 font-medium liquid-transition ${tab===k?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"}`}>
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
                <input type="text" placeholder="Material qidirish..." value={matSearch} onChange={e=>setMatSearch(e.target.value)} className="w-full pl-7 pr-2 py-1 text-[11px] bg-input-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"/>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{filteredMats.length} ta · {fmt(project.budget)}</span>
            </div>
            {/* Zich jadval — barcha materiallar minimal joyda */}
            <div className="flex-1 overflow-y-auto scrollbar-hide pb-20 sm:pb-2">
              <table className="w-full text-left border-collapse text-[11px] leading-tight">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 font-semibold">Material nomi</th>
                    <th className="px-2 py-1 font-semibold whitespace-nowrap">O'lchov</th>
                    <th className="px-2 py-1 font-semibold text-right whitespace-nowrap">Miqdor</th>
                    <th className="px-2 py-1 font-semibold text-right whitespace-nowrap">Narx</th>
                    <th className="px-2 py-1 font-semibold text-right whitespace-nowrap">Summa</th>
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
                    <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{project.requiredMaterials.length === 0 ? "Smeta yuklanmagan — 'Smeta yuklash' tugmasini bosing" : "Topilmadi"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab==="pending" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {pendT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-400 opacity-50"/><p className="text-sm md:text-xs">Kutilayotgan yo'q</p></div>
            :pendT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
        {tab==="confirmed" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {confT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><Package className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm md:text-xs">Tasdiqlangan yo'q</p></div>
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
  const sent = confT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const pending = pendT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const totalSpent = sent * (mat.price || 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end sm:justify-center sm:items-center backdrop-blur-sm liquid-transition">
      <div className="bg-background/90 backdrop-blur-xl w-full sm:w-[450px] sm:rounded-2xl rounded-t-[2rem] overflow-hidden animate-slide-up-fade flex flex-col shadow-2xl border border-white/20">
        <div className="p-5 border-b border-border/50 flex justify-between items-center bg-card/50">
          <h3 className="font-semibold text-base truncate pr-4">{mat.name}</h3>
          <div className="flex items-center gap-2">
            {onSend && <button onClick={()=>{onClose(); onSend();}} className="flex items-center gap-1.5 bg-primary text-white text-sm md:text-xs px-3 py-1.5 rounded-full hover:bg-primary/90 font-medium liquid-transition shadow-md shadow-primary/20"><Send className="w-3 h-3"/>Yuborish</button>}
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:bg-muted/50 rounded-full liquid-transition bg-muted/20"><X className="w-4 h-4"/></button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-muted p-2.5 rounded-lg border border-border">
              <p className="text-sm md:text-xs text-muted-foreground mb-1">Reja bo'yicha (Smeta)</p>
              <p className="font-semibold text-sm">{mat.quantity.toLocaleString()} <span className="text-sm md:text-xs font-normal">{mat.unit}</span></p>
              {mat.price ? <p className="text-sm md:text-xs text-muted-foreground mt-1">Narxi: {fmt(mat.price)}/{mat.unit}</p> : <p className="text-sm md:text-xs text-muted-foreground mt-1">Narxi kiritilmagan</p>}
            </div>
            <div className="bg-green-500/10 p-2.5 rounded-lg border border-green-500/20">
              <p className="text-sm md:text-xs text-green-700 dark:text-green-400 mb-1">Yetkazib berildi</p>
              <p className="font-semibold text-sm text-green-700 dark:text-green-400">{sent.toLocaleString()} <span className="text-sm md:text-xs font-normal">{mat.unit}</span></p>
              {(mat.price ?? 0) > 0 && <p className="text-sm md:text-xs text-green-700/70 mt-1">Jami xarajat: {fmt(totalSpent)}</p>}
            </div>
          </div>
          
          <h4 className="text-sm md:text-xs font-semibold mb-2">Yukxatlar tarixi</h4>
          {confT.filter(t=>t.materialName===mat.name).length === 0 && pendT.filter(t=>t.materialName===mat.name).length === 0 ? (
             <p className="text-sm md:text-xs text-muted-foreground py-4 text-center">Bu material bo'yicha hech qanday yukxat yuborilmagan.</p>
          ) : (
            <div className="space-y-2">
              {pendT.filter(t=>t.materialName===mat.name).map(t => (
                <div key={t.id} className="border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded p-2 text-sm md:text-xs">
                  <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-500 mb-1"><span>{t.quantity.toLocaleString()} {t.unit} (Kutilmoqda)</span><span>{(t.date || t.sentDate || '').split('T')[0]}</span></div>
                  <p className="text-sm md:text-xs text-amber-700/70">Yuboruvchi: {t.fromUserName}</p>
                </div>
              ))}
              {confT.filter(t=>t.materialName===mat.name).map(t => (
                <div key={t.id} className="border border-border bg-card rounded p-2 text-sm md:text-xs">
                  <div className="flex justify-between font-semibold mb-1"><span>{t.quantity.toLocaleString()} {t.unit}</span><span className="text-muted-foreground text-sm md:text-xs">{t.confirmedDate?.split('T')[0] || (t.date || t.sentDate || '').split('T')[0]}</span></div>
                  <p className="text-sm md:text-xs text-muted-foreground">Yuboruvchi: {t.fromUserName}</p>
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
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"all"|ExpType>("all");
  const [projFilter, setProjFilter] = useState("all");

  const filteredExpenses = expenses.filter(e => (filter==="all"||e.type===filter) && (projFilter==="all"||e.projectId===projFilter));

  const totalExpense = expenses.filter(e=>e.status==="confirmed").reduce((a,e)=>a+e.amount,0);
  const pendingMe = expenses.filter(e=>e.toUserId===currentUser.id&&e.status==="pending").length;
  const typeClr: Record<string,string> = {
    oylik:"bg-blue-500/15 text-blue-600 dark:text-blue-300",
    material:"bg-orange-500/15 text-orange-600 dark:text-orange-300",
    jihozlar:"bg-purple-500/15 text-purple-600 dark:text-purple-300",
    transport:"bg-teal-500/15 text-teal-600 dark:text-teal-300",
    boshqa:"bg-muted text-muted-foreground"
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-bold font-['Roboto_Slab',serif]">Moliya — Chiqimlar</h2>
          <p className="text-sm md:text-xs text-muted-foreground">Jami tasdiqlangan: <span className="font-semibold text-accent">{fmt(totalExpense)}</span></p>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingMe>0&&<span className="text-sm md:text-xs bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2 py-1 rounded font-semibold flex items-center gap-1"><Clock className="w-3 h-3"/>{pendingMe} tasdiqlash</span>}
          <button onClick={()=>setShowAdd(true)} className="flex items-center gap-1 text-sm md:text-xs bg-accent text-white px-3 py-1.5 rounded hover:bg-accent/90 font-semibold"><Plus className="w-3 h-3"/>Chiqim</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-border px-4 py-2 flex gap-2 flex-wrap flex-shrink-0">
        <select className="text-sm md:text-xs border border-border rounded px-2 py-1 bg-input-background focus:outline-none" value={projFilter} onChange={e=>setProjFilter(e.target.value)}>
          <option value="all">Barcha obyektlar</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap">
          <button onClick={()=>setFilter("all")} className={`text-sm md:text-xs px-2 py-1 rounded font-medium transition-colors ${filter==="all"?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>Barchasi</button>
          {(Object.keys(EXP_LABELS) as ExpType[]).map(k=><button key={k} onClick={()=>setFilter(k)} className={`text-sm md:text-xs px-2 py-1 rounded font-medium transition-colors ${filter===k?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{EXP_LABELS[k]}</button>)}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 scrollbar-hide">
        {filteredExpenses.length===0
          ? <div className="text-center py-10 text-muted-foreground"><Wallet className="w-10 h-10 mx-auto mb-2 opacity-30"/><p className="text-sm md:text-xs">Chiqimlar topilmadi</p></div>
          : filteredExpenses.map(e=>{
              const to=users.find(u=>u.id===e.toUserId);
              const proj=projects.find(p=>p.id===e.projectId);
              const creator=users.find(u=>u.id===e.createdById);
              const canConfirm=e.toUserId===currentUser.id&&e.status==="pending";
              return (
                <div key={e.id} className={`border rounded-md p-3 text-sm md:text-xs ${e.status==="confirmed"?"border-green-500/25 bg-green-500/8":"border-amber-500/25 bg-amber-500/8"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${typeClr[e.type] || "bg-muted text-muted-foreground"}`}>{EXP_LABELS[e.type as ExpType] || e.type}</span>
                      </div>
                      <p className="font-semibold text-foreground">{e.description}</p>
                      <p className="text-sm md:text-xs text-muted-foreground mt-0.5">{proj?.name || "—"} • {e.date}</p>
                      {to&&<p className="text-sm md:text-xs text-muted-foreground">Kimga: <span className="font-medium">{to.name}</span></p>}
                      {creator&&<p className="text-sm md:text-xs text-muted-foreground">Yaratdi: {creator.name}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-accent">{fmt(e.amount)}</p>
                      {e.status==="confirmed"
                        ?<p className="text-[9px] text-green-600 font-semibold mt-1 flex items-center gap-0.5 justify-end"><CheckCircle className="w-2.5 h-2.5"/>Tasdiqlandi</p>
                        :<p className="text-[9px] text-amber-600 font-semibold mt-1 flex items-center gap-0.5 justify-end"><Clock className="w-2.5 h-2.5"/>Kutilmoqda</p>}
                    </div>
                  </div>
                  {canConfirm&&<button onClick={()=>onConfirm(e.id)} className="mt-2 w-full text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><Check className="w-3 h-3"/>Qabul qilganman — Tasdiqlash</button>}
                </div>
              );
            })
        }
      </div>

      {showAdd&&<AddExpenseModal currentUser={currentUser} projects={projects} allUsers={users} onClose={()=>setShowAdd(false)} onAdd={onAddExpense}/>}
    </div>
  );
}

// ─── Reports Page ──────────────────────────────────────────────────────────────
function ReportsPage({ projects, expenses, users }:
  { projects: Project[]; expenses: Expense[]; users: AppUser[] }) {
  const [selProj, setSelProj] = useState("all");
  const filtExp = (selProj==="all"?expenses:expenses.filter(e=>e.projectId===selProj)).filter(e=>e.status==="confirmed");
  const total = filtExp.reduce((a,e)=>a+e.amount,0);
  const byType = (Object.keys(EXP_LABELS) as ExpType[]).map(k=>({name:EXP_LABELS[k],value:filtExp.filter(e=>e.type===k).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.value>0);
  const byProject = projects.map(p=>({name:p.name.split(" ").slice(0,2).join(" "),chiqim:expenses.filter(e=>e.projectId===p.id&&e.status==="confirmed").reduce((a,e)=>a+e.amount,0)}));
  const byPerson = users.filter(u=>!isAdmin(u.role)).map(u=>{const parts=u.name.split(" ");const shortName=parts[0]+(parts[1]?" "+parts[1][0]+".":"");return{name:shortName,total:expenses.filter(e=>e.toUserId===u.id&&e.status==="confirmed").reduce((a,e)=>a+e.amount,0)};}).filter(d=>d.total>0);
  return (
    <div className="flex flex-col h-full">
      <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-bold font-['Roboto_Slab',serif]">Hisobotlar</h2>
        <select className="text-sm md:text-xs border border-border rounded px-2 py-1 bg-input-background focus:outline-none" value={selProj} onChange={e=>setSelProj(e.target.value)}>
          <option value="all">Barcha obyektlar</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollbar-hide space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["Jami chiqim",total,"text-accent"],[EXP_LABELS.material,filtExp.filter(e=>e.type==="material").reduce((a,e)=>a+e.amount,0),"text-orange-600"],[EXP_LABELS.oylik,filtExp.filter(e=>e.type==="oylik").reduce((a,e)=>a+e.amount,0),"text-blue-600"],["Boshqa",filtExp.filter(e=>!["material","oylik"].includes(e.type)).reduce((a,e)=>a+e.amount,0),"text-purple-600"]].map(([l,v,c])=>(
            <div key={String(l)} className="bg-card border border-border rounded-lg p-3"><p className="text-sm md:text-xs text-muted-foreground">{String(l)}</p><p className={`text-sm font-bold font-mono mt-1 ${c}`}>{fmt(v as number)}</p></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">Chiqim turlari</p>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart><Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                {byType.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
              </Pie><Tooltip formatter={(v:number)=>fmt(v)}/></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">Obyektlar bo'yicha</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byProject}><XAxis dataKey="name" tick={{fontSize:9}} tickLine={false} axisLine={false}/><YAxis hide/><Tooltip formatter={(v:number)=>fmt(v)}/><Bar dataKey="chiqim" fill="#D9460F" radius={[3,3,0,0]} name="Chiqim"/></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        {byPerson.length>0&&(
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">Xodimlar bo'yicha to'lovlar</p>
            <ResponsiveContainer width="100%" height={byPerson.length*40+20}>
              <BarChart data={byPerson} layout="vertical" margin={{right:80,left:10}}>
                <XAxis type="number" hide/><YAxis type="category" dataKey="name" tick={{fontSize:10}} tickLine={false} axisLine={false} width={90}/>
                <Tooltip formatter={(v:number)=>fmt(v)}/>
                <Bar dataKey="total" fill="#1B3A6B" radius={[0,3,3,0]} name="To'lov" label={{position:"right",fontSize:9,formatter:(v:number)=>v>0?fmt(v):""}}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><p className="text-sm md:text-xs font-semibold font-['Roboto_Slab',serif]">Batafsil jadval</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:text-xs">
              <thead><tr className="border-b border-border bg-muted/40">{["Sana","Tavsif","Tur","Kimga","Obyekt","Summa"].map(h=><th key={h} className="text-left px-3 py-2 text-sm md:text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {filtExp.slice().reverse().map(e=>{
                  const to=users.find(u=>u.id===e.toUserId);
                  const proj=projects.find(p=>p.id===e.projectId);
                  return (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{e.date}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate">{e.description}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="text-[9px] bg-muted px-1.5 py-0.5 rounded">{EXP_LABELS[e.type]}</span></td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{to?.name??"-"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{proj?.name??"-"}</td>
                      <td className="px-3 py-2 font-mono font-semibold text-accent whitespace-nowrap">{fmt(e.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Voice Message Player ─────────────────────────────────────────────────────
function VoicePlayer({ src }: { src: string }) {
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

  return (
    <div className="flex items-center gap-2 mb-1 min-w-[180px] max-w-[220px]">
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        onTimeUpdate={e => { const a = e.target as HTMLAudioElement; setCurrentTime(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0); }}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime=0; }}
      />
      <button onClick={toggle}
        className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 hover:bg-primary/30 active:scale-95 transition-all">
        {playing
          ? <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="relative h-1.5 bg-white/20 rounded-full overflow-hidden cursor-pointer"
          onClick={e => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            if (audioRef.current && audioRef.current.duration) {
              audioRef.current.currentTime = pct * audioRef.current.duration;
            }
          }}>
          <div className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all" style={{ width: `${progress}%` }}/>
        </div>
        <div className="flex justify-between text-[9px] text-current/60">
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

  const thread = selGroup
    ? messages.filter(m => !m.deleted && m.groupId === selGroup.id)
    : selUser
      ? messages.filter(m =>
          !m.deleted && !m.groupId &&
          ((m.fromUserId===currentUser.id && m.toUserId===selUser.id) ||
           (m.fromUserId===selUser.id && m.toUserId===currentUser.id)))
      : [];
  const pinned = thread.filter(m => m.pinned).slice(-1)[0] ?? null;
  const unread = (uid: string) => messages.filter(m => !m.groupId && m.fromUserId===uid && m.toUserId===currentUser.id && !m.read).length;

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
    } catch { alert("Mikrofon ruxsati kerak"); }
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
    if (!navigator.geolocation) { alert("Brauzer geolokatsiyani qo'llab-quvvatlamaydi"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => doSend({ type: 'location', text: '📍 Lokatsiya', location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => alert("Lokatsiya ruxsati berilmadi")
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
          <img src={m.mediaUrl} alt="Rasm" className="rounded-xl max-w-full max-h-52 object-cover mb-1 cursor-pointer" onClick={()=>window.open(m.mediaUrl,'_blank')}/>
        )}
        {m.type==='video' && m.mediaUrl && (
          <video src={m.mediaUrl} controls className="rounded-xl max-w-full max-h-52 mb-1"/>
        )}
        {m.type==='audio' && m.mediaUrl && (
          <VoicePlayer src={m.mediaUrl}/>
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
            const th = messages.filter(m => !m.deleted && m.groupId===g.id);
            const last = th.slice(-1)[0];
            const lastText = last ? `${userById(last.fromUserId)?.name?.split(' ')[0] || ''}: ${last.type&&last.type!=='text'?(last.type==='audio'?'🎤 Ovoz':last.type==='image'?'🖼️ Rasm':last.type==='video'?'🎥 Video':last.type==='location'?'📍 Joylashuv':`📎 ${last.fileName??'Fayl'}`):last.text}` : `${g.memberIds.length} a'zo`;
            return (
              <button key={g.id} onClick={() => { setSelGroup(g); setSelUser(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/30 ${selGroup?.id===g.id?'bg-secondary/60':''}`}>
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
            const th = messages.filter(m => !m.deleted && m.groupId===g.id);
            const last = th.slice(-1)[0];
            const lastText = last ? `${last.type&&last.type!=='text'?(last.type==='audio'?'🎤 Ovoz':last.type==='image'?'🖼️ Rasm':last.type==='video'?'🎥 Video':last.type==='location'?'📍 Joylashuv':`📎 ${last.fileName??'Fayl'}`):last.text}` : 'Texnik yordam';
            return (
              <button key={g.id} onClick={() => { setSelGroup(g); setSelUser(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/30 ${selGroup?.id===g.id?'bg-secondary/60':''}`}>
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
              className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/30">
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
            const th = messages.filter(m => !m.deleted && !m.groupId && ((m.fromUserId===u.id&&m.toUserId===currentUser.id)||(m.fromUserId===currentUser.id&&m.toUserId===u.id)));
            const last = th.slice(-1)[0];
            const ur = unread(u.id);
            const lastText = last ? (last.type==='audio'?'🎤 Ovoz':last.type==='image'?'🖼️ Rasm':last.type==='video'?'🎥 Video':last.type==='location'?'📍 Joylashuv':last.type==='file'?`📎 ${last.fileName??'Fayl'}`:last.text) : '...';
            return (
              <button key={u.id} onClick={() => { setSelUser(u); setSelGroup(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left border-b border-border/30 ${selUser?.id===u.id?'bg-secondary/60':''}`}>
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
              <button onClick={closeChat} className="md:hidden p-2 -ml-2 mr-1 text-muted-foreground hover:bg-muted rounded-full transition-colors">
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
                  : <p className="text-[11px] text-muted-foreground">{isOnline(selUser!.id) ? <span className="text-green-600">onlayn</span> : ROLE_LABELS[selUser!.role]}</p>}
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
                    <button onClick={() => { const msg=messages.find(m=>m.id===[...selected][0]); if(msg) setShowForward(msg); }} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><Share2 className="w-4 h-4"/></button>
                    <button onClick={() => { selected.forEach(id=>onDelete(id)); setSelectMode(false); setSelected(new Set()); }} className="p-2 hover:bg-red-500/100/10 rounded-full text-red-500"><Trash2 className="w-4 h-4"/></button>
                  </>}
                  <button onClick={() => { setSelectMode(false); setSelected(new Set()); }} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><X className="w-4 h-4"/></button>
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
                <button onClick={()=>onPin(pinned.id)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-3.5 h-3.5"/></button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-hide relative" onClick={()=>{setCtxMenu(null);setShowAttach(false);}}>
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
                        {mine && <Check className="w-3 h-3"/>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef}/>

              {/* Context Menu */}
              {ctxMenu && (
                <div className="fixed z-50 glass-card p-1.5 rounded-xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-pop-in"
                  style={{top:Math.min(ctxMenu.y,window.innerHeight-260),left:ctxMenu.x>window.innerWidth-164?window.innerWidth-168:Math.max(4,ctxMenu.x)}}
                  onClick={e=>e.stopPropagation()}>
                  <div onClick={()=>{if(ctxMsg)setReplyTo(ctxMsg);setCtxMenu(null);}} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 rounded-lg cursor-pointer text-xs"><CornerDownLeft className="w-3.5 h-3.5 text-blue-500"/>Reply</div>
                  {canModifyMessages && !ctxMsg?.deleted && (
                    <div onClick={()=>{if(ctxMsg){setEditingId(ctxMsg.id);setEditText(ctxMsg.text);}setCtxMenu(null);}} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 rounded-lg cursor-pointer text-xs"><Edit className="w-3.5 h-3.5 text-green-500"/>Edit</div>
                  )}
                  <div onClick={()=>{if(ctxMsg)onPin(ctxMsg.id);setCtxMenu(null);}} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 rounded-lg cursor-pointer text-xs">
                    <span className="text-xs">{ctxMsg?.pinned?'📌':'📍'}</span>{ctxMsg?.pinned?'Unpin':'Pin'}
                  </div>
                  <div onClick={()=>{if(ctxMsg)setShowForward(ctxMsg);setCtxMenu(null);}} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 rounded-lg cursor-pointer text-xs"><Share2 className="w-3.5 h-3.5 text-purple-500"/>Forward</div>
                  <div onClick={()=>{if(ctxMsg){setSelectMode(true);setSelected(new Set([ctxMsg.id]));}setCtxMenu(null);}} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 rounded-lg cursor-pointer text-xs"><SquareCheck className="w-3.5 h-3.5 text-orange-500"/>Select</div>
                  {canModifyMessages && (
                    <>
                      <div className="h-px bg-border/60 my-0.5"/>
                      <div onClick={()=>{if(ctxMsg)onDelete(ctxMsg.id);setCtxMenu(null);}} className="flex items-center gap-2 px-3 py-2 hover:bg-red-500/10 text-red-500 rounded-lg cursor-pointer text-xs"><Trash2 className="w-3.5 h-3.5"/>Delete</div>
                    </>
                  )}
                </div>
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
                <button onClick={()=>setReplyTo(null)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-4 h-4"/></button>
              </div>
            )}

            {/* Edit preview */}
            {editingId && (
              <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 border-t border-amber-500/25 flex-shrink-0">
                <Edit className="w-4 h-4 text-amber-600 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-amber-600">Tahrirlash</p>
                  <p className="text-xs text-muted-foreground truncate">{messages.find(m=>m.id===editingId)?.text}</p>
                </div>
                <button onClick={()=>{setEditingId(null);setEditText("");}} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-4 h-4"/></button>
              </div>
            )}

            {/* Input */}
            {!selectMode && (
              <div className="glass border-t border-white/10 px-3 py-2.5 flex gap-2 flex-shrink-0 items-end relative" onClick={e=>e.stopPropagation()}>
                {showAttach && (
                  <div className="absolute bottom-[4.5rem] left-3 glass-card p-2 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-slide-up-fade z-50 min-w-[190px]" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>fileImgRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><ImageIcon className="w-4 h-4 text-blue-500"/>Rasm / Video</button>
                    <button onClick={()=>camRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><Camera className="w-4 h-4 text-rose-500"/>Kamera</button>
                    <button onClick={()=>fileAllRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><FileText className="w-4 h-4 text-orange-500"/>Fayl</button>
                    <button onClick={sendLocation} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><MapPin className="w-4 h-4 text-green-500"/>Lokatsiya</button>
                  </div>
                )}
                {!isRecording && (
                  <button onClick={()=>setShowAttach(!showAttach)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:bg-muted/50 rounded-full transition-colors mb-0.5">
                    <Paperclip className="w-5 h-5"/>
                  </button>
                )}
                {isRecording ? (
                  <div className="flex-1 flex items-center gap-3 bg-red-500/10 border border-red-500/25 rounded-full px-4 py-2.5">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>
                    <span className="text-sm font-mono text-red-600">{fmtTime(recSec)}</span>
                    <span className="text-xs text-red-400 flex-1">Yozilmoqda...</span>
                  </div>
                ) : (
                  <textarea rows={1}
                    className="flex-1 resize-none text-sm border border-border/50 rounded-2xl px-4 py-2.5 bg-input-background focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-inner liquid-transition max-h-28 overflow-y-auto leading-relaxed"
                    placeholder="Xabar yozing..."
                    value={editingId ? editText : text}
                    onChange={e=>{if(editingId)setEditText(e.target.value);else setText(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,112)+'px';}}
                    onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editingId)saveEdit();else doSend();}}}
                  />
                )}
                <div className="flex items-center gap-1 mb-0.5 flex-shrink-0">
                  {isRecording ? (
                    <>
                      <button onClick={cancelRec} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-muted/50 rounded-full transition-colors"><X className="w-4 h-4"/></button>
                      <button onClick={stopRec} className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-full flex items-center justify-center active:scale-95 liquid-transition shadow-md shadow-red-500/30"><Send className="w-4 h-4 ml-0.5"/></button>
                    </>
                  ) : (editingId ? editText : text).trim() ? (
                    <button onClick={()=>{if(editingId)saveEdit();else doSend();}} className="w-10 h-10 bg-gradient-to-br from-primary to-primary/80 text-white rounded-full flex items-center justify-center active:scale-95 liquid-transition shadow-md shadow-primary/30"><Send className="w-4 h-4 ml-0.5"/></button>
                  ) : (
                    <button onClick={startRec} className="w-10 h-10 flex items-center justify-center text-muted-foreground hover:bg-muted/50 rounded-full transition-colors"><Mic className="w-5 h-5"/></button>
                  )}
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
              <button onClick={()=>setShowForward(null)} className="p-1.5 hover:bg-muted rounded-full"><X className="w-4 h-4"/></button>
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
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const toggle = (id: string) => setSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const filtered = contacts.filter(u => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={onClose}>
      <div className="glass-modal rounded-t-3xl sm:rounded-2xl w-full max-w-sm p-5 mb-[104px] sm:mb-0 animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-2"><Users2 className="w-4 h-4 text-primary"/>Yangi guruh</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><X className="w-4 h-4"/></button>
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

// ─── Qo'ng'iroq (WebRTC — 1:1 va guruh) ──────────────────────────────────────────
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

function CallOverlay({ currentUser, users, call, onClose }:
  { currentUser: AppUser; users: AppUser[]; call: ActiveCall; onClose: () => void }) {
  const socket = getSocket();
  const localRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  // streamReady — accept() bu promise'ni kutib stream tayyor bo'lganini bildiradi
  const streamReadyResolve = useRef<((s: MediaStream) => void) | null>(null);
  const streamReady = useRef<Promise<MediaStream>>(new Promise(res => { streamReadyResolve.current = res; }));
  const pcs = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [status, setStatus] = useState<'incoming'|'ringing'|'connected'>(call.direction === 'in' ? 'incoming' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(call.mode === 'voice');

  const userById = (id: string) => users.find(u => u.id === id);
  const title = call.groupId ? "Guruh qo'ng'irog'i" : (userById(call.peerId || '')?.name || call.fromName || "Qo'ng'iroq");

  const makePC = (peerId: string) => {
    if (pcs.current[peerId]) return pcs.current[peerId];
    const pc = new RTCPeerConnection(ICE_CONFIG);
    localStream.current?.getTracks().forEach(t => pc.addTrack(t, localStream.current!));
    pc.onicecandidate = e => { if (e.candidate) socket?.emit('call:ice', { to: peerId, from: currentUser.id, candidate: e.candidate }); };
    pc.ontrack = e => { setRemote(prev => ({ ...prev, [peerId]: e.streams[0] })); setStatus('connected'); };
    pcs.current[peerId] = pc;
    return pc;
  };

  const offerTo = async (peerId: string) => {
    const pc = makePC(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket?.emit('call:offer', { to: peerId, from: currentUser.id, fromName: currentUser.name, mode: call.mode, groupId: call.groupId, sdp: offer });
  };

  const flushIce = async (peerId: string) => {
    const pc = pcs.current[peerId]; const list = pendingIce.current[peerId];
    if (pc && list) { for (const c of list) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} } pendingIce.current[peerId] = []; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.mode === 'video' });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        localStream.current = stream;
        if (localRef.current) { localRef.current.srcObject = stream; localRef.current.play().catch(()=>{}); }
        // Re-add tracks to any peer connections created before stream was ready (race condition fix)
        Object.values(pcs.current).forEach(pc => {
          stream.getTracks().forEach(t => { try { pc.addTrack(t, stream); } catch {} });
        });
        // accept() shu promise'ni kutib turib stream tayyor bo'lgandan keyin createAnswer qiladi
        streamReadyResolve.current?.(stream);
      } catch (e: any) { toast("Kamera/mikrofon ruxsati kerak: " + (e?.message || '')); onClose(); return; }
      if (call.direction === 'out') {
        const targets = call.groupId ? (call.memberIds || []) : (call.peerId ? [call.peerId] : []);
        targets.forEach(t => offerTo(t));
      }
    })();

    const onAnswer = async (d: any) => { const pc = pcs.current[d.from]; if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(d.sdp)); await flushIce(d.from); setStatus('connected'); } };
    const onIce = async (d: any) => {
      const pc = pcs.current[d.from];
      if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch {} }
      else { (pendingIce.current[d.from] ||= []).push(d.candidate); }
    };
    const onOffer = async (d: any) => { // guruh mesh — boshqa a'zodan yangi offer
      if (!call.groupId || d.groupId !== call.groupId || d.from === currentUser.id) return;
      const pc = makePC(d.from);
      await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      await flushIce(d.from);
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      socket?.emit('call:answer', { to: d.from, from: currentUser.id, sdp: ans });
    };
    const onJoin = (d: any) => { if (call.groupId && d.groupId === call.groupId && d.from !== currentUser.id) offerTo(d.from); };
    const closePeer = (peerId: string) => { pcs.current[peerId]?.close(); delete pcs.current[peerId]; setRemote(prev => { const c = { ...prev }; delete c[peerId]; return c; }); };
    const onEnd = (d: any) => { closePeer(d.from); if (Object.keys(pcs.current).length === 0) onClose(); };
    const onReject = (d: any) => { toast("Qo'ng'iroq rad etildi"); onEnd(d); };

    socket?.on('call:answer', onAnswer);
    socket?.on('call:ice', onIce);
    socket?.on('call:offer', onOffer);
    socket?.on('call:join', onJoin);
    socket?.on('call:end', onEnd);
    socket?.on('call:reject', onReject);

    return () => {
      cancelled = true;
      socket?.off('call:answer', onAnswer); socket?.off('call:ice', onIce); socket?.off('call:offer', onOffer);
      socket?.off('call:join', onJoin); socket?.off('call:end', onEnd); socket?.off('call:reject', onReject);
      Object.values(pcs.current).forEach(pc => pc.close()); pcs.current = {};
      localStream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const accept = async () => {
    setStatus('ringing');
    // Stream tayyor bo'lishini kutamiz (agar hali kamera/mikrofon ruxsati olinmagan bo'lsa)
    await streamReady.current;
    const from = call.peerId!;
    const pc = makePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
    await flushIce(from);
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    socket?.emit('call:answer', { to: from, from: currentUser.id, sdp: ans });
    if (call.groupId) socket?.emit('call:join', { groupId: call.groupId, from: currentUser.id });
  };
  const decline = () => { socket?.emit('call:reject', { to: call.peerId, from: currentUser.id }); onClose(); };
  const hangup = () => { Object.keys(pcs.current).forEach(pid => socket?.emit('call:end', { to: pid, from: currentUser.id })); onClose(); };
  const toggleMute = () => { const m = !muted; localStream.current?.getAudioTracks().forEach(t => t.enabled = !m); setMuted(m); };
  const toggleCam = () => { const c = !camOff; localStream.current?.getVideoTracks().forEach(t => t.enabled = !c); setCamOff(c); };

  const remoteEntries = Object.entries(remote);

  return (
    <div className="fixed inset-0 z-[100] bg-[#0A0E1C] flex flex-col animate-fade-in">
      {/* Video/masofaviy */}
      <div className="flex-1 relative overflow-hidden">
        {call.mode === 'video' && remoteEntries.length > 0 ? (
          <div className={`w-full h-full grid gap-1 ${remoteEntries.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {remoteEntries.map(([pid, stream]) => (
              <RemoteVideo key={pid} stream={stream} label={userById(pid)?.name || ''}/>
            ))}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-white">
            <div className="w-28 h-28 rounded-full bg-white/10 flex items-center justify-center">
              {call.groupId ? <Users2 className="w-12 h-12"/> : <span className="text-4xl font-bold">{title.charAt(0)}</span>}
            </div>
            <p className="text-xl font-semibold">{title}</p>
            <p className="text-white/60 text-sm">
              {status === 'incoming' ? `Kiruvchi ${call.mode==='video'?'video':'ovozli'} qo'ng'iroq...` :
               status === 'ringing' ? "Ulanmoqda..." : "Ulandi"}
            </p>
            {/* Ovozli qo'ng'iroqda masofaviy audio */}
            {remoteEntries.map(([pid, stream]) => <RemoteAudio key={pid} stream={stream}/>)}
          </div>
        )}
        {/* Lokal PiP (mirror + larger for readability) */}
        {call.mode === 'video' && (
          <video ref={localRef} autoPlay muted playsInline
            className="absolute bottom-4 right-4 w-32 h-48 object-cover rounded-2xl border-2 border-white/30 shadow-xl bg-black"
            style={{ transform: 'scaleX(-1)' }}
          />
        )}
      </div>

      {/* Boshqaruv */}
      <div className="flex-shrink-0 pt-4 flex items-center justify-center gap-4" style={{ paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom) + 1rem))" }}>
        {status === 'incoming' ? (
          <>
            <button onClick={decline} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center active:scale-95 shadow-lg"><PhoneOff className="w-6 h-6"/></button>
            <button onClick={accept} className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center active:scale-95 shadow-lg animate-pulse"><Phone className="w-6 h-6"/></button>
          </>
        ) : (
          <>
            <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center text-white active:scale-95 ${muted?'bg-white/30':'bg-white/10'}`}>{muted?<MicOff className="w-5 h-5"/>:<Mic className="w-5 h-5"/>}</button>
            {call.mode === 'video' && <button onClick={toggleCam} className={`w-14 h-14 rounded-full flex items-center justify-center text-white active:scale-95 ${camOff?'bg-white/30':'bg-white/10'}`}>{camOff?<VideoOff className="w-5 h-5"/>:<VideoIcon className="w-5 h-5"/>}</button>}
            <button onClick={hangup} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center active:scale-95 shadow-lg"><PhoneOff className="w-6 h-6"/></button>
          </>
        )}
      </div>
    </div>
  );
}

function RemoteVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="relative w-full h-full bg-black">
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover"/>
      {label && <span className="absolute bottom-2 left-2 text-white text-xs bg-black/50 px-2 py-0.5 rounded">{label}</span>}
    </div>
  );
}
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay/>;
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
  { id: "navy", name: "Klassik", primary: "#1B3A6B", accent: "#D9460F",
    light: themeVars({ primary:"#1B3A6B", accent:"#D9460F", secondary:"#E4EAF3", secondaryFg:"#1B3A6B", bg:"#F4F6FA", card:"#FFFFFF", fg:"#0F1A2E", muted:"#EAEEF5", mutedFg:"#5C6B84", border:"rgba(15,26,46,0.10)", input:"#EDF1F7", ring:"#1B3A6B" }),
    dark:  themeVars({ primary:"#3E6DB5", accent:"#F26A3D", secondary:"#1E2A40", secondaryFg:"#CBD5E1", bg:"#0B1220", card:"#131C2E", fg:"#E6ECF5", muted:"#1A2436", mutedFg:"#8A9CB8", border:DARK_BORDER, input:"#1A2436", ring:"#5B8DD6" }) },
  { id: "ocean", name: "Okean", primary: "#0369A1", accent: "#0EA5E9",
    light: themeVars({ primary:"#0369A1", accent:"#0EA5E9", secondary:"#E0F2FE", secondaryFg:"#075985", bg:"#F1F9FE", card:"#FFFFFF", fg:"#0C2536", muted:"#E4F3FB", mutedFg:"#4E6E7E", border:"rgba(3,105,161,0.10)", input:"#E8F5FF", ring:"#0369A1" }),
    dark:  themeVars({ primary:"#2A94D6", accent:"#22C3E6", secondary:"#102838", secondaryFg:"#BAE0F5", bg:"#071620", card:"#0E2130", fg:"#E1F0F7", muted:"#12293A", mutedFg:"#7F9DB0", border:DARK_BORDER, input:"#12293A", ring:"#38BDF8" }) },
  { id: "forest", name: "O'rmon", primary: "#166534", accent: "#16A34A",
    light: themeVars({ primary:"#166534", accent:"#16A34A", secondary:"#DCFCE7", secondaryFg:"#14532D", bg:"#F1FBF4", card:"#FFFFFF", fg:"#0E2A18", muted:"#E4F6EA", mutedFg:"#4B6B57", border:"rgba(22,101,52,0.10)", input:"#E9F8EF", ring:"#166534" }),
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
  { id: "amber", name: "Oltin rang", primary: "#B45309", accent: "#D97706",
    light: themeVars({ primary:"#B45309", accent:"#D97706", secondary:"#FEF3C7", secondaryFg:"#92400E", bg:"#FFFBEB", card:"#FFFFFF", fg:"#2E1D06", muted:"#FBF2D8", mutedFg:"#7A6A48", border:"rgba(146,64,14,0.10)", input:"#FFF8E0", ring:"#B45309" }),
    dark:  themeVars({ primary:"#B87A1C", accent:"#F59E0B", secondary:"#2C2110", secondaryFg:"#FDE68A", bg:"#15100A", card:"#221A0E", fg:"#F5ECD8", muted:"#271F10", mutedFg:"#B39B6E", border:DARK_BORDER, input:"#271F10", ring:"#FBBF24" }) },
  { id: "teal", name: "Moviy-yashil", primary: "#0F766E", accent: "#0D9488",
    light: themeVars({ primary:"#0F766E", accent:"#0D9488", secondary:"#CCFBF1", secondaryFg:"#115E59", bg:"#F0FDFA", card:"#FFFFFF", fg:"#0A2A28", muted:"#E0F5F1", mutedFg:"#4B6E6A", border:"rgba(15,118,110,0.10)", input:"#E8FBF7", ring:"#0F766E" }),
    dark:  themeVars({ primary:"#1AA093", accent:"#14B8A6", secondary:"#0F2A28", secondaryFg:"#99F6E4", bg:"#051614", card:"#0D2422", fg:"#DDF3F0", muted:"#112B28", mutedFg:"#7BA9A3", border:DARK_BORDER, input:"#112B28", ring:"#2DD4BF" }) },
];

function ProfilePage({ currentUser, projects, onUpdateAvatar, onLogout, onUpdateUser, onCompanyNameChange, onCompanyLogoChange, onBgChange, onColorThemeChange, colorTheme, themeMode, onThemeModeChange, canEditCompany }:
  { currentUser: AppUser; projects: Project[]; onUpdateAvatar: (url: string) => void; onLogout: () => void; onUpdateUser: (u: AppUser) => void; onCompanyNameChange: (name: string) => void; onCompanyLogoChange: (logo: string) => void; onBgChange: (bg: string) => void; onColorThemeChange: (id: string) => void; colorTheme: string; themeMode: "light"|"dark"|"system"; onThemeModeChange: (m: "light"|"dark"|"system") => void; canEditCompany?: boolean }) {
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { if (ev.target?.result) onUpdateAvatar(ev.target.result as string); };
    reader.readAsDataURL(file);
  };
  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (ev.target?.result) { const url = ev.target.result as string; setCompanyLogo(url); localStorage.setItem("erp_companyLogo", url); onCompanyLogoChange(url); }
    };
    reader.readAsDataURL(file);
  };
  const handleBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (ev.target?.result) { const url = ev.target.result as string; setProfileBg(url); localStorage.setItem("erp_profileBg", url); onBgChange(url); }
    };
    reader.readAsDataURL(file);
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
    : { background: "linear-gradient(135deg, #1B3A6B 0%, #D9460F 100%)" };

  const perms: [string, boolean][] = [
    ["Barcha moliya va hisobotlarni ko'rish", isAdmin(currentUser.role)],
    ["Chiqim qo'shish", isAdmin(currentUser.role)],
    ["Yangi foydalanuvchi qo'shish", isAdmin(currentUser.role)||currentUser.role==="brigadir"],
    ["Material yuborish", true],
    ["Material tasdiqlash", true],
    ["Oylik to'lovini tasdiqlash", !isAdmin(currentUser.role)],
  ];

  const activeTheme = COLOR_THEMES.find(t => t.id === colorTheme) || COLOR_THEMES[0];

  return (
    <div className="overflow-y-auto scrollbar-hide max-w-lg mx-auto w-full pb-10">

      {/* ── Company Banner ─────────────────────────── */}
      <div className="relative overflow-hidden" style={{ ...bannerStyle, height: 210 }}>
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
              <button onClick={() => logoRef.current?.click()}
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
                <button onClick={saveBrand} className="w-7 h-7 bg-white/20 text-white rounded-full flex items-center justify-center border border-white/30 hover:bg-white/30 liquid-transition"><Check className="w-3.5 h-3.5"/></button>
                <button onClick={() => setEditingBrand(false)} className="w-7 h-7 bg-black/20 text-white rounded-full flex items-center justify-center hover:bg-black/30 liquid-transition"><X className="w-3.5 h-3.5"/></button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-white font-bold text-xl drop-shadow-lg">{companyName}</p>
                {canEditCompany && (
                  <button onClick={() => { setBrandInput(companyName); setEditingBrand(true); }}
                    className="p-1 text-white/60 hover:text-white rounded-lg hover:bg-white/10 liquid-transition">
                    <Edit className="w-3.5 h-3.5"/>
                  </button>
                )}
              </div>
            )}
            <p className="text-white/65 text-xs mt-0.5">Qurilish kompaniyasi</p>
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* ── Profile Card ──────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl p-5 text-center relative shadow-sm">
          {isAdmin(currentUser.role) && (
            !isEditing
              ? <button onClick={() => setIsEditing(true)} className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded-lg liquid-transition"><Edit className="w-4 h-4"/></button>
              : <button onClick={() => setIsEditing(false)} className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:bg-muted/50 rounded-lg liquid-transition"><X className="w-4 h-4"/></button>
          )}
          <div className="relative inline-block mb-3">
            <Avatar user={currentUser} size="lg"/>
            <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center hover:bg-primary/90 border-2 border-white shadow-lg liquid-transition">
              <Camera className="w-3.5 h-3.5"/>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          {isEditing ? (
            <div className="space-y-3 mt-4 text-left">
              <div><label className="text-[10px] text-muted-foreground block mb-1.5 uppercase tracking-wider font-bold">Ism Familiya</label><input className="w-full text-sm border border-border rounded-xl px-3 py-2.5 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary liquid-transition" value={form.name} onChange={e => setForm({...form, name: e.target.value})}/></div>
              <div><label className="text-[10px] text-muted-foreground block mb-1.5 uppercase tracking-wider font-bold">Telefon raqam</label><input className="w-full text-sm border border-border rounded-xl px-3 py-2.5 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary liquid-transition font-mono" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})}/></div>
              {form.phone !== currentUser.phone && (
                <div className="bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs p-2.5 rounded-xl flex items-start gap-2"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/><p>Raqamni o'zgartirsangiz, Telegram bot orqali qayta tasdiqlashingiz shart!</p></div>
              )}
              <button onClick={handleSave} className="w-full text-white text-sm font-bold py-3 rounded-xl liquid-transition" style={{ background: `linear-gradient(135deg, ${activeTheme.primary} 0%, ${activeTheme.primary}cc 100%)` }}>Saqlash</button>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold font-['Roboto_Slab',serif]">{currentUser.name}</h2>
              <div className="flex justify-center mt-2"><RoleBadge role={currentUser.role}/></div>
              <p className="text-xs text-muted-foreground mt-2 font-mono">{currentUser.phone}</p>
              {currentUser.brigade && <p className="text-xs text-muted-foreground mt-1">{currentUser.brigade}</p>}
            </>
          )}
        </div>

        {/* ── Fon Mavzular ─────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <div className="w-4 h-4 rounded-md flex-shrink-0" style={(bannerStyle as any).background ? { background: (bannerStyle as any).background } : { backgroundImage: (bannerStyle as any).backgroundImage, backgroundSize: 'cover' }}/>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex-1">Fon mavzular</p>
            <span className="text-[10px] text-muted-foreground hidden sm:block">Butun site ga qo'llaniladi</span>
          </div>
          <div className="p-3">
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
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

        {/* ── Ko'rinish rejimi (Light / Dark / System) ─────────── */}
        <div className="surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Moon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"/>
            <p className="section-title flex-1">Ko'rinish rejimi</p>
          </div>
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

        {/* ── Rang Mavzusi ─────────────────────────── */}
        <div className="surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Palette className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"/>
            <p className="section-title flex-1">Rang mavzusi</p>
            <span className="text-[10px] font-semibold" style={{ color: activeTheme.primary }}>{activeTheme.name}</span>
          </div>
          <div className="px-3 py-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
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

        {/* ── Ruxsatlar ─────────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3.5 border-b border-border">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ruxsatlar</p>
          </div>
          {perms.map(([label, has]) => (
            <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/20 liquid-transition">
              <span className="text-sm text-foreground">{label}</span>
              {has ? <CheckCircle className="w-4 h-4 text-green-500"/> : <X className="w-4 h-4 text-muted-foreground/30"/>}
            </div>
          ))}
        </div>

        {/* ── Obyektlarim ───────────────────────────── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3.5 border-b border-border">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Obyektlarim</p>
          </div>
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

        <button onClick={() => { localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
          className="w-full flex items-center justify-center gap-2.5 text-sm border-2 border-border rounded-2xl px-4 py-3.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 liquid-transition font-semibold">
          <LogOut className="w-4 h-4"/>Tizimdan chiqish
        </button>
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
      setError("Telefon raqamni to'g'ri kiriting");
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
        setError(data.error || "Xatolik yuz berdi");
        return;
      }
      setStep("code");
      setTimeLeft(120);
    } catch (err) {
      setError("Server bilan ulanishda xatolik");
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
        setError(data.error || "Xatolik yuz berdi");
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
      };
      localStorage.setItem("token", data.token);
      localStorage.setItem("currentUser", JSON.stringify(u));
      onLogin(u, data.company);
    } catch (err) {
      setError("Server bilan ulanishda xatolik");
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
      if (!res.ok) { setError(data.error || "Xatolik yuz berdi"); return; }
      const u = {
        id: data.user.id || data.user._id,
        name: data.user.firstName + (data.user.lastName ? " " + data.user.lastName : ""),
        phone: data.user.phone,
        role: data.user.role,
        projectIds: data.user.projectIds || [],
        isOwner: false,
        companyId: undefined,
      };
      localStorage.setItem("token", data.token);
      localStorage.setItem("currentUser", JSON.stringify(u));
      onLogin(u, data.company);
    } catch (err) {
      setError("Server bilan ulanishda xatolik");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 py-8 liquid-transition relative overflow-y-auto scrollbar-hide" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      {/* Background decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[100px]" />

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="mb-8 text-center relative z-10">
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary/20 overflow-hidden">
          {loginCompanyLogo ? <img src={loginCompanyLogo} alt="Logo" className="w-full h-full object-contain p-1"/> : <Building2 className="w-8 h-8 text-white"/>}
        </div>
        <h1 className="text-3xl font-bold font-['Roboto_Slab',serif] bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">{loginCompanyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">Tizimga kirish</p>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.08 }}
        className="w-full max-w-sm space-y-4 glass p-7 rounded-[2rem] border border-white/20 shadow-2xl relative z-10 overflow-hidden">
        {error && <div className="bg-red-500/10 text-red-600 dark:text-red-400 text-sm md:text-xs p-3 rounded-lg border border-red-500/20 text-center">{error}</div>}

        <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 mb-4">
              <p className="text-sm md:text-xs text-muted-foreground leading-relaxed text-center">
                Oldin Telegram botimizga kiring, <span className="font-semibold text-foreground">/start</span> tugmasini bosib raqamingizni ulashing. Keyin shu yerga raqamingizni yozib kodni oling.
              </p>
              <a href="https://t.me/qurilish_erp_bot" target="_blank" rel="noopener noreferrer" className="mt-2 text-sm md:text-xs font-semibold text-primary flex items-center justify-center gap-1 hover:underline">
                <Send className="w-3 h-3"/> @qurilish_erp_bot ga o'tish
              </a>
            </div>
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground">Telefon raqamingiz</label>
              <div className="relative">
                <Phone className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"/>
                <input type="text" className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono liquid-transition shadow-inner"
                  value={phone} onChange={e => {
                    setError("");
                    const val = e.target.value;
                    if (val.startsWith("+998 ")) setPhone(val);
                    else if (val === "+998") setPhone("+998 ");
                  }} autoFocus/>
              </div>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-semibold py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">
              Kodni olish
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
                  <p className="text-sm font-semibold">Obuna tasdiqini kutmoqda</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">Adminningiz obunangizni hali tasdiqlamagan. Tasdiqlanganida Telegram orqali xabar olasiz.</p>
                </>
              )}
              {(blockedReason === 'expired' || blockedReason === 'rejected') && (
                <>
                  <p className="text-sm font-semibold">{blockedReason === 'expired' ? 'Obuna muddati tugagan' : 'Obuna rad etilgan'}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">To'lovni yangilash va kirish huquqini qayta olish uchun admin bilan bog'laning.</p>
                </>
              )}
            </div>
            <a href="https://t.me/Sadriddinov_Jahongir" target="_blank" rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-500 text-white text-sm font-semibold py-3.5 rounded-full min-h-[44px] active:scale-[0.98] transition-transform">
              <Send className="w-4 h-4"/> @Sadriddinov_Jahongir'ga yozish
            </a>
            <button type="button" onClick={() => { setStep("phone"); setBlockedReason(null); setError(""); }}
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2">
              Orqaga
            </button>
          </div>
        ) : step === "devpass" ? (
          <form onSubmit={handleDevLogin} className="space-y-4">
            <div className="bg-slate-800/5 border border-slate-800/10 rounded-xl p-3 mb-2 text-center">
              <p className="text-sm md:text-xs text-muted-foreground">🛠 Dasturchi kirishi</p>
              <p className="text-xs font-mono text-foreground mt-1">{phone}</p>
            </div>
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground text-center">Parol</label>
              <input type="password" className="w-full text-base text-center border border-border/50 rounded-xl px-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition shadow-inner"
                placeholder="••••••••" value={password} onChange={e => { setError(""); setPassword(e.target.value); }} autoFocus/>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-semibold py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">
              Kirish
            </button>
            <button type="button" onClick={() => { setStep("phone"); setPassword(""); }} className="w-full text-sm md:text-xs text-muted-foreground hover:text-foreground py-2 liquid-transition">
              Raqamni o'zgartirish
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label className="text-sm md:text-xs font-medium block mb-2 text-muted-foreground text-center">Telegram botga yuborilgan 4 xonali kod</label>
              <OtpBoxes value={code} onChange={v => { setError(""); setCode(v); }} error={!!error} autoFocus/>
            </div>
            <button type="submit" className="w-full bg-gradient-to-r from-primary to-primary/90 text-white text-sm font-semibold py-3.5 rounded-full shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 liquid-transition">
              Tizimga kirish
            </button>
            <div className="flex flex-col gap-2 pt-2">
              <button type="button" onClick={() => {
                if (timeLeft === 0) handlePhoneSubmit();
              }} className={`w-full text-sm md:text-xs font-medium py-2 rounded-lg liquid-transition ${timeLeft > 0 ? "text-muted-foreground/50 cursor-not-allowed" : "text-primary hover:bg-primary/10"}`}>
                {timeLeft > 0 ? `Qayta yuborish (${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')})` : "Kodni qayta yuborish"}
              </button>
              <button type="button" onClick={() => setStep("phone")} className="w-full text-sm md:text-xs text-muted-foreground hover:text-foreground py-2 liquid-transition">
                Raqamni o'zgartirish
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
            <span className="text-xs text-muted-foreground">yoki</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>
          <button type="button" onClick={onRegister}
            className="w-full text-sm font-semibold py-3 rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 liquid-transition flex items-center justify-center gap-2 min-h-[48px]">
            <Building2 className="w-4 h-4" /> Yangi foydalanuvchimisiz? Firma ochish
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Register Wizard (v1.2 self-signup) ────────────────────────────────────────
type RegStep = "warn" | "tarif" | "payment" | "phone" | "bot" | "owner" | "company" | "brand" | "summary" | "done";

// Modul darajasida (render ichida emas) — aks holda input fokusini yo'qotadi
function RegField({ label, children, hint }: { label: string; children: any; hint?: string }) {
  return (
    <div>
      <label className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1 ml-1">{hint}</p>}
    </div>
  );
}

function RegisterWizard({ onBack, onDone }: { onBack: () => void; onDone: (u: any, company?: any) => void }) {
  const [step, setStep] = useState<RegStep>("warn");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Qadam 1 — ogohlantirish
  const [ownerConfirm, setOwnerConfirm] = useState(false);

  // Qadam 2 — tarif tanlash
  const [selectedPlan, setSelectedPlan] = useState<'1month'|'3month'|'6month'|'12month'|null>(null);
  const [regDoneInfo, setRegDoneInfo] = useState<{phone:string;planLabel:string;planAmount:number;companyName:string;branchId:string;ownerName:string}|null>(null);
  const [doneCopied, setDoneCopied] = useState(false);

  // Qadam 3 — telefon
  const [phone, setPhone] = useState("+998 ");

  // Ro'yxat sessiyasi (resume uchun localStorage'da saqlanadi)
  const [reg, setReg] = useState<{ registrationId: string; token: string; deepLink: string; botUsername: string; expiresAt: string } | null>(() => {
    try { const s = localStorage.getItem("erp_reg"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [botStatus, setBotStatus] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [resendCd, setResendCd] = useState(0);

  // Qadam 5.1 — egasi
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState("Direktor");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  // Qadam 5.2 — firma
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [inn, setInn] = useState("");
  const [activityType, setActivityType] = useState("qurilish");
  const [region, setRegion] = useState("");
  const [employeeRange, setEmployeeRange] = useState("1-10");

  // Qadam 5.3 — logo + valyuta
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [currency, setCurrency] = useState<"UZS" | "USD">("UZS");
  const logoRef = useRef<HTMLInputElement>(null);

  const saveReg = (r: any, plan?: string) => {
    setReg(r);
    try { localStorage.setItem("erp_reg", JSON.stringify(r)); } catch {}
    if (plan) try { localStorage.setItem("erp_reg_plan", plan); } catch {}
  };
  const clearReg = () => {
    setReg(null);
    try { localStorage.removeItem("erp_reg"); localStorage.removeItem("erp_reg_plan"); } catch {}
  };

  // Resume: sahifa ochilganda faol sessiya bo'lsa botga/keyingi qadamга o'tamiz
  useEffect(() => {
    if (reg && step === "warn") {
      setOwnerConfirm(true);
      // Saqlangan tarifni tiklaymiz
      const savedPlan = localStorage.getItem("erp_reg_plan") as '1month'|'3month'|'12month'|null;
      if (savedPlan) setSelectedPlan(savedPlan);
      setStep("bot");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 15 daqiqa timer
  useEffect(() => {
    if (step !== "bot" || !reg) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(reg.expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, reg]);

  // Resend cooldown
  useEffect(() => {
    if (resendCd <= 0) return;
    const id = setTimeout(() => setResendCd(resendCd - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCd]);

  // Polling: bot tomonda tasdiqlanganini kutamiz
  useEffect(() => {
    if (step !== "bot" || !reg) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/register/status?registrationId=${reg.registrationId}`);
        const d = await res.json();
        if (stop) return;
        setBotStatus(d.step);
        if (d.step === "EXPIRED") { setError("Sessiya muddati tugadi. Qaytadan boshlang."); clearReg(); setStep("phone"); return; }
        if (d.consentGiven) { setStep("owner"); return; }
      } catch { /* tarmoq — keyingi urinishda */ }
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, reg?.registrationId]);

  const submitPhone = async () => {
    const clean = phone.replace(/\s+/g, "");
    if (!/^\+998\d{9}$/.test(clean)) { setError("To'g'ri raqam kiriting: +998 XX XXX XX XX"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/register/phone`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: clean, ownerConfirm }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Xatolik"); setLoading(false); return; }
      if (d.exists) { setError("Bu raqam bilan firma mavjud. Tizimga kiring."); setLoading(false); setTimeout(onBack, 1800); return; }
      // Tarifni ham saqlaymiz — resume qilganda tiklanadi
      saveReg(
        { registrationId: d.registrationId, token: d.token, deepLink: d.deepLink, botUsername: d.botUsername, expiresAt: d.expiresAt },
        selectedPlan || '1month'
      );
      setStep("bot");
    } catch { setError("Server bilan ulanishda xatolik"); }
    setLoading(false);
  };

  const resend = async () => {
    if (!reg || resendCd > 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/register/resend`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId: reg.registrationId }),
      });
      const d = await res.json();
      if (res.ok) { saveReg({ registrationId: d.registrationId, token: d.token, deepLink: d.deepLink, botUsername: d.botUsername, expiresAt: d.expiresAt }); setResendCd(60); }
      else if (d.retryAfterSec) setResendCd(d.retryAfterSec);
    } catch {}
  };

  const pickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError("Logo 2MB dan katta bo'lmasin"); return; }
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setError("Faqat PNG/JPG/WEBP"); return; }
    setError(""); setLogoUploading(true);
    try { const { url } = await uploadChatMedia(f, f.name); setLogoUrl(url); }
    catch { setError("Logo yuklanmadi"); }
    setLogoUploading(false);
  };

  const complete = async () => {
    if (!reg) return;
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/register/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: reg.token,
          selectedPlan: selectedPlan || '1month',
          owner: { firstName, lastName, middleName, email, position, password },
          company: { name: companyName, legalName, inn, activityType, region, employeeRange, currency },
          logoUrl,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Xatolik"); setLoading(false); return; }
      // Server endi JWT bermaydi — pending holatida admin tasdiqini kutamiz
      clearReg();
      setRegDoneInfo({
        phone: d.phone || phone.replace(/\s/g,''),
        planLabel: d.planLabel || '1 oylik',
        planAmount: d.planAmount || 700_000,
        companyName: d.company?.name || companyName,
        branchId: d.company?.branchId || '',
        ownerName: `${firstName} ${lastName}`.trim(),
      });
      setStep("done");
    } catch { setError("Server bilan ulanishda xatolik"); setLoading(false); }
    setLoading(false);
  };

  // ── Kichik UI yordamchilar ──────────────────────────────────────────────────
  const STEPS_ORDER: RegStep[] = ["tarif", "payment", "phone", "bot", "owner", "company", "brand", "summary"];
  const progress = Math.max(0, STEPS_ORDER.indexOf(step)) / (STEPS_ORDER.length - 1);
  const inputCls = "w-full text-base border border-border/50 rounded-xl px-4 py-3 bg-white/60 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition";

  const goBack = () => {
    const map: Record<RegStep, RegStep | null> = {
      warn: null, tarif: "warn", payment: "tarif", phone: "payment",
      bot: "phone", owner: "bot", company: "owner", brand: "company", summary: "brand", done: null
    };
    const prev = map[step];
    if (prev) setStep(prev); else onBack();
  };

  return (
    <div className="h-[100dvh] bg-background flex flex-col liquid-transition relative overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent/20 rounded-full blur-[100px]" />

      {/* Header: back + progress */}
      <div className="relative z-10 flex items-center gap-3 px-4 pt-4">
        <button onClick={goBack} className="w-10 h-10 rounded-full bg-white/50 dark:bg-black/20 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
          <div className="h-full bg-primary liquid-transition" style={{ width: `${step === "warn" ? 0 : progress * 100}%` }} />
        </div>
      </div>

      {/* pb-24 = sticky button height uchun joy qoldiradi — content uning ostiga tushib ketmaydi */}
      <div className="relative z-10 flex-1 overflow-y-auto scrollbar-hide px-4 py-6 pb-24 flex flex-col">
        <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
          {error && <div className="bg-red-500/10 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg border border-red-500/20 text-center mb-4 animate-pop-in">{error}</div>}

          {/* ── Qadam 1: Ogohlantirish ── */}
          {step === "warn" && (
            <div className="space-y-5 animate-slide-up-fade">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2 text-amber-600 dark:text-amber-300 font-bold">
                  <AlertTriangle className="w-5 h-5" /> Diqqat!
                </div>
                <p className="text-sm leading-relaxed text-foreground">
                  Faqat <b>firma egasi (rahbari)</b> ro'yxatdan o'ta oladi. Bu formani shaxsan firma egasi o'zi to'ldirishi kerak.
                  Xodimlar mustaqil ro'yxatdan o'ta olmaydi — sizni firma egasi tizimga taklif qiladi.
                  Har bir yangi firmaga alohida <b>Branch ID</b> beriladi va ma'lumotlaringiz boshqa firmalarga ko'rinmaydi.
                </p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={ownerConfirm} onChange={e => setOwnerConfirm(e.target.checked)} className="mt-1 w-5 h-5 accent-primary" />
                <span className="text-sm">Men firma egasi ekanligimni va ma'lumotlar to'g'ri ekanini tasdiqlayman</span>
              </label>
            </div>
          )}

          {/* ── Qadam 2: Tarif tanlash ── */}
          {step === "tarif" && (
            <div className="space-y-5 animate-slide-in-right">
              <div>
                <h2 className="text-xl font-bold mb-1">Tarif tanlang</h2>
                <p className="text-sm text-muted-foreground">Firma uchun obuna muddatini tanlang</p>
              </div>
              {([
                { key: '1month',  label: '1 oylik',  price: 700_000,   days: 30,  badge: 'BEPUL (1-oy sinov)' },
                { key: '3month',  label: '3 oylik',  price: 2_000_000, days: 90,  badge: '100 000 so\'m tejaysiz' },
                { key: '6month',  label: '6 oylik',  price: 4_000_000, days: 180, badge: '200 000 so\'m tejaysiz' },
                { key: '12month', label: '12 oylik', price: 8_000_000, days: 365, badge: '400 000 so\'m tejaysiz' },
              ] as const).map(plan => (
                <button key={plan.key} type="button"
                  onClick={() => setSelectedPlan(plan.key)}
                  className={`w-full rounded-2xl border-2 p-4 text-left transition-all duration-200 active:scale-[0.98]
                    ${selectedPlan===plan.key
                      ? 'border-primary bg-primary/8 shadow-md shadow-primary/20'
                      : 'border-border/50 bg-white/40 dark:bg-black/20 hover:border-primary/40'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base font-bold">{plan.label}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${plan.key === '1month' ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-accent/15 text-accent'}`}>{plan.badge}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{plan.days} kun</p>
                    </div>
                    <div className="text-right">
                      {plan.key === '1month' ? (
                        <div>
                          <p className="text-lg font-bold text-green-600 dark:text-green-400">BEPUL</p>
                          <p className="text-xs line-through text-muted-foreground">{plan.price.toLocaleString('uz-UZ')} so'm</p>
                        </div>
                      ) : (
                        <>
                          <p className="text-lg font-bold text-primary">{plan.price.toLocaleString('uz-UZ')}</p>
                          <p className="text-[11px] text-muted-foreground">so'm</p>
                        </>
                      )}
                    </div>
                  </div>
                  {selectedPlan===plan.key && (
                    <div className="mt-2 flex items-center gap-1.5 text-primary">
                      <Check className="w-4 h-4"/><span className="text-xs font-semibold">Tanlangan</span>
                    </div>
                  )}
                </button>
              ))}
              <p className="text-xs text-center text-muted-foreground pt-1">Birinchi oy bepul. Keyingi oydan to'lov boshlanadi.</p>
            </div>
          )}

          {/* ── Qadam 3: To'lov jarayoni ── */}
          {step === "payment" && selectedPlan && (
            <div className="space-y-5 animate-slide-in-right">
              <div>
                <h2 className="text-xl font-bold mb-1">To'lov jarayoni</h2>
                <p className="text-sm text-muted-foreground">Ro'yxatdan o'tgandan so'ng qanday ishlaydi</p>
              </div>
              <div className="bg-primary/8 border border-primary/20 rounded-2xl p-4">
                <p className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-2">Tanlangan tarif</p>
                {selectedPlan === '1month' ? (
                  <div>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">BEPUL</p>
                    <p className="text-sm line-through text-muted-foreground">700 000 so'm</p>
                  </div>
                ) : (
                  <p className="text-2xl font-bold text-primary">
                    {selectedPlan==='3month'?'2 000 000':selectedPlan==='6month'?'4 000 000':'8 000 000'}
                    <span className="text-base font-normal text-muted-foreground ml-1">so'm</span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedPlan==='1month'?'1 oylik (30 kun) — birinchi oy bepul':selectedPlan==='3month'?'3 oylik (90 kun)':selectedPlan==='6month'?'6 oylik (180 kun)':'12 oylik (365 kun)'}
                </p>
              </div>
              <div className="surface rounded-2xl p-4 space-y-3">
                {[
                  { n: "1", t: "Ro'yxatdan o'ting", d: "Barcha bosqichlarni to'ldiring va firmangizni oching" },
                  { n: "2", t: "Ma'lumotlarni yuboring", d: "@Sadriddinov_Jahongir'ga (Telegram) nusxalangan ma'lumotni yuboring" },
                  { n: "3", t: "Operator tasdiqlaydi", d: "1 daqiqadan 24 soat ichida akkauntingiz tekshiriladi" },
                  { n: "4", t: "Akkaunt ochiladi", d: "Birinchi oy — BEPUL! Keyingi oydan to'lov boshlanadi" },
                ].map(s => (
                  <div key={s.n} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">{s.n}</div>
                    <div><p className="text-sm font-semibold">{s.t}</p><p className="text-xs text-muted-foreground">{s.d}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Qadam 4: Telefon ── */}
          {step === "phone" && (
            <div className="space-y-5 animate-slide-in-right">
              <div>
                <h2 className="text-xl font-bold mb-1">Telefon raqamingiz</h2>
                <p className="text-sm text-muted-foreground">Firma egasining raqami. Telegram orqali tasdiqlanadi.</p>
              </div>
              <RegField label="Telefon">
                <input inputMode="tel" className={inputCls + " font-mono"} value={phone}
                  onChange={e => { setError(""); const v = e.target.value; if (v.startsWith("+998 ")) setPhone(v); else if (v === "+998") setPhone("+998 "); }}
                  autoFocus />
              </RegField>
            </div>
          )}

          {/* ── Qadam 3: Botga o'tish ── */}
          {step === "bot" && reg && (
            <div className="space-y-5 animate-slide-in-right text-center">
              <div>
                <h2 className="text-xl font-bold mb-1">Telegram orqali tasdiqlash</h2>
                <p className="text-sm text-muted-foreground">Botga o'ting, raqamingizni yuboring va rozilik bering. Bu sahifa avtomatik davom etadi.</p>
              </div>
              <a href={reg.deepLink} target="_blank" rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary/90 text-white text-base font-semibold py-4 rounded-xl shadow-lg shadow-primary/25 min-h-[54px] active:scale-[0.98] transition-transform">
                <Send className="w-5 h-5" /> Telegram botga o'tish
              </a>
              {/* Bosib to'liq /start <token> nusxalanadi (kesilmaydi) */}
              <button type="button" onClick={() => {
                const txt = `/start ${reg.token}`;
                const done = () => toast.success("Nusxalandi ✅ — botga joylab yuboring");
                if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done).catch(()=>{});
                else { try { const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); done(); } catch {} }
              }} className="w-full bg-white/50 dark:bg-black/20 rounded-xl p-3 border border-border/50 text-left active:scale-[0.99] transition-transform">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] text-muted-foreground">Tugma ishlamasa — bosib nusxalang:</p>
                  <span className="text-[11px] text-primary font-semibold whitespace-nowrap">📋 Nusxalash</span>
                </div>
                <code className="text-xs break-all font-mono text-primary block leading-relaxed">/start {reg.token}</code>
              </button>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {botStatus === "PHONE_CONFIRMED" ? "Raqam tasdiqlandi, rozilik kutilmoqda…" : "Bot javobini kutmoqdamiz…"}
              </div>
              {/* Timer 2:00 → 0:00; "Qayta yuborish" FAQAT muddat tugagach chiqadi */}
              {timeLeft > 0 ? (
                <p className="text-sm text-muted-foreground">Kod <span className="font-mono font-semibold text-foreground">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}</span> amal qiladi</p>
              ) : (
                <button onClick={resend} disabled={resendCd > 0} className={`text-sm font-semibold min-h-[44px] px-4 rounded-lg ${resendCd > 0 ? "text-muted-foreground/50" : "text-primary hover:bg-primary/10"}`}>
                  {resendCd > 0 ? `Qayta yuborish (${resendCd}s)` : "🔄 Kodni qayta yuborish"}
                </button>
              )}
            </div>
          )}

          {/* ── Qadam 5.1: Egasi ── */}
          {step === "owner" && (
            <div className="space-y-4 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Firma egasi</h2><p className="text-sm text-muted-foreground">Sizning ma'lumotlaringiz.</p></div>
              <div className="grid grid-cols-2 gap-3">
                <RegField label="Ism *"><input className={inputCls} value={firstName} onChange={e => setFirstName(e.target.value)} autoFocus /></RegField>
                <RegField label="Familiya *"><input className={inputCls} value={lastName} onChange={e => setLastName(e.target.value)} /></RegField>
              </div>
              <RegField label="Otasining ismi"><input className={inputCls} value={middleName} onChange={e => setMiddleName(e.target.value)} /></RegField>
              <RegField label="Email"><input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} /></RegField>
              <RegField label="Lavozim"><input className={inputCls} value={position} onChange={e => setPosition(e.target.value)} /></RegField>
              <RegField label="Parol *" hint="Kamida 8 belgi">
                <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} />
                <div className="h-1 mt-1.5 rounded-full bg-border/60 overflow-hidden">
                  <div className={`h-full liquid-transition ${password.length >= 12 ? "bg-green-500 w-full" : password.length >= 8 ? "bg-amber-500 w-2/3" : "bg-red-500 w-1/3"}`} />
                </div>
              </RegField>
              <RegField label="Parolni tasdiqlang *"><input type="password" className={inputCls} value={password2} onChange={e => setPassword2(e.target.value)} /></RegField>
            </div>
          )}

          {/* ── Qadam 5.2: Firma ── */}
          {step === "company" && (
            <div className="space-y-4 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Firma ma'lumotlari</h2></div>
              <RegField label="Firma nomi *"><input className={inputCls} value={companyName} onChange={e => setCompanyName(e.target.value)} autoFocus /></RegField>
              <RegField label="Yuridik nomi"><input className={inputCls} value={legalName} onChange={e => setLegalName(e.target.value)} /></RegField>
              <RegField label="INN / STIR" hint="9 raqam"><input inputMode="numeric" className={inputCls + " font-mono"} value={inn} maxLength={9} onChange={e => setInn(e.target.value.replace(/\D/g, ""))} /></RegField>
              <RegField label="Faoliyat turi">
                <select className={inputCls} value={activityType} onChange={e => setActivityType(e.target.value)}>
                  <option value="qurilish">Qurilish</option><option value="tamirlash">Ta'mirlash</option>
                  <option value="loyihalash">Loyihalash</option><option value="boshqa">Boshqa</option>
                </select>
              </RegField>
              <RegField label="Viloyat / Manzil"><input className={inputCls} value={region} onChange={e => setRegion(e.target.value)} /></RegField>
              <RegField label="Xodimlar soni">
                <select className={inputCls} value={employeeRange} onChange={e => setEmployeeRange(e.target.value)}>
                  <option value="1-10">1–10</option><option value="11-50">11–50</option>
                  <option value="51-200">51–200</option><option value="200+">200+</option>
                </select>
              </RegField>
            </div>
          )}

          {/* ── Qadam 5.3: Logo + valyuta ── */}
          {step === "brand" && (
            <div className="space-y-5 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Logotip va brend</h2></div>
              <div className="flex flex-col items-center gap-3">
                <div className="w-28 h-28 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden">
                  {logoUploading ? <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    : logoUrl ? <img src={logoUrl} alt="logo" className="w-full h-full object-cover" />
                    : <span className="text-3xl font-bold text-primary">{(companyName || "F").slice(0, 1).toUpperCase()}</span>}
                </div>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickLogo} />
                <button onClick={() => logoRef.current?.click()} className="text-sm font-semibold text-primary flex items-center gap-1.5">
                  <Camera className="w-4 h-4" /> {logoUrl ? "O'zgartirish" : "Logo yuklash"}
                </button>
                <p className="text-[11px] text-muted-foreground">PNG/JPG/WEBP, maks 2MB. Ixtiyoriy.</p>
              </div>
              <RegField label="Asosiy valyuta">
                <div className="grid grid-cols-2 gap-3">
                  {(["UZS", "USD"] as const).map(c => (
                    <button key={c} onClick={() => setCurrency(c)}
                      className={`py-3 rounded-xl border text-sm font-semibold ${currency === c ? "border-primary bg-primary/10 text-primary" : "border-border/50"}`}>{c}</button>
                  ))}
                </div>
              </RegField>
            </div>
          )}

          {/* ── Qadam 9: Yakuniy tasdiq ── */}
          {step === "summary" && (
            <div className="space-y-4 animate-slide-in-right">
              <div><h2 className="text-xl font-bold mb-1">Tekshirib tasdiqlang</h2></div>
              {[
                { t: "Tarif", v: selectedPlan==='1month'?'1 oylik — 700 000 so\'m':selectedPlan==='3month'?'3 oylik — 2 000 000 so\'m':selectedPlan==='6month'?'6 oylik — 4 000 000 so\'m':'12 oylik — 8 000 000 so\'m', go: "tarif" as RegStep },
                { t: "Egasi", v: `${firstName} ${lastName}`, go: "owner" as RegStep },
                { t: "Telefon", v: phone, go: "phone" as RegStep },
                { t: "Firma", v: companyName, go: "company" as RegStep },
                { t: "Faoliyat", v: activityType, go: "company" as RegStep },
                { t: "Valyuta", v: currency, go: "brand" as RegStep },
              ].map((r, i) => (
                <div key={i} className="flex items-center justify-between surface rounded-xl px-4 py-3">
                  <div><p className="text-[11px] text-muted-foreground">{r.t}</p><p className="text-sm font-medium">{r.v || "—"}</p></div>
                  <button onClick={() => setStep(r.go)} className="text-xs text-primary font-semibold">Tahrirlash</button>
                </div>
              ))}
            </div>
          )}

          {/* ── Qadam 10: Ro'yxatdan o'tdingiz — ma'lumotlarni yuborish ── */}
          {step === "done" && regDoneInfo && (
            <div className="space-y-5 animate-slide-in-right flex-1 flex flex-col justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-500"/>
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-1">Ro'yxatdan o'tdingiz!</h2>
                  <p className="text-sm text-muted-foreground">Quyidagi ma'lumotlarni @Sadriddinov_Jahongir'ga (Telegram) yuboring</p>
                </div>
              </div>

              {/* Copyable info block */}
              <div className="relative">
                <div className="bg-slate-900 dark:bg-slate-800 text-green-400 rounded-2xl p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap border border-slate-700 select-all">
                  {[
                    `📋 YANGI FIRMA RO'YXATI`,
                    `─────────────────────────`,
                    `🏢 Firma: ${regDoneInfo.companyName}`,
                    `👤 Egasi: ${regDoneInfo.ownerName}`,
                    `📞 Telefon: ${regDoneInfo.phone}`,
                    `📦 Tarif: ${regDoneInfo.planLabel}`,
                    `💰 Summa: ${regDoneInfo.planAmount.toLocaleString('uz-UZ')} so'm`,
                    ...(regDoneInfo.branchId ? [`🔑 ID: ${regDoneInfo.branchId}`] : []),
                    `─────────────────────────`,
                  ].join('\n')}
                </div>
                <button
                  onClick={() => {
                    const text = [
                      `📋 YANGI FIRMA RO'YXATI`,
                      `─────────────────────────`,
                      `🏢 Firma: ${regDoneInfo.companyName}`,
                      `👤 Egasi: ${regDoneInfo.ownerName}`,
                      `📞 Telefon: ${regDoneInfo.phone}`,
                      `📦 Tarif: ${regDoneInfo.planLabel}`,
                      `💰 Summa: ${regDoneInfo.planAmount.toLocaleString('uz-UZ')} so'm`,
                      ...(regDoneInfo.branchId ? [`🔑 ID: ${regDoneInfo.branchId}`] : []),
                      `─────────────────────────`,
                    ].join('\n');
                    navigator.clipboard.writeText(text).then(() => {
                      setDoneCopied(true);
                      setTimeout(() => setDoneCopied(false), 2500);
                    });
                  }}
                  className={`absolute top-3 right-3 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-all ${doneCopied ? 'bg-green-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  {doneCopied ? <><Check className="w-3 h-3"/>Nusxalandi!</> : <><Copy className="w-3 h-3"/>Nusxalash</>}
                </button>
              </div>

              <div className="surface rounded-2xl p-4 space-y-2.5">
                <p className="text-sm font-semibold">Keyingi qadam:</p>
                <p className="text-sm leading-relaxed text-muted-foreground">Yuqoridagi ma'lumotni nusxalab @Sadriddinov_Jahongir'ga (Telegram) yuboring:</p>
                <a href="https://t.me/Sadriddinov_Jahongir" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 bg-primary/10 border border-primary/25 rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-primary"/>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-primary">@Sadriddinov_Jahongir</p>
                    <p className="text-[11px] text-muted-foreground">Telegram — ma'lumotlarni yuboring</p>
                  </div>
                </a>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Operator javobini kuting. <b className="text-foreground">Birinchi oy — BEPUL!</b> Keyingi oydan to'lov boshlanadi.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky primary button (thumb zone) */}
      <div className="relative z-10 px-4 pb-4 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
        <div className="w-full max-w-md mx-auto">
          {step === "warn" && (
            <button disabled={!ownerConfirm} onClick={() => setStep("tarif")}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform">
              Davom etish
            </button>
          )}
          {step === "tarif" && (
            <button disabled={!selectedPlan} onClick={() => setStep("payment")}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform">
              Davom etish
            </button>
          )}
          {step === "payment" && (
            <button onClick={() => setStep("phone")}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] active:scale-[0.98] transition-transform">
              Davom etish
            </button>
          )}
          {step === "phone" && (
            <button disabled={loading} onClick={submitPhone}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Davom etish
            </button>
          )}
          {step === "owner" && (
            <button onClick={() => {
              if (!firstName.trim() || !lastName.trim()) { setError("Ism va familiya majburiy"); return; }
              if (password.length < 8) { setError("Parol kamida 8 belgi"); return; }
              if (password !== password2) { setError("Parollar mos kelmadi"); return; }
              setError(""); setStep("company");
            }} className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px]">Davom etish</button>
          )}
          {step === "company" && (
            <button onClick={() => {
              if (!companyName.trim()) { setError("Firma nomi majburiy"); return; }
              if (inn && !/^\d{9}$/.test(inn)) { setError("INN 9 raqam bo'lishi kerak"); return; }
              setError(""); setStep("brand");
            }} className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px]">Davom etish</button>
          )}
          {step === "brand" && (
            <button onClick={() => setStep("summary")} className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px]">Davom etish</button>
          )}
          {step === "summary" && (
            <button disabled={loading} onClick={complete}
              className="w-full bg-accent text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Firmani ochish
            </button>
          )}
          {step === "done" && (
            <button onClick={onBack}
              className="w-full bg-primary text-white text-sm font-semibold py-3.5 rounded-xl min-h-[48px] active:scale-[0.98] transition-transform">
              Tizimga kirish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Developer (super-admin) Panel ─────────────────────────────────────────────
const DEV_PLAN_CONFIG: Record<string, { label: string; days: number; amount: number }> = {
  'bepul':   { label: '1 oy bepul', days: 30,  amount: 0 },
  '1month':  { label: '1 oylik',   days: 30,  amount: 700_000 },
  '3month':  { label: '3 oylik',   days: 90,  amount: 2_000_000 },
  '6month':  { label: '6 oylik',   days: 180, amount: 4_000_000 },
  '12month': { label: '12 oylik',  days: 365, amount: 8_000_000 },
};

// ─── AI Assistant ──────────────────────────────────────────────────────────────
interface AiMsg { role: 'user'|'assistant'; content: string; }
interface AiAction { type: string; toUserId?: string; toUserName?: string; text?: string; description?: string; }

function AIAssistant({ currentUser, users, token }: { currentUser: AppUser; users: AppUser[]; token: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<AiMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ action: AiAction; response: string } | null>(null);
  const [execMsg, setExecMsg] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, pending, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setExecMsg('');
    const newMsgs: AiMsg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ message: text, history: msgs.slice(-8) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsgs(p => [...p, { role: 'assistant', content: `⚠️ ${data.error || 'Xatolik yuz berdi'}` }]);
      } else if (data.type === 'action' && data.action) {
        setMsgs(p => [...p, { role: 'assistant', content: data.response }]);
        setPending({ action: data.action, response: data.response });
      } else {
        setMsgs(p => [...p, { role: 'assistant', content: data.response || 'Javob yo\'q' }]);
      }
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: '⚠️ Server bilan ulanishda xatolik' }]);
    }
    setLoading(false);
  };

  const confirm = async () => {
    if (!pending) return;
    setLoading(true);
    setPending(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/execute`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ action: pending.action }),
      });
      const data = await res.json();
      const result = res.ok ? `✅ ${data.result || 'Bajarildi'}` : `⚠️ ${data.error || 'Xatolik'}`;
      setMsgs(p => [...p, { role: 'assistant', content: result }]);
      setExecMsg(result);
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: '⚠️ Amalga oshirishda xatolik' }]);
    }
    setLoading(false);
  };

  const cancel = () => {
    setPending(null);
    setMsgs(p => [...p, { role: 'assistant', content: '❌ Bekor qilindi' }]);
  };

  const greeting = `Salom, ${currentUser.name.split(' ')[0]}! Men AI yordamchisiman.\n\nMasalan: "Alibekka 'Ertaga soat 9da yig\'ilish bor' deb xabar yubor"`;

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed right-5 z-50 w-13 h-13 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 active:scale-95"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 112px)',
          background: open ? 'var(--accent)' : 'linear-gradient(135deg, var(--primary), var(--accent))',
          width: 52, height: 52,
        }}
        aria-label="AI Yordamchi"
      >
        {open
          ? <X className="w-5 h-5 text-white"/>
          : <span className="text-xl leading-none select-none">✨</span>
        }
        {!open && msgs.length === 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-card animate-pulse"/>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed right-5 z-50 w-[calc(100vw-40px)] max-w-[360px] rounded-2xl shadow-2xl border border-border/50 flex flex-col overflow-hidden animate-pop-in"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 172px)',
            maxHeight: '60vh',
            background: 'var(--card)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/40 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary)/10, var(--accent)/10)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-base"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
              <span className="text-white text-sm">✨</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-none">AI Yordamchi</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Buyruqni bajaruvchi asistent</p>
            </div>
            <button onClick={() => { setOpen(false); }} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
              <X className="w-4 h-4"/>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-hide">
            {msgs.length === 0 && (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{greeting}</p>
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {[
                    "Xodimlar ro'yxati",
                    "Rahimovga xabar yubor",
                    "Bugun nima qilsa bo'ladi?",
                  ].map(hint => (
                    <button key={hint} onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                      className="text-[10px] px-2.5 py-1.5 rounded-full border border-border/60 hover:bg-muted/60 transition-colors">
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-primary text-white rounded-br-sm'
                    : 'bg-muted/70 text-foreground rounded-bl-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted/70 px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-1.5">
                  <div className="flex gap-0.5">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${i*150}ms` }}/>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground">O'ylayapti...</span>
                </div>
              </div>
            )}
            {/* Confirmation card */}
            {pending && !loading && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-2.5">
                <div className="flex items-start gap-2">
                  <span className="text-base flex-shrink-0">🤖</span>
                  <p className="text-xs leading-relaxed font-medium">{pending.action.description || pending.response}</p>
                </div>
                {pending.action.text && (
                  <div className="bg-white/10 dark:bg-black/20 rounded-xl px-3 py-2">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Xabar matni:</p>
                    <p className="text-xs font-medium">"{pending.action.text}"</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={confirm}
                    className="flex-1 bg-green-600 text-white text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-transform">
                    <Check className="w-3.5 h-3.5"/> Ha, bajar
                  </button>
                  <button onClick={cancel}
                    className="flex-1 border border-red-500/40 text-red-500 text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-transform">
                    <X className="w-3.5 h-3.5"/> Yo'q
                  </button>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/40 flex-shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Buyruq bering..."
              className="flex-1 text-xs bg-muted/50 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
              disabled={loading || !!pending}
            />
            <button onClick={send} disabled={loading || !input.trim() || !!pending}
              className="w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all active:scale-95"
              style={{ background: 'var(--primary)' }}>
              <Send className="w-3.5 h-3.5 text-white"/>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Developer Panel ────────────────────────────────────────────────────────────
function DeveloperPanel({ currentUser, onLogout }: { currentUser: AppUser; onLogout: () => void }) {
  const [tab, setTab] = useState<"firms" | "users" | "subscriptions" | "messages">("subscriptions");
  const [companies, setCompanies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [subLoading, setSubLoading] = useState<string|null>(null);
  const [renewPlan, setRenewPlan] = useState<Record<string, string>>({}); // subId → selectedPlan
  // Messages tab state — per-company direct chats
  const [selDevFirm, setSelDevFirm] = useState<any|null>(null);
  const [selDevContact, setSelDevContact] = useState<any|null>(null);
  const [devDMMessages, setDevDMMessages] = useState<Msg[]>([]);
  const [devMobileStep, setDevMobileStep] = useState<'firms'|'contacts'|'chat'>('firms');
  const [devMsgText, setDevMsgText] = useState("");
  const [devMsgLoading, setDevMsgLoading] = useState(false);
  const devMsgBottomRef = useRef<HTMLDivElement>(null);

  const token = localStorage.getItem("token") || "";
  const authHdr = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  const load = async () => {
    setErr(""); setLoading(true);
    try {
      const [cr, ur, sr] = await Promise.all([
        fetch(`${API_BASE}/api/companies`, { headers: authHdr }),
        fetch(`${API_BASE}/api/users`, { headers: authHdr }),
        fetch(`${API_BASE}/api/admin/subscriptions`, { headers: authHdr }),
      ]);
      if (!cr.ok) { setErr("Firmalarni olishda xatolik (ruxsat yo'q?)"); setLoading(false); return; }
      setCompanies(await cr.json());
      setUsers(ur.ok ? await ur.json() : []);
      setSubs(sr.ok ? await sr.json() : []);
    } catch { setErr("Server bilan ulanishda xatolik"); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Load direct messages between developer and a company user
  const loadDevDM = async (toUserId: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/messages?userId=${currentUser.id}`, { headers: authHdr });
      if (r.ok) {
        const all = await r.json();
        setDevDMMessages(all.filter((m: any) => !m.deleted && !m.groupId &&
          ((m.fromUserId === currentUser.id && m.toUserId === toUserId) ||
           (m.fromUserId === toUserId && m.toUserId === currentUser.id))));
      }
    } catch {}
  };

  useEffect(() => {
    if (!selDevContact) return;
    loadDevDM(selDevContact.id);
  // eslint-disable-next-line
  }, [selDevContact?.id]);

  // Socket for real-time DMs in dev panel
  useEffect(() => {
    const sock = connectSocket(currentUser.id);
    const onNew = (m: any) => {
      if (!m.groupId && selDevContact && !m.deleted &&
        ((m.fromUserId === currentUser.id && m.toUserId === selDevContact.id) ||
         (m.fromUserId === selDevContact.id && m.toUserId === currentUser.id)))
        setDevDMMessages(prev => prev.some(x => x.id === (m.id || m._id)) ? prev : [...prev, { ...m, id: m.id || m._id }]);
    };
    sock.on('message:new', onNew);
    return () => { sock.off('message:new', onNew); };
  // eslint-disable-next-line
  }, [currentUser.id, selDevContact?.id]);

  useEffect(() => { devMsgBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [devDMMessages]);

  const sendDevMsg = async () => {
    if (!devMsgText.trim() || !selDevContact) return;
    setDevMsgLoading(true);
    try {
      await fetch(`${API_BASE}/api/messages`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ fromUserId: currentUser.id, toUserId: selDevContact.id, text: devMsgText.trim() }),
      });
      setDevMsgText('');
    } catch {}
    setDevMsgLoading(false);
  };

  const approveSub = async (id: string) => {
    const plan = renewPlan[id] || 'bepul';
    const cfg = DEV_PLAN_CONFIG[plan] || DEV_PLAN_CONFIG['bepul'];
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/approve`, {
      method: "POST", headers: authHdr,
      body: JSON.stringify({ selectedPlan: plan, days: cfg.days, amount: cfg.amount }),
    });
    if (res.ok) { await load(); } else { setErr("Tasdiqlashda xatolik"); }
    setSubLoading(null);
  };
  const rejectSub = async (id: string) => {
    if (!window.confirm("Rad etilsinmi?")) return;
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/reject`, { method: "POST", headers: authHdr });
    if (res.ok) { await load(); } else { setErr("Rad etishda xatolik"); }
    setSubLoading(null);
  };
  const renewSub = async (id: string) => {
    const plan = renewPlan[id] || '1month';
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/renew`, {
      method: "POST", headers: authHdr,
      body: JSON.stringify({ selectedPlan: plan }),
    });
    if (res.ok) { await load(); } else { setErr("Yangilashda xatolik"); }
    setSubLoading(null);
  };

  const companyName = (cid: string) => companies.find(c => c.id === cid)?.name || "—";

  const deleteCompany = async (c: any) => {
    if (!window.confirm(`"${c.name}" firmasi va uning BARCHA ma'lumotlari (${c.userCount} user, ${c.objectCount} obyekt) o'chiriladi. Davom etasizmi?`)) return;
    const res = await fetch(`${API_BASE}/api/companies/${c.id}`, { method: "DELETE" });
    if (res.ok) load(); else setErr("O'chirishda xatolik");
  };
  const toggleStatus = async (c: any) => {
    const status = c.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    const res = await fetch(`${API_BASE}/api/companies/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) load();
  };
  const deleteUser = async (u: any) => {
    if (u.id === currentUser.id) { setErr("O'z akkauntingizni o'chirib bo'lmaydi"); return; }
    if (!window.confirm(`"${u.name}" (${u.phone}) o'chirilsinmi?`)) return;
    const res = await fetch(`${API_BASE}/api/users/${u.id}`, { method: "DELETE", headers: authHdr });
    if (res.ok) load(); else setErr("O'chirishda xatolik");
  };
  const changeRole = async (u: any, role: string) => {
    const res = await fetch(`${API_BASE}/api/auth/users/${u.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (res.ok) load(); else setErr("O'zgartirishda xatolik");
  };
  // Eski tenant-bug qurbonlarini (companyId noto'g'ri/yo'q xodimlar) to'g'ri firmaga biriktirish
  const assignCompany = async (u: any, companyId: string) => {
    const res = await fetch(`${API_BASE}/api/users/${u.id}`, { method: "PUT", headers: authHdr, body: JSON.stringify({ companyId: companyId || null }) });
    if (res.ok) { load(); toast.success(`${u.name} firmaga biriktirildi. Xodim qayta login qilishi kerak.`); }
    else setErr("Firmaga biriktirishda xatolik");
  };

  return (
    <div className="min-h-screen bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="glass sticky top-0 z-20 px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-slate-800 text-white flex items-center justify-center text-sm font-bold">🛠</div>
          <div>
            <p className="text-sm font-bold leading-tight">Dasturchi paneli</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{currentUser.name} · super-admin</p>
          </div>
        </div>
        <button onClick={() => { localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-600 border border-border rounded-xl px-3 py-2">
          <LogOut className="w-4 h-4" /> Chiqish
        </button>
      </header>

      <div className="px-4 pt-3 flex gap-2 flex-wrap">
        <button onClick={() => setTab("subscriptions")} className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold ${tab === "subscriptions" ? "bg-primary text-white" : "surface"}`}>
          To'lovlar {subs.filter(s => s.status === "pending").length > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{subs.filter(s => s.status === "pending").length}</span>}
        </button>
        <button onClick={() => setTab("firms")} className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold ${tab === "firms" ? "bg-primary text-white" : "surface"}`}>Firmalar ({companies.length})</button>
        <button onClick={() => setTab("users")} className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold ${tab === "users" ? "bg-primary text-white" : "surface"}`}>Foydalanuvchilar</button>
        <button onClick={() => setTab("messages")} className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold ${tab === "messages" ? "bg-primary text-white" : "surface"}`}>
          💬 Xabarlar
        </button>
      </div>

      {err && <div className="mx-4 mt-3 bg-red-500/10 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg border border-red-500/20">{err}</div>}

      <div className="p-4 space-y-3 pb-24">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tab === "subscriptions" ? (
          subs.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">Obuna so'rovi yo'q</p> :
          subs.map(s => {
            const isPending = s.status === "pending";
            const isActive = s.status === "active";
            const isExpired = s.status === "expired";
            const isRejected = s.status === "rejected";
            const expiryWarning = isActive && typeof s.daysLeft === "number" && s.daysLeft <= 3;
            const statusLabel = isPending ? "Kutilmoqda" : isActive ? `Faol · ${s.daysLeft} kun` : isExpired ? "Muddati o'tgan" : "Rad etilgan";
            const statusColor = isPending ? "text-yellow-600 bg-yellow-500/10" : isActive ? (expiryWarning ? "text-orange-600 bg-orange-500/10" : "text-green-600 bg-green-500/10") : "text-red-600 bg-red-500/10";
            return (
              <div key={s.id} className={`surface rounded-2xl p-4 ${expiryWarning ? "ring-1 ring-orange-500/40" : ""} ${isPending ? "ring-1 ring-yellow-500/40" : ""}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{s.companyName}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{s.branchId} · {s.userPhone}</p>
                    <p className="text-[11px] text-muted-foreground">{s.userName}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-lg shrink-0 ${statusColor}`}>{statusLabel}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-muted-foreground mb-3">
                  <span>📦 {DEV_PLAN_CONFIG[s.selectedPlan]?.label || s.selectedPlan || "—"}</span>
                  <span className="font-semibold text-foreground">{s.amount ? s.amount.toLocaleString() + " so'm" : "—"}</span>
                </div>
                {s.requestedAt && <p className="text-[11px] text-muted-foreground mb-3">So'rov: {new Date(s.requestedAt).toLocaleString("uz-UZ")}</p>}
                {expiryWarning && (
                  <div className="mb-3">
                    <p className="text-[11px] text-orange-600 font-semibold mb-2">⚠️ Faqat {s.daysLeft} kun qoldi!</p>
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || s.selectedPlan || '1month'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-orange-400/40 rounded-lg px-2 py-1.5 bg-transparent">
                        {Object.entries(DEV_PLAN_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label} — {v.amount.toLocaleString()} so'm</option>
                        ))}
                      </select>
                      <button onClick={() => renewSub(s.id)} disabled={subLoading === s.id}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-orange-500 text-white disabled:opacity-60 flex items-center gap-1 shrink-0">
                        {subLoading === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"} Uzaytirish
                      </button>
                    </div>
                  </div>
                )}
                {isPending && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || 'bepul'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-green-500/40 rounded-lg px-2 py-1.5 bg-transparent">
                        {Object.entries(DEV_PLAN_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}{v.amount ? ` — ${v.amount.toLocaleString()} so'm` : ' — BEPUL'}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setRenewPlan(prev => ({ ...prev, [s.id]: prev[s.id] || 'bepul' })); approveSub(s.id); }} disabled={subLoading === s.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-1">
                        {subLoading === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "✅"} Tasdiqlash
                      </button>
                      <button onClick={() => rejectSub(s.id)} disabled={subLoading === s.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10 disabled:opacity-60 flex items-center justify-center gap-1">
                        {subLoading === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "❌"} Rad etish
                      </button>
                    </div>
                  </div>
                )}
                {(isExpired || isRejected) && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || s.selectedPlan || '1month'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-border/60 rounded-lg px-2 py-2 bg-transparent">
                        {Object.entries(DEV_PLAN_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.label} — {v.amount.toLocaleString()} so'm</option>
                        ))}
                      </select>
                      <button onClick={() => renewSub(s.id)} disabled={subLoading === s.id}
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1 shrink-0">
                        {subLoading === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "🔄"} Yangilash
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : tab === "firms" ? (
          companies.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">Firma yo'q</p> :
          companies.map(c => (
            <div key={c.id} className="surface rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                    {c.logoUrl ? <img src={c.logoUrl} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-5 h-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{c.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{c.branchId} · {c.status}</p>
                    <p className="text-[11px] text-muted-foreground truncate">Egasi: {c.owner?.name || "—"} · {c.owner?.phone || c.phone}</p>
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 text-right">{c.userCount} user<br/>{c.objectCount} obyekt</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => toggleStatus(c)} className="flex-1 text-xs font-semibold py-2 rounded-lg border border-border/60 hover:bg-muted">
                  {c.status === "SUSPENDED" ? "Faollashtirish" : "To'xtatish"}
                </button>
                <button onClick={() => deleteCompany(c)} className="flex-1 text-xs font-semibold py-2 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> O'chirish
                </button>
              </div>
            </div>
          ))
        ) : tab === "messages" ? (
          <div className="flex flex-col md:flex-row gap-0 md:gap-2 md:h-[60vh] md:min-h-[320px]">
            {/* Mobile: breadcrumb/back nav */}
            {devMobileStep !== 'firms' && (
              <div className="md:hidden flex items-center gap-2 mb-2 pb-2 border-b border-border/40">
                <button onClick={() => {
                  if (devMobileStep === 'chat') { setDevMobileStep('contacts'); }
                  else { setDevMobileStep('firms'); setSelDevFirm(null); setSelDevContact(null); setDevDMMessages([]); }
                }} className="flex items-center gap-1 text-xs text-primary font-semibold py-1.5 px-2 rounded-lg hover:bg-primary/10">
                  <ChevronLeft className="w-4 h-4"/> Orqaga
                </button>
                <span className="text-xs font-semibold text-foreground truncate">
                  {devMobileStep === 'contacts' ? selDevFirm?.name : selDevContact?.name}
                </span>
              </div>
            )}

            {/* Column 1: Firmalar */}
            <div className={`${devMobileStep === 'firms' ? 'flex' : 'hidden'} md:flex flex-col gap-1 overflow-y-auto w-full md:w-36 md:shrink-0`}>
              <p className="text-[10px] font-semibold text-muted-foreground px-1 pb-1">Firmalar</p>
              {companies.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Firma yo'q</p>}
              {companies.map((c: any) => {
                const cid = c.id || c._id;
                const isActive = selDevFirm && (selDevFirm.id || selDevFirm._id) === cid;
                return (
                  <button key={cid} onClick={() => {
                    setSelDevFirm(c); setSelDevContact(null); setDevDMMessages([]);
                    setDevMobileStep('contacts');
                  }} className={`w-full text-left px-3 py-2.5 md:py-2 rounded-xl text-xs font-semibold border border-border/40 flex items-center justify-between ${isActive?'bg-primary text-white':'surface'}`}>
                    <div className="min-w-0">
                      <p className="truncate">{c.name}</p>
                      <p className={`text-[10px] font-normal truncate ${isActive?'text-white/70':'text-muted-foreground'}`}>{c.branchId || ''}</p>
                    </div>
                    <ChevronLeft className="w-3.5 h-3.5 rotate-180 opacity-40 md:hidden flex-shrink-0 ml-1"/>
                  </button>
                );
              })}
            </div>

            {/* Column 2: Rahbarlar / O'rinbosarlar */}
            <div className={`${devMobileStep === 'contacts' ? 'flex' : 'hidden'} md:flex flex-col gap-1 overflow-y-auto w-full md:w-36 md:shrink-0`}>
              <p className="text-[10px] font-semibold text-muted-foreground px-1 pb-1">Rahbarlar</p>
              {!selDevFirm ? (
                <p className="text-xs text-muted-foreground text-center py-6">Firma tanlang</p>
              ) : (() => {
                const cid = selDevFirm.id || selDevFirm._id;
                const devContacts = users.filter((u: any) => (u.companyId === cid) && (u.role === 'direktor' || u.role === 'orinbosar'));
                if (devContacts.length === 0) return <p className="text-xs text-muted-foreground text-center py-6">Rahbar yo'q</p>;
                return devContacts.map((u: any) => {
                  const isActive = selDevContact?.id === u.id;
                  return (
                    <button key={u.id} onClick={() => {
                      setSelDevContact(u); loadDevDM(u.id);
                      setDevMobileStep('chat');
                    }} className={`w-full text-left px-3 py-2.5 md:py-2 rounded-xl text-xs font-semibold border border-border/40 flex items-center justify-between ${isActive?'bg-primary text-white':'surface'}`}>
                      <div className="min-w-0">
                        <p className="truncate">{u.name}</p>
                        <p className={`text-[10px] font-normal truncate ${isActive?'text-white/70':'text-muted-foreground'}`}>{ROLE_LABELS[u.role as Role] || u.role}</p>
                      </div>
                      <ChevronLeft className="w-3.5 h-3.5 rotate-180 opacity-40 md:hidden flex-shrink-0 ml-1"/>
                    </button>
                  );
                });
              })()}
            </div>

            {/* Column 3: DM chat */}
            <div className={`${devMobileStep === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 flex-col surface rounded-2xl overflow-hidden min-h-[60vh] md:min-h-0`}>
              {!selDevContact ? (
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Rahbar tanlang</div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 flex-shrink-0">
                    <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[12px] font-bold text-primary flex-shrink-0">
                      {selDevContact.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-none truncate">{selDevContact.name}</p>
                      <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[selDevContact.role as Role] || selDevContact.role}</p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {devDMMessages.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">Xabarlar yo'q</p>}
                    {devDMMessages.map(m => {
                      const mine = m.fromUserId === currentUser.id;
                      return (
                        <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'}`}>
                          <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs ${mine?'bg-primary text-white':'bg-muted'}`}>
                            <p className="break-words">{m.text}</p>
                            <p className={`text-[9px] mt-0.5 ${mine?'text-white/60':'text-muted-foreground'}`}>{new Date(m.timestamp).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit'})}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={devMsgBottomRef}/>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/40 flex-shrink-0">
                    <input value={devMsgText} onChange={e => setDevMsgText(e.target.value)}
                      onKeyDown={e => e.key==='Enter'&&!e.shiftKey&&sendDevMsg()}
                      placeholder="Xabar yozing..."
                      className="flex-1 text-sm md:text-xs bg-muted/50 rounded-xl px-3 py-2.5 md:py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"/>
                    <button onClick={sendDevMsg} disabled={devMsgLoading||!devMsgText.trim()}
                      className="w-10 h-10 md:w-8 md:h-8 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0">
                      {devMsgLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          users.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">Foydalanuvchi yo'q</p> :
          users.map(u => (
            <div key={u.id} className="surface rounded-2xl p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{u.name}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{u.phone}</p>
                <p className={`text-[11px] truncate ${u.companyId ? "text-muted-foreground" : "text-red-500 font-semibold"}`}>{u.companyId ? companyName(u.companyId) : "⚠️ firmasiz (eski bug qurboni)"}{u.isOwner ? " · egasi" : ""}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {u.role !== "dasturchi" && (
                  <select value={u.companyId || ""} onChange={e => assignCompany(u, e.target.value)}
                    title="Firmaga biriktirish"
                    className={`text-xs border rounded-lg px-2 py-1.5 bg-transparent max-w-[110px] ${u.companyId ? "border-border/60" : "border-red-500/50 text-red-600"}`}>
                    <option value="">— firmasiz —</option>
                    {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <select value={u.role} onChange={e => changeRole(u, e.target.value)} disabled={u.role === "dasturchi"}
                  className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                  {["direktor","orinbosar","prorab","brigadir","ishchi"].map(r => <option key={r} value={r}>{ROLE_LABELS[r as Role]}</option>)}
                  {u.role === "dasturchi" && <option value="dasturchi">Dasturchi</option>}
                </select>
                <button onClick={() => deleteUser(u)} disabled={u.id === currentUser.id}
                  className="w-9 h-9 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center disabled:opacity-30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser|null>(()=>{
    const saved = localStorage.getItem("currentUser");
    return saved ? JSON.parse(saved) : null;
  });
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
          const formattedP = pData.map(p => ({...p, id: p.id || p._id, requiredMaterials: (p.materials || []).map((m:any) => ({ id: m._id || m.id, name: m.name, quantity: m.needed, unit: m.unit, category: 'Qurilish', price: m.price }))}));
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

      // Kiruvchi qo'ng'iroq (faol qo'ng'iroq bo'lmasa)
      const onCallOffer = (d: any) => {
        if (activeCallRef.current) return; // allaqachon qo'ng'iroqda — CallOverlay mesh'ni boshqaradi
        if (d.from === liveUser.id) return;
        setActiveCall({ direction: 'in', mode: d.mode || 'voice', peerId: d.from, groupId: d.groupId, offer: d.sdp, fromName: d.fromName });
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

      // Fallback polling (socket uzilsa) — kamroq
      const intv = setInterval(() => { fetchMsgs(); fetchGroups(); }, 12000);
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
      ? <RegisterWizard onBack={()=>setAuthView("login")} onDone={(u,company)=>{setCurrentUser(u);setPage("dashboard");setAuthView("login");applyCompany(company);}}/>
      : <LoginScreen onLogin={(u,company)=>{setCurrentUser(u);setPage("dashboard");applyCompany(company);}} onRegister={()=>setAuthView("register")}/>;
  }
  // Dasturchi (super-admin) — alohida panel: barcha firmalar va foydalanuvchilar
  if (liveUser.role === "dasturchi") return <DeveloperPanel currentUser={liveUser} onLogout={()=>{setCurrentUser(null);setAuthView("login");}}/>;
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
    { key: "dashboard", label: "Bosh sahifa", icon: Home },
    ...(admin ? [
      { key: "finance" as NavPage, label: "Moliya", icon: DollarSign },
      { key: "reports" as NavPage, label: "Hisobotlar", icon: BarChart2 },
    ] : []),
    { key: "chat", label: "Xabarlar", icon: MessageCircle, badge: unreadMsgs },
    { key: "profile", label: "Profil", icon: User },
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
      <main key={`${page}:${selProject?.id || ''}`} className={`page-enter flex-1 overflow-hidden flex flex-col relative ${(page === 'chat' && chatIsOpen) ? '' : 'main-pb-safe'}`}>
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
          <ReportsPage projects={projects} expenses={expenses} users={users}/>
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
      <nav className={`ios-bottom-bar flex items-center justify-around ${page==='chat' && chatIsOpen ? 'ios-bottom-bar-hidden' : ''}`}>
        {NAV.map(n => (
          <motion.button key={n.key} onClick={() => { setPage(n.key); setSelProject(null); }}
            whileTap={{ scale: 0.86 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
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
        <CallOverlay currentUser={liveUser} users={users} call={activeCall} onClose={() => setActiveCall(null)}/>
      )}

      {/* AI Yordamchi — faqat direktor va o'rinbosar */}
      {(liveUser.role === 'direktor' || liveUser.role === 'orinbosar') && (
        <AIAssistant
          currentUser={liveUser}
          users={users}
          token={localStorage.getItem('token') || ''}
        />
      )}

      {/* Bildirishnoma toast'lari */}
      <Toaster position="top-center" richColors closeButton/>
    </div>
  );
}
