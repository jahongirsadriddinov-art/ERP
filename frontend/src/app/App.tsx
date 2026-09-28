import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Users from "@hugeicons/core-free-icons/UserMultipleIcon";
import HardHat from "@hugeicons/core-free-icons/HardHatIcon";
import Package from "@hugeicons/core-free-icons/Package01Icon";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import AlertTriangle from "@hugeicons/core-free-icons/Alert02Icon";
import ChevronRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import User from "@hugeicons/core-free-icons/UserIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import BarChart2 from "@hugeicons/core-free-icons/BarChartIcon";
import DollarSign from "@hugeicons/core-free-icons/DollarSignIcon";
import MessageCircle from "@hugeicons/core-free-icons/Message01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ChevronUp from "@hugeicons/core-free-icons/ArrowUp01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import TrendingDown from "@hugeicons/core-free-icons/TradeDownIcon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import LogOut from "@hugeicons/core-free-icons/Logout01Icon";
import Camera from "@hugeicons/core-free-icons/Camera01Icon";
import Home from "@hugeicons/core-free-icons/Home01Icon";
import UserPlus from "@hugeicons/core-free-icons/UserAdd01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Megaphone from "@hugeicons/core-free-icons/Megaphone01Icon";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Paperclip from "@hugeicons/core-free-icons/Attachment01Icon";
import Mic from "@hugeicons/core-free-icons/Mic01Icon";
import VideoIcon from "@hugeicons/core-free-icons/Video01Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import MapIcon from "@hugeicons/core-free-icons/MapIcon";
import FileText from "@hugeicons/core-free-icons/FileTextIcon";
import CornerDownLeft from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import Share2 from "@hugeicons/core-free-icons/Share01Icon";
import SquareCheck from "@hugeicons/core-free-icons/CheckmarkSquare01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import MoreHorizontal from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Upload from "@hugeicons/core-free-icons/Upload01Icon";
import Palette from "@hugeicons/core-free-icons/PaletteIcon";
import Sun from "@hugeicons/core-free-icons/Sun01Icon";
import Moon from "@hugeicons/core-free-icons/Moon02Icon";
import Monitor from "@hugeicons/core-free-icons/ComputerIcon";
import Smartphone from "@hugeicons/core-free-icons/SmartPhone01Icon";
import LogOutDevice from "@hugeicons/core-free-icons/Logout03Icon";
import PhoneOff from "@hugeicons/core-free-icons/PhoneOff01Icon";
import MicOff from "@hugeicons/core-free-icons/MicOff01Icon";
import VideoOff from "@hugeicons/core-free-icons/VideoOffIcon";
import Users2 from "@hugeicons/core-free-icons/UserGroup02Icon";
import Copy from "@hugeicons/core-free-icons/Copy01Icon";
import Bell from "@hugeicons/core-free-icons/BellIcon";
import Pin from "@hugeicons/core-free-icons/PinIcon";
import PinOff from "@hugeicons/core-free-icons/PinOffIcon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import Languages from "@hugeicons/core-free-icons/TranslateIcon";
import CreditCard from "@hugeicons/core-free-icons/CreditCardIcon";
import Calendar from "@hugeicons/core-free-icons/Calendar01Icon";
import QrCode from "@hugeicons/core-free-icons/QrCodeIcon";
import WifiOff from "@hugeicons/core-free-icons/WifiOff01Icon";
import Euro from "@hugeicons/core-free-icons/EuroIcon";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Volume2 from "@hugeicons/core-free-icons/VolumeHighIcon";
import VolumeX from "@hugeicons/core-free-icons/VolumeOffIcon";
import { MorphIcon, type IconNode } from "morphicons/react";
import { toast, Toaster } from "sonner";
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume, playSound, sfx } from "./sound";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { API_BASE, parseSmetaFile, uploadChatMedia, offlineQueueCount } from "./api";
import NotificationCenter from "./NotificationCenter";
import { AnnouncementComposer, AnnouncementContent, AnnouncementPopup, type AnnouncementData } from "./AnnouncementParts";
import { connectSocket, getSocket, disconnectSocket } from "./socket";
import { motion, AnimatePresence } from "motion/react";
import { setSiteLanguage, SiteLang, langLabel } from "./i18n";
import { isTelegramMiniApp, getTelegramInitData, markManualLogout, clearManualLogout, telegramAutoLoginAllowed } from "./telegramWebApp";
import { installAndroidBackHandler, saveOrShareBlob, openExternalUrl, isNative, isTabletOrLarger } from "./platform";
import QrLoginPanel from "./QrLoginPanel";
import { AppDownloadCards } from "./AppDownload";
import { openMediaViewer } from "./MediaViewer";
import { VoicePlayer, VideoPlayer } from "./MediaPlayers";
import { guessExpType } from "./lib/expense";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { Skeleton, SkeletonList, SkeletonPage, SkeletonMessage, SkeletonTable, SkeletonProfile } from "./Skeleton";
import { useGeoTracker, accuracyQuality, QUALITY_COLOR, type GpsStatus } from "./useGeoTracker";
import PullToRefresh from "./PullToRefresh";
import { isPinSet, useAppLock, markActiveNow, clearPin, PinSetupScreen, PinLockScreen, ChangePinModal, ForgotPinScreen, syncPinFromServer, isBiometricEnabled, setBiometricEnabled, biometricAvailable, biometricSupported, tryBiometricUnlock, nativeBiometricSupported, registerWebAuthnBiometric, getLockTimeoutMin, setLockTimeoutMin, LOCK_TIMEOUT_OPTIONS } from "./AppLock";

// recharts og'ir kutubxona — faqat "Hisobotlar" bo'limiga kirilganda yuklanadi
// (boshlang'ich bundle hajmini kamaytiradi, sayt tezroq ochiladi).
const ReportsPage = lazy(() => import("./ReportsPage"));
// Kamdan-kam ishlatiladigan (rol/hodisaga bog'liq) og'ir sahifalar — faqat
// chindan kerak bo'lganda yuklanadi (unused JS ni kamaytiradi).
const CallOverlay = lazy(() => import("./CallOverlay"));
const RegisterWizard = lazy(() => import("./RegisterWizard"));
const DeveloperPanel = lazy(() => import("./DeveloperPanel"));
const AIAssistant = lazy(() => import("./AIAssistant"));
const QRScanner = lazy(() => import("./QRScanner"));
const LandingPage = lazy(() => import("./LandingPage"));
const LocationPicker = lazy(() => import("./LocationPicker"));
const ESignDocs = lazy(() => import("./ESignDocs"));
const ChatPage = lazy(() => import("./ChatPage"));
const ProfilePage = lazy(() => import("./ProfilePage"));
const QRGenerator = lazy(() => import("./QRGenerator"));
const GpsTrackingPage = lazy(() => import("./GpsTrackingPage"));
import type { LandingFocus } from "./LandingPage";

// SEO: har bir marketing bo'limining O'Z (indekslanadigan) manzili —
// LandingPage.tsx'dagi FOCUS_PATH bilan BIR XIL bo'lishi SHART (u yerdagi
// canonical shu yo'llarga ishora qiladi). Aniq talab: "harbitta yolga
// alohida /... hamma bo'limga shunaqa qilib chiq".
const SECTION_PATH_TO_FOCUS: Record<string, LandingFocus> = {
  "/xususiyatlar": "features",
  "/qanday-ishlaydi": "steps",
  "/kimlar-uchun": "audience",
  "/savollar": "faq",
};

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
// AIAssistant kabi modallar uchun — ular endi chat tarixini saqlab qolish
// uchun DOIM montaj qilingan holda qoladi (faqat `open` prop orqali
// ko'rsatiladi/yashiriladi), shu sabab oddiy `useModalPresence()` (faqat
// mount/unmount'da hisoblaydigan) ishlatilsa, hisoblagich BIR MARTA
// ko'tarilib qolib, komponent hech qachon unmount bo'lmagani uchun
// pastki navbar foydalanuvchi AI oynasini yopgandan keyin ham ABADIY
// yashirin qolib ketardi (aynan shu sabab "navigation bar umuman
// ko'rinmayapti" xatosi). Bu variant hisoblagichni `open`ning o'ziga
// bog'laydi — modal HAQIQATDA ochiq bo'lgandagina hisoblanadi.
export function useModalPresenceWhen(active: boolean) {
  useEffect(() => {
    if (!active) return;
    openModalCount++; notifyModalListeners();
    return () => { openModalCount--; notifyModalListeners(); };
  }, [active]);
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type Role = "direktor" | "orinbosar" | "prorab" | "brigadir" | "ishchi" | "dasturchi";
type NavPage = "dashboard" | "finance" | "reports" | "chat" | "profile" | "gps";
export type ExpType = "oylik" | "material" | "jihozlar" | "transport" | "boshqa";
type TStatus = "pending" | "confirmed" | "rejected";
type EStatus = "pending" | "confirmed" | "rejected";

export interface AppUser {
  id: string; name: string; role: Role; phone: string;
  avatar?: string; brigade?: string; projectIds: string[];
  isOwner?: boolean; companyId?: string; language?: SiteLang;
  baseSalary?: number; // ish haqi hisob-kitobi uchun oylik/kunlik stavka
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
export interface Transfer {
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
  requiresAdminApproval?: boolean;
  approvalHistory?: Array<{ userId: string; name: string; role: string; action: 'approved'|'rejected'; date: string; note?: string }>;
  // Xodim chiqim yaratganda ANIQ kim tasdiqlashini tanlaydi (direktor/orinbosarlardan
  // biri) — belgilansa, FAQAT o'sha odam tasdiqlay/rad eta oladi.
  approverId?: string;
  recipientName?: string; objectLabel?: string; source?: 'site' | 'bot';
  currency?: 'UZS' | 'USD' | 'EUR'; originalAmount?: number; // aytilgan valyuta (amount — doim so'mda)
  anomaly?: boolean; // odatdagidan ancha katta chiqim (server belgilaydi) // botdan: aytilgan "kimga"/obyekt
}
export interface Msg {
  id: string; fromUserId: string; toUserId: string; groupId?: string;
  text: string; timestamp: string; read: boolean;
  type?: 'text'|'image'|'video'|'file'|'audio'|'location'|'video_invite'|'video_event';
  videoEvent?: { kind: 'started'|'ended'; durationSec?: number; by?: string }; // guruhdagi tizim xabari
  mediaUrl?: string; fileName?: string; fileSize?: number;
  location?: { lat: number; lng: number };
  videoChatGroupId?: string; // 'video_invite' xabari — qaysi guruhning video chatiga taklif
  replyToId?: string; edited?: boolean; pinned?: boolean; deleted?: boolean;
  // Optimistik yuborish holati — faqat lokal, serverga hech qachon
  // yuborilmaydi/saqlanmaydi. Yo'q (undefined) === serverdan kelgan/
  // tasdiqlangan xabar. "sending" — hali serverga POST qilinmoqda,
  // "failed" — yuborilmadi, qayta urinish (retry) ko'rsatiladi.
  status?: 'sending' | 'failed';
}
// Telegram-ga o'xshash "guruh video chat" — hech kim chaqirilmaydi,
// istalgan a'zo istalgan vaqt qo'shilishi/chiqishi mumkin (App.tsx'dagi
// videochat:* socket hodisalariga qarang).
export interface ActiveVideoChat {
  startedBy: string; startedByName: string; startedAt: string;
  mode: 'voice'|'video'; participantIds: string[];
}
export interface Group {
  id: string; name: string; avatar?: string;
  memberIds: string[]; adminIds: string[]; createdBy: string;
  devSupport?: boolean;
  activeVideoChat?: ActiveVideoChat;
}
export interface ActiveCall {
  direction: 'out'|'in';
  mode: 'voice'|'video';
  peerId?: string;       // 1:1 (yoki incoming'da chaqiruvchi)
  groupId?: string;      // guruh qo'ng'irog'i
  memberIds?: string[];  // guruhda chaqiriladigan a'zolar
  offer?: any;           // incoming SDP offer
  fromName?: string;
  // Telegram-ga o'xshash guruh video chat belgisi — true bo'lsa, CallOverlay
  // hech kimni "chaqirmaydi" (memberIds bo'sh), o'rniga videochat:start/join
  // hodisalarini yuboradi; faqat startedBy === joriy user bo'lsa "hammaga
  // yakunlash" tugmasi ko'rinadi.
  videoChat?: boolean;
  startedBy?: string;
  startedByName?: string;
  groupName?: string;        // taklif xabari matni uchun
  groupMemberIds?: string[]; // taklif qilish uchun a'zolar ro'yxati (memberIds — ringing uchun — bo'sh qoldiriladi)
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

// XATO TUZATILDI (2-marta — "pastga tushirsam yon tomonga surilib
// qolyapti, avtomatik boshqa tomonga o'tmayapti"): oldingi urinish
// HAR QANDAY vertikal g'ildirak aylantirishni gorizontalga aylantirib
// yuborgan edi — natijada jadval ustida oddiy pastga-tepaga scroll
// QILISH BUTUNLAY ishlamay qoldi (aynan foydalanuvchi tasvirlagan xato).
// TO'G'RI yechim: ODDIY g'ildirak — HECH NARSA o'zgarmaydi (brauzerning
// o'z tabiiy vertikal scrolli ishlaydi, tashqi konteynerga o'tadi).
// Faqat Shift bosib turilganda gorizontalga aylanadi (standart brauzer
// konvensiyasi) — pastdagi scrollbar (endi ko'rinadigan, scrollbar-hide
// OLIB TASHLANGAN) esa sichqoncha bilan sudrab ko'rish uchun asosiy,
// Shift bilishni talab qilmaydigan usul.
function hwheel(e: React.WheelEvent<HTMLDivElement>) {
  if (!e.shiftKey) return; // oddiy aylantirish — vertikal, hech narsa qilinmaydi
  const el = e.currentTarget;
  if (el.scrollWidth > el.clientWidth) {
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}

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
// Standart (o'zbekcha) rol nomlari — fallback sifatida va `t` mavjud
// bo'lmagan joylarda ishlatiladi. Haqiqiy ko'rsatiladigan matn uchun
// `roleLabel(t, role)` chaqirilishi kerak (quyida) — shu orqali rol
// nomi Rossiyacha interfeys tilida ham to'g'ri tarjima qilinadi.
export const ROLE_LABELS: Record<Role, string> = {
  direktor: "Direktor", orinbosar: "O'rinbosar",
  prorab: "Prorab", brigadir: "Brigadir", ishchi: "Ishchi", dasturchi: "Dasturchi"
};
// i18n — rol nomini joriy tilga mos tarjima qilib qaytaradi.
export function roleLabel(t: (key: string) => string, role: Role): string {
  return t(`common.roles.${role}`) || ROLE_LABELS[role];
}
const ROLE_COLORS: Record<Role, string> = {
  direktor: "bg-red-500/15 text-red-700 dark:text-red-300",
  orinbosar: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  prorab: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  brigadir: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  ishchi: "bg-green-500/15 text-green-800 dark:text-green-300",
  dasturchi: "bg-slate-800/15 text-slate-700 dark:text-slate-200"
};
// Standart (o'zbekcha) chiqim turi nomlari — fallback sifatida. Haqiqiy
// ko'rsatiladigan matn uchun `expLabel(t, type)` chaqiriladi (roleLabel
// bilan bir xil pattern).
export const EXP_LABELS: Record<ExpType, string> = {
  oylik: "Oylik", material: "Material",
  jihozlar: "Jihozlar", transport: "Transport", boshqa: "Boshqa"
};
export function expLabel(t: (key: string) => string, type: ExpType): string {
  // Noma'lum tur (masalan eski bot yozuvlari: 'expense') xom kalit matni bo'lib chiqmasin.
  const v = t(`finance.types.${type}`);
  return v && !v.startsWith('finance.types.') ? v : (EXP_LABELS[type] || EXP_LABELS.boshqa);
}

// Chat — sidebar/last-message preview label uchun (audio/rasm/video/joylashuv/
// fayl turlarini qisqa matnga aylantiradi; oddiy matn xabarlar uchun shunchaki
// o'z matnini qaytaradi). Bir xil mantiq avval 3 joyda (kontaktlar, guruhlar,
// dev-support ro'yxati) alohida-alohida takrorlangan edi.
export function msgTypePreview(t: (key: string, opts?: any) => string, m: { type?: string; text?: string; fileName?: string } | null | undefined): string {
  if (!m) return '';
  if (!m.type || m.type === 'text') return m.text || '';
  if (m.type === 'audio') return t('chat.voicePreview');
  if (m.type === 'image') return t('chat.photo');
  if (m.type === 'video') return t('chat.video');
  if (m.type === 'location') return t('chat.locationPreview');
  return `📎 ${m.fileName || t('chat.fileLabel')}`;
}

// Chat — javob-berish (reply) va pin'langan xabar oldindan ko'rish uchun.
// Video/fayl turlari uchun maxsus yorliq YO'Q (asl ternar shunday edi) —
// ular o'z saqlangan matnini (allaqachon o'zi label bo'lgan) ko'rsatadi.
export function msgReplyPreview(t: (key: string, opts?: any) => string, m: { type?: string; text?: string } | null | undefined): string {
  if (!m) return '';
  if (m.type === 'audio') return t('chat.voicePreview');
  if (m.type === 'image') return t('chat.photo');
  if (m.type === 'location') return t('chat.locationPreview');
  return m.text || '';
}
export const CHART_COLORS = ["#1B3A6B", "#D2440F", "#1B7A4B", "#F0A500", "#7B2D8B"];
export const fmt = (n?: number) => (n || 0).toLocaleString("uz-UZ") + " so'm";

// Ishlagan vaqtni "X soat Y daqiqa" ko'rinishida, ANIQ ko'rsatadi — saqlangan
// workHours (0.1 soatgacha yaxlitlangan, masalan 5 daqiqa "0.1 soat" bo'lib
// chiqadi — noaniq/chalkash) o'rniga to'g'ridan-to'g'ri checkIn/checkOut
// vaqt tamg'alaridan hisoblanadi, hech narsa yo'qolmaydi.
// `tt` ixtiyoriy — berilmasa (eski chaqiruvlar bilan moslik uchun)
// standart o'zbekcha matn qaytariladi, berilsa joriy tilga tarjima qilinadi.
export const fmtWorkDuration = (checkIn?: string | null, checkOut?: string | null, tt?: (key: string, opts?: any) => string): string => {
  if (!checkIn || !checkOut) return "";
  const minutes = Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000));
  if (minutes < 60) return tt ? tt('gps.minutesShort', { min: minutes }) : `${minutes} daqiqa`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (tt) return m === 0 ? tt('gps.hoursShort', { h }) : tt('gps.hoursMinutesShort', { h, m });
  return m === 0 ? `${h} soat` : `${h} soat ${m} daqiqa`;
};

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
  // XATO TUZATILDI ("chiqim tafsilotini yuklaganda... formati noto'g'ir"):
  // BOM + ";" ajratkich o'zi YETARLI emas edi — Excel qaysi belgini
  // ajratkich deb hisoblashni FOYDALANUVCHI KOMPYUTERINING til/mintaqa
  // sozlamasidan (Windows Control Panel) o'qiydi, fayl ICHIDAGI belgidan
  // emas. Agar u boshqa (masalan ",") bo'lsa, butun qator BITTA katakka
  // ("A1"da hammasi qatorlab) tushib qolardi — aynan shu holat sodir
  // bo'lgan. "sep=;" — Excel tomonidan rasman qo'llab-quvvatlanadigan
  // maxsus BIRINCHI QATOR ko'rsatmasi, mintaqa sozlamasidan qat'i nazar
  // ";"ni MAJBURIY ajratkich sifatida ishlatishga majburlaydi.
  const blob = new Blob(["﻿sep=;\r\n" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  // saveOrShareBlob: Android APK'da <a download> ISHLAMAYDI (WebView'da
  // Downloads integratsiyasi yo'q — hech qanday xato ham chiqmasdi, shu
  // sabab "hisobotni yuklab bo'lmayapti" edi). Web/exe'da eski usul saqlanadi.
  saveOrShareBlob(filename, blob).then(r => { if (!r.ok) toast.error("Fayl saqlanmadi"); });
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
export const isAdmin = (r: Role) => r === "direktor" || r === "orinbosar";
export const isPlatformAdmin = (r: Role) => r === "dasturchi";

// "Ishga keldim" uchun joylashuv — aniq talab: oddiy bir martalik snapshot
// EMAS, botdagi "jonli joylashuv" talabiga yaqinroq bo'lsin. Brauzerda
// haqiqiy kriptografik tasdiqlash imkoni yo'q (dev-tools joylashuvni har
// doim qalbakilashtira oladi) — lekin watchPosition orqali BIR NECHA
// ketma-ket o'qishni talab qilish (bitta statik getCurrentPosition() chaqirig'i
// o'rniga) hech bo'lmasa eng oddiy soxtalashtirishning (bir marta qo'lda
// kiritilgan koordinata) oldini oladi va haqiqiy GPS qulfini (fix) tasdiqlaydi.
// Qattiq bloklamaslik uchun: agar timeoutgacha faqat 1 ta o'qish kelsa ham,
// o'shani ishlatamiz (signal zaif joylarda ishlashni to'xtatmasin).
function getLivePosition(timeoutMs = 8000, minSamples = 2): Promise<{ pos: GeolocationPosition | null; denied: boolean }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({ pos: null, denied: false }); return; }
    const samples: GeolocationPosition[] = [];
    let watchId: number | null = null;
    let done = false;
    // XATO TUZATILDI ("aniqlikni yahshiroq olsin"): avval to'plangan
    // namunalardan shunchaki OXIRGISI ishlatilardi — lekin GPS o'qishlari
    // ketma-ket kelaverishi shart emas ANIQROQ bo'lib boraveradi; ba'zan
    // 1-o'qish 2-dan aniqroq chiqadi. Endi ENG AMIQ (coords.accuracy eng
    // kichik) namuna tanlanadi, "oxirgi kelgani" emas.
    const best = () => samples.length
      ? samples.reduce((a, b) => (b.coords.accuracy ?? Infinity) < (a.coords.accuracy ?? Infinity) ? b : a)
      : null;
    const finish = (pos: GeolocationPosition | null, denied = false) => {
      if (done) return;
      done = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      resolve({ pos, denied });
    };
    const timer = setTimeout(() => finish(best()), timeoutMs);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        samples.push(pos);
        if (samples.length >= minSamples) { clearTimeout(timer); finish(best()); }
      },
      (err) => { clearTimeout(timer); finish(best(), err.code === 1 && samples.length === 0); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs }
    );
  });
}
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

// index.html'dagi boshlang'ich loader bilan AYNAN bir xil — yuklanish bitta uzluksiz loader bo'lib ko'rinadi
// Yangi "shisha" (shaffof, blur) bildirishnoma dizayni — eski richColors (to'q yashil/qizil
// to'rtburchak) o'rniga. Ko'rinishi globals.css'dagi .erp-toast bloki orqali.
export const AppToaster = () => (
  <Toaster position="top-center" closeButton gap={10} visibleToasts={4} offset={14}
    toastOptions={{ className: "erp-toast", duration: 3800 }} />
);
export const BootLoader = () => <div className="boot-loader"><div className="logo-wrap"><div className="spinner" /></div></div>;

// ─── Small Components ─────────────────────────────────────────────────────────
// Rasm yuklanmasa (fayl o'chgan/tarmoq xatosi) — "singan rasm" belgisi o'rniga tartibli belgi.
export function SafeImg({ src, alt, className, onClick, fallbackClassName }: { src: string; alt?: string; className?: string; onClick?: () => void; fallbackClassName?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  if (bad) return (
    <div className={`${fallbackClassName || 'w-full h-full'} flex items-center justify-center bg-muted/40 text-muted-foreground border border-dashed border-border rounded-xl`} title={alt}>
      <MorphIcon icon={ImageIcon} className="w-6 h-6 opacity-50" />
    </div>
  );
  return <img src={src} alt={alt || ""} decoding="async" className={className} onClick={onClick} onError={() => setBad(true)} />;
}
export function CompanyLogo({ src, imgClass, iconClass }: { src?: string; imgClass: string; iconClass: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  return src && !bad
    ? <img src={src} alt="Logo" className={imgClass} onError={() => setBad(true)} />
    : <MorphIcon icon={Building2} className={iconClass} />;
}

export function Avatar({ user, size = "md" }: { user: AppUser; size?: "sm"|"md"|"lg" }) {
  const sz = { sm: "w-7 h-7 text-sm md:text-xs", md: "w-9 h-9 text-sm md:text-xs", lg: "w-16 h-16 text-xl" }[size];
  const [avatarBad, setAvatarBad] = useState(false);
  useEffect(() => { setAvatarBad(false); }, [user.avatar]);
  if (user.avatar && !avatarBad) return <img src={user.avatar} alt={user.name} className={`${sz} rounded-full object-cover flex-shrink-0`} onError={() => setAvatarBad(true)}/>;
  const initials = user.name.split(" ").map(w => w[0]).slice(0,2).join("");
  return (
    <div className={`${sz} rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary dark:text-white flex-shrink-0 select-none`}>
      {initials}
    </div>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation();
  return <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${ROLE_COLORS[role]}`}>{roleLabel(t, role)}</span>;
}

// ─── Notification Bell (liquid-glass dropdown, real data) ─────────────────────
export function fmtVideoDuration(sec: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ─── Add User Modal ────────────────────────────────────────────────────────────
function AddUserModal({ currentUser, users, projects, onClose, onAdd }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; onClose: () => void; onAdd: (u: AppUser) => Promise<{ ok: boolean; error?: string }> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "", phone: "+998 ", role: "ishchi" as Role,
    brigade: currentUser.brigade ?? "", newBrigade: "", projectIds: [] as string[],
    baseSalary: "",
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
      projectIds: form.projectIds,
      baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined,
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
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={UserPlus} className="w-4 h-4 text-primary" />{t('addUser.title')}</h3>
          <button aria-label={t('common.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2"><MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0" />{err}</div>}
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.nameLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={t('addUser.namePlaceholder')} value={form.name} onChange={e => { setErr(""); setForm({...form, name: e.target.value}); }} required/>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.phoneLabel')}</label>
            <input inputMode="tel" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              value={form.phone} onChange={e => {
                setErr("");
                const val = e.target.value;
                if (val.startsWith("+998 ")) setForm({...form, phone: "+998 " + val.slice(5).replace(/\D/g, "").slice(0, 9)});
                else if (val === "+998" || val === "") setForm({...form, phone: "+998 "});
              }} required/>
            <p className="text-sm md:text-xs text-muted-foreground mt-1">{t('addUser.smsHint')}</p>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.positionLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {allowedRoles.map(r => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
            </select>
          </div>
          {isAdmin(currentUser.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.baseSalaryLabel')}</label>
              <input type="number" min="0" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={t('addUser.baseSalaryPlaceholder') as string} value={form.baseSalary} onChange={e => setForm({...form, baseSalary: e.target.value})}/>
            </div>
          )}
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
              {submitting && <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" />}{t('common.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Manzil kiritish — yozayotganda takliflar (OpenStreetMap Nominatim orqali,
// backend proksi qiladi) va "joriy joylashuvni aniqlash" (GPS + teskari
// geokodlash) tugmasi bilan. Obyekt qo'shish VA tahrirlash — ikkalasida
// ham ishlatiladi.
function LocationInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<{ label: string; lat?: number; lng?: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  // Tanlangan takliflar/GPS koordinatasi — xarita aynan shu joyni ko'rsatishi uchun
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [pickLoading, setPickLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const authHeader = () => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  };

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/geocode/search?q=${encodeURIComponent(q)}`, { headers: authHeader() });
        if (res.ok) { const data = await res.json(); setSuggestions(data); setOpen(data.length > 0); }
      } catch {}
    }, 220);
  };

  const detectLocation = () => {
    if (!navigator.geolocation) { toast.error(t('addObject.geoUnsupported')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const res = await fetch(`${API_BASE}/api/geocode/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`, { headers: authHeader() });
        if (res.ok) { const data = await res.json(); onChange(data.label); setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); }
        else toast.error(t('addObject.geoFailed'));
      } catch { toast.error(t('addObject.geoFailed')); }
      setLocating(false);
    }, () => { toast.error(t('addObject.geoDenied')); setLocating(false); }, { enableHighAccuracy: true, timeout: 10000 });
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex gap-1.5">
        <input
          className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); setCoords(null); search(e.target.value); }}
          onFocus={() => { if (suggestions.length) setOpen(true); }}
        />
        <button type="button" onClick={detectLocation} disabled={locating}
          title={t('addObject.useCurrentLocation')} aria-label={t('addObject.useCurrentLocation')}
          className="flex-shrink-0 w-9 flex items-center justify-center border border-border rounded bg-input-background hover:bg-muted liquid-transition disabled:opacity-50">
          {locating ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={MapPin} className="w-3.5 h-3.5 text-primary" />}
        </button>
        <button type="button" onClick={async () => {
            setMapOpen(true);
            if (coords) { setPicked({ ...coords, label: value }); return; }
            setPicked(null);
            // Koordinata yo'q (faqat matn yozilgan) — yozilgan manzilning o'rnini topib, xaritani shu joyga olib boramiz
            if (value.trim().length >= 2) {
              try {
                const res = await fetch(`${API_BASE}/api/geocode/search?q=${encodeURIComponent(value.trim())}`, { headers: authHeader() });
                const hits = res.ok ? await res.json() : [];
                if (hits[0]?.lat != null) { setCoords({ lat: hits[0].lat, lng: hits[0].lng }); setPicked({ lat: hits[0].lat, lng: hits[0].lng, label: value }); }
              } catch {}
            }
          }}
          title={t('addObject.pickOnMap')} aria-label={t('addObject.pickOnMap')}
          className="flex-shrink-0 w-9 flex items-center justify-center border border-border rounded bg-input-background hover:bg-muted liquid-transition">
          <MorphIcon icon={MapIcon} className="w-3.5 h-3.5 text-primary" />
        </button>
      </div>
      {mapOpen && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={() => setMapOpen(false)}>
          <div className="bg-card border border-border rounded-2xl w-full max-w-2xl p-3 space-y-2 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">{t('addObject.pickOnMap')}</p>
              <button type="button" onClick={() => setMapOpen(false)} aria-label={t('common.cancel')} className="p-1 text-muted-foreground hover:text-foreground"><MorphIcon icon={X} className="w-4 h-4" /></button>
            </div>
            <Suspense fallback={<div className="w-full h-[55vh] rounded-xl border border-border bg-muted/40 flex items-center justify-center"><MorphIcon icon={Loader2} className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
              <LocationPicker height={typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.55) : 360} value={picked ? { lat: picked.lat, lng: picked.lng } : null}
                onPick={async (lat, lng) => {
                  setPicked({ lat, lng, label: '' }); setPickLoading(true);
                  let label = '';
                  try {
                    const res = await fetch(`${API_BASE}/api/geocode/reverse?lat=${lat}&lng=${lng}`, { headers: authHeader() });
                    if (res.ok) label = String((await res.json()).label || '');
                  } catch {}
                  setPicked({ lat, lng, label: label || `${lat.toFixed(5)}, ${lng.toFixed(5)}` }); setCoords({ lat, lng }); setPickLoading(false);
                }} />
            </Suspense>
            <p className="text-xs text-muted-foreground min-h-[1rem] truncate">{pickLoading ? '…' : picked?.label || t('addObject.mapHint')}</p>
            <button type="button" disabled={!picked || pickLoading} onClick={() => { if (picked) { onChange(picked.label); setMapOpen(false); } }}
              className="w-full btn btn-primary py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">{t('addObject.confirmPlace')}</button>
          </div>
        </div>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto scrollbar-hide">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onClick={() => { onChange(s.label); setCoords(s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null); setOpen(false); setSuggestions([]); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted liquid-transition border-b border-border/30 last:border-0">
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Add Object Modal ────────────────────────────────────────────────────────
function AddObjectModal({ users, onClose, onAdd }:
  { users: AppUser[]; onClose: () => void; onAdd: (p: Project) => void }) {
  const { t } = useTranslation();
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
        setSmetaMsg(t('addObject.smetaAnalyzing'));
        try {
          smetaResult = await parseSmetaFile(smeta, obj.id || obj._id);
          finalMats = smetaResult!.resources.filter(r => r.group === 'material');
          finalBudget = smetaResult!.meta?.totalWithoutVat ?? finalBudget;
        } catch (e) {
          // Obyekt yaratildi, lekin smeta o'qilmadi — ogohlantirib davom etamiz
          setSmetaMsg((e as Error).message || t('addObject.smetaParseFailed'));
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
      toast.error(t('addObject.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Package} className="w-4 h-4 text-accent" />{t('addObject.title')}</h3>
          <button aria-label={t('addObject.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.nameLabel')}</label><input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder={t('addObject.namePlaceholder')} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.locationLabel')}</label><LocationInput placeholder={t('addObject.locationPlaceholder')} value={form.location} onChange={v=>setForm({...form,location:v})}/></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.budgetLabel')}</label><input type="number" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder="50000000" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.foremanLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" value={form.foremanId} onChange={e=>setForm({...form,foremanId:e.target.value})}>
              <option value="">{t('addObject.selectPlaceholder')}</option>
              {users.filter(u=>u.role==="prorab").map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.smetaLabel')}</label>
            <input type="file" accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.txt" className="w-full text-sm md:text-xs border border-border rounded px-3 py-1.5 bg-input-background file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm md:text-xs file:bg-primary file:text-white hover:file:bg-primary/90" onChange={e=>setSmeta(e.target.files?.[0]||null)}/>
            {loading && smeta && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><MorphIcon icon={Loader2} className="w-3 h-3 animate-spin" />{smetaMsg || t('addObject.smetaLoading')}</div>
                {smetaPercent > 0 && <div className="w-full bg-muted rounded-full h-1 mt-1"><div className="bg-accent h-1 rounded-full liquid-transition" style={{width:`${smetaPercent}%`}}/></div>}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted">{t('addObject.cancel')}</button><button type="submit" disabled={loading} className="flex-1 text-sm md:text-xs bg-accent text-white rounded px-3 py-2 font-semibold hover:bg-accent/90">{loading?t('addObject.smetaLoading'):t('addObject.submit')}</button></div>
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
  // Direktor/o'rinbosar odatda hech bir obyektga "biriktirilmagan" bo'ladi
  // (projectIds bo'sh) — avval ishchi/prorab/brigadir uchun "Kimga" ro'yxatida
  // ular umuman chiqmasdi va bu xodimlar material yubora olmasdi. Endi
  // rahbarlar HAR DOIM tanlash mumkin; qolganlar esa shu obyektga biriktirilgan bo'lsa.
  const targets = allUsers.filter(u => u.id !== currentUser.id && (isAdmin(currentUser.role) || isAdmin(u.role) || (u.projectIds || []).some(pid => pid === projectId)));

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
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Send} className="w-4 h-4 text-primary" />{t('sendTransfer.title')}</h3>
          <button aria-label={t('sendTransfer.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
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
                        <MorphIcon icon={CheckCircle} className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{sel.name}</span>
                        <span className="chip bg-muted text-muted-foreground">{sel.unit || "—"}</span>
                        <button type="button" onClick={() => setSelMats(prev => prev.filter(s => s.name !== sel.name))}
                          className="btn btn-ghost w-6 h-6 p-0 rounded-lg text-muted-foreground"><MorphIcon icon={X} className="w-3.5 h-3.5" /></button>
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
                    <MorphIcon icon={Search} className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                          <MorphIcon icon={Plus} className="w-4 h-4 text-primary flex-shrink-0" />
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
                              <MorphIcon icon={X} className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setCustomMats([...customMats, { name: "", unit: "", quantity: "1", price: "" }])}
                        className="text-xs text-primary font-semibold flex items-center gap-1 mt-2 hover:underline">
                        <MorphIcon icon={Plus} className="w-3 h-3" /> {t('sendTransfer.addMore')}
                      </button>
                    </div>
                  )}
                </div>
              {selMats.length > 0 || customMats.some(m => m.name.trim()) ? (
                <p className="mt-1.5 text-[10px] text-primary font-semibold flex items-center gap-1">
                  <MorphIcon icon={CheckCircle} className="w-3 h-3" />{t('sendTransfer.materialsSelected', { count: selMats.length + customMats.filter(m => m.name.trim()).length })}
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
              {targets.map(u => <option key={u.id} value={u.id}>{u.name} — {roleLabel(t, u.role)}</option>)}
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
  const [form, setForm] = useState({ type: "oylik" as ExpType, amount: "", projectId: projects[0]?.id || "", description: "", toUserId: "", approverId: "", date: new Date().toISOString().split("T")[0] });
  const [err, setErr] = useState("");
  const [boshqaRows, setBoshqaRows] = useState<{ name: string; price: string }[]>([{ name: "", price: "" }]);

  const boshqaTotal = boshqaRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  // Admin (direktor/orinbosar) o'zi chiqim yaratsa — tasdiqlash shart emas
  // (backendda ham xuddi shu qoida: creator direktor/orinbosar bo'lsa
  // requiresAdminApproval qo'yilmaydi). Boshqa har qanday rol — kim
  // tasdiqlashini ANIQ tanlashi SHART.
  const needsApprover = !isAdmin(currentUser.role);
  const approverOptions = allUsers.filter(u => (u.role === 'direktor' || u.role === 'orinbosar') && u.id !== currentUser.id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (needsApprover && !form.approverId) { setErr(t('addExpense.errApproverRequired')); return; }

    if (form.type === "boshqa") {
      const valid = boshqaRows.filter(r => r.name.trim() && r.price);
      if (valid.length === 0) { setErr(t('addExpense.errNeedMaterial')); return; }
      onAdd({
        id: `e${Date.now()}`,
        type: "boshqa",
        amount: boshqaTotal,
        toUserId: form.toUserId || undefined,
        approverId: needsApprover ? form.approverId : undefined,
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
      approverId: needsApprover ? form.approverId : undefined,
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
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={TrendingDown} className="w-4 h-4 text-accent" />{t('addExpense.title')}</h3>
          <button aria-label={t('addExpense.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {err && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
              <MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0" />{err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.typeLabel')}</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.type} onChange={e => { setErr(""); setForm({...form, type: e.target.value as ExpType, toUserId: "", description: ""}); }}>
                {(Object.keys(EXP_LABELS) as ExpType[]).map(k => <option key={k} value={k}>{expLabel(t, k)}</option>)}
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
                        <MorphIcon icon={X} className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setBoshqaRows(r => [...r, { name: "", price: "" }])}
                className="mt-2.5 flex items-center gap-1.5 text-sm text-primary hover:bg-primary/5 px-2.5 py-1.5 rounded-lg liquid-transition font-semibold">
                <MorphIcon icon={Plus} className="w-3.5 h-3.5" />{t('addExpense.addRow')}
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
                {(() => {
                  const g = guessExpType(form.description);
                  return g && g !== form.type && g !== "boshqa" ? (
                    <button type="button" onClick={() => setForm({ ...form, type: g })}
                      className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/15">
                      🤖 {t('addExpense.aiSuggest', { defaultValue: "Tavsif bo'yicha tur" })}: <b>{expLabel(t, g)}</b> — {t('addExpense.apply', { defaultValue: "qo'llash" })}
                    </button>
                  ) : null;
                })()}
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
              {allUsers.filter(u => u.id !== currentUser.id).map(u => <option key={u.id} value={u.id}>{u.name} ({roleLabel(t, u.role)})</option>)}
            </select>
          </div>

          {needsApprover && (
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
                {t('addExpense.approverLabel')} <span className="text-accent normal-case">*</span>
              </label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.approverId} onChange={e => { setErr(""); setForm({...form, approverId: e.target.value}); }} required>
                <option value="">{t('addExpense.approverPlaceholder')}</option>
                {approverOptions.map(u => <option key={u.id} value={u.id}>{u.name} ({roleLabel(t, u.role)})</option>)}
              </select>
              {approverOptions.length === 0 && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">{t('addExpense.noApprovers')}</p>
              )}
            </div>
          )}

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
  // MUHIM: shu komponentdagi `t` allaqachon Transfer obyekti (parametr nomi
  // o'zgartirilmadi — hamma joyda `t.xxx` sifatida ishlatiladi), shu sabab
  // tarjima funksiyasi shu bilan TO'QNASHMASLIGI uchun `tt` deb nomlandi.
  const { t: tt } = useTranslation();
  const [defect, setDefect] = useState("");
  const from = allUsers.find(u => u.id === t.fromUserId);
  const to = allUsers.find(u => u.id === t.toUserId);
  const proj = projects.find(p => p.id === t.projectId);
  const isSender = t.fromUserId === currentUser.id;
  const isReceiver = t.toUserId === currentUser.id;
  const canConfirm = isReceiver && t.status === "pending";

  const statusBadge = {
    pending: <span className="text-[9px] bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><MorphIcon icon={Clock} className="w-2.5 h-2.5" />{tt('dashboard.transferPending')}</span>,
    confirmed: <span className="text-[9px] bg-green-500/15 text-green-800 dark:text-green-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><MorphIcon icon={CheckCircle} className="w-2.5 h-2.5" />{tt('dashboard.transferConfirmed')}</span>,
    rejected: <span className="text-[9px] bg-red-500/15 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap"><MorphIcon icon={X} className="w-2.5 h-2.5" />{tt('dashboard.transferRejected')}</span>,
  }[t.status];

  return (
    <div className={`border rounded-xl p-3 text-sm md:text-xs space-y-2 shadow-sm liquid-transition ${t.status === "confirmed" ? "border-green-500/25 bg-green-500/8" : t.status === "rejected" ? "border-red-500/25 bg-red-500/8" : "border-amber-500/25 bg-amber-500/8"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">{t.materialName}</p>
          <p className="text-muted-foreground font-mono text-sm md:text-xs">
            {t.quantity.toLocaleString()} {t.unit}
            {!!t.price && <span className="ml-1.5 text-primary font-semibold">· {(t.price * t.quantity).toLocaleString()} {tt('common.som')}</span>}
          </p>
          <p className="text-sm md:text-xs text-muted-foreground mt-0.5">
            {isSender ? <><span className="text-foreground font-medium">{tt('dashboard.youLabel')}</span> → {to?.name}</> : <>{from?.name} → <span className="text-foreground font-medium">{tt('dashboard.youLabel')}</span></>}
          </p>
          <p className="text-sm md:text-xs text-muted-foreground">{proj?.name} • {t.date || t.sentDate}</p>
          {t.note && <p className="text-sm md:text-xs text-muted-foreground italic">{t.note}</p>}
          {t.defect && <p className="text-sm md:text-xs text-amber-700 flex items-center gap-1 mt-0.5"><MorphIcon icon={AlertTriangle} className="w-2.5 h-2.5" />{t.defect}</p>}
          {t.status === "confirmed" && isSender && t.confirmedDate && (
            <p className="text-sm md:text-xs text-green-800 dark:text-green-400 font-medium mt-0.5">✓ {tt('dashboard.confirmedByLabel', { name: to?.name, date: t.confirmedDate })}</p>
          )}
        </div>
        <div className="flex-shrink-0">{statusBadge}</div>
      </div>
      {canConfirm && (
        <div className="space-y-1.5">
          <textarea rows={1} placeholder={tt('dashboard.defectPlaceholder')} value={defect} onChange={e => setDefect(e.target.value)}
            className="w-full text-sm md:text-xs border border-border rounded px-2 py-1.5 bg-input-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"/>
          <div className="flex gap-1.5">
            <button onClick={() => onConfirm(t.id, defect || undefined)}
              className="flex-1 flex items-center justify-center gap-1 text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold">
              <MorphIcon icon={Check} className="w-3 h-3" />{tt('dashboard.acceptBtn')}
            </button>
            <button onClick={() => onReject(t.id)}
              className="flex items-center justify-center gap-1 text-sm md:text-xs bg-red-500/15 text-red-700 dark:text-red-300 rounded px-2.5 py-1.5 hover:bg-red-500/100/25 font-semibold">
              <MorphIcon icon={X} className="w-3 h-3" />{tt('dashboard.rejectBtn')}
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
  const { t } = useTranslation();
  const [tab, setTab] = useState<"inbox"|"sent">("inbox");
  const inbox = transfers.filter(t => t.toUserId === currentUser.id);
  const sent = transfers.filter(t => t.fromUserId === currentUser.id);
  const pendingCount = inbox.filter(t => t.status === "pending").length;
  const shown = tab === "inbox" ? inbox : sent;

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="surface flex items-center justify-between px-4 py-3 flex-shrink-0">
        <h2 className="text-sm font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.materials')}</h2>
        <button onClick={onSend} className="btn btn-primary flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-full">
          <MorphIcon icon={Send} className="w-3.5 h-3.5" />{t('dashboard.send')}
        </button>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.05 }}
        className="nav-pill-desktop flex p-1 rounded-full flex-shrink-0 w-fit">
        <button onClick={() => setTab("inbox")} className={`relative flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-semibold liquid-transition ${tab==="inbox"?"bg-primary/15 text-primary":"text-muted-foreground hover:text-foreground"}`}>
          {t('dashboard.inboxTab')}
          {pendingCount > 0 && <span className="text-[9px] bg-accent text-white px-1.5 py-0.5 rounded-full font-bold badge-pulse">{pendingCount}</span>}
        </button>
        <button onClick={() => setTab("sent")} className={`relative flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-semibold liquid-transition ${tab==="sent"?"bg-primary/15 text-primary":"text-muted-foreground hover:text-foreground"}`}>
          {t('dashboard.sentTab')}
          <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-semibold">{sent.length}</span>
        </button>
      </motion.div>
      <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide">
        {shown.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground"><MorphIcon icon={Package} className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('dashboard.emptyList')}</p></div>
        ) : shown.map(tr => (
          <TransferRow key={tr.id} t={tr} currentUser={currentUser} allUsers={allUsers} projects={projects} onConfirm={onConfirm} onReject={onReject}/>
        ))}
      </div>
    </div>
  );
}

// ─── Edit User Modal ─────────────────────────────────────────────────────────────
function EditUserModal({ user, currentUser, onClose, onUpdate }: { user: AppUser; currentUser: AppUser; onClose: () => void; onUpdate: (u: AppUser) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: user.name, role: user.role, phone: user.phone, brigade: user.brigade || "", baseSalary: user.baseSalary != null ? String(user.baseSalary) : "" });
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
          <h3 className="font-semibold text-sm flex items-center gap-2"><MorphIcon icon={Edit} className="w-4 h-4 text-primary" />{t('editUser.title')}</h3>
          <button aria-label={t('editUser.close')} onClick={onClose} className="p-1 rounded hover:bg-muted"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          onUpdate({ ...user, ...form, baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined });
          onClose();
        }} className="p-4 space-y-3">
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.nameLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              placeholder={t('editUser.namePlaceholder')} value={form.name} onChange={e => setForm({...form, name: e.target.value})} required autoFocus
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.phoneLabel')}</label>
            <input inputMode="tel" className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
              placeholder="+998901234567" value={form.phone} onChange={e => setForm({...form, phone: e.target.value.replace(/[^\d+]/g, "")})} required
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.positionLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {editableRoles.map(r => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
              {!editableRoles.includes(form.role) && <option value={form.role}>{roleLabel(t, form.role)}</option>}
            </select>
          </div>
          {isAdmin(currentUser.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.baseSalaryLabel')}</label>
              <input type="number" min="0" className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={t('addUser.baseSalaryPlaceholder') as string} value={form.baseSalary} onChange={e => setForm({...form, baseSalary: e.target.value})}/>
            </div>
          )}
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
// Backup yuklab olish / tiklash — AdminDashboard va Profil sahifasi ikkalasida ishlatiladi.
function useBackupActions() {
  const { t } = useTranslation();
  const [backupLoading, setBackupLoading] = useState(false);
  const handleBackup = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setBackupLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/admin/backup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { toast.error(t('dashboard.backupError')); return; }
      const blob = await r.blob();
      const saved = await saveOrShareBlob(`qurilish-erp-backup-${new Date().toISOString().split('T')[0]}.json`, blob);
      if (saved.ok) toast.success(t('dashboard.backupSuccess')); else toast.error(t('dashboard.backupError'));
    } catch { toast.error(t('dashboard.backupError')); }
    finally { setBackupLoading(false); }
  };

  // Backup faylni TIRIK (mavjud) firmaga qayta yuklash — avval faqat
  // O'CHIRILGAN firmani tiklash mumkin edi (routes/companies.ts). Juda
  // xavfli amal (joriy ma'lumotlarni backup holatiga qaytaradi, keyingi
  // o'zgarishlar yo'qoladi) — shu sabab ikki bosqichli tasdiqlash: fayl
  // tanlash + aniq matn yozib tasdiqlash.
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importLoading, setImportLoading] = useState(false);
  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const typed = window.prompt(t('dashboard.importConfirmPrompt') as string);
    // Katta/kichik harf farqi endi muhim emas — "TASDIQLAYMAN" yoki
    // "tasdiqlayman" (yoki aralash) baravar qabul qilinadi, faqat SO'Z
    // to'g'ri yozilishi muhim.
    const expected = (t('dashboard.importConfirmWord') as string).trim().toUpperCase();
    if ((typed || '').trim().toUpperCase() !== expected) { if (typed !== null) toast.error(t('dashboard.importConfirmMismatch')); return; }
    const token = localStorage.getItem("token");
    if (!token) return;
    setImportLoading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const r = await fetch(`${API_BASE}/api/admin/backup/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: parsed.companyId, data: parsed.data, confirm: true }),
      });
      const data = await r.json();
      if (!r.ok) { toast.error(data.error || t('dashboard.backupError')); return; }
      toast.success(t('dashboard.importSuccess'));
      // XATO TUZATILDI ("backup qildi keyin avtomatik o'zi yangilasin sayt"):
      // tiklashdan keyin serverdagi BARCHA ma'lumot (users/projects/
      // transactions va h.k.) almashtirilgan, lekin sahifadagi eski React
      // state hali eski (tiklashdan OLDINGI) holatda qolardi — foydalanuvchi
      // qo'lda sahifani yangilamaguncha ilova eskirgan ma'lumotni ko'rsatardi.
      // Toast ko'rinishi uchun qisqa kechikish bilan sahifa to'liq qayta
      // yuklanadi.
      setTimeout(() => window.location.reload(), 1500);
    } catch { toast.error(t('dashboard.backupError')); }
    finally { setImportLoading(false); }
  };
  return { backupLoading, handleBackup, importFileRef, importLoading, handleImportBackup };
}

function AdminDashboard({ currentUser, users, projects, transfers, setUsers, onSendTransfer, onConfirmTransfer, onRejectTransfer, onSelectProject, onAddUser, onUpdateUser, onDeleteUser, onAddProject, hasFeature }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; transfers: Transfer[];
    setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
    onSendTransfer: (t: Transfer) => void; onConfirmTransfer: (id: string, d?: string) => void;
    onRejectTransfer: (id: string) => void; onSelectProject: (p: Project) => void; onAddUser: (u: AppUser) => Promise<{ ok: boolean; error?: string }>;
    onUpdateUser: (u: AppUser) => void; onDeleteUser: (id: string) => void;
    onAddProject: (p: Project) => void;
    // Obuna tarifida "backup" funksiyasi yoqilganmi — App() komponentidan
    // (companyFeatures/hasFeature) uzatiladi, chunki AdminDashboard alohida
    // komponent bo'lib, o'zining obuna ma'lumotlarini so'ramaydi.
    hasFeature: (key: string) => boolean;
  }) {
  const { t } = useTranslation();
  const [showAddUser, setShowAddUser] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showAddObject, setShowAddObject] = useState(false);
  const [editUser, setEditUser] = useState<AppUser|null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem("admin_activeTab") || "rahbariyat";
  });
  const [stats, setStats] = useState<{
    activeProjects: number; totalProjects: number; totalEmployees: number;
    totalExpenses: number; pendingTransfers: number; todayAttendance: number;
  } | null>(null);
  const [showEquipment, setShowEquipment] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showESign, setShowESign] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);
  const [export1cLoading, setExport1cLoading] = useState(false);
  const handleExport1c = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setExport1cLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/export1c/transactions`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast.error(t('dashboard.backupError')); return; }
      const blob = await r.blob();
      const saved = await saveOrShareBlob(`1c-export-${new Date().toISOString().split('T')[0]}.xlsx`, blob);
      if (!saved.ok) toast.error(t('dashboard.backupError'));
    } catch { toast.error(t('dashboard.backupError')); }
    finally { setExport1cLoading(false); }
  };

  useEffect(() => {
    localStorage.setItem("admin_activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE}/api/dashboard/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : null).then(d => { if (d) setStats(d); }).catch(() => {});
  }, []);

  const { backupLoading, handleBackup, importFileRef, importLoading, handleImportBackup } = useBackupActions();

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
    {/* Stats strip — real data from API.
        XATO TUZATILDI ("responsive ahvoli juda yomon, kesilib qolyapti"):
        avval bu qat'iy `flex` (o'ralmaydigan, yig'ilmaydigan) qator edi —
        5 ta chip + Backup tugmasi umumiy kengligi keng desktop'dan
        boshqa deyarli har qanday enda (ayniqsa iPad kabi ~768px'da,
        aynan `md:` chegarasida) sig'may qolib, `truncate` matnni
        "Bugun keldl..." kabi chala kesib ko'rsatardi. Endi qat'iy sig'ish
        o'rniga GORIZONTAL SKROLL (mobil ilovalardagi filter-chip qatori
        naqshi) ishlatiladi — hech qaysi chip HECH QACHON kesilmaydi yoki
        siqilmaydi, shunchaki kerak bo'lsa yon tomonga suriladi. */}
    {stats && (
      <div className="flex-shrink-0 hidden lg:flex items-center gap-2 pl-3 pr-6 pt-3 pb-1 overflow-x-auto scrollbar-hide scroll-smooth">
        {[
          { label: t('dashboard.activeObjects'), value: stats.activeProjects, color: "text-green-600 dark:text-green-400" },
          { label: t('dashboard.totalStaff'), value: stats.totalEmployees, color: "text-blue-600 dark:text-blue-300" },
          { label: t('dashboard.pendingTransfers'), value: stats.pendingTransfers, color: "text-amber-600 dark:text-amber-300" },
          { label: t('dashboard.todayAttendance'), value: stats.todayAttendance, color: "text-primary" },
          { label: t('dashboard.totalExpenses'), value: fmt(stats.totalExpenses), color: "text-foreground" },
        ].map(s => (
          <div key={s.label} className="surface rounded-lg px-3 py-1.5 flex items-center gap-2 flex-shrink-0 whitespace-nowrap liquid-transition hover:shadow-sm">
            <span className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</span>
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </div>
        ))}
        {hasFeature('backup') && (
          <button onClick={handleBackup} disabled={backupLoading}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition disabled:opacity-60 text-muted-foreground hover:text-foreground flex-shrink-0 whitespace-nowrap ml-auto">
            {backupLoading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Download} className="w-3.5 h-3.5" />}
            {t('dashboard.backup')}
          </button>
        )}
        {hasFeature('backup') && (
          <>
            <input ref={importFileRef} type="file" accept="application/json" className="hidden" onChange={handleImportBackup} />
            <button onClick={() => importFileRef.current?.click()} disabled={importLoading}
              title={t('dashboard.importWarning') as string}
              className="flex items-center gap-1.5 text-xs border border-destructive/30 text-destructive rounded-lg px-3 py-1.5 hover:bg-destructive/10 active:scale-95 liquid-transition disabled:opacity-60 flex-shrink-0 whitespace-nowrap">
              {importLoading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Upload} className="w-3.5 h-3.5" />}
              {t('dashboard.importBackup')}
            </button>
          </>
        )}
        <button onClick={handleExport1c} disabled={export1cLoading}
          className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition disabled:opacity-60 text-muted-foreground hover:text-foreground flex-shrink-0 whitespace-nowrap">
          {export1cLoading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Download} className="w-3.5 h-3.5" />}
          {t('dashboard.export1c')}
        </button>
      </div>
    )}
    {/* Boshqaruv — jihozlar/xavfsizlik/hujjatlar/ish haqi (avval umuman yo'q
        edi, product-audit'da topilgan bo'shliqlar). Har biri o'z modalida
        ochiladi — mavjud accordion/grid tuzilishini o'zgartirmasdan. */}
    <div className="flex-shrink-0 flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto scrollbar-hide">
      <button onClick={() => setShowEquipment(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={Package} className="w-3.5 h-3.5 text-primary" />{t('management.equipment')}
      </button>
      <button onClick={() => setShowSafety(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={AlertTriangle} className="w-3.5 h-3.5 text-amber-500" />{t('management.safety')}
      </button>
      <button onClick={() => setShowESign(true)} className="flex items-center gap-1.5 text-xs border border-primary/40 bg-primary/5 text-primary rounded-lg px-3 py-1.5 hover:bg-primary/10 active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap font-semibold">
        ✍️ {t('management.esign', { defaultValue: "E-hujjat va imzo" })}
      </button>
      <button onClick={() => setShowDocuments(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={FileText} className="w-3.5 h-3.5 text-blue-500" />{t('management.documents')}
      </button>
      <button onClick={() => setShowPayroll(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={Wallet} className="w-3.5 h-3.5 text-green-600" />{t('management.payroll')}
      </button>
    </div>
    {/* Desktop: 4-column grid */}
    <div className="hidden lg:grid lg:grid-cols-2 xl:grid-cols-4 gap-3 overflow-hidden bg-background p-3 flex-1 min-h-0">
      {/* Col 1 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="icon-chip w-6 h-6"><MorphIcon icon={Building2} className="w-3.5 h-3.5" /></div>
          <h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.leadership')}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          {users.filter(u => u.role === "direktor").map(u => (
            <div key={u.id} className="mb-2">
              <div className="bg-primary text-white rounded-md p-3 flex items-center gap-2">
                <Avatar user={u} size="sm"/><div><p className="text-sm md:text-xs font-semibold">{u.name}</p><p className="text-sm md:text-xs text-white/90">{roleLabel(t, u.role)}</p></div>
              </div>
              {users.filter(u2 => u2.role === "orinbosar").map(u2 => (
                <div key={u2.id} className="ml-4 mt-2 border-l-2 border-dashed border-primary/30 pl-3">
                  <div className="bg-secondary rounded-md p-3 flex items-center gap-2">
                    <Avatar user={u2} size="sm"/><div><p className="text-sm md:text-xs font-semibold">{u2.name}</p><p className="text-sm md:text-xs text-muted-foreground">{roleLabel(t, u2.role)}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u2.phone}</p></div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('dashboard.staffShort')}</p>
              <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-[9px] bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold"><MorphIcon icon={UserPlus} className="w-2.5 h-2.5" />{t('common.add')}</button>
            </div>
            {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
              <div key={r} className="flex items-center justify-between py-1">
                <span className="text-sm md:text-xs text-muted-foreground">{roleLabel(t, r)}</span>
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
          <div className="flex items-center gap-2"><div className="icon-chip w-6 h-6"><MorphIcon icon={Users} className="w-3.5 h-3.5" /></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.topStaff')}</h2></div>
          <button onClick={() => setShowAddUser(true)} className="text-sm md:text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold flex items-center gap-1"><MorphIcon icon={UserPlus} className="w-2.5 h-2.5" />{t('common.add')}</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-border/50">
          {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
            <div key={u.id} className="flex items-center gap-2.5 py-2 px-3 hover:bg-muted/40 transition-colors group">
              <Avatar user={u} size="sm"/>
              <div className="flex-1 min-w-0"><p className="text-sm md:text-xs font-semibold truncate">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p>{u.brigade&&<p className="text-[9px] text-muted-foreground">{u.brigade}</p>}</div>
              <RoleBadge role={u.role}/>
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button aria-label={t('common.edit')} onClick={() => setEditUser(u)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3 h-3" /></button>
                <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(u.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Col 3 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.10 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip w-6 h-6"><MorphIcon icon={HardHat} className="w-3.5 h-3.5" /></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.brigades')}</h2></div>
          <button onClick={() => setShowSend(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2 py-1 rounded hover:bg-primary/90 font-semibold"><MorphIcon icon={Send} className="w-2.5 h-2.5" />{t('dashboard.send')}</button>
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
                    <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3 h-3" /></button>
                    <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-sm md:text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase mb-2 flex items-center gap-1"><MorphIcon icon={Package} className="w-2.5 h-2.5" />{t('dashboard.incomingShort')}</p>
              {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").map(t => (
                <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={projects} onConfirm={onConfirmTransfer} onReject={onRejectTransfer}/>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">{t('dashboard.allWorkers')}</p>
            {users.filter(u => u.role==="ishchi" || u.role==="brigadir").map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group mb-1">
                <Avatar user={m} size="sm"/>
                <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                <RoleBadge role={m.role}/>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3 h-3" /></button>
                  <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3 h-3" /></button>
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
          <div className="flex items-center gap-2"><div className="icon-chip icon-chip-accent w-6 h-6"><MorphIcon icon={Package} className="w-3.5 h-3.5" /></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.activeObjects')}</h2></div>
          <button onClick={()=>setShowAddObject(true)} className="text-sm md:text-xs bg-accent text-white px-2 py-1 rounded hover:bg-accent/90 font-semibold flex items-center gap-1 dark:bg-accent/10 dark:text-accent dark:hover:bg-accent/20"><MorphIcon icon={Plus} className="w-2.5 h-2.5" />{t('common.add')}</button>
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
                    <p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MorphIcon icon={MapPin} className="w-2.5 h-2.5" />{p.location}</p>
                    {foreman&&<p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MorphIcon icon={HardHat} className="w-2.5 h-2.5" />{foreman.name}</p>}
                  </div>
                  <MorphIcon icon={ChevronRight} className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-0.5" />
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
    <div className="flex flex-col lg:hidden overflow-y-auto scrollbar-hide bg-background pb-4">
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
                  <MorphIcon icon={section.icon} className={`w-4 h-4 ${isOpen ? "text-white" : "text-primary"}`} />
                </div>
                <span className={`text-sm font-bold tracking-wide font-['Roboto_Slab',serif] ${isOpen ? "text-white" : "text-foreground"}`}>{section.label}</span>
              </div>
              <MorphIcon icon={ChevronDown} className={`w-5 h-5 transition-transform duration-300 ${isOpen ? "rotate-180 text-white" : "text-muted-foreground"}`} />
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
                          <div><p className="text-sm font-semibold">{u.name}</p><p className="text-[11px] text-white/90">{roleLabel(t, u.role)}</p></div>
                        </div>
                        {users.filter(u2 => u2.role === "orinbosar").map(u2 => (
                          <div key={u2.id} className="ml-6 mt-2 border-l-2 border-dashed border-primary/30 pl-3">
                            <div className="bg-secondary rounded-xl p-3 flex items-center gap-2">
                              <Avatar user={u2} size="sm"/>
                              <div><p className="text-sm font-semibold">{u2.name}</p><p className="text-sm md:text-xs text-muted-foreground">{roleLabel(t, u2.role)}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u2.phone}</p></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-3 border-t border-border">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('dashboard.staffCount')}</p>
                        <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full hover:bg-primary/20 font-semibold"><MorphIcon icon={UserPlus} className="w-3 h-3" />{t('common.add')}</button>
                      </div>
                      {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
                        <div key={r} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                          <span className="text-sm text-muted-foreground">{roleLabel(t, r)}</span>
                          <span className="text-sm font-mono font-bold">{users.filter(u=>u.role===r).length}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {section.key === "boshxodimlar" && (
                  <div>
                    <div className="flex justify-end px-4 py-2 border-b border-border/30">
                      <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><MorphIcon icon={UserPlus} className="w-3 h-3" />{t('common.add')}</button>
                    </div>
                    {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
                      <div key={u.id} className="flex items-center gap-3 py-3 px-4 border-b border-border/40 hover:bg-muted/30">
                        <Avatar user={u} size="sm"/>
                        <div className="flex-1"><p className="text-sm font-semibold">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p></div>
                        <RoleBadge role={u.role}/>
                        <div className="flex gap-1">
                          <button aria-label={t('common.edit')} onClick={() => setEditUser(u)} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-4 h-4" /></button>
                          <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(u.id); }} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {section.key === "brigadalar" && (
                  <div className="p-4 space-y-3">
                    <div className="flex justify-end">
                      <button onClick={() => setShowSend(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><MorphIcon icon={Send} className="w-3 h-3" />{t('dashboard.send')}</button>
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
                              <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3.5 h-3.5" /></button>
                              <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-border">
                      <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">{t('dashboard.allWorkers')}</p>
                      {users.filter(u => u.role==="ishchi" || u.role==="brigadir").map(m => (
                        <div key={m.id} className="flex items-center gap-3 py-2.5 px-2 border-b border-border/30">
                          <Avatar user={m} size="sm"/>
                          <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                          <RoleBadge role={m.role}/>
                          <div className="flex gap-1">
                            <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3.5 h-3.5" /></button>
                            <button aria-label={t('common.delete')} onClick={() => { if(confirm(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-sm md:text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase mb-2 flex items-center gap-1"><MorphIcon icon={Package} className="w-3 h-3" />{t('dashboard.incomingMaterials')}</p>
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
                      <button onClick={()=>setShowAddObject(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-accent text-white px-3 py-1.5 rounded-full font-semibold"><MorphIcon icon={Plus} className="w-3 h-3" />{t('common.add')}</button>
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
                              <p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MorphIcon icon={MapPin} className="w-3 h-3" />{p.location}</p>
                              {foreman&&<p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MorphIcon icon={HardHat} className="w-3 h-3" />{foreman.name}</p>}
                            </div>
                            <MorphIcon icon={ChevronRight} className="w-5 h-5 text-muted-foreground mt-0.5" />
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
      {showEquipment && <EquipmentModal projects={projects} onClose={()=>setShowEquipment(false)}/>}
      {showSafety && <SafetyModal projects={projects} onClose={()=>setShowSafety(false)}/>}
      {showDocuments && <DocumentsModal projects={projects} currentUser={currentUser} onClose={()=>setShowDocuments(false)}/>}
      {showESign && (
        <Suspense fallback={null}>
          <ESignDocs onClose={() => setShowESign(false)} currentUserName={currentUser.name}
            companyName={localStorage.getItem("erp_companyName") || ""}
            projects={projects.map(p => ({ id: p.id, name: p.name, location: p.location }))} />
        </Suspense>
      )}
      {showPayroll && <PayrollModal users={users} onClose={()=>setShowPayroll(false)}/>}
    </>
  );
}

// ─── Umumiy "Boshqaruv" modal skeleton — jihoz/xavfsizlik/hujjat/ish haqi
// modallarining barchasi bir xil qobiq (header+yopish) ishlatadi. ────────────
function ManagementModalShell({ icon, title, onClose, children }: { icon: any; title: string; onClose: () => void; children: React.ReactNode }) {
  useModalPresence();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" onClick={onClose}>
      <div className="glass-modal rounded-2xl w-full max-w-lg p-5 animate-slide-up-fade max-h-[85vh] overflow-y-auto scrollbar-hide" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={icon} className="w-4 h-4 text-primary" />{title}</h3>
          <button aria-label={i18n_common_close} onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
const i18n_common_close = "Yopish";

// ─── Jihoz/texnika kuzatuvi ──────────────────────────────────────────────────
function EquipmentModal({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(""); const [type, setType] = useState(""); const [objectId, setObjectId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/equipment`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const add = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(`${API_BASE}/api/equipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type: type.trim() || undefined, objectId: objectId || undefined }) });
      if (r.ok) { setName(""); setType(""); setObjectId(""); load(); } else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setAdding(false);
  };
  const setStatus = async (id: string, status: string) => {
    try { await fetch(`${API_BASE}/api/equipment/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load(); } catch {}
  };
  const remove = async (id: string) => {
    if (!window.confirm(t('common.confirmDelete') as string)) return;
    try { await fetch(`${API_BASE}/api/equipment/${id}`, { method: 'DELETE' }); load(); } catch {}
  };
  const statusColor: Record<string,string> = { available: 'text-green-600 bg-green-500/10', in_use: 'text-blue-600 bg-blue-500/10', maintenance: 'text-amber-600 bg-amber-500/10', broken: 'text-red-600 bg-red-500/10' };
  const statusLabel: Record<string,string> = { available: t('management.eqAvailable'), in_use: t('management.eqInUse'), maintenance: t('management.eqMaintenance'), broken: t('management.eqBroken') };

  return (
    <ManagementModalShell icon={Package} title={t('management.equipment')} onClose={onClose}>
      <div className="space-y-2 mb-4">
        <input value={name} onChange={e=>setName(e.target.value)} placeholder={t('management.eqNamePlaceholder') as string} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
        <div className="grid grid-cols-2 gap-2">
          <input value={type} onChange={e=>setType(e.target.value)} placeholder={t('management.eqTypePlaceholder') as string} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
          <select value={objectId} onChange={e=>setObjectId(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="">{t('management.eqNoProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={add} disabled={adding || !name.trim()} className="btn btn-primary w-full py-2 text-sm disabled:opacity-50">{t('common.add')}</button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.eqEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map(e => (
            <div key={e.id} className="flex items-center gap-2 border border-border/50 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{e.name}{e.type ? ` — ${e.type}` : ''}</p>
                {e.objectId && <p className="text-[10px] text-muted-foreground truncate">{projects.find(p=>p.id===e.objectId)?.name || ''}</p>}
              </div>
              <select value={e.status} onChange={ev=>setStatus(e.id, ev.target.value)} className={`text-[10px] font-semibold rounded-full px-2 py-1 border-none focus:outline-none ${statusColor[e.status]}`}>
                {Object.keys(statusLabel).map(k => <option key={k} value={k}>{statusLabel[k]}</option>)}
              </select>
              <button onClick={()=>remove(e.id)} aria-label={t('common.delete')} className="p-1 text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Xavfsizlik hodisalari ───────────────────────────────────────────────────
function SafetyModal({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitleField] = useState(""); const [severity, setSeverity] = useState("medium"); const [objectId, setObjectId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/safety`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const add = async () => {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(`${API_BASE}/api/safety`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), severity, objectId: objectId || undefined }) });
      if (r.ok) { setTitleField(""); setSeverity("medium"); setObjectId(""); load(); } else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setAdding(false);
  };
  const setStatus = async (id: string, status: string) => {
    try { await fetch(`${API_BASE}/api/safety/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load(); } catch {}
  };
  const sevColor: Record<string,string> = { low: 'text-muted-foreground bg-muted', medium: 'text-amber-600 bg-amber-500/10', high: 'text-orange-600 bg-orange-500/10', critical: 'text-red-600 bg-red-500/10' };
  const statusLabel: Record<string,string> = { open: t('management.safOpen'), investigating: t('management.safInvestigating'), resolved: t('management.safResolved') };

  return (
    <ManagementModalShell icon={AlertTriangle} title={t('management.safety')} onClose={onClose}>
      <div className="space-y-2 mb-4">
        <input value={title} onChange={e=>setTitleField(e.target.value)} placeholder={t('management.safTitlePlaceholder') as string} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
        <div className="grid grid-cols-2 gap-2">
          <select value={severity} onChange={e=>setSeverity(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="low">{t('management.sevLow')}</option>
            <option value="medium">{t('management.sevMedium')}</option>
            <option value="high">{t('management.sevHigh')}</option>
            <option value="critical">{t('management.sevCritical')}</option>
          </select>
          <select value={objectId} onChange={e=>setObjectId(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="">{t('management.eqNoProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={add} disabled={adding || !title.trim()} className="btn btn-primary w-full py-2 text-sm disabled:opacity-50">{t('management.safReportBtn')}</button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.safEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((inc:any) => (
            <div key={inc.id} className="border border-border/50 rounded-xl px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{inc.title}</p>
                  <p className="text-[10px] text-muted-foreground">{inc.reportedBy?.name} · {new Date(inc.occurredAt).toLocaleDateString('uz-UZ')}</p>
                </div>
                <span className={`text-[9px] font-bold rounded-full px-2 py-0.5 flex-shrink-0 ${sevColor[inc.severity]}`}>{inc.severity.toUpperCase()}</span>
              </div>
              <select value={inc.status} onChange={ev=>setStatus(inc.id, ev.target.value)} className="mt-1.5 text-[10px] font-semibold border border-border rounded-full px-2 py-1 bg-transparent focus:outline-none">
                {Object.keys(statusLabel).map(k => <option key={k} value={k}>{statusLabel[k]}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Hujjat/shartnoma boshqaruvi ─────────────────────────────────────────────
function DocumentsModal({ projects, currentUser, onClose }: { projects: Project[]; currentUser: AppUser; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("contract"); const [objectId, setObjectId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canSign = isAdmin(currentUser.role);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/documents`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const sign = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/documents/${id}/sign`, { method: 'POST' });
      if (r.ok) load(); else toast.error((await r.json().catch(()=>({})))?.error || t('common.error'));
    } catch { toast.error(t('common.error')); }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadChatMedia(file, file.name);
      const r = await fetch(`${API_BASE}/api/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: file.name, fileUrl: up.url, fileName: file.name, category, objectId: objectId || undefined }) });
      if (r.ok) load(); else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setUploading(false);
  };
  const remove = async (id: string) => {
    if (!window.confirm(t('common.confirmDelete') as string)) return;
    try { await fetch(`${API_BASE}/api/documents/${id}`, { method: 'DELETE' }); load(); } catch {}
  };
  const catLabel: Record<string,string> = { contract: t('management.catContract'), permit: t('management.catPermit'), invoice: t('management.catInvoice'), other: t('management.catOther') };

  return (
    <ManagementModalShell icon={FileText} title={t('management.documents')} onClose={onClose}>
      <div className="space-y-2 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={e=>setCategory(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            {Object.keys(catLabel).map(k => <option key={k} value={k}>{catLabel[k]}</option>)}
          </select>
          <select value={objectId} onChange={e=>setObjectId(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="">{t('management.eqNoProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <input ref={fileRef} type="file" className="hidden" onChange={upload} />
        <button onClick={()=>fileRef.current?.click()} disabled={uploading} className="btn btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2">
          {uploading ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Upload} className="w-4 h-4" />}
          {t('management.docUploadBtn')}
        </button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.docEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((d:any) => {
            const iSigned = (d.signatures || []).some((s:any) => s.userId === currentUser.id);
            return (
            <div key={d.id} className="border border-border/50 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <MorphIcon icon={FileText} className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <button onClick={()=>openExternalUrl(d.fileUrl)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-[10px] text-muted-foreground">{catLabel[d.category]} · {d.uploadedBy?.name}</p>
                </button>
                {canSign && !iSigned && (
                  <button onClick={()=>sign(d.id)} title={t('management.docSignBtn')} aria-label={t('management.docSignBtn')} className="p-1 text-muted-foreground hover:text-primary"><MorphIcon icon={Check} className="w-3.5 h-3.5" /></button>
                )}
                <button onClick={()=>remove(d.id)} aria-label={t('common.delete')} className="p-1 text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
              </div>
              {(d.signatures || []).length > 0 && (
                <p className="text-[10px] text-green-600 mt-1 pl-6">{t('management.docSignedBy', { names: d.signatures.map((s:any)=>s.name).join(', ') })}</p>
              )}
            </div>
          );})}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Ish haqi hisob-kitobi ────────────────────────────────────────────────────
function PayrollModal({ users, onClose }: { users: AppUser[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0,7));
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);

  const load = async (p: string) => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/payroll?period=${p}`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period]);

  const calculate = async () => {
    setCalculating(true);
    try {
      const r = await fetch(`${API_BASE}/api/payroll/calculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period }) });
      if (r.ok) { const d = await r.json(); setList(d.records); toast.success(t('management.payrollCalculated', { count: d.count })); }
      else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setCalculating(false);
  };
  const patch = async (id: string, body: any) => {
    try { const r = await fetch(`${API_BASE}/api/payroll/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.ok) load(period); } catch {}
  };
  const statusLabel: Record<string,string> = { draft: t('management.payDraft'), finalized: t('management.payFinalized'), paid: t('management.payPaid') };

  return (
    <ManagementModalShell icon={Wallet} title={t('management.payroll')} onClose={onClose}>
      <div className="flex items-center gap-2 mb-4">
        <input type="month" value={period} onChange={e=>setPeriod(e.target.value)} className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
        <button onClick={calculate} disabled={calculating} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50 whitespace-nowrap">
          {calculating ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : t('management.payCalculateBtn')}
        </button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.payEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {list.map((r:any) => (
            <div key={r.id} className="border border-border/50 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold truncate">{r.userName}</p>
                <span className="text-sm font-mono font-bold text-primary">{r.netPay.toLocaleString()} so'm</span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1.5">{t('management.payDaysWorked', { days: r.presentDays })} · {t('management.payBase', { amount: r.baseSalary.toLocaleString() })}</p>
              <div className="grid grid-cols-3 gap-1.5">
                <input type="number" defaultValue={r.bonuses} placeholder={t('management.payBonus') as string} disabled={r.status==='paid'}
                  onBlur={e=>patch(r.id, { bonuses: Number(e.target.value)||0 })} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-input-background focus:outline-none disabled:opacity-50" />
                <input type="number" defaultValue={r.deductions} placeholder={t('management.payDeduction') as string} disabled={r.status==='paid'}
                  onBlur={e=>patch(r.id, { deductions: Number(e.target.value)||0 })} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-input-background focus:outline-none disabled:opacity-50" />
                <select value={r.status} disabled={r.status==='paid'} onChange={e=>patch(r.id, { status: e.target.value })} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-input-background focus:outline-none disabled:opacity-50">
                  {Object.keys(statusLabel).map(k => <option key={k} value={k}>{statusLabel[k]}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Ichki e'lonlar taxtasi ──────────────────────────────────────────────────
// Chat'dan farqli — bir yo'nalishli (direktor/o'rinbosardan hammaga),
// javob/muhokama uchun mo'ljallanmagan. BARCHA xodim ko'radi, faqat admin yozadi.
function AnnouncementsModal({ currentUser, onClose }: { currentUser: AppUser; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<AnnouncementData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const canPost = isAdmin(currentUser.role);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/announcements`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const remove = async (id: string) => {
    if (!window.confirm(t('common.confirmDelete') as string)) return;
    try { const r = await fetch(`${API_BASE}/api/announcements/${id}`, { method: 'DELETE' }); if (r.ok) load(); } catch {}
  };

  return (
    <ManagementModalShell icon={Megaphone} title={t('announcements.title')} onClose={onClose}>
      {canPost && (
        showForm ? (
          <AnnouncementComposer endpoint="/api/announcements" onCancel={()=>setShowForm(false)} onPosted={()=>{ setShowForm(false); load(); }} />
        ) : (
          <button onClick={()=>setShowForm(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border-2 border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary liquid-transition mb-4">
            <MorphIcon icon={Plus} className="w-4 h-4" />{t('announcements.newBtn')}
          </button>
        )
      )}
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('announcements.empty')}</p>
      ) : (
        <div className="space-y-2.5">
          {list.map(a => (
            <div key={a.id} className="glass-card rounded-2xl p-3.5 border border-border/40 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: 'linear-gradient(180deg, var(--primary), var(--accent))' }} />
              <div className="flex items-start gap-2.5">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)' }}>
                  <MorphIcon icon={Megaphone} className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold break-words min-w-0">
                      {a.title}
                      {a.isGlobal && <span className="ml-1.5 align-middle text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{t('announcements.globalBadge')}</span>}
                    </p>
                    {canPost && !a.isGlobal && (
                      <button onClick={()=>remove(a.id)} aria-label={t('common.delete')} className="p-1 text-muted-foreground hover:text-destructive flex-shrink-0 rounded-lg hover:bg-destructive/10 liquid-transition"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                  <div className="mt-1"><AnnouncementContent a={a} /></div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">{a.postedBy?.name} · {new Date(a.createdAt).toLocaleDateString('uz-UZ')}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
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

  // Jadvallarda touch-action cheklovi yo'q — vertikal va gorizontal surish ikkalasi ishlaydi.
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-3 p-4 pb-24 animate-slide-up-fade">
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
              <span className="flex items-center gap-2"><span className="font-mono text-sm font-bold">{fmtNum(sum)}</span><MorphIcon icon={open ? ChevronUp : ChevronDown} className="w-4 h-4 shrink-0" /></span>
            </button>
            {/* XATO TUZATILDI: sahifaning o'zi (yuqorida) vertikal scroll
                qiladi, bu jadval esa gorizontal — ikkalasi izolyatsiya
                qilinmagan bo'lsa, mobil/APK'da touch imo-ishorasi ko'pincha
                vertikalga "qulflanib", gorizontal svayp deyarli ishlamaydi
                ("smeta bo'limida chapga qimirlatib bo'lmayapti"). Talab
                jadvalidagi bilan bir xil touch-action izolyatsiyasi. */}
            {open && (
              <div className="overflow-x-auto border-t border-border" onWheel={hwheel}>
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
              <MorphIcon icon={so ? ChevronUp : ChevronDown} className="w-4 h-4 shrink-0" />
            </button>
            {so && sec.works.map(w => {
              const wo = openWork === w.index;
              return (
                <div key={w.index} className="border-t border-border/50">
                  <button onClick={() => setOpenWork(wo ? null : w.index)} className="w-full flex items-start justify-between gap-2 px-4 py-2 hover:bg-muted/20 text-left">
                    <span className="text-xs leading-snug"><span className="text-muted-foreground">{w.index}.</span> {w.shifr && <span className="font-mono text-primary">{w.shifr} </span>}{w.name} <span className="text-muted-foreground">[{w.unit}]</span></span>
                    <span className="flex items-center gap-1 shrink-0"><span className="text-[10px] text-muted-foreground whitespace-nowrap">{w.norms.length} n.</span><MorphIcon icon={wo ? ChevronUp : ChevronDown} className="w-3.5 h-3.5" /></span>
                  </button>
                  {wo && w.norms.length > 0 && (
                    <div className="overflow-x-auto px-4 pb-2" onWheel={hwheel}>
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

function ObjectDetailPage({ project, currentUser, users, transfers, onBack, onSendTransfer, onConfirm, onReject, onSmetaUploaded, onUpdateStatus, onUpdateProject, onDeleteProject }:
  { project: Project; currentUser: AppUser; users: AppUser[]; transfers: Transfer[];
    onBack: () => void; onSendTransfer: (t: Transfer) => void; onConfirm: (id: string, d?: string) => void; onReject: (id: string) => void; onSmetaUploaded: (pid: string, result: SmetaResult) => void;
    onUpdateStatus: (pid: string, status: "active"|"paused"|"completed") => void;
    onUpdateProject: (pid: string, patch: Partial<Project>) => void;
    onDeleteProject: (pid: string) => void;
  }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"required"|"smeta"|"pending"|"confirmed"|"media">("required");
  const [showEditProject, setShowEditProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  // Ish jarayoni rasm/video — BARCHA xodim (ishchi, brigadir, prorab ham)
  // qo'sha oladi, faqat direktor/o'rinbosar emas (aniq talab).
  const [mediaItems, setMediaItems] = useState<{ id: string; type: 'image'|'video'; url: string; caption?: string; uploadedBy: { userId: string; name: string; role: string }; createdAt: string }[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const loadMedia = async () => {
    setMediaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media`);
      if (res.ok) setMediaItems(await res.json());
    } catch {}
    setMediaLoading(false);
  };
  useEffect(() => { loadMedia(); /* eslint-disable-next-line */ }, [project.id]);
  // Fayl tanlangach darhol yuklanmaydi — avval ko'rinish + izoh (matn) yozish oynasi chiqadi.
  const [pendingMedia, setPendingMedia] = useState<{ file: File; preview: string; type: 'image'|'video' } | null>(null);
  const [pendingCaption, setPendingCaption] = useState("");
  const [editingCaption, setEditingCaption] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => () => { if (pendingMedia) URL.revokeObjectURL(pendingMedia.preview); }, [pendingMedia]);
  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingCaption("");
    setPendingMedia({ file, preview: URL.createObjectURL(file), type: file.type.startsWith('video') ? 'video' : 'image' });
  };
  const submitPendingMedia = async () => {
    if (!pendingMedia) return;
    setUploadingMedia(true);
    try {
      const { url } = await uploadChatMedia(pendingMedia.file, pendingMedia.file.name);
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: pendingMedia.type, caption: pendingCaption.trim() || undefined }),
      });
      if (res.ok) { const m = await res.json(); setMediaItems(prev => [m, ...prev]); toast.success(t('objectDetail.mediaUploaded')); setPendingMedia(null); }
      else toast.error(t('objectDetail.mediaUploadError'));
    } catch { toast.error(t('objectDetail.mediaUploadError')); }
    setUploadingMedia(false);
  };
  const saveCaption = async () => {
    if (!editingCaption) return;
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media/${editingCaption.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caption: editingCaption.text }),
      });
      if (!res.ok) throw new Error();
      const m = await res.json();
      setMediaItems(prev => prev.map(x => x.id === m.id ? { ...x, caption: m.caption } : x));
      setEditingCaption(null);
    } catch { toast.error(t('common.error')); }
  };
  const handleMediaDelete = async (mediaId: string) => {
    if (!window.confirm(t('objectDetail.confirmMediaDelete'))) return;
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media/${mediaId}`, { method: 'DELETE' });
      if (res.ok) setMediaItems(prev => prev.filter(m => m.id !== mediaId));
      else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
  };
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
      {/* MUHIM: header va tab-panel ILGARI ikkalasi ALOHIDA sticky (top-0 va
          top-[53px], qattiq piksel) edi — header uzun nom/status+smeta
          tugmasi tor ekranda IKKI QATORGA o'tganda balandligi 53px'dan
          oshib, tab-panel ustidan bosib qolar edi ("qo'shilib ketgan"
          ko'rinish). Endi ikkalasi BITTA sticky konteynerda — header
          balandligidan qat'i nazar tab-panel doim to'g'ri joyda turadi. */}
      <div className="flex-shrink-0 z-10 sticky top-0">
      <div className="glass border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm md:text-xs text-muted-foreground hover:text-foreground transition-colors"><MorphIcon icon={ArrowLeft} className="w-4 h-4" />{t('common.back')}</button>
        <div className="w-px h-4 bg-border"/>
        <MorphIcon icon={Building2} className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2">
            {/* MUHIM: truncate avval butun qatorga (matn + select'ga birga)
                qo'yilgan edi — nom uzun bo'lsa, `overflow:hidden` butun
                qatorni qirqib, status tanlovini ko'rinmas qilib qo'yardi
                ("obyekt statusini o'zgartiradigan tugma yo'qolib qoldi").
                Endi faqat nomning o'zi qirqiladi, select doim ko'rinadi. */}
            <span className="truncate min-w-0">{project.name}</span>
            {isAdmin(currentUser.role) && (
              <button type="button" onClick={() => setShowEditProject(true)} aria-label={t('objectDetail.editProject')} title={t('objectDetail.editProject')}
                className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full flex-shrink-0 liquid-transition">
                <MorphIcon icon={Edit} className="w-3.5 h-3.5" />
              </button>
            )}
            {isAdmin(currentUser.role) && (
              <button type="button" onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/api/objects/${project.id}/client-link`, { method: 'POST' });
                  const data = await res.json();
                  if (res.ok && data.url) {
                    await navigator.clipboard.writeText(data.url).catch(() => {});
                    toast.success(t('objectDetail.clientLinkCopied'));
                  } else toast.error(t('common.error'));
                } catch { toast.error(t('common.error')); }
              }} aria-label={t('objectDetail.clientLinkBtn')} title={t('objectDetail.clientLinkBtn')}
                className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full flex-shrink-0 liquid-transition">
                <MorphIcon icon={Share2} className="w-3.5 h-3.5" />
              </button>
            )}
            {isAdmin(currentUser.role) && (
              <button type="button" disabled={deletingProject} onClick={async () => {
                if (!confirm(t('objectDetail.confirmDeleteProject', { name: project.name }))) return;
                setDeletingProject(true);
                try {
                  const res = await fetch(`${API_BASE}/api/objects/${project.id}`, { method: 'DELETE' });
                  if (res.ok) {
                    toast.success(t('objectDetail.deleteProjectSuccess'));
                    onDeleteProject(project.id);
                    onBack();
                  } else toast.error(t('objectDetail.deleteProjectError'));
                } catch { toast.error(t('objectDetail.deleteProjectError')); }
                setDeletingProject(false);
              }} aria-label={t('objectDetail.deleteProject')} title={t('objectDetail.deleteProject')}
                className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full flex-shrink-0 liquid-transition disabled:opacity-50">
                {deletingProject ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Trash} className="w-3.5 h-3.5" />}
              </button>
            )}
            <select
              className="text-xs bg-transparent border-none font-semibold focus:outline-none cursor-pointer liquid-transition outline-none flex-shrink-0"
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
        {/* Tor ekranda (telefon) bu qator status-select bilan "qo'shilib
            ketardi" — endi w-full bilan navbatdagi qatorga tushadi, katta
            ekranda (sm+) xuddi eskisidek bir qatorda turaveradi. */}
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
          <input type="file" id="smeta-upload" className="hidden" accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.txt" onChange={async e=>{
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
                  {smetaMsg.startsWith('✓') ? <MorphIcon icon={CheckCircle} className="w-3.5 h-3.5 flex-shrink-0" /> : smetaMsg.startsWith('✗') ? <MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0" /> : <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
                  <span className="truncate max-w-[180px]">{smetaMsg.replace(/^[✓✗]\s*/, '') || t('objectDetail.uploading')}</span>
                </div>
                {smetaPercent > 0 && !smetaMsg.startsWith('✗') && <div className="w-full bg-accent/20 rounded-full h-1 mt-0.5"><div className={`${smetaMsg.startsWith('✓') ? 'bg-green-500' : 'bg-accent'} h-1 rounded-full liquid-transition`} style={{width:`${smetaPercent}%`}}/></div>}
              </>
            ) : <><MorphIcon icon={Download} className="w-3.5 h-3.5" />{t('objectDetail.smetaUpload')}</>}
          </label>
          <button onClick={()=>{setInitialTransferData(undefined);setShowSend(true);}} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2.5 py-1.5 rounded hover:bg-primary/90 font-medium liquid-transition shadow-sm"><MorphIcon icon={Send} className="w-3.5 h-3.5" />{t('common.send')}</button>
        </div>
      </div>
      <div className="glass border-b border-border px-3 py-2 flex gap-1 overflow-x-auto scrollbar-hide">
        {([["required",t('objectDetail.tabRequired'),project.requiredMaterials.length], ...(project.smeta ? [["smeta",t('objectDetail.tabSmeta'),project.smeta.resources.length] as [string,string,number]] : []), ["pending",t('objectDetail.tabPending'),pendT.length],["confirmed",t('objectDetail.tabConfirmed'),confT.length],["media",t('objectDetail.tabMedia'),mediaItems.length]] as [string,string,number][]).map(([k,l,c])=>(
          <button key={k} onClick={()=>setTab(k as any)} className={`relative flex items-center gap-1.5 text-sm md:text-xs py-2 px-3 rounded-full font-medium liquid-transition whitespace-nowrap ${tab===k?"text-primary":"text-muted-foreground hover:text-foreground"}`}>
            {tab===k && (
              <motion.div layoutId="objectDetailTabPill" className="absolute inset-0 rounded-full bg-primary/10 -z-10"
                transition={{ type: "spring", stiffness: 480, damping: 34 }}  />
            )}
            {l}<span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${tab===k?"bg-primary text-white":"bg-muted text-muted-foreground"}`}>{c}</span>
          </button>
        ))}
      </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {tab==="smeta" && project.smeta && <SmetaResultView smeta={project.smeta}/>}
        {tab==="required" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Kompakt tepa: qidiruv + soni + byudjet (bitta yupqa qator).
                "Sodda chiroyli compact" dizayn talabi: pill-shakldagi qidiruv
                + alohida chip'lar (avvalgi qattiq chiziqli input + oddiy matn
                o'rniga) — zich joy egallashda davom etadi, faqat ko'rinishi
                boshqa joylardagi (.surface, rounded-full chip) uslubga mos. */}
            <div className="flex-shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-border/50 bg-muted/10">
              <div className="relative flex-1 min-w-0">
                <MorphIcon icon={Search} className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="text" placeholder={t('objectDetail.searchMaterial')} value={matSearch} onChange={e=>setMatSearch(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-input-background border border-border rounded-full focus:outline-none focus:ring-1 focus:ring-primary liquid-transition"/>
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap shrink-0 bg-muted/60 px-2 py-1 rounded-full">{filteredMats.length} ta</span>
              <span className="text-[10px] font-semibold text-primary whitespace-nowrap shrink-0 bg-primary/10 px-2 py-1 rounded-full">{fmt(project.budget)}</span>
            </div>
            {/* Zich jadval — barcha materiallar minimal joyda. MUHIM:
                overflow-x-auto avval yo'q edi — 5 ustunli jadval tor
                (mobil) ekranga sig'masdan, o'ng tomondagi ustunlar (Narx,
                Summa) ko'rish/scroll qilib bo'lmaydigan holda "yo'qolib"
                qolardi. min-w-max jadvalni siqib qisqartirish o'rniga
                o'z tabiiy kengligida saqlaydi, konteyner esa uni gorizontal
                aylantirishga imkon beradi. */}
            {/* min-h-0 SHART: flex-1 + overflow-auto bo'lsagina scroll
                ishlaydi deb o'ylanardi, lekin bu yo'q bo'lsa flex element
                o'z ICHIDAGI kontent balandligidan kichik bo'lishni "rad
                etadi" (flex bolalarining standart min-height:auto) — natijada
                jadval pastga cheksiz o'sib, ko'rinmas qismi hech qanday
                scrollsiz shunchaki kesilib qolardi ("davomini ko'rish uchun
                scroll bo'lmayapti"). */}
            {/* XATO TUZATILDI: avval shu BITTA <div> ham vertikal (qatorlar
                ro'yxati), ham gorizontal (keng jadval) scrollni birga
                bajarishga urinardi (overflow-auto = ikkalasi). Mobil
                teginish-imo-ishoralarida bu noaniq: chapga suring desa ham
                brauzer ko'pincha vertikal scroll deb "qulflab" qo'yadi —
                natijada gorizontal suzish DEYARLI ishlamaydi (aniq xabar
                qilingan xato: "chapga qilirlamayadpi"). Endi ikkita ALOHIDA
                konteyner: TASHQI faqat vertikal (butun jadval + sticky sarlavha
                yuqoriga-pastga suriladi), ICHKI faqat gorizontal (qator
                matni chapga-o'ngga suriladi) — ikki yo'nalish endi bir-biriga
                xalaqit bermaydi. */}
            {/* touch-action CHEKLOVSIZ (auto): brauzer barmoq yo'nalishini o'zi aniqlaydi — gorizontal
                surish jadvalni, vertikal surish sahifani suradi. Avval jadvalda touch-pan-x bor edi va
                u telefonda jadval ustidan PASTGA surishni butunlay to'sib qo'yardi. */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide pb-20 sm:pb-2">
              <div className="overflow-x-auto" onWheel={hwheel}>
                <table className="w-full xl:w-auto xl:min-w-[760px] min-w-[560px] text-left border-collapse text-[11px] leading-tight">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border">
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground">{t('objectDetail.colName')}</th>
                      <th className="px-4 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{t('objectDetail.colUnit')}</th>
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">{t('objectDetail.colQty')}</th>
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">{t('objectDetail.colPrice')}</th>
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">{t('objectDetail.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMats.map((m, i) => {
                      const total = m.price != null ? m.price * m.quantity : null;
                      return (
                        <tr key={m.id} onClick={() => setSelectedMat(m)}
                          className={`cursor-pointer hover:bg-primary/5 border-b border-border/25 liquid-transition ${i % 2 === 1 ? "bg-muted/15" : ""}`}>
                          <td className="px-2.5 py-1.5 font-semibold text-primary leading-snug" title={m.name}><div className="min-w-[220px] max-w-[480px] line-clamp-2">{m.name}</div></td>
                          <td className="px-4 py-1.5 text-muted-foreground whitespace-nowrap">{m.unit}</td>
                          <td className="px-2.5 py-1.5 font-mono text-right whitespace-nowrap">{fmtNum(m.quantity)}</td>
                          <td className="px-2.5 py-1.5 font-mono text-right whitespace-nowrap text-muted-foreground">{m.price != null ? fmtNum(m.price) : "—"}</td>
                          <td className="px-2.5 py-1.5 font-mono text-right font-semibold whitespace-nowrap">{total != null ? fmtNum(total) : "—"}</td>
                        </tr>
                      );
                    })}
                    {filteredMats.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-10 text-center text-muted-foreground">
                        <MorphIcon icon={Package} className="w-8 h-8 mx-auto mb-2 opacity-25" />
                        {project.requiredMaterials.length === 0 ? t('objectDetail.noSmeta') : t('common.notFound')}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {tab==="pending" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {pendT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><MorphIcon icon={CheckCircle} className="w-10 h-10 mx-auto mb-2 text-green-400 opacity-50" /><p className="text-sm md:text-xs">{t('objectDetail.noPending')}</p></div>
            :pendT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
        {tab==="confirmed" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {confT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><MorphIcon icon={Package} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('objectDetail.noConfirmed')}</p></div>
            :confT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
        {tab==="media" && (
          <div className="flex-1 overflow-y-auto p-3 scrollbar-hide pb-24 sm:pb-4 space-y-3 animate-slide-up-fade">
            {/* Aniq talab: BARCHA xodim (ishchi, brigadir, prorab ham)
                qo'sha oladi — direktor/o'rinbosarga cheklanmagan. */}
            <input ref={mediaFileRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleMediaUpload} />
            <button onClick={() => mediaFileRef.current?.click()} disabled={uploadingMedia}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold border-2 border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary liquid-transition disabled:opacity-50">
              <MorphIcon icon={Camera} className="w-4 h-4" />{t('objectDetail.mediaAddBtn')}
            </button>
            {pendingMedia && (
              <div className="surface border border-primary/25 rounded-2xl p-3 flex flex-col sm:flex-row gap-3 animate-slide-up-fade">
                <div className="w-full sm:w-40 h-40 sm:h-32 rounded-xl overflow-hidden bg-black/80 flex-shrink-0">
                  {pendingMedia.type === 'video'
                    ? <video src={pendingMedia.preview} className="w-full h-full object-contain" controls playsInline />
                    : <img src={pendingMedia.preview} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <textarea value={pendingCaption} onChange={e => setPendingCaption(e.target.value.slice(0, 300))} rows={3} autoFocus
                    placeholder={t('objectDetail.mediaCaptionPh', "Izoh yozing (ixtiyoriy) — nima qilindi, qayerda...")}
                    className="w-full flex-1 text-sm rounded-xl border border-border bg-background/60 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  <div className="flex gap-2">
                    <button onClick={() => setPendingMedia(null)} disabled={uploadingMedia}
                      className="flex-1 sm:flex-none h-10 px-4 rounded-xl text-sm font-semibold border border-border hover:bg-muted liquid-transition disabled:opacity-50">{t('common.cancel')}</button>
                    <button onClick={submitPendingMedia} disabled={uploadingMedia}
                      className="flex-1 sm:flex-none h-10 px-5 rounded-xl text-sm font-bold bg-primary text-primary-foreground flex items-center justify-center gap-2 hover:opacity-90 liquid-transition disabled:opacity-60">
                      {uploadingMedia ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Send} className="w-4 h-4" />}
                      {uploadingMedia ? t('objectDetail.mediaUploading') : t('objectDetail.mediaPublish', "Joylash")}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {mediaLoading ? (
              <SkeletonList items={3} withAvatar={false} />
            ) : mediaItems.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground animate-pop-in"><MorphIcon icon={Camera} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('objectDetail.mediaEmpty')}</p></div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {mediaItems.map(m => {
                  const canManage = m.uploadedBy?.userId === currentUser.id || isAdmin(currentUser.role);
                  const editing = editingCaption?.id === m.id;
                  return (
                  <div key={m.id} className="surface border border-border/70 rounded-2xl overflow-hidden flex flex-col">
                    <button type="button" onClick={() => openMediaViewer(m.url, m.type)} className="relative block w-full aspect-[4/3] bg-muted overflow-hidden group">
                      {m.type === 'video' ? (
                        <>
                          <video src={`${m.url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                            <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center text-white shadow-lg group-hover:scale-110 liquid-transition">
                              <svg viewBox="0 0 24 24" className="w-5 h-5 ml-0.5" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>
                            </span>
                          </span>
                        </>
                      ) : (
                        <SafeImg src={m.url} className="w-full h-full object-cover group-hover:scale-[1.03] liquid-transition" />
                      )}
                    </button>
                    <div className="p-2.5 flex-1 flex flex-col gap-1.5 min-w-0">
                      {editing ? (
                        <textarea value={editingCaption!.text} autoFocus rows={3}
                          onChange={e => setEditingCaption({ id: m.id, text: e.target.value.slice(0, 300) })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCaption(); } if (e.key === 'Escape') setEditingCaption(null); }}
                          className="w-full text-xs rounded-lg border border-border bg-background/60 px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
                      ) : m.caption ? (
                        <p className="text-xs text-foreground/85 leading-snug line-clamp-3 break-words whitespace-pre-wrap">{m.caption}</p>
                      ) : null}
                      <div className="mt-auto flex items-center gap-1.5 min-w-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold truncate">{m.uploadedBy?.name || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}</p>
                        </div>
                        {canManage && (editing ? (
                          <>
                            <button onClick={() => setEditingCaption(null)} aria-label={t('common.cancel')} className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4" /></button>
                            <button onClick={saveCaption} aria-label={t('common.save')} className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary text-primary-foreground hover:opacity-90 liquid-transition"><MorphIcon icon={Check} className="w-4 h-4" /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setEditingCaption({ id: m.id, text: m.caption || '' })} aria-label={t('common.edit')} title={t('common.edit')}
                              className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 liquid-transition"><MorphIcon icon={Edit} className="w-4 h-4" /></button>
                            <button onClick={() => handleMediaDelete(m.id)} aria-label={t('common.delete')} title={t('common.delete')}
                              className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500/20 liquid-transition"><MorphIcon icon={Trash2} className="w-4 h-4" /></button>
                          </>
                        ))}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {showSend && <SendTransferModal currentUser={currentUser} projects={[project]} allUsers={users} onClose={()=>setShowSend(false)} onSend={t=>{onSendTransfer(t);setShowSend(false);}} initialTransfer={initialTransferData}/>}
      {selectedMat && <MaterialDetailsModal mat={selectedMat} confT={confT} pendT={pendT} objectId={project.id} canEdit={isAdmin(currentUser.role)}
        onClose={() => setSelectedMat(null)} onSend={() => {
        setInitialTransferData({ projectId: project.id, materialName: selectedMat.name, unit: selectedMat.unit });
        setShowSend(true);
      }}
        onUpdated={patch => {
          const updated = { ...selectedMat, ...patch };
          onUpdateProject(project.id, { requiredMaterials: project.requiredMaterials.map(m => m.id === selectedMat.id ? updated : m) });
          setSelectedMat(updated);
        }} />}
      {showEditProject && (
        <ProjectEditModal project={project} users={users} onClose={() => setShowEditProject(false)}
          onSave={patch => { onUpdateProject(project.id, patch); setShowEditProject(false); }} />
      )}
    </div>
  );
}

// ─── Loyihani tahrirlash modali ───────────────────────────────────────────────
function ProjectEditModal({ project, users, onClose, onSave }:
  { project: Project; users: AppUser[]; onClose: () => void; onSave: (patch: Partial<Project>) => void }) {
  const { t } = useTranslation();
  useModalPresence();
  const [name, setName] = useState(project.name);
  const [budget, setBudget] = useState(project.budget ? String(project.budget) : "");
  const [location, setLocation] = useState(project.location || "");
  const [foremanId, setForemanId] = useState(project.foremanId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const foremen = users.filter(u => u.role === 'prorab' || u.role === 'brigadir' || u.role === 'direktor' || u.role === 'orinbosar');

  const save = async () => {
    if (name.trim().length < 2) { setError(t('objectDetail.editNameError')); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), budget: budget ? Number(budget) : null, location: location.trim(), foremanId: foremanId || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('common.error')); return; }
      onSave({ name: name.trim(), budget: budget ? Number(budget) : 0, location: location.trim(), foremanId: foremanId || undefined });
    } catch { setError(t('common.error')); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" onClick={onClose}>
      <div className="glass-modal rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Edit} className="w-4 h-4 text-primary" />{t('objectDetail.editProject')}</h3>
          <button aria-label={t('groupCreate.close')} onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>
        {error && <div className="bg-red-500/10 text-red-600 text-xs p-2 rounded-lg mb-2">{error}</div>}
        <div className="space-y-2.5">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editNameLabel')}</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editBudgetLabel')}</label>
            <input type="number" min="0" value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editLocationLabel')}</label>
            <LocationInput value={location} onChange={setLocation} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editForemanLabel')}</label>
            <select value={foremanId} onChange={e => setForemanId(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
              <option value="">{t('objectDetail.editForemanNone')}</option>
              {foremen.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <button disabled={saving} onClick={save} className="btn btn-primary w-full py-2.5 mt-4 disabled:opacity-50">
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ─── Material Details Modal ───────────────────────────────────────────────────
function MaterialDetailsModal({ mat, confT, pendT, objectId, canEdit, onClose, onSend, onUpdated }:
  { mat: ReqMat; confT: Transfer[]; pendT: Transfer[]; objectId: string; canEdit?: boolean; onClose: () => void; onSend?: () => void; onUpdated?: (patch: Partial<ReqMat>) => void; }) {
  // `t` diqqat: bu komponentda transfer o'zgaruvchisi sifatida ham ishlatiladi
  // (.filter/.map(t=>...)), shuning uchun tarjima funksiyasi `tt` deb nomlangan.
  const { t: tt } = useTranslation();
  useModalPresence();
  const sent = confT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const pending = pendT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const totalSpent = sent * (mat.price || 0);

  const [editing, setEditing] = useState(false);
  const [eName, setEName] = useState(mat.name);
  const [eUnit, setEUnit] = useState(mat.unit);
  const [eQty, setEQty] = useState(String(mat.quantity));
  const [ePrice, setEPrice] = useState(mat.price != null ? String(mat.price) : "");
  const [saving, setSaving] = useState(false);

  const saveEdit = async () => {
    if (!eName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/materials/object/${objectId}/by-name`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentName: mat.name, name: eName.trim(), unit: eUnit.trim(), needed: Number(eQty) || 0, price: ePrice ? Number(ePrice) : null }),
      });
      if (res.ok) {
        onUpdated?.({ name: eName.trim(), unit: eUnit.trim(), quantity: Number(eQty) || 0, price: ePrice ? Number(ePrice) : undefined });
        setEditing(false);
      } else toast.error(tt('common.error'));
    } catch { toast.error(tt('common.error')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex flex-col justify-end sm:justify-center sm:items-center backdrop-blur-sm liquid-transition">
      <div className="bg-background/90 backdrop-blur-xl w-full sm:w-[450px] sm:rounded-2xl rounded-t-[2rem] overflow-hidden animate-slide-up-fade flex flex-col shadow-2xl border border-white/20">
        <div className="p-5 border-b border-border/50 flex justify-between items-center bg-card/50">
          <h3 className="font-semibold text-base truncate pr-4">{mat.name}</h3>
          <div className="flex items-center gap-2">
            {canEdit && !editing && <button onClick={()=>setEditing(true)} aria-label={tt('materialDetails.editBtn')} title={tt('materialDetails.editBtn')} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full liquid-transition"><MorphIcon icon={Edit} className="w-4 h-4" /></button>}
            {onSend && <button onClick={()=>{onClose(); onSend();}} className="flex items-center gap-1.5 bg-primary text-white text-sm md:text-xs px-3 py-1.5 rounded-full hover:bg-primary/90 font-medium liquid-transition shadow-md shadow-primary/20"><MorphIcon icon={Send} className="w-3 h-3" />{tt('common.send')}</button>}
            <button aria-label={tt('common.close')} onClick={onClose} className="p-1.5 text-muted-foreground hover:bg-muted/50 rounded-full liquid-transition bg-muted/20"><MorphIcon icon={X} className="w-4 h-4" /></button>
          </div>
        </div>
        {editing ? (
          <div className="p-4 space-y-2.5">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.editNameLabel')}</label>
              <input value={eName} onChange={e=>setEName(e.target.value)} autoFocus className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.colUnit')}</label>
                <input value={eUnit} onChange={e=>setEUnit(e.target.value)} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.colQty')}</label>
                <input type="number" min="0" value={eQty} onChange={e=>setEQty(e.target.value)} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.colPrice')}</label>
              <input type="number" min="0" value={ePrice} onChange={e=>setEPrice(e.target.value)} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={()=>setEditing(false)} className="btn btn-outline flex-1 py-2">{tt('common.cancel')}</button>
              <button onClick={saveEdit} disabled={saving} className="btn btn-primary flex-1 py-2 disabled:opacity-50">{tt('common.save')}</button>
            </div>
          </div>
        ) : (
        <div className="p-4 overflow-y-auto overflow-x-hidden">
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
        )}
      </div>
    </div>
  );
}

// ─── Currency utils ────────────────────────────────────────────────────────────
// Global rates — fetched from backend (CBU Uzbekistan) and cached
let LIVE_USD_RATE = 12900;
let LIVE_EUR_RATE = 14100;
let LIVE_RATE_DATE = "";

export async function fetchLiveCurrencyRates(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/currency/rates`);
    if (res.ok) {
      const data = await res.json();
      LIVE_USD_RATE = data.USD || LIVE_USD_RATE;
      LIVE_EUR_RATE = data.EUR || LIVE_EUR_RATE;
      LIVE_RATE_DATE = data.date || "";
    }
  } catch {}
}

function fmtUsd(uzs: number): string { return "$" + (uzs / LIVE_USD_RATE).toFixed(2); }
function fmtEur(uzs: number): string { return "€" + (uzs / LIVE_EUR_RATE).toFixed(2); }

// ─── Finance Page ──────────────────────────────────────────────────────────────
export function FinancePage({ currentUser, users, projects, expenses, onAddExpense, onConfirm, onApprove, onReject }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; expenses: Expense[]; onAddExpense: (e: Expense) => void; onConfirm: (id: string) => void; onApprove?: (id: string, note?: string) => void; onReject?: (id: string) => void }) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"all"|ExpType>("all");
  const [projFilter, setProjFilter] = useState("all");
  const [detailExp, setDetailExp] = useState<Expense|null>(null);
  const [showCurrency, setShowCurrency] = useState(false);
  const [currencyAmount, setCurrencyAmount] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"uzs2usd"|"usd2uzs"|"uzs2eur"|"eur2uzs">("uzs2usd");

  const filteredExpenses = expenses.filter(e => (filter==="all"||e.type===filter) && (projFilter==="all"||e.projectId===projFilter));

  const totalExpense = expenses.filter(e=>e.status==="confirmed").reduce((a,e)=>a+e.amount,0);
  const isAdmin = ['direktor','orinbosar'].includes(currentUser.role);
  const pendingMe = isAdmin
    ? expenses.filter(e=>e.requiresAdminApproval&&e.status==="pending").length
    : expenses.filter(e=>e.toUserId===currentUser.id&&e.status==="pending").length;
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
          <p className="text-sm md:text-xs text-muted-foreground">{t('finance.totalConfirmed')} <span className="font-semibold text-accent">{fmt(totalExpense)}</span> <span className="text-[10px] text-muted-foreground/70">≈ {fmtUsd(totalExpense)}</span></p>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingMe>0&&<span className="text-sm md:text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-full font-semibold flex items-center gap-1 badge-pulse"><MorphIcon icon={Clock} className="w-3 h-3" />{t('finance.pendingCount', { count: pendingMe })}</span>}
          <button onClick={()=>setShowCurrency(v=>!v)} title={t('currency.title')} aria-label={t('currency.title')} className="btn btn-outline flex items-center gap-1 text-sm md:text-xs px-2.5 py-1.5 rounded-full"><MorphIcon icon={DollarSign} className="w-3 h-3" /></button>
          <button onClick={()=>setShowAdd(true)} className="btn btn-accent flex items-center gap-1 text-sm md:text-xs px-3 py-1.5 rounded-full"><MorphIcon icon={Plus} className="w-3 h-3" />{t('finance.addExpense')}</button>
        </div>
      </div>
      {/* Currency converter mini widget */}
      {showCurrency && (
        <div className="surface px-4 py-3 flex-shrink-0 animate-slide-up-fade">
          <p className="text-[10px] font-semibold text-muted-foreground mb-2">{t('currency.title')} — 1 USD = {LIVE_USD_RATE.toLocaleString()} UZS &nbsp;|&nbsp; 1 EUR = {LIVE_EUR_RATE.toLocaleString()} UZS{LIVE_RATE_DATE ? ` (${LIVE_RATE_DATE})` : ""}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={currencyMode} onChange={e=>setCurrencyMode(e.target.value as any)} className="text-[10px] bg-muted text-muted-foreground px-2 py-1 rounded-full font-semibold border-0 focus:outline-none cursor-pointer flex-shrink-0">
              <option value="uzs2usd">UZS → USD</option>
              <option value="usd2uzs">USD → UZS</option>
              <option value="uzs2eur">UZS → EUR</option>
              <option value="eur2uzs">EUR → UZS</option>
            </select>
            <input type="number" value={currencyAmount} onChange={e=>setCurrencyAmount(e.target.value)}
              placeholder={currencyMode.startsWith("uzs")?"UZS":currencyMode.startsWith("usd")?"USD":"EUR"}
              className="flex-1 min-w-[80px] text-sm border border-border rounded-xl px-3 py-1.5 bg-input-background focus:outline-none"/>
            {(() => {
              const n = parseFloat(currencyAmount);
              const result = currencyAmount && !isNaN(n) ? (
                currencyMode==="uzs2usd" ? "$" + (n/LIVE_USD_RATE).toFixed(2) :
                currencyMode==="usd2uzs" ? (n*LIVE_USD_RATE).toLocaleString() + " UZS" :
                currencyMode==="uzs2eur" ? "€" + (n/LIVE_EUR_RATE).toFixed(2) :
                currencyMode==="eur2uzs" ? (n*LIVE_EUR_RATE).toLocaleString() + " UZS" : null
              ) : null;
              return (
                <button type="button" disabled={!result} title={result ? t('currency.copyHint') : undefined}
                  onClick={() => { if (!result) return; navigator.clipboard?.writeText(result).then(() => toast.success(t('currency.copied'))).catch(() => {}); }}
                  className="ml-auto flex items-center gap-1.5 text-sm font-bold text-accent font-mono text-right liquid-transition rounded-lg px-1.5 py-0.5 -mr-1.5 hover:bg-accent/10 active:scale-95 disabled:cursor-default disabled:hover:bg-transparent">
                  {result || "—"}
                  {result && <MorphIcon icon={Copy} className="w-3 h-3 opacity-50 flex-shrink-0" />}
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="surface px-4 py-2.5 flex gap-2 flex-wrap flex-shrink-0">
        <select className="text-sm md:text-xs border border-border rounded-full px-3 py-1.5 bg-input-background focus:outline-none" value={projFilter} onChange={e=>setProjFilter(e.target.value)}>
          <option value="all">{t('finance.allObjects')}</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={()=>setFilter("all")} className={`text-sm md:text-xs px-3 py-1.5 rounded-full font-medium liquid-transition ${filter==="all"?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{t('finance.all')}</button>
          {(Object.keys(EXP_LABELS) as ExpType[]).map(k=><button key={k} onClick={()=>setFilter(k)} className={`text-sm md:text-xs px-3 py-1.5 rounded-full font-medium liquid-transition ${filter===k?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{expLabel(t, k)}</button>)}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 scrollbar-hide">
        {filteredExpenses.length===0
          ? <div className="text-center py-10 text-muted-foreground"><MorphIcon icon={Wallet} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('finance.notFound')}</p></div>
          : filteredExpenses.map(e=>{
              const to=users.find(u=>u.id===e.toUserId);
              const proj=projects.find(p=>p.id===e.projectId);
              const creator=users.find(u=>u.id===e.createdById);
              const canConfirm=e.toUserId===currentUser.id&&e.status==="pending"&&!e.requiresAdminApproval;
              // approverId belgilangan bo'lsa — FAQAT o'sha admin tasdiqlay oladi
              // (backend PATCH /:id/approve'dagi bir xil qoida). approverId yo'q
              // (eski) yozuvlar uchun — eski xatti-harakat, istalgan admin tasdiqlaydi.
              const canAdminApprove=isAdmin&&e.requiresAdminApproval&&e.status==="pending"&&(!e.approverId||e.approverId===currentUser.id);
              const approver=e.approverId?users.find(u=>u.id===e.approverId):undefined;
              const borderColor = e.status==="confirmed" ? "#22c55e" : e.requiresAdminApproval ? "#e5633a" : "#f59e0b";
              return (
                <button key={e.id} onClick={()=>setDetailExp(e)} className="w-full text-left surface rounded-2xl p-3 text-sm md:text-xs hover:bg-muted/20 liquid-transition" style={{ borderLeft: `4px solid ${borderColor}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${typeClr[e.type] || "bg-muted text-muted-foreground"}`}>{expLabel(t, e.type as ExpType) || e.type}</span>
                        {e.requiresAdminApproval&&e.status==="pending"&&<span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-accent/15 text-accent">{t('approvalChain.needsApproval')}</span>}
                      </div>
                      <p className="font-semibold text-foreground">{e.anomaly && <span className="mr-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">⚠ {t('finance.anomaly', { defaultValue: "G'ayrioddiy" })}</span>}{e.description || expLabel(t, e.type as ExpType)}</p>
                      <p className="text-sm md:text-xs text-muted-foreground mt-0.5">{proj?.name || e.objectLabel || "—"}{e.recipientName ? ` • 👤 ${e.recipientName}` : ""} • {e.date}</p>
                      {to&&<p className="text-sm md:text-xs text-muted-foreground">{t('finance.to')} <span className="font-medium">{to.name}</span></p>}
                      {creator&&<p className="text-sm md:text-xs text-muted-foreground">{t('finance.createdBy')} {creator.name}</p>}
                      {approver&&e.status==="pending"&&<p className="text-sm md:text-xs text-muted-foreground">{t('approvalChain.approver')} <span className="font-medium">{approver.name}</span></p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-accent">{fmt(e.amount)}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{fmtUsd(e.amount)}</p>
                      {e.status==="confirmed"
                        ?<p className="text-[9px] text-green-800 dark:text-green-400 font-semibold mt-1 flex items-center gap-0.5 justify-end"><MorphIcon icon={CheckCircle} className="w-2.5 h-2.5" />{t('finance.confirmed')}</p>
                        :<p className="text-[9px] text-amber-800 dark:text-amber-400 font-semibold mt-1 flex items-center gap-0.5 justify-end"><MorphIcon icon={Clock} className="w-2.5 h-2.5" />{t('finance.pending')}</p>}
                    </div>
                  </div>
                  {canConfirm&&<button onClick={e2=>{e2.stopPropagation();onConfirm(e.id);}} className="mt-2 w-full text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={Check} className="w-3 h-3" />{t('finance.confirmAction')}</button>}
                  {canAdminApprove&&(
                    <div className="mt-2 flex gap-2" onClick={e2=>e2.stopPropagation()}>
                      <button onClick={()=>onApprove?.(e.id)} className="flex-1 text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={Check} className="w-3 h-3" />{t('approvalChain.approve')}</button>
                      <button onClick={()=>onReject?.(e.id)} className="flex-1 text-sm md:text-xs bg-red-600 text-white rounded py-1.5 hover:bg-red-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={X} className="w-3 h-3" />{t('approvalChain.reject')}</button>
                    </div>
                  )}
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
  const approver = expense.approverId ? users.find(u => u.id === expense.approverId) : undefined;
  const rows: [string, string][] = [
    ...(expense.currency && expense.currency !== 'UZS' && expense.originalAmount
      ? [[t('finance.originalAmount', { defaultValue: 'Asl summa' }), `${expense.originalAmount.toLocaleString('ru-RU')} ${expense.currency === 'USD' ? '$' : '€'}`] as [string, string]] : []),
    [t('reports.table.date'), expense.date],
    [t('reports.table.type'), expLabel(t, expense.type)],
    [t('finance.to'), to?.name || expense.recipientName || "—"],
    [t('reports.table.project'), proj?.name || expense.objectLabel || "—"],
    [t('finance.createdBy'), creator?.name || "—"],
    ...(approver && expense.status === 'pending' ? [[t('approvalChain.approver'), approver.name] as [string, string]] : []),
    ...(confirmer ? [[t('finance.confirmedBy'), confirmer.name] as [string, string]] : []),
  ];
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm overflow-hidden animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Wallet} className="w-4 h-4 text-accent" />{t('finance.detailTitle')}</h3>
          <button aria-label={t('common.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <p className="text-base font-bold text-foreground">{expense.description || expLabel(t, expense.type)}</p>
            <p className="text-lg font-bold text-accent font-mono mt-1">{fmt(expense.amount)} <span className="text-sm font-normal text-muted-foreground">≈ {fmtUsd(expense.amount)}</span></p>
          </div>
          <div className="surface divide-y divide-border/50 overflow-hidden">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-3 py-2 text-sm md:text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{value}</span>
              </div>
            ))}
          </div>
          {expense.approvalHistory && expense.approvalHistory.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">{t('approvalChain.history')}</p>
              <div className="space-y-1.5">
                {expense.approvalHistory.map((h, i) => (
                  <div key={i} className={`flex items-start gap-2 text-[10px] rounded-lg px-2.5 py-1.5 ${h.action==='approved'?'bg-green-500/10 text-green-700 dark:text-green-400':'bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                    {h.action==='approved'?<MorphIcon icon={CheckCircle} className="w-3 h-3 mt-0.5 flex-shrink-0" />:<MorphIcon icon={X} className="w-3 h-3 mt-0.5 flex-shrink-0" />}
                    <span>{h.action==='approved'?t('approvalChain.approvedBy',{name:h.name}):t('approvalChain.rejectedBy',{name:h.name})} — {h.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => exportExpensesToCsv([expense], users, projects, `chiqim_${expense.date}.csv`)}
            className="btn btn-outline w-full flex items-center justify-center gap-1.5 text-sm md:text-xs py-2.5 rounded-full">
            <MorphIcon icon={Download} className="w-3.5 h-3.5" />{t('reports.exportExcel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Voice Message Player ─────────────────────────────────────────────────────
// Ovozli xabar pleyeri — MediaPlayers.tsx (Telegram uslubi: tezlik 1x/1.5x/2x/3x)
export { VoicePlayer };

// ─── Profile Page ──────────────────────────────────────────────────────────────
// ─── Design constants ─────────────────────────────────────────────────────────
export const BG_TEMPLATES = [
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
export const COLOR_THEMES = [
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
export function resizeImageFile(file: File, maxDim: number, quality = 0.85): Promise<string> {
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

// ─── Bottom Finance Bar ──────────────────────────────────────────────────────────────
function BottomFinanceBar({ expenses, projects }: { expenses: Expense[]; projects: Project[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const confirmed = expenses.filter(e=>e.status==="confirmed");
  const total = confirmed.reduce((a,e)=>a+e.amount,0);
  const byProj = projects.map(p=>({name:p.name,amount:confirmed.filter(e=>e.projectId===p.id).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.amount>0);
  const byType = (Object.keys(EXP_LABELS) as ExpType[]).map(k=>({name:expLabel(t, k),amount:confirmed.filter(e=>e.type===k).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.amount>0);
  return (
    <div className="flex-shrink-0 border-b border-white/10 bg-gradient-to-r from-primary to-primary/95 text-white z-20 shadow-md">
      {open&&(
        <div className="border-b border-white/10 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><p className="text-sm md:text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">{t('finance.byProject')}</p>
            {byProj.map(d=><div key={d.name} className="flex items-center justify-between py-0.5"><span className="text-sm md:text-xs text-white/80 truncate mr-4">{d.name}</span><span className="text-sm md:text-xs font-mono font-semibold text-white flex-shrink-0">{fmt(d.amount)}</span></div>)}
          </div>
          <div><p className="text-sm md:text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">{t('finance.byType')}</p>
            {byType.map(d=><div key={d.name} className="flex items-center justify-between py-0.5"><span className="text-sm md:text-xs text-white/80">{d.name}</span><span className="text-sm md:text-xs font-mono font-semibold text-white">{fmt(d.amount)}</span></div>)}
          </div>
        </div>
      )}
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-2"><MorphIcon icon={TrendingDown} className="w-4 h-4 text-white/90" /><span className="text-sm md:text-xs text-white/90">{t('finance.totalExpenses')}</span></div>
        <div className="flex items-center gap-2"><span className="text-sm font-bold font-mono">{fmt(total)}</span><MorphIcon icon={open ? ChevronUp : ChevronDown} className="w-4 h-4 text-white/60" /></div>
      </button>
    </div>
  );
}

// ─── OTP kod qutilar (4 xonali kod uchun) — auto-advance, backspace, paste ──────
function OtpBoxes({ value, onChange, length = 4, autoFocus, error }: { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean; error?: boolean }) {
  const { t } = useTranslation();
  const realRef = useRef<HTMLInputElement | null>(null);
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  // Ko'rinadigan 4 ta katakcha shunchaki DISPLAY — haqiqiy kiritish (teri,
  // backspace, paste, VA eng muhimi — OS SMS-kod autofill) bitta HAQIQIY,
  // shaffof inputga tushadi (autoComplete="one-time-code"). Bu — iOS/Android
  // klaviaturasi kelgan SMS ichidan raqamli kodni avtomatik tanib, klaviatura
  // ustida taklif sifatida ko'rsatadigan STANDART veb-platforma mexanizmi:
  // FAQAT haqiqiy SMS kelganda ishlaydi, hech qachon o'zidan to'ldirmaydi —
  // shu bilan boshqa ilovalardagi kabi tabiiy xatti-harakat olinadi.
  // (Eski versiya 4 ta ALOHIDA inputdan iborat edi — bitta butun kodni
  // avtomatik taqsimlab bera olmasdi, chunki bu attribut bitta maydonga
  // butun kodni tushirishga mo'ljallangan.)
  const handleRealChange = (raw: string) => {
    onChange(raw.replace(/\D/g, "").slice(0, length));
  };

  return (
    <div className="relative flex justify-center gap-2.5">
      <input
        ref={realRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={e => handleRealChange(e.target.value)}
        autoFocus={autoFocus}
        aria-label={t('login.codeLabel')}
        className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-text"
      />
      {digits.map((d, i) => (
        <div key={i} onClick={() => realRef.current?.focus()}
          className={`w-14 h-16 flex items-center justify-center text-2xl font-bold rounded-2xl border bg-white/50 dark:bg-black/20 shadow-inner liquid-transition ${error ? "border-red-500/50" : value.length === i ? "border-primary ring-2 ring-primary/50" : "border-border/50"}`}>
          {d}
        </div>
      ))}
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onRegister, onBack }: { onLogin: (u: any, company?: any) => void; onRegister?: () => void; onBack?: () => void }) {
  const { t, i18n } = useTranslation();
  const [phone, setPhone] = useState("+998 ");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "devpass" | "blocked" | "qr">("phone");
  const [blockedReason, setBlockedReason] = useState<'pending'|'expired'|'rejected'|null>(null);
  const [error, setError] = useState("");
  // Dasturchi paroli "unutdim" oqimi — devpass qadamida qo'shimcha holat.
  const [devResetStage, setDevResetStage] = useState<"none" | "requested" | "done">("none");
  const [devResetCode, setDevResetCode] = useState("");
  const [devResetNewPassword, setDevResetNewPassword] = useState("");
  const [devResetBusy, setDevResetBusy] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loginCompanyName] = useState(() => localStorage.getItem("erp_companyName") || "QurilishERP");
  const [loginCompanyLogo] = useState(() => localStorage.getItem("erp_companyLogo") || "");
  // Ikkilamchi yuborish qarshisiga — tugma tez-tez ikki marta bosilsa (yoki
  // Enter + tugma bosilishi ustma-ust tushsa) so'rov IKKI MARTA ketmasin
  // (aniq talab: kod so'ralganda ikki marta kelib qolgan). handleCheckIn/
  // handleCheckOut'dagi "pending" naqshi bilan bir xil — bitta umumiy
  // bayroq, uchala forma (telefon/kod/dasturchi) ham shuni ishlatadi,
  // chunki bir vaqtning o'zida faqat bittasi ko'rinadi.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (step === "code" && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [step, timeLeft]);

  const handlePhoneSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submitting) return;
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

    setSubmitting(true);
    try {
      // VAQTINCHA Telegram-kod oqimiga qaytarildi (/send-otp EMAS) — Eskiz
      // akkounti hali production uchun tasdiqlanmagan, real SMS kod olib
      // kelolmaydi. /api/auth/send-otp + /api/auth/verify-otp backendda
      // to'liq tayyor va ishlab turibdi (sinovdan o'tgan) — akkount
      // tasdiqlangach shu ikkita fetch manzilini almashtirish kifoya.
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submitting) return;
    const cleanPhone = phone.replace(/\s+/g, "");
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleDevResetRequest = async () => {
    setDevResetBusy(true); setError("");
    try {
      await fetch(API_BASE + "/api/auth/dev-password/request-reset", { method: "POST" });
      setDevResetStage("requested");
    } catch {
      setError(t('login.serverError'));
    } finally {
      setDevResetBusy(false);
    }
  };

  const handleDevResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setDevResetBusy(true); setError("");
    try {
      const res = await fetch(API_BASE + "/api/auth/dev-password/confirm-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: devResetCode, newPassword: devResetNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('login.genericError')); return; }
      setDevResetStage("done");
      setPassword(devResetNewPassword);
    } catch {
      setError(t('login.serverError'));
    } finally {
      setDevResetBusy(false);
    }
  };

  // 4 xona to'lganda avtomatik yuborish (OTP qutilar bilan qulay oqim)
  useEffect(() => {
    if (step === "code" && code.length === 4) handleCodeSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  // Dasturchi login: raqam + parol + (2FA) botga kelgan kod
  const [devNeedCode, setDevNeedCode] = useState(false);
  const [devCode, setDevCode] = useState("");
  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const cleanPhone = phone.replace(/\s+/g, "");
    try {
      const res = await fetch(API_BASE + "/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone, password, ...(devNeedCode && devCode ? { code: devCode } : {}) })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('login.genericError')); if (data.twoFactor && !devNeedCode) setDevNeedCode(true); return; }
      if (data.twoFactor && !data.token) { setDevNeedCode(true); setDevCode(""); setError(""); return; }
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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 py-8 liquid-transition relative overflow-y-auto scrollbar-hide" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      {/* Background decorations */}
      <div className="absolute top-[-8%] left-[-12%] w-[45%] h-[45%] bg-primary/15 rounded-full blur-[120px] blob-anim pointer-events-none" />
      <div className="absolute bottom-[-8%] right-[-12%] w-[45%] h-[45%] bg-accent/15 rounded-full blur-[120px] blob-anim-slow pointer-events-none" />
      <div className="absolute top-[40%] right-[-5%] w-[25%] h-[25%] bg-primary/10 rounded-full blur-[80px] blob-anim pointer-events-none" style={{ animationDelay: '4s' }} />

      {onBack && !isNative() && !isTelegramMiniApp() && (
        <button type="button" onClick={onBack}
          className="absolute left-4 z-10 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground liquid-transition"
          style={{ top: "max(1.25rem, env(safe-area-inset-top))" }}>
          <MorphIcon icon={ArrowLeft} className="w-4 h-4" /> {t('login.homeLink')}
        </button>
      )}

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="mb-8 text-center relative z-10">
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary/20 overflow-hidden">
          <CompanyLogo src={loginCompanyLogo} imgClass="w-full h-full object-contain p-1" iconClass="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold font-['Roboto_Slab',serif] bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">{loginCompanyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('login.subtitle')}</p>
      </motion.div>
      <div className="mb-4 relative z-10">
        <LanguageSwitcher size="sm" value={i18n.language as SiteLang} onChange={l => setSiteLanguage(l)}/>
      </div>
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 280, damping: 26, delay: 0.08 }}
        className="w-full max-w-sm space-y-4 glass p-7 rounded-[2rem] border border-white/25 shadow-2xl shadow-primary/10 relative z-10 overflow-hidden">
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
                <MorphIcon icon={Send} className="w-3 h-3 text-primary" /> {t('login.goToBot', { handle: '@qurilish_erp_bot' })}
              </a>
            </div>
            <div>
              <label htmlFor="login-phone" className="text-sm md:text-xs font-medium block mb-1.5 ml-1 text-muted-foreground">{t('login.phoneLabel')}</label>
              <div className="relative">
                <MorphIcon icon={Phone} className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input id="login-phone" type="text" inputMode="tel" className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono liquid-transition shadow-inner"
                  value={phone} onChange={e => {
                    setError("");
                    const val = e.target.value;
                    if (val.startsWith("+998 ")) setPhone("+998 " + val.slice(5).replace(/\D/g, "").slice(0, 9));
                    else if (val === "+998" || val === "") setPhone("+998 ");
                  }} autoFocus/>
              </div>
            </div>
            <button type="submit" disabled={submitting} className="w-full bg-gradient-to-r from-primary via-primary to-blue-700 text-white text-sm font-bold py-3.5 rounded-full shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98] liquid-transition disabled:opacity-60 disabled:pointer-events-none">
              {t('login.getCode')}
            </button>
            {/* Faqat laptop/planshet ekranida — QRScanner.tsx faqat telefon
                kamerasidan foydalanadi, shu sabab telefon ekranida bu
                variantning ma'nosi yo'q. */}
            {isTabletOrLarger() && (
              <button type="button" onClick={() => setStep("qr")}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-full liquid-transition"
                style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)", color: "white" }}>
                <MorphIcon icon={QrCode} className="w-4 h-4" />
                {t('login.qrLoginLink')}
              </button>
            )}
          </form>
        ) : step === "qr" ? (
          <QrLoginPanel onLogin={onLogin} onBack={() => setStep("phone")} />
        ) : step === "blocked" ? (
          <div className="space-y-4 text-center">
            <div className="flex flex-col items-center gap-3">
              {blockedReason === 'pending' ? (
                <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
                  <MorphIcon icon={Clock} className="w-7 h-7 text-amber-500" />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
                  <MorphIcon icon={AlertCircle} className="w-7 h-7 text-red-500" />
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
              <MorphIcon icon={Send} className="w-4 h-4" /> {t('login.contactAdmin', { handle: '@Sadriddinov_Jahongir' })}
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
            {devNeedCode && (
              <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 space-y-2">
                <p className="text-xs text-muted-foreground text-center">🔐 {t('login.dev2faHint', { defaultValue: "Telegram botga 6 xonali kirish kodi yuborildi" })}</p>
                <input type="text" inputMode="numeric" autoFocus placeholder="••••••" value={devCode}
                  onChange={e => { setError(""); setDevCode(e.target.value.replace(/\D/g, "").slice(0, 6)); }}
                  className="w-full text-xl tracking-[0.4em] text-center font-mono border border-border/50 rounded-xl px-4 py-2.5 bg-white/50 dark:bg-black/20 focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            )}
            <button type="submit" disabled={submitting} className="w-full bg-gradient-to-r from-primary via-primary to-blue-700 text-white text-sm font-bold py-3.5 rounded-full shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98] liquid-transition disabled:opacity-60 disabled:pointer-events-none">
              {t('login.signIn')}
            </button>
            {devResetStage === "none" && (
              <button type="button" onClick={handleDevResetRequest} disabled={devResetBusy}
                className="w-full text-sm md:text-xs text-primary hover:underline py-1 liquid-transition disabled:opacity-60">
                {t('login.devForgotPassword')}
              </button>
            )}
            {devResetStage === "requested" && (
              <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 space-y-2">
                <p className="text-xs text-muted-foreground text-center">{t('login.devResetSentHint')}</p>
                <input type="text" inputMode="numeric" placeholder={t('login.devResetCodePlaceholder') as string}
                  className="w-full text-base text-center border border-border/50 rounded-xl px-4 py-2.5 bg-white/50 dark:bg-black/20 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={devResetCode} onChange={e => setDevResetCode(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                <input type="password" placeholder={t('login.devResetNewPasswordPlaceholder') as string}
                  className="w-full text-sm border border-border/50 rounded-xl px-4 py-2.5 bg-white/50 dark:bg-black/20 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={devResetNewPassword} onChange={e => setDevResetNewPassword(e.target.value)} />
                <button type="button" onClick={handleDevResetConfirm as any} disabled={devResetBusy || devResetCode.length !== 4 || devResetNewPassword.length < 8}
                  className="w-full bg-primary text-white text-sm font-bold py-2.5 rounded-full disabled:opacity-50">
                  {t('login.devResetConfirmBtn')}
                </button>
              </div>
            )}
            {devResetStage === "done" && (
              <p className="text-xs text-green-600 text-center">{t('login.devResetSuccessHint')}</p>
            )}
            <button type="button" onClick={() => { setStep("phone"); setPassword(""); setDevResetStage("none"); }} className="w-full text-sm md:text-xs text-muted-foreground hover:text-foreground py-2 liquid-transition">
              {t('login.changeNumber')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label className="text-sm md:text-xs font-medium block mb-2 text-muted-foreground text-center">{t('login.codeLabel')}</label>
              <OtpBoxes value={code} onChange={v => { setError(""); setCode(v); }} error={!!error} autoFocus/>
            </div>
            <button type="submit" disabled={submitting} className="w-full bg-gradient-to-r from-primary via-primary to-blue-700 text-white text-sm font-bold py-3.5 rounded-full shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98] liquid-transition disabled:opacity-60 disabled:pointer-events-none">
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
            <MorphIcon icon={Building2} className="w-4 h-4 text-primary"  /> {t('login.newUser')}
          </button>
        </div>
      )}

    </main>
  );
}

// ─── Mijoz portali (client portal) ──────────────────────────────────────────
// Login TALAB QILMAYDI — main.tsx URL'da /client/:token ko'rsa, butun
// autentifikatsiyalangan ilova o'rniga shu komponent render qilinadi.
// Faqat xavfsiz/umumiy ma'lumot (nom/holat/progress/rasm-video) —
// moliyaviy tafsilot yo'q (backend/src/routes/publicClient.ts'ga qarang).
export function ClientViewPage({ token }: { token: string }) {
  const [data, setData] = useState<{ name: string; location?: string; status: string; progressPercent: number; media: { type: 'image'|'video'; url: string; caption?: string; createdAt: string }[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${API_BASE}/api/public/client-view/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setError("Havola yaroqsiz yoki bekor qilingan"));
  }, [token]);

  const statusLabel = (s: string) => s === 'active' ? "Faol" : s === 'paused' ? "To'xtatilgan" : "Yakunlangan";
  const statusColor = (s: string) => s === 'active' ? '#22c55e' : s === 'paused' ? '#f59e0b' : '#3b82f6';

  if (error) return (
    <main className="min-h-[100dvh] bg-background flex items-center justify-center p-6 text-center">
      <div>
        <MorphIcon icon={AlertCircle} className="w-10 h-10 mx-auto mb-3 text-destructive opacity-70" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    </main>
  );
  if (!data) return (
    <main className="min-h-[100dvh] bg-background flex items-center justify-center">
      <MorphIcon icon={Loader2} className="w-8 h-8 animate-spin text-primary" />
    </main>
  );

  return (
    <main className="min-h-[100dvh] bg-background">
      <div className="glass border-b border-border px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0"><MorphIcon icon={Building2} className="w-5 h-5" /></div>
        <div className="min-w-0">
          <p className="text-base font-bold truncate">{data.name}</p>
          {data.location && <p className="text-xs text-muted-foreground truncate">{data.location}</p>}
        </div>
      </div>
      <div className="p-5 max-w-2xl mx-auto space-y-5">
        <div className="surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: statusColor(data.status) }}>{statusLabel(data.status)}</span>
            <span className="text-sm font-bold font-mono">{data.progressPercent}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${data.progressPercent}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Material yetkazib berish progressi (moliyaviy ma'lumot ko'rsatilmaydi)</p>
        </div>

        <div>
          <p className="text-sm font-bold mb-2">Ish jarayoni ({data.media.length})</p>
          {data.media.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Hali rasm/video qo'shilmagan</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.media.map((m, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden bg-muted aspect-square">
                  {m.type === 'video' ? <VideoPlayer src={m.url} compact className="w-full h-full" onExpand={() => openMediaViewer(m.url, 'video')} /> : <SafeImg src={m.url} className="w-full h-full object-cover" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { backupLoading, handleBackup, importFileRef, importLoading, handleImportBackup } = useBackupActions();
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
  // v1.3: kirish-oldi oqim — reklama/landing sahifa FAQAT birinchi marta
  // (ushbu qurilma/o'rnatishda hech qachon ochilmagan bo'lsa — veb, Android
  // APK va Windows exe barchasida bir xil qoida) ko'rsatiladi; undan
  // "Kirish"/"Bepul boshlash" orqali login/register'ga o'tiladi. Ikkinchi va
  // keyingi ochilishlarda ("erp_visited" localStorage'da bor) to'g'ridan-
  // to'g'ri login ochiladi. Ro'yxatdan o'tish niyati aniq bo'lsa
  // (link/localStorage) landing'ni baribir chetlab o'tamiz.
  const [authView, setAuthView] = useState<"landing"|"login"|"register">(()=>{
    // Windows .exe (Tauri) / Android APK / iOS — bular marketing sayti
    // EMAS, o'rnatilgan ilova: har qanday boshqa ilova kabi ochilganda
    // to'g'ridan-to'g'ri kirish ekraniga tushadi, landing sahifasi UMUMAN
    // ko'rsatilmaydi (birinchi o'rnatishda ham). Faqat brauzerda (veb
    // sayt sifatida) birinchi tashrifda landing ko'rsatiladi.
    // Telegram Mini App ham marketing sayti emas — faqat kirish ekrani.
    if (isNative() || isTelegramMiniApp()) return "login";
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("rid") || sp.has("register")) return "register";
      if (localStorage.getItem("erp_reg")) return "register";
      // "/landing" va har bir marketing bo'limi uchun ALOHIDA (indekslanadigan)
      // manzil — aniq talab: "harbitta yolga alohida /... hamma bo'limga
      // shunaqa qilib chiq". vercel.json'dagi umumiy SPA rewrite tufayli bu
      // yo'llar allaqachon index.html'ni beradi — yetishmayotgan yagona
      // narsa shu edi: ilova O'ZI shu yo'lni tanib, "erp_visited" belgisidan
      // qat'i nazar (hatto qaytib kelgan brauzerda ham) doim landing
      // sahifasini (kerakli bo'lim bilan) ko'rsatishi. "/landing"da
      // LandingPage'ning O'Z canonical'i "/" ga ishora qiladi (duplicate
      // content emas), bo'lim manzillari esa O'ZLARINING canonical'iga ega
      // (LandingPage.tsx'dagi FOCUS_PATH) — https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
      if (window.location.pathname === "/landing" || SECTION_PATH_TO_FOCUS[window.location.pathname]) return "landing";
    }
    if (typeof window !== "undefined") {
      if (localStorage.getItem("erp_visited")) return "login";
      localStorage.setItem("erp_visited", "1");
    }
    return "landing";
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
  const [globalSearch, setGlobalSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [qrGenData, setQrGenData] = useState<{type:"material"|"object"|"transaction";id:string;name:string}|null>(null);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
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
  // Telegram Mini App: bot orqali ochilganda botga ulangan hisobga avtomatik kirish.
  // Hisob topilmasa/xato bo'lsa — oddiy login ekrani ko'rsatiladi.
  const [tgAutoBusy, setTgAutoBusy] = useState(() => telegramAutoLoginAllowed());
  useEffect(() => {
    if (!tgAutoBusy) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/telegram-webapp`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: getTelegramInitData() }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive || !data?.token || !data?.user) return;
        const u = {
          id: data.user.id || data.user._id,
          name: data.user.firstName + (data.user.lastName ? " " + data.user.lastName : ""),
          phone: data.user.phone, role: data.user.role, projectIds: data.user.projectIds || [],
          isOwner: data.user.isOwner || false, companyId: data.user.companyId, language: data.user.language,
        };
        localStorage.setItem("token", data.token);
        localStorage.setItem("currentUser", JSON.stringify(u));
        if (data.user.language) setSiteLanguage(data.user.language);
        setCurrentUser(u); setPage("dashboard"); applyCompany(data.company);
      } catch { /* login ekrani ko'rsatiladi */ }
      finally { if (alive) setTgAutoBusy(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // XATO TUZATILDI: standart rang "navy" (ko'k) edi — aniq talab bo'yicha
  // yangi (hali hech qanday tanlov qilmagan) foydalanuvchilar uchun standart
  // endi "amber" ("Oltin rang"). Kim ALLAQACHON o'zi tanlab qo'ygan bo'lsa
  // (localStorage'da "erp_colorTheme" bor) — bunga tegilmaydi, faqat
  // localStorage BO'SH bo'lganda (chinakam yangi tashrif) ishlaydi.
  const [colorTheme, setColorTheme] = useState(() => localStorage.getItem("erp_colorTheme") || "amber");
  const [themeMode, setThemeMode] = useState<"light"|"dark"|"system">(
    () => (localStorage.getItem("erp_themeMode") as "light"|"dark"|"system") || "system"
  );
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [syncPending, setSyncPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState<"idle"|"pending"|"syncing"|"synced">("idle");

  // ── Attendance & GPS (App darajasida — sahifadan tashqarida ham ishlaydi) ──
  // gpsTracking holati endi useGeoTracker hook'idan keladi (pastda, liveUser
  // aniqlangandan keyin chaqiriladi).
  const [todayAttendance, setTodayAttendance] = useState<null | { status: string; checkIn?: string; checkOut?: string; workHours?: number }>(null);
  // GPS admin ko'rinishi uchun
  const [gpsLocations, setGpsLocations] = useState<Array<{userId: string; lat: number; lng: number; accuracy?: number; timestamp: string; source?: 'site'|'bot_live'|'bot_once'; speed?: number; battery?: number; charging?: boolean; network?: string}>>([]);
  const [gpsRefreshing, setGpsRefreshing] = useState(false);

  // Offline/online detection + SW sync messages
  // MUHIM: brauzerning "online" hodisasi FAQAT haqiqiy offline→online
  // o'tishida ishga tushadi. Agar so'rov CORS yoki backend xatoligi (masalan
  // Render deploy'i eskirgan) sababli muvaffaqiyatsiz bo'lsa, SW buni ham
  // "offline" deb navbatga qo'yadi — lekin foydalanuvchi HAQIQATDA internetdan
  // hech qachon uzilmagan, shuning uchun "online" hodisasi hech qachon
  // qayta otilmaydi va navbat abadiy "kutmoqda" holida osilib qoladi (aynan
  // shu holat production'da CORS tuzatilmasdan oldin ro'y bergan edi — 17 ta
  // "o'zgartirish kutmoqda" internetga ulangan holda ham ko'rinib turgan edi).
  // Shu sabab: mount bo'lganda va har 90s'da (navbat bo'sh bo'lmasa) — haqiqiy
  // "online" hodisasidan mustaqil — replaydan qayta urinib turamiz, shunda
  // backend tuzalgan zahoti navbat o'zi tozalanadi, foydalanuvchi sahifani
  // qayta yuklashi yoki internetni o'chirib-yoqishi shart bo'lmaydi.
  useEffect(() => {
    const requestReplay = () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'ONLINE' });
      }
    };
    const onOnline = () => { setIsOffline(false); requestReplay(); };
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // SW xabarlarini tinglash
    const handleSWMsg = (e: MessageEvent) => {
      if (e.data?.type === 'SYNC_STATUS') {
        setSyncPending(e.data.count || 0);
        setSyncStatus(e.data.status || 'idle');
        if (e.data.status === 'synced') {
          setTimeout(() => setSyncStatus('idle'), 3000);
        }
      }
    };
    navigator.serviceWorker?.addEventListener?.('message', handleSWMsg);
    // Ilovalardagi (SW'siz) oflayn navbat — api.ts
    const onAppQueue = (e: Event) => handleSWMsg({ data: { type: 'SYNC_STATUS', ...(e as CustomEvent).detail } } as MessageEvent);
    window.addEventListener('erp:offline-queue', onAppQueue);
    if (offlineQueueCount() > 0) { setSyncPending(offlineQueueCount()); setSyncStatus('pending'); }

    // Dastlabki pending count + agar hozir online bo'lsak, eskirgan
    // (stuck) navbatni ham darhol tozalashga urinamiz.
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'GET_PENDING_COUNT' });
      if (navigator.onLine) requestReplay();
    }

    // Sahifa qayta ko'rinadigan bo'lganda (tab almashtirish, ilova qayta
    // ochilishi) ham qayta urinamiz — bu ham haqiqiy "online" hodisasisiz
    // sodir bo'ladigan qayta ulanish holatlarini qamrab oladi.
    const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) requestReplay(); };
    document.addEventListener('visibilitychange', onVisible);

    // Fon rejimida vaqti-vaqti bilan qayta urinish (navbat bo'sh bo'lsa SW
    // darhol qaytadi — arzon operatsiya).
    const retryTimer = setInterval(() => { if (navigator.onLine) requestReplay(); }, 90_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      navigator.serviceWorker?.removeEventListener?.('message', handleSWMsg);
      window.removeEventListener('erp:offline-queue', onAppQueue);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(retryTimer);
    };
  }, []);

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

  // Texnik ishlar rejimi — dasturchi botdan yoqib/o'chiradi (backend
  // requireAuth/optionalAuth ham xuddi shu holatga qarab 503 qaytaradi;
  // shu yerda esa foydalanuvchi login ekranidan OLDIN ham aniq xabar
  // ko'rsin uchun, ketma-ket muvaffaqiyatsiz so'rovlar o'rniga). Xatolik
  // yoki hali javob kelmagan holatda — HECH QACHON saytni yolg'on
  // "o'chiq" deb bloklamaymiz (fail-open, backend bilan bir xil qoida).
  const [siteEnabled, setSiteEnabled] = useState(true);
  const [statusChecking, setStatusChecking] = useState(false);
  // Ilova (Capacitor/Tauri)da texnik-ishlar ekranida "sahifani yangilash"
  // tabiiy imkoni yo'q (brauzer emas) — shu sabab qayta tekshirish uchun
  // aniq tugma kerak (aniq talab: "ochganda apk da exe refresh qip
  // bomayapdi u menuda" — bu funksiya o'sha tugma bilan chaqiriladi).
  const checkSiteStatus = () => {
    setStatusChecking(true);
    return fetch(`${API_BASE}/api/status`)
      .then(r => r.json())
      .then(d => setSiteEnabled(d?.siteEnabled !== false))
      .catch(() => {})
      .finally(() => setStatusChecking(false));
  };
  useEffect(() => { checkSiteStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ilova qulfi (PIN/biometrik) — faqat kirilgan bo'lsa ma'noli, lekin hook
  // shart-siz (har renderda) chaqirilishi kerak — shu sabab pinIsSet hisobi
  // ham liveUser'ga bog'liq bo'lmagan, doim bir xil tartibda chaqiriladi.
  // isPinSet() localStorage'ni to'g'ridan-to'g'ri o'qiydi (React state emas),
  // shuning uchun PIN yangi o'rnatilgach qayta render bo'lishi uchun alohida
  // hisoblagich (pinRefresh) kerak — currentUser'ni soxta o'zgartirishdan
  // ko'ra aniqroq.
  const [, setPinRefresh] = useState(0);
  const pinIsSet = isPinSet();
  // Yangi qurilmada login: hisobda PIN allaqachon bo'lsa — serverdan tiklanadi, qayta so'ralmaydi.
  const [pinSyncing, setPinSyncing] = useState(false);
  const [forgotPin, setForgotPin] = useState(false);
  const pinSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!liveUser || pinIsSet || pinSyncedFor.current === liveUser.id) return;
    pinSyncedFor.current = liveUser.id;
    setPinSyncing(true);
    syncPinFromServer().then(found => { if (found) { markActiveNow(); setPinRefresh(v => v + 1); } }).finally(() => setPinSyncing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUser?.id, pinIsSet]);
  const { locked: appLocked, unlock: unlockApp, lock: lockAppNow } = useAppLock(!!liveUser && pinIsSet);
  const isWorkerRole = liveUser ? ['ishchi', 'prorab', 'brigadir'].includes(liveUser.role) : false;

  // Tarifga qarab qaysi funksiyalar yoqilganini bilish uchun — admin
  // panelida (Dasturchi paneli → Tariflar) belgilanadi. `null` = hali
  // yuklanmagan (yoki dasturchi — unga tegishli emas) — bu holatda
  // HAMMASI yoqilgan deb hisoblanadi, aks holda sahifa ochilgan zahoti
  // barcha tugmalar bir lahza yo'qolib, keyin qayta paydo bo'lardi.
  const [companyFeatures, setCompanyFeatures] = useState<string[] | null>(null);
  useEffect(() => {
    if (!liveUser?.companyId || liveUser.role === 'dasturchi') { setCompanyFeatures(null); return; }
    fetch(`${API_BASE}/api/admin/subscriptions/my`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setCompanyFeatures(Array.isArray(d?.features) ? d.features : null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUser?.companyId, liveUser?.role]);
  const hasFeature = (key: string) => !companyFeatures || companyFeatures.includes(key);
  // GPS shu holatga BOG'LIQ: "Ishga keldim" bosilmaguncha ishlamaydi (foydalanuvchi
  // talabi). MUHIM: lekin "Ishni tugatdim" bosilgach GPS TO'XTAMAYDI — faqat
  // check-in mavjudligiga qaraladi, check-out'ga emas ("GPS har doim olinsin,
  // faqat check-in'dan keyin" — aniqlashtirilgan talab). Sessiya davomida bir
  // marta boshlangach, faqat logout/foydalanuvchi almashishi to'xtatadi.
  const isWorking = !!todayAttendance?.checkIn;

  // GPS kuzatuv — session-scoped hook (App darajasida, sahifa emas — shu
  // sabab navigatsiya GPS'ni to'xtatmaydi, lekin isWorking o'zgarishi
  // to'xtatadi/boshlaydi). To'liq mantiq useGeoTracker.ts'da. siteEnabled=false
  // (texnik ishlar rejimi) bo'lsa ham darhol to'xtaydi — foydalanuvchi aniq
  // talabi: "sayt ochirilgan bolsa ham joylashuv uzatip turishi ochmasin".
  const { gpsTracking, gpsStatus } = useGeoTracker(liveUser?.id, liveUser?.role, isWorking, siteEnabled);

  // Push bildirishnoma ro'yxatdan o'tkazish — XATO TUZATILDI: avval bu
  // faqat main.tsx'dagi 'storage' hodisasiga bog'liq edi, u esa FAQAT
  // BOSHQA tab/oynada token o'zgarsa ishga tushadi (brauzer standarti) —
  // shu (odatiy) tabning o'zida login qilinganda HECH QACHON qayta
  // chaqirilmasdi, shu sabab push bildirishnomalar deyarli hech qachon
  // kelmasdi. Endi liveUser paydo bo'lgan (login/ro'yxatdan o'tish/sahifa
  // eski token bilan ochilgan) HAR bir holatda to'g'ridan-to'g'ri
  // chaqiriladi — qaysi login yo'li (oddiy, dev-login, ro'yxatdan o'tish)
  // ishlatilishidan qat'i nazar.
  useEffect(() => {
    if (!liveUser) return;
    // Service worker ro'yxatdan o'tishi (main.tsx, window 'load' hodisasida)
    // bilan bu effekt orasida poyga (race) bo'lishi mumkin — __setupPush
    // hali tayin qilinmagan bo'lsa, tayyor bo'lguncha (eng ko'pi 5s) qisqa
    // fosila bilan qayta urinamiz, aks holda push umuman yozilmay qolardi.
    let cancelled = false;
    const tryCall = (attempt = 0) => {
      if (cancelled) return;
      const fn = (window as any).__setupPush;
      if (fn) { fn(); return; }
      if (attempt < 10) setTimeout(() => tryCall(attempt + 1), 500);
    };
    tryCall();
    return () => { cancelled = true; };
  }, [liveUser?.id]);

  // Bugungi davomat holatini alohida yuklaymiz. attendanceChecked — ishchi
  // rol uchun "Ishga keldim" darvozasini (gate) ko'rsatishdan oldin, haqiqiy
  // holat serverdan kelguncha bir zumlik noto'g'ri (bo'sh) holatni ko'rsatib
  // qo'ymaslik uchun kerak.
  const [attendanceChecked, setAttendanceChecked] = useState(false);
  useEffect(() => {
    if (!liveUser) return;
    if (!isWorkerRole) { setAttendanceChecked(true); return; }
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${API_BASE}/api/attendance/today`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTodayAttendance(d); else setTodayAttendance(null); })
      .catch(()=>{})
      .finally(() => setAttendanceChecked(true));
  }, [liveUser?.id]);

  // Ikkala tugma ham bitta umumiy "pending" bayrog'ini ishlatadi — ketma-ket
  // tez bosishda (double-submit) ikkinchi so'rov yubormaslik uchun.
  const [attendancePending, setAttendancePending] = useState(false);
  const handleCheckIn = async () => {
    if (attendancePending) return;
    setAttendancePending(true);
    try {
      // Barmoq izi/Face ID/Windows Hello tasdiqlash — agar xodim buni
      // Profilda allaqachon yoqib qo'ygan bo'lsa (Profil > Xavfsizlik),
      // "ishga keldim" tugmasi bosilganda ham so'raladi: bu boshqa birov
      // xodimning telefonidan (yoki ulardan qarzga olib) o'rniga check-in
      // qilib qo'yishining (odatiy amaliyot atamasi bilan — "buddy
      // punching") oldini oladi. Yoqilmagan/qo'llab-quvvatlanmaydigan
      // qurilmada — eski xatti-harakat (faqat joylashuv) o'zgarishsiz qoladi.
      let biometricVerified: boolean | undefined;
      if (isBiometricEnabled() && biometricSupported()) {
        const ok = await tryBiometricUnlock();
        if (!ok) {
          toast.error(tApp('attendance.biometricRequired'));
          return;
        }
        biometricVerified = true;
      }
      const token = localStorage.getItem('token') || '';
      const headers: Record<string,string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      // MAJBURIY: joylashuv olinmasa "Ishga keldim" tasdiqlanmaydi — botdagi
      // jonli joylashuv talabi bilan bir xil qoida (aniq foydalanuvchi talabi:
      // "tekshir oddiy joylashuv emasligini live joylashuv ekanligini").
      // getLivePosition() bir martalik statik o'qish o'rniga bir necha
      // ketma-ket o'qishni (watchPosition) talab qiladi.
      const { pos, denied } = await getLivePosition();
      if (!pos) {
        toast.error(denied
          ? "Ishga kelish uchun joylashuv ruxsati kerak. Brauzer/ilova sozlamalaridan joylashuvga ruxsat bering va qayta urinib ko'ring."
          : "Joylashuvni aniqlab bo'lmadi. GPS yoqilganini tekshirib, qayta urinib ko'ring.");
        return;
      }
      const body: any = { lat: pos.coords.latitude, lng: pos.coords.longitude, ...(biometricVerified ? { biometricVerified: true } : {}) };
      const r = await fetch(`${API_BASE}/api/attendance/checkin`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (r.ok) {
        const d = await r.json();
        setTodayAttendance(d);
        toast.success(tApp('attendance.checkedIn'));
      } else {
        const e = await r.json().catch(()=>({}));
        toast.error(e.error || 'Xatolik');
      }
    } finally { setAttendancePending(false); }
  };

  const handleCheckOut = async () => {
    if (attendancePending) return;
    setAttendancePending(true);
    try {
      const token = localStorage.getItem('token') || '';
      const headers: Record<string,string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      ).catch(() => null);
      const body: any = {};
      if (pos) { body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; }
      const r = await fetch(`${API_BASE}/api/attendance/checkout`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (r.ok) {
        const d = await r.json();
        setTodayAttendance(d);
        // MUHIM: GPS shu yerda TO'XTATILMAYDI — kuzatuv "Ishga keldim/Ishni
        // tugatdim" tugmalaridan mustaqil, ilova ochiq turgan ekan doim ishlab
        // turishi kerak (foydalanuvchi talabi).
        toast.success('Ish yakunlandi.');
      } else {
        const e = await r.json().catch(()=>({}));
        toast.error(e.error || 'Xatolik');
      }
    } finally { setAttendancePending(false); }
  };

  // Admin GPS locations refresh
  const fetchGpsLocations = async () => {
    const token = localStorage.getItem('token') || '';
    setGpsRefreshing(true);
    try {
      const r = await fetch(`${API_BASE}/api/gps/latest`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setGpsLocations(await r.json());
    } catch {}
    finally { setGpsRefreshing(false); }
  };

  const selProjectMounted = useRef(false);

  // Socket handler'lari uchun yangi qiymatlar (stale closure'dan qochish)
  const usersRef = useRef(users); usersRef.current = users;
  const pageRef = useRef(page); pageRef.current = page;
  const chatOpenRef = useRef(chatIsOpen); chatOpenRef.current = chatIsOpen;
  const qrScanRef = useRef(qrScanOpen); qrScanRef.current = qrScanOpen;
  const aiOpenRef = useRef(aiOpen); aiOpenRef.current = aiOpen;
  const globalSearchRef = useRef(globalSearch); globalSearchRef.current = globalSearch;
  const selProjectRef = useRef(selProject); selProjectRef.current = selProject;
  const anyBigModalOpenRef = useRef(anyBigModalOpen); anyBigModalOpenRef.current = anyBigModalOpen;

  useEffect(() => {
    localStorage.setItem("page", page);
  }, [page]);

  // Backend global search (debounced, permission-aware)
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults(null); return; }
    const token = localStorage.getItem("token");
    if (!token) return;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results);
        }
      } catch {}
      finally { setSearchLoading(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!selProjectMounted.current) { selProjectMounted.current = true; return; }
    if (selProject) {
      localStorage.setItem("selProjectId", selProject.id);
    } else {
      localStorage.removeItem("selProjectId");
    }
  }, [selProject]);

  // Fetch live currency rates once on login
  useEffect(() => {
    if (liveUser) { fetchLiveCurrencyRates(); }
  }, [liveUser?.id]);

  // Firma nomi/logotipini serverdan yangilaymiz — login/register javobidan
  // KEYIN qo'shilgan/o'zgargan bo'lishi mumkin (masalan sahifa oddiy qayta
  // yuklansa, saqlangan sessiyadan davom etiladi — login handshake qayta
  // ishlamaydi, shu sabab bu yerda ALOHIDA so'raladi, aks holda eskirgan
  // localStorage nusxasi ko'rsatilib qolaverardi).
  useEffect(() => {
    if (!liveUser || liveUser.role === 'dasturchi') return;
    const token = localStorage.getItem('token') || '';
    fetch(`${API_BASE}/api/company/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.available) applyCompany(d); })
      .catch(() => {});
  }, [liveUser?.id]);

  useEffect(() => {
    if (liveUser) {
      setInitialLoading(true);

      // MUHIM: dasturchi (super-admin) uchun /api/objects va /api/transactions
      // backendda blockDeveloper middleware orqali ATAYLAB 403 qaytaradi (firma
      // ichki ma'lumotlariga kirish yo'q — DeveloperPanel buni chindan
      // ishlatmaydi ham, o'zining /api/companies+/api/users so'rovlari bilan
      // ishlaydi). Bu effekt oldin rol tekshirmasdan har doim shu uchalasini
      // (shu jumladan /api/users — DeveloperPanel buni ham mustaqil, o'zi
      // qayta so'raydi) chaqirar edi — 403'ning o'zi kutilgan, lekin natija
      // hech qayerda ishlatilmagani uchun keraksiz. Dasturchi uchun butunlay
      // o'tkazib yuboramiz.
      if (liveUser.role === 'dasturchi') {
        setInitialLoading(false);
      } else {
      // Render free tier cold-start: 30s timeout — agar backend uyg'onmasa
      // foydalanuvchi abadiy loading ekranida qolmasin, ilovani bo'sh holda ochamiz.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => { ctrl.abort(); }, 30_000);

      const safeFetch = (url: string) =>
        fetch(url, { signal: ctrl.signal }).then(r => r.json()).catch(() => null);

      // Fetch initial data when user logs in
      Promise.all([
        safeFetch(API_BASE + "/api/users"),
        safeFetch(API_BASE + "/api/objects"),
        safeFetch(API_BASE + "/api/transactions"),
      ]).then(([uData, pData, tData]) => {
        clearTimeout(timeoutId);
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
      }).catch(() => { clearTimeout(timeoutId); }).finally(() => setInitialLoading(false));
      }

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
      const socket = connectSocket(liveUser.id, liveUser.companyId);
      const withId = (p: any): Msg => ({ ...p, id: p.id || p._id });

      const onNew = (payload: any) => {
        const m = withId(payload);
        setMessages(prev => prev.some(x => x.id === m.id) ? prev.map(x => x.id===m.id?{...x,...m}:x) : [...prev, m]);
        if (m.fromUserId === liveUser.id) return;
        const sender = usersRef.current.find(u => u.id === m.fromUserId);
        const name = sender?.name || tApp('chat.notifNewMessage');
        const preview = m.type && m.type !== 'text' ? m.text : (m.text || "");
        const viewingChat = pageRef.current === 'chat' && chatOpenRef.current;
        if (!viewingChat) toast.message(name, { description: preview });
        // MUHIM: `new Notification(...)` konstruktori to'g'ridan-to'g'ri
        // chaqirilsa — Android'da (Chrome/WebView, jumladan Capacitor)
        // ko'pincha HECH NARSA ko'rsatmaydi, jim tarzda muvaffaqiyatsiz
        // bo'ladi (bu android'ning o'zi cheklovi — MDN/web.dev'da
        // hujjatlashtirilgan: mobil'da faqat ServiceWorkerRegistration.
        // showNotification() ishlaydi). Shu sabab "faqat ichki (toast)
        // bildirishnoma keladi, telefonning o'zi ko'rsatgan bildirishnoma
        // kelmaydi" degan shikoyat aynan shu qatordan kelib chiqqan —
        // service worker orqali chaqirilganda (sw.js'dagi push handleri
        // bilan bir xil parametrlar) haqiqiy tizim bildirishnomasi chiqadi.
        if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification(name, {
            body: preview,
            icon: '/favicon-192.png',
            badge: '/favicon-192.png',
            tag: 'qurilish-chat-' + m.fromUserId,
            data: { url: '/?page=chat' },
            vibrate: [200, 100, 200],
          } as NotificationOptions)).catch(() => {});
        }
      };
      const onEdit = (payload: any) => setMessages(prev => prev.map(x => x.id===(payload.id||payload._id) ? {...x, ...withId(payload)} : x));
      const onDelete = (payload: any) => setMessages(prev => prev.map(x => x.id===payload.id ? {...x, deleted: true} : x));
      const onRead = ({ fromUserId, toUserId }: any) => setMessages(prev => prev.map(x => x.fromUserId===fromUserId && x.toUserId===toUserId ? {...x, read: true} : x));
      const onPresence = ({ online }: any) => setOnlineUsers(online || []);
      const onGroupNew = (g: any) => { const gg = {...g, id: g.id||g._id}; setGroups(prev => prev.some(x=>x.id===gg.id)?prev:[...prev, gg]); socket.emit("join:group", gg.id); toast.message(tApp('chat.newGroupToast', { name: gg.name })); };
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
      // XATO TUZATILDI ("telefon qilganda ovoz chiqmayapti, ogohlantirish
      // yo'q"): CallOverlay'ning ichki qo'ng'iroq ovozi Web Audio orqali
      // ishlaydi (sound.ts) — brauzerning autoplay siyosati bo'yicha bu
      // FAQAT foydalanuvchi sahifa bilan yaqinda o'zaro ta'sirda bo'lgan
      // (bosgan/teккan) bo'lsagina ishlaydi. Qo'ng'iroq qabul qiluvchi aynan
      // ANIQ shu holatda bo'ladi — sahifani ochib qo'yib, hech narsaga
      // tegmagan holda kutmoqda — shu sabab ovoz "jimgina" chiqmasdan
      // qolib ketardi. Bu yerda darhol (1) audio'ni qayta ochishga urinamiz
      // (avval hech bo'lmaganda BIR marta ochilgan bo'lsa, ko'p brauzer buni
      // yangi gestursiz ham davom ettiradi) va (2) mobil qurilmada tebranish
      // (vibratsiya) — bu HECH QANDAY oldingi foydalanuvchi harakatini talab
      // qilmaydi, shu sabab ovoz ishlamasa ham kamida FIZIK ogohlantirish beradi.
      const onCallOffer = (d: any) => {
        if (activeCallRef.current) return; // allaqachon qo'ng'iroqda — CallOverlay mesh'ni boshqaradi
        if (d.from === liveUser.id) return;
        sfx.unlock().catch(() => {});
        try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch {}
        setActiveCall({ direction: 'in', mode: d.mode || 'voice', peerId: d.from, groupId: d.groupId, offer: d.sdp, fromName: d.fromName });
      };

      // Guruh video chat (Telegram-ga o'xshash) — bu HECH KIMNI chaqirmaydi,
      // shu sabab `call:offer` orqali emas, alohida `videochat:*`
      // hodisalari orqali keladi. Faqat guruh ro'yxatidagi (`groups`)
      // `activeVideoChat` maydonini yangilaydi — bu "Qo'shilish" banerini
      // ko'rsatish uchun yetarli, haqiqiy media ulanishi CallOverlay o'zi
      // (call:join/offer orqali) boshqaradi.
      const onVideoChatActive = (d: any) => {
        setGroups(prev => prev.map(g => g.id === d.groupId
          ? { ...g, activeVideoChat: { startedBy: d.startedBy, startedByName: d.startedByName, startedAt: d.startedAt, mode: d.mode, participantIds: d.participantIds || [] } }
          : g));
      };
      const onVideoChatParticipants = (d: any) => {
        setGroups(prev => prev.map(g => g.id === d.groupId && g.activeVideoChat
          ? { ...g, activeVideoChat: { ...g.activeVideoChat, participantIds: d.participantIds || [] } }
          : g));
      };
      const onVideoChatEnded = (d: any) => {
        setGroups(prev => prev.map(g => g.id === d.groupId ? { ...g, activeVideoChat: undefined } : g));
      };

      // Til boshqa qurilmadan (masalan bot orqali) o'zgartirilsa — shu yerda ham
      // darhol yangi tilga o'tadi (va aksincha, sayt orqali o'zgartirsa botga ham boradi).
      // Adminlar uchun GPS real-time update
      const onGpsUpdate = (payload: any) => {
        if (!payload?.userId) return;
        setGpsLocations(prev => {
          const idx = prev.findIndex(g => g.userId === payload.userId);
          const item = { userId: payload.userId, lat: payload.lat, lng: payload.lng, accuracy: payload.accuracy, timestamp: payload.timestamp, source: payload.source, speed: payload.speed, battery: payload.battery, charging: payload.charging, network: payload.network };
          return idx >= 0 ? prev.map((g, i) => i === idx ? item : g) : [...prev, item];
        });
      };

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

      // Firma nomi/logotipi biror admin tomonidan o'zgartirilsa — SHU FIRMADAGI
      // barcha ochiq sessiyalarda darhol yangilanadi (avval faqat o'zgartirgan
      // odamning O'Z brauzeridagi localStorage'da qolib ketardi).
      const onCompanyUpdate = (company: any) => applyCompany(company);

      // Ishga kelish/ketish BOSHQA joydan (masalan botdan, yoki boshqa
      // ochiq tab/qurilmadan) qilingan bo'lsa ham — DARHOL shu yerda ham
      // ko'rinadi. Avval faqat mount payti bir marta o'qilardi, shu sabab
      // "botdan ishga keldim bosdim, saytda hali eski tugma turibdi"
      // muammosi bo'lardi.
      const onAttendanceUpdate = (rec: any) => setTodayAttendance(rec);

      // "Ulangan qurilmalar"dan (ProfilePage) shu qurilma chiqarib
      // yuborilganda — DARHOL (keyingi HTTP so'rovni kutmasdan) tizimdan
      // chiqariladi (backend/src/services/socket.ts kickSession).
      const onSessionRevoked = () => {
        playSound("lock");
        localStorage.removeItem("currentUser"); localStorage.removeItem("token");
        setCurrentUser(null); setAuthView("login");
        toast.message(tApp('profile.sessionRevokedNotice'));
      };
      socket.on("session:revoked", onSessionRevoked);

      socket.on("message:new", onNew);
      socket.on("message:edit", onEdit);
      socket.on("message:delete", onDelete);
      socket.on("message:read", onRead);
      socket.on("presence", onPresence);
      socket.on("group:new", onGroupNew);
      socket.on("group:update", onGroupUpdate);
      socket.on("group:removed", onGroupRemoved);
      socket.on("call:offer", onCallOffer);
      socket.on("videochat:active", onVideoChatActive);
      socket.on("videochat:participants", onVideoChatParticipants);
      socket.on("videochat:ended", onVideoChatEnded);
      socket.on("transaction:update", onTxUpdate);
      socket.on("transaction:new", onTxNew);
      socket.on("user:language", onLanguage);
      socket.on("gps:update", onGpsUpdate);
      socket.on("company:update", onCompanyUpdate);
      socket.on("attendance:update", onAttendanceUpdate);

      // App background'dan qaytganda socket ulanishini tiklash (Android/Tauri)
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && !socket.connected) {
          socket.connect();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);

      // Fallback polling (socket uzilsa) — kamroq. Dasturchi uchun /api/transactions
      // blockDeveloper orqali 403 qaytaradi va natija hech qayerda ishlatilmaydi —
      // shuning uchun bu funksiya dasturchi uchun hech narsa qilmaydi (aks holda
      // har 12s'da abadiy 403 urinib turaverardi).
      const fetchTx = () => {
        if (liveUser.role === 'dasturchi') return;
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
        document.removeEventListener('visibilitychange', onVisibility);
        socket.off("message:new", onNew);
        socket.off("message:edit", onEdit);
        socket.off("message:delete", onDelete);
        socket.off("message:read", onRead);
        socket.off("presence", onPresence);
        socket.off("group:new", onGroupNew);
        socket.off("group:update", onGroupUpdate);
        socket.off("group:removed", onGroupRemoved);
        socket.off("call:offer", onCallOffer);
        socket.off("videochat:active", onVideoChatActive);
        socket.off("videochat:participants", onVideoChatParticipants);
        socket.off("videochat:ended", onVideoChatEnded);
        socket.off("user:language", onLanguage);
        socket.off("transaction:update", onTxUpdate);
        socket.off("transaction:new", onTxNew);
        socket.off("gps:update", onGpsUpdate);
        socket.off("company:update", onCompanyUpdate);
        socket.off("attendance:update", onAttendanceUpdate);
        socket.off("session:revoked", onSessionRevoked);
      };
    }
  }, [liveUser?.id]);

  // Guruh room'lariga qo'shilish (guruhlar yangilanganda)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    groups.forEach(g => socket.emit("join:group", g.id));
  }, [groups.map(g => g.id).join(",")]);

  // Android Back Button — platformani aniqlash platformada ishga tushadi
  useEffect(() => {
    if (!liveUser) return;
    installAndroidBackHandler(() => {
      if (qrScanRef.current) { setQrScanOpen(false); return true; }
      if (aiOpenRef.current) { setAiOpen(false); return true; }
      if (globalSearchRef.current) { setGlobalSearch(false); return true; }
      if (chatOpenRef.current) { setChatIsOpen(false); return true; }
      if (selProjectRef.current) { setSelProject(null); return true; }
      if (pageRef.current !== 'dashboard') { setPage('dashboard'); return true; }
      // XATO TUZATILDI: yuqoridagi ro'yxat FAQAT bir nechta bilingan
      // ("katta") holatlarni bilardi — o'nlab boshqa modal/dialog
      // (tahrirlash oynalari, rasm ko'ruvchi, tasdiqlash oynalari va h.k.,
      // hammasi useModalPresence() bilan ro'yxatdan o'tadi) ro'yxatda YO'Q
      // edi, shu sabab ular ochiq turganda orqaga bosilsa "hech narsa
      // ushlamadi" deb hisoblanib, ilovadan chiqish so'rovi chiqardi —
      // aniq xabar qilingan xato ("orqaga qaytish... ilovadan chiqip
      // ketvotti"). Endi HAR QANDAY ro'yxatdan o'tgan modal ochiq bo'lsa,
      // "ushladik" deb hisoblaymiz (chiqish so'ralmaydi) — modalning o'zi
      // hali yopilmasa ham, ilova hech qachon kutilmaganda yopilib
      // qolmaydi; foydalanuvchi modalni o'zining X/bekor qilish tugmasi
      // bilan yopadi.
      if (anyBigModalOpenRef.current) return true;
      return false;
    });
  }, [liveUser?.id]);

  // MUHIM: dasturchi bu ekranni ko'rmaydi (u qayta yoqishi kerak bo'lgani
  // uchun) — backend ham aynan shu istisnoni qiladi (auth.ts, isDeveloper).
  if (!siteEnabled && liveUser?.role !== 'dasturchi') {
    // Native ilova (APK/exe) foydalanuvchisiga "sayt" emas — "ilova" deyish
    // kerak, chunki u brauzerda emas, ilovaning o'zida turibdi (aniq talab).
    const surface = isNative() ? tApp('maintenance.appLabel') : tApp('maintenance.siteLabel');
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-4">
            <div className="text-5xl">🛠️</div>
            <h1 className="text-xl font-semibold text-foreground">{tApp('maintenance.title', { surface })}</h1>
            <p className="text-sm text-muted-foreground">{tApp('maintenance.subtitle')}</p>
            <button
              onClick={checkSiteStatus}
              disabled={statusChecking}
              className="mx-auto flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium liquid-transition disabled:opacity-60"
            >
              <MorphIcon icon={RefreshCw} className={`w-4 h-4 ${statusChecking ? 'animate-spin' : ''}`} />
              {statusChecking ? tApp('maintenance.checking') : tApp('maintenance.retryBtn')}
            </button>
          </div>
        </div>
        <AppToaster/>
      </>
    );
  }

  if (!liveUser) {
    // MUHIM: <Toaster/> asosiy (pastdagi, liveUser bor holatdagi) return ichida
    // edi — login/register ekranida umuman render qilinmagan bo'lardi, ya'ni
    // shu yerdan chiqarilgan toast() chaqiruvlari (masalan SMS OTP test-rejim
    // kodini ko'rsatish) hech qayerda ko'rinmasdi. Har bir "erta return"
    // filialida o'zining Toaster'i bo'lishi shart.
    if (tgAutoBusy) return <BootLoader />;
    return (
      <>
        {(authView === "landing" && !isNative() && !isTelegramMiniApp())
          ? <Suspense fallback={<BootLoader />}>
              <LandingPage onLogin={()=>setAuthView("login")} onRegister={()=>setAuthView("register")}
                focus={typeof window !== "undefined" ? SECTION_PATH_TO_FOCUS[window.location.pathname] : undefined}/>
            </Suspense>
          : authView === "register"
          ? <Suspense fallback={<div className="min-h-screen bg-background"><SkeletonPage variant="form" /></div>}>
              <RegisterWizard onBack={()=>setAuthView("login")} onDone={(u,company)=>{playSound("success");setCurrentUser(u);setPage("dashboard");setAuthView("login");applyCompany(company);}}/>
            </Suspense>
          : <LoginScreen onLogin={(u,company)=>{playSound("unlock");clearManualLogout();setCurrentUser(u);setPage("dashboard");applyCompany(company);}} onRegister={()=>setAuthView("register")} onBack={(isTelegramMiniApp() || isNative()) ? undefined : ()=>setAuthView("landing")}/>}
        <AppToaster/>
      </>
    );
  }
  // Ilova qulfi — login'dan keyin BIR MARTA PIN o'rnatiladi (majburiy), keyin
  // ilova >1 daq. fondan qaytganda shu PIN (yoki yoqilgan bo'lsa biometrik)
  // so'raladi. Dasturchi panelidan HAM oldin — barcha rollarga bir xil.
  if (!pinIsSet && pinSyncing) return <BootLoader />;
  if (!pinIsSet) return (
    <>
      <PinSetupScreen onDone={() => { markActiveNow(); setPinRefresh(v => v + 1); }} />
      <AppToaster/>
    </>
  );
  if (appLocked && forgotPin) return (
    <>
      <ForgotPinScreen
        onDone={() => { setForgotPin(false); playSound("unlock"); unlockApp(); setPinRefresh(v => v + 1); toast.success(tApp('pinLock.resetDone')); }}
        onCancel={() => setForgotPin(false)}
        onLogout={() => {
          setForgotPin(false); clearPin();
          localStorage.removeItem("currentUser"); localStorage.removeItem("token");
          setCurrentUser(null); setAuthView("login");
        }} />
      <AppToaster/>
    </>
  );
  if (appLocked) return (
    <>
      <PinLockScreen onUnlock={()=>{playSound("unlock");unlockApp();}}
        onForgot={() => setForgotPin(true)}
        onLockedOut={() => {
          toast.error("Ko'p marta noto'g'ri PIN kiritildi — xavfsizlik uchun qayta kirishingiz kerak.");
          localStorage.removeItem("currentUser"); localStorage.removeItem("token");
          setCurrentUser(null); setAuthView("login");
        }} />
      <AppToaster/>
    </>
  );
  // Dasturchi (super-admin) — alohida panel: barcha firmalar va foydalanuvchilar
  if (liveUser.role === "dasturchi") return (
    <>
      <Suspense fallback={<div className="min-h-screen bg-background"><SkeletonPage variant="dashboard" /></div>}>
        <DeveloperPanel currentUser={liveUser} onLogout={()=>{playSound("lock");setCurrentUser(null);setAuthView("login");}}/>
      </Suspense>
      <AppToaster/>
    </>
  );
  // MUHIM: bular avval initialLoading gate'idan KEYIN hisoblanardi — ya'ni
  // header (logo/nav/bell/avatar) ham initialLoading tugagunicha umuman
  // render qilinmasdi, garchi ularning hech biri /api/users, /api/objects,
  // /api/transactions natijasiga MUHTOJ bo'lmasa ham (bo'sh massivlar bilan
  // ham xavfsiz ishlaydi — masalan unreadMsgs bo'sh `messages`da shunchaki 0
  // bo'ladi). Endi yuqoriga ko'chirildi, shunda header ASOSIY ma'lumot hali
  // yuklanayotganda ham darhol chizilib, bosiladigan bo'ladi — LCP/perceived
  // performance uchun eng katta yutuq shu yerda (Render cold-start paytida
  // foydalanuvchi bo'sh skeleton emas, haqiqiy, ishlaydigan header ko'radi).
  const admin = isAdmin(liveUser.role);
  const unreadMsgs = messages.filter(m=>m.toUserId===liveUser.id&&!m.read).length;
  const isGpsAdmin = liveUser?.role === 'direktor' || liveUser?.role === 'orinbosar';
  const NAV: { key: NavPage; label: string; icon: IconNode; badge?: number }[] = [
    { key: "dashboard", label: tApp('nav.dashboard'), icon: Home },
    // Moliya endi HAMMAGA ko'rinadi — oddiy xodim o'z chiqimini kiritib,
    // faqat o'zinikini ko'radi (backend GET /api/transactions rolga qarab
    // filtrlaydi); direktor/orinbosar hammasini ko'radi va tasdiqlaydi.
    // FinancePage'ning o'zi ichida approve/reject tugmalari isAdmin bilan
    // allaqachon cheklangan — bu yerda faqat sahifaga KIRISH ochilmoqda.
    { key: "finance" as NavPage, label: tApp('nav.finance'), icon: DollarSign },
    ...(admin && hasFeature('reports') ? [
      { key: "reports" as NavPage, label: tApp('nav.reports'), icon: BarChart2 },
    ] : []),
    ...(isGpsAdmin && hasFeature('gps_tracking') ? [{ key: "gps" as NavPage, label: tApp('nav.gps'), icon: MapPin }] : []),
    { key: "chat", label: tApp('nav.chat'), icon: MessageCircle, badge: unreadMsgs },
    { key: "profile", label: tApp('nav.profile'), icon: User },
  ];
  // Header — 3 ta mustaqil "orolcha" pill (logo / nav / bell+avatar), orqada
  // bar yo'q. Bir marta quriladi, ikkalasida (yuklanish skeleti VA asosiy
  // daraxt) ham xuddi shu elementning o'zi ishlatiladi — ikkita alohida
  // nusxa yozib, ular vaqt o'tishi bilan bir-biridan farqlanib ketishining
  // (drift) oldini oladi.
  const headerEl = (
    <header className="flex items-center gap-3 px-4 flex-shrink-0 z-50 sticky top-0"
      style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))', paddingBottom: '0.625rem' }}>
      <div className="nav-pill-desktop flex items-center gap-2.5 px-3 py-2 rounded-full flex-shrink-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-accent to-accent/75 shadow-sm flex-shrink-0">
          <CompanyLogo src={companyLogo} imgClass="w-full h-full object-contain" iconClass="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight hidden lg:block whitespace-nowrap max-w-[140px] truncate">{companyName}</span>
      </div>
      <nav className="hidden lg:flex items-center gap-0.5 lg:gap-1 nav-pill-desktop px-1.5 py-1.5 rounded-full w-fit flex-shrink-0">
        {NAV.map(n=>(
          <button key={n.key} onClick={()=>{setPage(n.key);setSelProject(null);}}
            title={n.label} aria-label={n.label} className={`relative flex items-center gap-1.5 lg:gap-2 text-sm md:text-[13px] lg:text-sm px-2.5 md:px-2.5 lg:px-4 py-2 lg:py-2.5 rounded-full z-10 liquid-transition whitespace-nowrap ${page===n.key?"text-primary font-semibold":"text-muted-foreground hover:text-foreground"}`}>
            {page===n.key && (
              <motion.div layoutId="desktopNavPill" className="absolute inset-0 rounded-full bg-primary/10 -z-10"
                transition={{ type: "spring", stiffness: 480, damping: 34 }}  />
            )}
            <MorphIcon icon={n.icon} className="w-[18px] h-[18px] lg:w-5 lg:h-5 flex-shrink-0" /><span className={page===n.key ? "inline" : "hidden 2xl:inline"}>{n.label}</span>
            {!!n.badge && n.badge>0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-accent text-accent-foreground rounded-full text-[10px] flex items-center justify-center font-bold shadow-sm">{n.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="nav-pill-desktop flex items-center gap-1 px-1.5 py-1.5 rounded-full flex-shrink-0 ml-auto">
        {(liveUser.role === 'direktor' || liveUser.role === 'orinbosar') && hasFeature('ai_assistant') && (
          <button onClick={() => setAiOpen(true)} title="AI Yordamchi" aria-label="AI Yordamchi"
            className="relative w-9 h-9 p-0 rounded-full flex items-center justify-center flex-shrink-0 shadow-md active:scale-90 liquid-transition"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
            <MorphIcon icon={AiSparkles} className="w-[18px] h-[18px] text-white" />
          </button>
        )}
        <button onClick={()=>setGlobalSearch(true)} title={tApp('search.title')} aria-label={tApp('search.title')}
          className="btn btn-ghost w-9 h-9 p-0 rounded-full">
          <MorphIcon icon={Search} className="w-[18px] h-[18px]" />
        </button>
        <button onClick={()=>setShowAnnouncements(true)} title={tApp('announcements.title')} aria-label={tApp('announcements.title')}
          className="btn btn-ghost w-9 h-9 p-0 rounded-full">
          <MorphIcon icon={Megaphone} className="w-[18px] h-[18px]" />
        </button>
        {hasFeature('qr_tools') && (
          <button onClick={()=>setQrScanOpen(true)} title={tApp('qrScanner.title')} aria-label={tApp('qrScanner.title')}
            className="btn btn-ghost w-9 h-9 p-0 rounded-full">
            <MorphIcon icon={QrCode} className="w-[18px] h-[18px]" />
          </button>
        )}
        <button onClick={lockAppNow} title={tApp('profile.lockNowBtn')} aria-label={tApp('profile.lockNowBtn')}
          className="btn btn-ghost w-9 h-9 p-0 rounded-full">
          <MorphIcon icon={Lock} className="w-[18px] h-[18px]" />
        </button>
        <NotificationCenter messages={messages} transfers={transfers} expenses={expenses} users={users} currentUser={liveUser}
          onOpenChat={()=>{setPage("chat");setSelProject(null);}} onOpenDashboard={()=>{setPage("dashboard");setSelProject(null);}}/>
        <button onClick={cycleThemeMode} title={themeMode==="light"?"Yorug'":themeMode==="dark"?"Qorong'i":"Tizim bo'yicha"}
          aria-label={themeMode==="light"?"Yorug'":themeMode==="dark"?"Qorong'i":"Tizim bo'yicha"}
          className="btn btn-ghost w-9 h-9 p-0 rounded-full">
          <MorphIcon icon={themeMode==="light"?Sun:themeMode==="dark"?Moon:Monitor} className="w-[18px] h-[18px]" />
        </button>
        <button onClick={()=>{setPage("profile");setSelProject(null);}} className="flex items-center gap-2 hover:bg-white/5 pl-1 pr-1 sm:pr-3 py-1 rounded-full liquid-transition">
          <Avatar user={liveUser} size="sm"/>
          <div className="hidden 2xl:block text-left">
            <p className="text-[11px] font-semibold leading-none">{liveUser.name.split(" ")[0]}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{roleLabel(tApp, liveUser.role)}</p>
          </div>
        </button>
      </div>
    </header>
  );

  if (initialLoading || (isWorkerRole && !attendanceChecked)) return (
    <>
      <div className="min-h-screen bg-background flex flex-col">
        {headerEl}
        <SkeletonPage variant="dashboard" />
      </div>
      <AppToaster/>
    </>
  );

  // "Ishga keldim" darvozasi (gate) — ishchi/prorab/brigadir hali bugun
  // check-in bosmagan bo'lsa, BOSHQA HECH NARSA (nav, GPS, hech qanday
  // sahifa) ishlamaydi — faqat shu tugma ko'rinadi. Check-in bosilgach
  // (WORKING yoki FINISHED holatida) oddiy ilova ochiladi. Bu qat'iy talab:
  // avvalgi (bu sessiyada) "GPS check-in'dan mustaqil" qarori endi
  // foydalanuvchining yangi, aniq so'rovi bilan bekor qilindi.
  if (isWorkerRole && !todayAttendance?.checkIn) return (
    <>
      <main className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4 py-8 liquid-transition relative overflow-y-auto scrollbar-hide"
        style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        <div className="absolute top-[-8%] left-[-12%] w-[45%] h-[45%] bg-primary/15 rounded-full blur-[120px] blob-anim pointer-events-none" />
        <div className="absolute bottom-[-8%] right-[-12%] w-[45%] h-[45%] bg-accent/15 rounded-full blur-[120px] blob-anim-slow pointer-events-none" />
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="w-full max-w-sm surface rounded-3xl p-8 text-center space-y-5 relative">
          <div className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-accent to-accent/75 shadow-sm mx-auto">
            <CompanyLogo src={companyLogo} imgClass="w-full h-full object-contain" iconClass="w-8 h-8 text-white" />
          </div>
          <div>
            <p className="text-lg font-bold">{tApp('checkinGate.welcome', { name: liveUser.name.split(' ')[0] })}</p>
            <p className="text-sm text-muted-foreground mt-1">{tApp('checkinGate.instruction')}</p>
          </div>
          <button onClick={() => { if (confirm(tApp('checkinGate.confirmPrompt'))) handleCheckIn(); }} disabled={attendancePending}
            className="w-full btn btn-primary text-base py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60">
            {attendancePending ? <MorphIcon icon={Loader2} className="w-5 h-5 animate-spin" /> : <MorphIcon icon={MapPin} className="w-5 h-5" />}
            {tApp('checkinGate.checkInBtn')}
          </button>
          <button onClick={()=>{playSound("lock");markManualLogout();localStorage.removeItem("currentUser"); localStorage.removeItem("token"); setCurrentUser(null); setAuthView("login");}}
            className="text-xs text-muted-foreground hover:text-foreground underline">{tApp('checkinGate.logout')}</button>
        </motion.div>
      </main>
      <AnnouncementPopup />
      <AppToaster/>
    </>
  );

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
        approverId: e.approverId || undefined,
        createdById: e.createdById,
        date: e.date,
        status: e.status
      };
      const res = await fetch(API_BASE + "/api/transactions", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      if (res.ok) { const data = await res.json(); setExpenses(p=>[...p, {...data, id: data._id || data.id}]); }
      else {
        const errData = await res.json();
        console.error('Expense error:', errData);
        toast.error(errData.error || errData.errors?.[0]?.message || 'Noma\'lum xato');
      }
    } catch(err) { console.error(err); }
  };
  const handleAddUser = async (u: AppUser): Promise<{ ok: boolean; error?: string }> => {
    try {
      const nameParts = u.name.trim().split(" ");
      const res = await fetch(API_BASE + "/api/auth/users", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({firstName: nameParts[0] || u.name, lastName: nameParts.slice(1).join(" ") || "", phone: u.phone, role: u.role, brigade: u.brigade, projectIds: u.projectIds || [], baseSalary: u.baseSalary}) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUsers(p=>[...p, {...data, id: data.id || data._id, name: data.name || u.name, projectIds: u.projectIds || []}]);
        return { ok: true };
      }
      return { ok: false, error: data.error || tApp('common.userAddFailed') };
    } catch(err) {
      console.error('Foydalanuvchi qo\'shish xatosi:', err);
      return { ok: false, error: tApp('common.connectionFailed') };
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
        projectIds: u.projectIds || [],
        baseSalary: u.baseSalary,
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
      else toast.error(tApp('common.userDeleteFailed'));
    } catch(err) { console.error(err); toast.error(tApp('common.connectionFailed')); }
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
  const handleApproveExpense = async (id: string, note?: string) => {
    try {
      const headers: Record<string,string> = {"Content-Type":"application/json"};
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/transactions/${id}/approve`, {
        method: "PATCH", headers, body: JSON.stringify({ note: note || "" })
      });
      if (res.ok) {
        const data = await res.json();
        setExpenses(p=>p.map(ex=>ex.id===id?{...ex,...data,status:"confirmed"}:ex));
        toast.success(tApp('common.expenseConfirmed'));
      } else {
        const err = await res.json().catch(()=>({error: tApp('common.error')}));
        toast.error(err.error || tApp('common.confirmFailed'));
      }
    } catch(err) { console.error(err); toast.error(tApp('login.serverError')); }
  };
  const handleRejectExpense = async (id: string) => {
    try {
      const headers: Record<string,string> = {"Content-Type":"application/json"};
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/transactions/${id}/reject`, {
        method: "PATCH", headers, body: JSON.stringify({})
      });
      if (res.ok) setExpenses(p=>p.map(ex=>ex.id===id?{...ex,status:"rejected"}:ex));
    } catch(err) { console.error(err); }
  };
  // Optimistik yuborish: xabar SERVERGA yuborilishini kutmasdan darhol
  // "sending" holatida ro'yxatga qo'shiladi (xuddi shu `m.id` — doSend'da
  // client tomonda generatsiya qilingan `msg${Date.now()}`) — agar shu id
  // allaqachon ro'yxatda bo'lsa (masalan qayta urinish/"retry" chaqirilsa),
  // yangi qator qo'shish o'rniga o'sha joyida yangilanadi, dublikat bo'lmaydi.
  // Muvaffaqiyatli bo'lsa — server tasdiqlagan haqiqiy hujjat bilan
  // almashtiriladi; muvaffaqiyatsiz bo'lsa — matn yo'qolib ketmaydi, "failed"
  // deb belgilanadi va foydalanuvchi bosib qayta yubora oladi (ChatPage'dagi
  // pufakcha shu holatni ko'rsatadi).
  const handleSendMsg = async (m: Msg) => {
    const tempId = m.id;
    const optimistic: Msg = { ...m, status: 'sending' };
    setMessages(p => {
      const idx = p.findIndex(x => x.id === tempId);
      if (idx === -1) return [...p, optimistic];
      const next = [...p]; next[idx] = optimistic; return next;
    });
    try {
      const { status, ...body } = m; // status faqat lokal — serverga yubormaymiz
      const res = await fetch(API_BASE + "/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        const newMsg = {...data, id: data._id || data.id};
        setMessages(p => {
          // Socket orqali ALLAQACHON (real id bilan) kelib qolgan bo'lsa —
          // dublikat qo'shmasdan, faqat vaqtinchalik yozuvni olib tashlaymiz.
          if (p.some(x => x.id === newMsg.id && x.id !== tempId)) {
            return p.filter(x => x.id !== tempId);
          }
          return p.map(x => x.id === tempId ? newMsg : x);
        });
      } else {
        setMessages(p => p.map(x => x.id === tempId ? { ...x, status: 'failed' as const } : x));
      }
    } catch (err) {
      console.error(err);
      setMessages(p => p.map(x => x.id === tempId ? { ...x, status: 'failed' as const } : x));
    }
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
  // Guruh boshqaruvi — backend allaqachon a'zolarga 'group:update'/'group:removed'
  // socket hodisasini yuboradi (groups.ts), shu sabab bu yerda qo'lda setGroups
  // qilish shart emas — yuqoridagi onGroupUpdate/onGroupRemoved effekti buni
  // avtomatik bajaradi (ACTING foydalanuvchiga ham yuboriladi).
  const handleRenameGroup = async (groupId: string, name: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!res.ok) toast.error(tApp('common.error'));
    } catch { toast.error(tApp('common.error')); }
  };
  const handleAddGroupMembers = async (groupId: string, memberIds: string[]) => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberIds }) });
      if (!res.ok) toast.error(tApp('common.error'));
    } catch { toast.error(tApp('common.error')); }
  };
  const handleRemoveGroupMember = async (groupId: string, userId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      if (!res.ok) toast.error(tApp('common.error'));
    } catch { toast.error(tApp('common.error')); }
  };
  const handleLeaveGroup = async (groupId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (res.ok) setGroups(p => p.filter(g => g.id !== groupId));
      else toast.error(tApp('common.error'));
    } catch { toast.error(tApp('common.error')); }
  };
  const handleDeleteGroup = async (groupId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/groups/${groupId}`, { method: 'DELETE' });
      if (res.ok) setGroups(p => p.filter(g => g.id !== groupId));
      else toast.error((await res.json().catch(() => ({})))?.error || tApp('common.error'));
    } catch { toast.error(tApp('common.error')); }
  };
  const handleStartCall = (mode: 'voice'|'video', target: { peer?: AppUser; group?: Group }) => {
    if (target.group) setActiveCall({ direction: 'out', mode, groupId: target.group.id, memberIds: (target.group.memberIds || []).filter(id => id !== liveUser.id) });
    else if (target.peer) setActiveCall({ direction: 'out', mode, peerId: target.peer.id });
  };
  // Guruh video chat (Telegram-ga o'xshash) — oddiy qo'ng'iroqdan farqli,
  // HECH KIM chaqirilmaydi (`memberIds: []`) — CallOverlay buni ko'rib,
  // shunchaki mahalliy media tayyorlaydi va videochat:start/join hodisasini
  // yuboradi. Boshlash va qo'shilish bir xil — farqi faqat `startedBy`da
  // (guruhda allaqachon faol bo'lsa, o'shani ishlatamiz).
  const handleStartOrJoinVideoChat = (group: Group) => {
    const active = group.activeVideoChat;
    setActiveCall({
      direction: 'out', mode: active?.mode || 'video', groupId: group.id, memberIds: [],
      videoChat: true, startedBy: active?.startedBy || liveUser.id, startedByName: active?.startedByName || liveUser.name,
      groupName: group.name, groupMemberIds: group.memberIds,
    });
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


  const currentProject = selProject ? (projects.find(p=>p.id===selProject.id)??selProject) : null;

  return (
    <div className={`h-[100dvh] flex flex-col overflow-hidden font-['Inter',sans-serif] ${siteBg ? 'with-bg' : ''}`} style={(() => { if (!siteBg) return { background: 'var(--background)' }; const isImg = !siteBg.startsWith('linear-gradient') && !siteBg.startsWith('radial-gradient'); return isImg ? { backgroundImage: `url(${siteBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : { background: siteBg }; })()}>
      {/* MUHIM: safe-area-inset-top yo'q edi — sayt endi PWA (manifest.json/
          sw.js) sifatida "Bosh ekranga qo'shish" orqali TO'LIQ EKRAN (standalone)
          rejimda ochilsa, veb-kontent OS status-bar (soat/tarmoq/batareya)
          ostidagi maydonni ham egallaydi — shu joyga aynan shu header
          chizilib, telefon status-barining o'z belgilari (5G, batareya)
          ilova header'ining ikonkalari bilan bir qatorda ustma-ust
          chiqib, "hunuk"/"buzilgan" ko'rinishga sabab bo'lardi. Header'ning
          o'zi endi yuqorida (initialLoading gate'idan OLDIN) headerEl
          sifatida bir marta quriladi — shu yerda faqat qo'yiladi. */}
      <PullToRefresh />
      {headerEl}

      {/* Offline banner */}
      {(isOffline || syncPending > 0 || syncStatus === 'synced') && (
        <div className="flex justify-center px-3 pt-1.5 flex-shrink-0 pointer-events-none">
        <div role="status" className={`sync-pill pointer-events-auto inline-flex items-center gap-2 max-w-full px-4 py-2 rounded-full text-xs sm:text-[13px] font-bold border shadow-xl transition-colors
          ${isOffline ? 'bg-red-600 text-white border-white/25 shadow-red-900/40' :
            syncStatus === 'synced' ? 'bg-emerald-600 text-white border-white/25 shadow-emerald-900/40' :
            'bg-amber-500 text-black border-black/10 shadow-amber-900/30'}`}>
          {isOffline ? (
            <><MorphIcon icon={WifiOff} className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{tApp('sync.offline')}</span></>
          ) : syncStatus === 'syncing' ? (
            <><MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /><span>{tApp('sync.syncing')}</span></>
          ) : syncStatus === 'synced' ? (
            <><MorphIcon icon={CheckCheck} className="w-3.5 h-3.5" /><span>{tApp('sync.synced')}</span></>
          ) : (
            <><MorphIcon icon={AlertCircle} className="w-3.5 h-3.5" /><span>{tApp('sync.pending', { count: syncPending })}</span></>
          )}
        </div>
        </div>
      )}

      {/* Top bar — admin only (Mobile/Tablet only) */}
      <div className="block lg:hidden">
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
            }} hasFeature={hasFeature}/>
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
            onUpdateProject={(pid, patch) => {
              setProjects(prev => prev.map(p => p.id === pid ? {...p, ...patch} : p));
              setSelProject(prev => prev && prev.id === pid ? {...prev, ...patch} : prev);
            }}
            onDeleteProject={(pid) => {
              setProjects(prev => prev.filter(p => p.id !== pid));
            }}
          />
        )}
        {page==="finance" && (
          <FinancePage currentUser={liveUser} users={users} projects={projects} expenses={expenses}
            onAddExpense={handleAddExpense} onConfirm={handleConfirmExpense}
            onApprove={handleApproveExpense} onReject={handleRejectExpense}/>
        )}
        {page==="reports" && admin && (
          <Suspense fallback={<SkeletonPage variant="dashboard" />}>
            <ReportsPage projects={projects} expenses={expenses} incomes={incomes} users={users}/>
          </Suspense>
        )}
        {page==="chat" && (
          <Suspense fallback={<SkeletonPage variant="list" />}>
          <ChatPage currentUser={liveUser} users={users} messages={messages} groups={groups} onlineUsers={onlineUsers}
            onSend={handleSendMsg} onMarkRead={handleMarkRead}
            onEdit={handleEditMsg} onDelete={handleDeleteMsg} onPin={handlePinMsg}
            onChatOpen={open => setChatIsOpen(open)} onCreateGroup={handleCreateGroup} onStartCall={handleStartCall} onStartVideoChat={handleStartOrJoinVideoChat}
            canModifyMessages={liveUser.role === 'direktor' || liveUser.role === 'orinbosar'}
            onGetDevSupport={handleGetDevSupport}
            onRenameGroup={handleRenameGroup} onAddGroupMembers={handleAddGroupMembers}
            onRemoveGroupMember={handleRemoveGroupMember} onLeaveGroup={handleLeaveGroup} onDeleteGroup={handleDeleteGroup}/>
          </Suspense>
        )}
        {page==="profile" && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide lg:overflow-hidden lg:flex lg:flex-col">
            <Suspense fallback={<SkeletonPage variant="list" />}>
            <ProfilePage currentUser={liveUser} projects={projects} onUpdateAvatar={handleUpdateAvatar} onUpdateUser={handleUpdateUser}
              onLogout={()=>{playSound("lock");setCurrentUser(null);setSelProject(null);setPage("dashboard");}}
              onCompanyNameChange={name => setCompanyName(name)}
              onCompanyLogoChange={logo => setCompanyLogo(logo)}
              onBgChange={bg => setSiteBg(bg)}
              colorTheme={colorTheme}
              onColorThemeChange={id => { setColorTheme(id); localStorage.setItem("erp_colorTheme", id); }}
              themeMode={themeMode}
              onThemeModeChange={m => { setThemeMode(m); localStorage.setItem("erp_themeMode", m); }}
              canEditCompany={!!(liveUser.isOwner || liveUser.role === 'direktor')}
              todayAttendance={todayAttendance}
              onCheckIn={handleCheckIn}
              onCheckOut={handleCheckOut}
              canBackup={isAdmin(liveUser.role) && hasFeature('backup')}
              backupLoading={backupLoading}
              onBackup={handleBackup}
              importLoading={importLoading}
              onImportBackup={handleImportBackup}
              importFileRef={importFileRef}
              gpsTracking={gpsTracking}
              gpsStatus={gpsStatus}
              onLockNow={lockAppNow}/>
            </Suspense>
          </div>
        )}
        {page==="gps" && isGpsAdmin && hasFeature('gps_tracking') && (
          <Suspense fallback={<SkeletonPage variant="list" />}>
            <GpsTrackingPage users={users} gpsLocations={gpsLocations} refreshing={gpsRefreshing} onRefresh={fetchGpsLocations} transfers={transfers} expenses={expenses}/>
          </Suspense>
        )}
      </main>

      {/* Bottom bar — admin only (Desktop only).
          XATO TUZATILDI ("Jami chiqimlar ikkita bo'lib qolgan, navbar
          orqasida ko'rinyapti"): bu juftlik (yuqoridagi mobil/tablet
          nusxasi bilan) ESKI `md` chegarada qolib ketgan edi, holbuki
          o'sha nusxa endi `lg`ga ko'chirilgan — natijada 768-1023px
          oralig'ida (portret planshet) IKKALASI HAM bir vaqtda ko'rinib,
          pastkisi oddiy hujjat oqimida suzuvchi pastki navbar orqasida
          "sizib chiqib" turardi. Endi ikkalasi ham bir xil `lg` chegarada. */}
      <div className="hidden lg:block">
        {admin && <BottomFinanceBar expenses={expenses} projects={projects}/>}
      </div>

      {/* Global send modal for non-admin */}
      {showSend && !admin && (
        <SendTransferModal currentUser={liveUser} projects={projects} allUsers={users}
          onClose={()=>setShowSend(false)} onSend={t=>{handleSendTransfer(t);setShowSend(false);}}/>
      )}

      {/* Mobile Bottom Navigation — 3-avlod ("butunlay boshqacha" so'ralgach):
          avvalgi ikkita variant HAM tub jihatdan bir xil naqsh edi — keng
          to'rtburchak "yoritilgan fon" tugma ustida sirg'alib yurar edi,
          shu sabab foydalanuvchiga "hali ham oddiy" tuyulardi. Endi butunlay
          boshqa naqsh: faol bo'lim ustida KENG FON emas, balki ikonaning
          o'ZI atrofida SUZUVCHI DOIRAVIY "bubble" (fintech-ilovalar uslubi)
          — ikkinchisidan farqli, bu FAQAT ikonani o'rab oladi (label'ni
          emas), shu bilan "aktiv tugma" endi butunlay boshqacha shaklda
          ko'zga tashlanadi. */}
      {/* 4-avlod — foydalanuvchi ko'rsatgan namunaga ("fintech" uslubi) moslab
          qayta ishlandi: aktiv bo'lim endi ORQA FON (bubble/pill) bilan emas,
          faqat IKONA+YORLIQ RANGI (kulrang → primary) bilan va bar ustida
          suzuvchi ingichka "urg'u chizig'i" (accent stripe) bilan
          ko'rsatiladi — namunadagi aynan shu naqsh. */}
      <nav className={`ios-bottom-bar flex items-center justify-around ${(page==='chat' && chatIsOpen) || anyBigModalOpen ? 'ios-bottom-bar-hidden' : ''}`}>
        {NAV.map(n => (
          <motion.button key={n.key} onClick={() => { setPage(n.key); setSelProject(null); }}
            whileTap={{ scale: 0.90 }}
            transition={{ type: "spring", stiffness: 520, damping: 30 }}
            aria-label={n.label}
            aria-current={page===n.key ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-[4px] px-3 py-2 min-w-[56px] h-[60px] relative z-10"
            style={{ color: page===n.key ? 'var(--primary)' : 'rgba(255,255,255,0.42)' }}
          >
            {page === n.key && (
              <motion.div
                layoutId="mobileNavActiveStripe"
                className="nav-active-stripe absolute top-0 left-1/2 -translate-x-1/2"
                transition={{ type: "spring", stiffness: 480, damping: 30 }}
              />
            )}
            <div className="relative flex items-center justify-center w-10 h-10">
              <div className="relative z-[1] flex items-center justify-center w-[26px] h-[26px]">
                {n.key === "profile"
                  ? <div className={`rounded-full overflow-hidden transition-all duration-200 ${page===n.key?"ring-2 ring-current shadow-md":"opacity-70"}`}><Avatar user={liveUser} size="sm"/></div>
                  : <MorphIcon icon={n.icon} className="w-[19px] h-[19px]" />}
              </div>
              {!!n.badge && n.badge>0 && (
                <span className="badge-pulse absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold shadow border border-black/20 z-[2]">{n.badge > 9 ? '9+' : n.badge}</span>
              )}
            </div>
            <span className="text-[9px] font-semibold leading-none tracking-wide">
              {n.label}
            </span>
          </motion.button>
        ))}
      </nav>

      {/* Qo'ng'iroq (WebRTC) */}
      {activeCall && (
        <Suspense fallback={null}>
          <CallOverlay currentUser={liveUser} users={users} call={activeCall} onClose={() => setActiveCall(null)} onSendMessage={handleSendMsg}/>
        </Suspense>
      )}

      {/* AI Yordamchi — faqat direktor va o'rinbosar; endi FAQAT header'dagi ✨ tugmasidan ochiladi.
          XATO TUZATILDI ("AI'dan chiqib qaytib kirsam chat yo'q", "ovozli
          o'qish yopgandan keyin ham gapiraverdi"): avval bu blok `aiOpen &&`
          shartiga bog'liq bo'lib, modal yopilganda <AIAssistant> BUTUNLAY
          UNMOUNT bo'lardi — shu bilan uning ichidagi butun chat tarixi
          (useState) yo'qolardi VA "modal yopilganda gapirishni to'xtat"
          useEffect'i HECH QACHON ishlamas edi (chunki u `open` prop FALSE
          bo'lib qayta render bo'lishini kutadi, unmount esa buni chetlab
          o'tadi). Endi komponent doim montaj qilingan holda qoladi — ko'rinish
          FAQAT `open` prop orqali (`AIAssistant` ichida `if (!open) return
          null`) boshqariladi, shu bilan ham chat tarixi saqlanadi, ham
          yopilganda ovoz/tinglash to'g'ri to'xtaydi. */}
      {(liveUser.role === 'direktor' || liveUser.role === 'orinbosar') && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-card w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl overflow-hidden" style={{ height: 'min(600px, 85vh)' }}>
              <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border">
                <Skeleton className="w-8 h-8 rounded-full"/>
                <Skeleton className="h-3 w-28"/>
              </div>
              <div className="p-3 space-y-2.5">
                <SkeletonMessage/>
                <SkeletonMessage mine/>
                <SkeletonMessage/>
              </div>
            </div>
          </div>
        }>
          <AIAssistant
            currentUser={liveUser}
            users={users}
            token={localStorage.getItem('token') || ''}
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            onUserAdded={(u) => setUsers(p => [...p, u])}
            onUserDeleted={(id) => setUsers(p => p.filter(u => u.id !== id))}
            onUserUpdated={(u) => setUsers(p => p.map(x => x.id === u.id ? u : x))}
          />
        </Suspense>
      )}

      {/* E'lonlar taxtasi */}
      {showAnnouncements && (
        <AnnouncementsModal currentUser={liveUser} onClose={() => setShowAnnouncements(false)} />
      )}

      {/* QR Scanner */}
      {qrScanOpen && (
        <Suspense fallback={null}>
          <QRScanner token={localStorage.getItem("token") || ""}
            onClose={() => setQrScanOpen(false)}
            onResult={r => { toast.success(`QR skan: ${r.type === 'material' ? r.data.name : r.type === 'object' ? r.data.name : 'Tranzaksiya'}`); setQrScanOpen(false); }}
            onLoginQrVerified={() => playSound("success")} />
        </Suspense>
      )}

      {/* QR Generator */}
      {qrGenData && (
        <Suspense fallback={null}>
          <QRGenerator type={qrGenData.type} id={qrGenData.id} name={qrGenData.name}
            onClose={() => setQrGenData(null)} />
        </Suspense>
      )}

      {/* Global Search modal */}
      {globalSearch && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-start justify-center pt-16 px-4" onClick={()=>{setGlobalSearch(false);setSearchQuery("");setSearchResults(null);}}>
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <MorphIcon icon={Search} className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <input autoFocus value={searchQuery} onChange={e=>{setSearchQuery(e.target.value);if(e.target.value.length<2)setSearchResults(null);}}
                placeholder={tApp('search.placeholder')}
                className="flex-1 bg-transparent text-sm focus:outline-none text-foreground placeholder:text-muted-foreground"/>
              {searchLoading && <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />}
              <button onClick={()=>{setGlobalSearch(false);setSearchQuery("");setSearchResults(null);}} aria-label="Yopish" className="p-1 rounded hover:bg-muted"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            {searchQuery.length > 1 ? (
              <div className="max-h-[60vh] overflow-y-auto scrollbar-hide p-3 space-y-3">
                {searchResults ? (<>
                  {/* Backend results: Users */}
                  {(searchResults.users||[]).length > 0 && (
                    <div><p className="text-[10px] font-semibold text-muted-foreground mb-1.5 px-1">{tApp('search.users')}</p>
                      {(searchResults.users||[]).slice(0,5).map((u: any) => (
                        <button key={u.id} onClick={()=>{setGlobalSearch(false);setSearchQuery("");setSearchResults(null);setPage("dashboard");}}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted liquid-transition text-left">
                          <MorphIcon icon={User} className="w-5 h-5 text-primary flex-shrink-0" />
                          <div><p className="text-sm font-medium text-foreground">{u.name}</p><p className="text-[10px] text-muted-foreground">{ROLE_LABELS[u.role as Role] ? roleLabel(tApp, u.role as Role) : u.role}</p></div>
                        </button>))}
                    </div>
                  )}
                  {/* Backend results: Objects */}
                  {(searchResults.objects||[]).length > 0 && (
                    <div><p className="text-[10px] font-semibold text-muted-foreground mb-1.5 px-1">{tApp('search.objects')}</p>
                      {(searchResults.objects||[]).slice(0,5).map((o: any) => (
                        <button key={o.id} onClick={()=>{setGlobalSearch(false);setSearchQuery("");setSearchResults(null);const p=projects.find(p=>p.id===o.id);if(p)setSelProject(p);setPage("dashboard");}}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted liquid-transition text-left">
                          <MorphIcon icon={Building2} className="w-5 h-5 text-primary flex-shrink-0" />
                          <div><p className="text-sm font-medium text-foreground">{o.name}</p><p className="text-[10px] text-muted-foreground">{o.location}</p></div>
                        </button>))}
                    </div>
                  )}
                  {/* Backend results: Materials */}
                  {(searchResults.materials||[]).length > 0 && (
                    <div><p className="text-[10px] font-semibold text-muted-foreground mb-1.5 px-1">{tApp('search.materials')}</p>
                      {(searchResults.materials||[]).slice(0,5).map((m: any) => (
                        <div key={m.id} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted liquid-transition">
                          <MorphIcon icon={Package} className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{m.name}</p><p className="text-[10px] text-muted-foreground">{m.remaining} {m.unit} qolgan</p></div>
                          <button onClick={()=>setQrGenData({type:"material",id:m.id,name:m.name})} className="p-1 rounded hover:bg-muted" title="QR kod" aria-label="QR kod"><MorphIcon icon={QrCode} className="w-4 h-4 text-muted-foreground" /></button>
                        </div>))}
                    </div>
                  )}
                  {/* Backend results: Transactions */}
                  {(searchResults.transactions||[]).length > 0 && (
                    <div><p className="text-[10px] font-semibold text-muted-foreground mb-1.5 px-1">{tApp('search.transactions')}</p>
                      {(searchResults.transactions||[]).slice(0,5).map((t: any) => (
                        <button key={t.id} onClick={()=>{setGlobalSearch(false);setSearchQuery("");setSearchResults(null);setPage("finance");}}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted liquid-transition text-left">
                          <MorphIcon icon={Wallet} className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0"><p className="text-sm text-foreground truncate">{t.description||t.materialName}</p><p className="text-[10px] text-muted-foreground">{t.amount?.toLocaleString()} so'm</p></div>
                        </button>))}
                    </div>
                  )}
                  {/* Backend results: Messages */}
                  {(searchResults.messages||[]).length > 0 && (
                    <div><p className="text-[10px] font-semibold text-muted-foreground mb-1.5 px-1">{tApp('search.messages')}</p>
                      {(searchResults.messages||[]).slice(0,5).map((m: any) => (
                        <button key={m.id} onClick={()=>{setGlobalSearch(false);setSearchQuery("");setSearchResults(null);setPage("chat");}}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted liquid-transition text-left">
                          <MorphIcon icon={MessageCircle} className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0"><p className="text-sm text-foreground truncate">{m.text}</p></div>
                        </button>))}
                    </div>
                  )}
                  {/* No results */}
                  {Object.values(searchResults).every((arr: any) => !arr?.length) && (
                    <div className="text-center py-6 text-muted-foreground text-sm">{tApp('search.noResults')}</div>
                  )}
                </>) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    {searchLoading ? "Qidirilmoqda..." : tApp('search.noResults')}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">{tApp('search.placeholder')}</div>
            )}
          </div>
        </div>
      )}

      {/* Yangi/ko'rilmagan e'lonlar — kirganda BIR MARTA avtomatik chiqadi */}
      <AnnouncementPopup />

      {/* Bildirishnoma toast'lari */}
      <AppToaster/>
    </div>
  );
}
