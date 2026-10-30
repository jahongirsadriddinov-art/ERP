import { confirmDialog, promptDialog } from "./lib/confirmDialog";
import { startBackground, stopBackground } from "./lib/background";
import { fmtNumber, parseMoney } from "./lib/money";
import { MoneyInput } from "./components/MoneyInput";
// Sarlavha satri ikonalari (owner 2026-10-27: "oddiy emoji emas, premium ikona ishlat")
import CalendarIcon from "@hugeicons/core-free-icons/Calendar03Icon";
import DollarIcon from "@hugeicons/core-free-icons/Dollar01Icon";
import SunIcon from "@hugeicons/core-free-icons/Sun03Icon";
import NewsIcon from "@hugeicons/core-free-icons/News01Icon";
import { PriceField } from "./components/Money";
import { MarketPriceHint } from "./components/MarketPriceHint";
import { CountUp } from "./components/CountUp";
import { useState, useRef, useEffect, useMemo, Suspense, useLayoutEffect } from "react";
import { lazyRetry as lazy } from "./lib/lazyRetry";
import type { BlockedInfo } from "./SubscriptionBlocked";
import SyncStatusBar from "./SyncStatusBar";
import { useScrollMemory } from "./lib/persistentState";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Package from "@hugeicons/core-free-icons/Package01Icon";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import AlertTriangle from "@hugeicons/core-free-icons/Alert02Icon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import User from "@hugeicons/core-free-icons/UserIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import BarChart2 from "@hugeicons/core-free-icons/BarChartIcon";
import DollarSign from "@hugeicons/core-free-icons/DollarSignIcon";
import MessageCircle from "@hugeicons/core-free-icons/Message01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ChevronUp from "@hugeicons/core-free-icons/ArrowUp01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import TrendingDown from "@hugeicons/core-free-icons/TradeDownIcon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import Home from "@hugeicons/core-free-icons/Home01Icon";
import Megaphone from "@hugeicons/core-free-icons/Megaphone01Icon";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import MapIcon from "@hugeicons/core-free-icons/MapIcon";
import MoreHorizontal from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Sun from "@hugeicons/core-free-icons/Sun01Icon";
import Moon from "@hugeicons/core-free-icons/Moon02Icon";
import Monitor from "@hugeicons/core-free-icons/ComputerIcon";
import Smartphone from "@hugeicons/core-free-icons/SmartPhone01Icon";
import TabletIcon from "@hugeicons/core-free-icons/Tablet01Icon";
import QrCode from "@hugeicons/core-free-icons/QrCodeIcon";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import { MorphIcon, type IconNode } from "morphicons/react";
import { IconTile, type IconTone } from "./components/IconTile";
import { UserAvatar } from "./components/UserAvatar";
import { toast, Toaster } from "sonner";
import { playSound, sfx } from "./sound";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
// Owner 2026-10-27: birinchi ekranga kerak emas — bosilganda yuklanadi (Speed Index)
import type { AnnouncementData } from "./AnnouncementParts";
import { connectSocket, getSocket } from "./socket";
import { isAiCallActive, decideCallOffer } from "./aiVoice/bus";
import { motion, AnimatePresence } from "motion/react";
// Katta sahifalar alohida fayllarda va kerak bo'lganda yuklanadi (owner 2026-10-19: App.tsx'ni bo'lish)
const SubscriptionBlocked = lazy(() => import("./SubscriptionBlocked"));
const AdminDashboard = lazy(() => import("./AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const ObjectDetailPage = lazy(() => import("./ObjectDetailPage").then((m) => ({ default: m.ObjectDetailPage })));
const FinancePage = lazy(() => import("./FinancePage").then((m) => ({ default: m.FinancePage })));
import { setSiteLanguage, SiteLang } from "./i18n";
import { isTelegramMiniApp, getTelegramInitData, markManualLogout, clearManualLogout, telegramAutoLoginAllowed } from "./telegramWebApp";
import { isChatMuted, useChatPrefs } from "./chat/chatPrefs";
import { buildEntries as buildChatEntries, navUnreadCount } from "./chat/chatModel";
import { installAndroidBackHandler, isAndroid, saveOrShareBlob, isNative, isTabletOrLarger, notifyOS, ensureNotifyPermission, appInForeground } from "./platform";

import { openMediaViewer } from "./MediaViewer";
import { VoicePlayer, VideoPlayer } from "./MediaPlayers";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { Skeleton, SkeletonList, SkeletonPage, SkeletonMessage } from "./Skeleton";
import { useGeoTracker } from "./useGeoTracker";
import PullToRefresh from "./PullToRefresh";
import { hidePrivacyCover, isPinSet, useAppLock, markActiveNow, clearPin, PinSetupScreen, PinLockScreen, ForgotPinScreen, syncPinFromServer, isBiometricEnabled, biometricSupported, tryBiometricUnlock } from "./AppLock";

// recharts og'ir kutubxona — faqat "Hisobotlar" bo'limiga kirilganda yuklanadi
// (boshlang'ich bundle hajmini kamaytiradi, sayt tezroq ochiladi).
const ReportsPage = lazy(() => import("./ReportsPage"));
// Kamdan-kam ishlatiladigan (rol/hodisaga bog'liq) og'ir sahifalar — faqat
// chindan kerak bo'lganda yuklanadi (unused JS ni kamaytiradi).
const CallOverlay = lazy(() => import("./CallOverlay"));
// Qo'ng'iroq oynasi kutilmaganda (kiruvchi qo'ng'iroqda) ochiladi — uning bo'lagi oldindan, bo'sh vaqtda yuklab
// qo'yiladi. Aks holda sahifa ochiq turganda yangi versiya chiqsa, eski bo'lak serverda qolmaydi va qo'ng'iroq ochilmasdi.
if (typeof window !== "undefined" && localStorage.getItem("token")) {
  const preloadCall = () => { import("./CallOverlay").catch(() => {}); };
  const ric = (window as any).requestIdleCallback;
  if (ric) ric(preloadCall, { timeout: 10000 }); else setTimeout(preloadCall, 6000);
}
const RegisterWizard = lazy(() => import("./RegisterWizard"));
const DeveloperPanel = lazy(() => import("./DeveloperPanel"));
const AIAssistant = lazy(() => import("./AIAssistant"));
const AiVoiceRoot = lazy(() => import("./aiVoice/AiVoiceRoot"));
const BackgroundPermissionPrompt = lazy(() => import("./BackgroundPermissionPrompt"));
const QRScanner = lazy(() => import("./QRScanner"));
const LandingPage = lazy(() => import("./LandingPage"));
const LocationPicker = lazy(() => import("./LocationPicker"));
export const ESignDocs = lazy(() => import("./ESignDocs"));
const ChatPage = lazy(() => import("./ChatPage"));
const ProfilePage = lazy(() => import("./ProfilePage"));
const QRGenerator = lazy(() => import("./QRGenerator"));
const GpsTrackingPage = lazy(() => import("./GpsTrackingPage"));
// Birinchi ekranda ko'rinmaydigan qismlar — ochilganda yuklanadi
const NotificationCenter = lazy(() => import("./NotificationCenter"));
const QrLoginPanel = lazy(() => import("./QrLoginPanel"));
const AnnouncementComposer = lazy(() => import("./AnnouncementParts").then(m => ({ default: m.AnnouncementComposer })));
const AnnouncementContent = lazy(() => import("./AnnouncementParts").then(m => ({ default: m.AnnouncementContent })));
const AnnouncementPopup = lazy(() => import("./AnnouncementParts").then(m => ({ default: m.AnnouncementPopup })));
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
// Global kuzatuvchi: har qanday modal/sheet/overlay (useModalPresence
// chaqirmaganlari ham) DOM'da paydo bo'lsa — navbar yashirinadi va
// body'ga `modal-open` klassi qo'yiladi (CSS orqa fonni xiralashtiradi).
// Belgisi: qorong'i fonli `fixed inset-0` qatlam, aria-modal dialog,
// Radix overlay yoki `data-modal-open` atributi. Shaffof "click-catcher"
// qatlamlar (menyu yopish uchun) hisobga olinmaydi.
export const MODAL_OVERLAY_SELECTOR = [
  '.fixed.inset-0[class*="bg-black/"]',
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"]',
  '[data-slot="dialog-overlay"]', '[data-slot="sheet-overlay"]',
  '[data-slot="drawer-overlay"]', '[data-slot="alert-dialog-overlay"]',
  '[data-modal-open]',
].join(',');
export function domHasModalOverlay(root: ParentNode = document): boolean {
  const els = root.querySelectorAll(MODAL_OVERLAY_SELECTOR);
  for (const el of Array.from(els)) {
    if ((el as HTMLElement).closest('[data-modal-ignore]')) continue;
    if (el.getClientRects().length === 0) continue; // display:none
    // Yopiq (opacity-0 / invisible / pointer-events-none) qatlam — hisoblanmaydi,
    // aks holda navbar abadiy yashirin qolardi
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (cs && (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || cs.opacity === '0')) continue;
    if ((el as HTMLElement).dataset?.state === 'closed') continue;
    return true;
  }
  return false;
}
function useDomModalOverlay() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    let raf = 0;
    const check = () => { raf = 0; setOpen(domHasModalOverlay()); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'aria-modal'] });
    // fade-in/out animatsiyasi tugaganda ham qayta tekshiriladi (opacity o'zgaradi)
    document.addEventListener('animationend', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    check();
    return () => {
      mo.disconnect(); if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('animationend', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
    };
  }, []);
  return open;
}
function useAnyBigModalOpen() {
  const [counted, setCounted] = useState(openModalCount > 0);
  const inDom = useDomModalOverlay();
  useEffect(() => {
    modalListeners.add(setCounted);
    return () => { modalListeners.delete(setCounted); };
  }, []);
  const open = counted || inDom;
  // body klassi — CSS (globals.css) uchun: telefonda orqa fon xiralashadi
  useEffect(() => {
    document.body.classList.toggle('modal-open', open);
    return () => { document.body.classList.remove('modal-open'); };
  }, [open]);
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
export interface ReqMat { id: string; name: string; quantity: number;  unit: string;
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
  system?: boolean; // tizim yozuvi (AI qo'shildi/chiqarildi) — markazda kichik yozuv
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
export interface SmetaResourceRow { index:number; shifr:string|null; shifrNote:string|null; rawName:string; shortName:string; unit:string; qty:number; price:number|null; total:number|null; group:string; category?:string; warnings:string[]; }
interface SmetaNormRow { index:string; shifr:string|null; name:string; unit:string; perUnit:number; byProject:number; }
export interface SmetaWorkRow { index:number; shifr:string|null; shifrNote:string|null; name:string; unit:string; volume:number|null; section:string|null; norms:SmetaNormRow[]; warnings:string[]; }
interface SmetaGroupTotal { group:string; declared:number; computed:number; diff:number; passed:boolean; }
export interface SmetaResult { meta:any; resources:SmetaResourceRow[]; works:SmetaWorkRow[]; totals:SmetaGroupTotal[]; validation:{ok:boolean; checks:any[]; warnings:string[]; errors:string[]}; }

export const SMETA_GROUP_LABEL: Record<string,string> = {
  labor:"Трудовые ресурсы", general:"Ресурсы общего назначения", machinery:"Строительные машины",
  material:"Материальные ресурсы", equipment:"Оборудование",
};
export const SMETA_GROUP_ORDER = ["labor","general","machinery","material","equipment"];

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
export function hwheel(e: React.WheelEvent<HTMLDivElement>) {
  if (!e.shiftKey) return; // oddiy aylantirish — vertikal, hech narsa qilinmaydi
  const el = e.currentTarget;
  if (el.scrollWidth > el.clientWidth) {
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}

// To'liq aniqlik — HECH NIMANI YAXLITLAMAYDI (kasr, tiyin, manfiy saqlanadi). null → "-".
export function fmtNum(n: number|null|undefined): string {
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
// Owner 2026-10-23: minglar NUQTA bilan ("1.250.000 so'm") — kiritish maydonlari bilan bir xil ko'rinish
export const fmt = (n?: number) => fmtNumber(n || 0) + " so'm";

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

// Excel eksport (owner 2026-10-22: "Excel'ga yuklangan hamma narsa tartibsiz"). Avval ";" bilan CSV edi —
// mintaqa sozlamasiga qarab bitta ustunga yopishib qolardi, sana/summa matn bo'lib chiqardi. Endi haqiqiy .xlsx
// (lib/xlsx — tashqi kutubxonasiz): o'zbekcha sarlavha, so'm formati, sana — sana, filtr, JAMI qatori.
// Nomi eski chaqiruvlar (FinancePage) uchun saqlangan; fayl kengaytmasi avtomatik .xlsx bo'ladi.
export function exportExpensesToCsv(expenses: Expense[], users: AppUser[], projects: Project[], filename: string) {
  import("./lib/xlsx/download")
    .then(m => m.saveExpensesXlsx(expenses, users, projects, filename))
    .then(ok => { if (!ok) toast.error("Fayl saqlanmadi"); })
    .catch(() => toast.error("Fayl saqlanmadi"));
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

// index.html'dagi boshlang'ich loader bilan AYNAN bir xil — yuklanish bitta uzluksiz loader bo'lib ko'rinadi
// Yangi "shisha" (shaffof, blur) bildirishnoma dizayni — eski richColors (to'q yashil/qizil
// to'rtburchak) o'rniga. Ko'rinishi globals.css'dagi .erp-toast bloki orqali.
// Telefonda (owner 2026-10-23) bildirishnomalar PASTDA, menyu/yozish maydonidan yuqorida — tepada ular sarlavhadagi
// tugmalarni (masalan chatdagi qo'ng'iroq) to'sib qo'yardi. Kompyuterda — tepada, o'rtada.
export const AppToaster = () => {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 640px)");
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return (
    <Toaster position={phone ? "bottom-center" : "top-center"} closeButton gap={10} visibleToasts={phone ? 3 : 4} offset={14}
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)", left: 12, right: 12 }}
      toastOptions={{ className: "erp-toast", duration: 3800 }} />
  );
};
// Ilova ICHIDAGI loader — mavzu rangida (index.html'dagi dastlabki amber loader faqat birinchi yuklash uchun;
// uni ilova ichida qayta ishlatganda qanday mavzu bo'lsa ham sariq kvadrat chiqardi — owner 2026-10-26)
export const BootLoader = () => <div className="app-loader"><span className="app-loader__spin" /></div>;

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
  // Rasm yoki (rasm yo'q bo'lsa) foydalanuvchiga barqaror 3D memoji — components/UserAvatar.tsx
  const sz = { sm: "w-7 h-7 text-sm", md: "w-9 h-9 text-sm", lg: "w-16 h-16 text-xl" }[size];
  return <UserAvatar seed={user.id} name={user.name} src={user.avatar} className={sz} />;
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

// Forma oynalari (yangi obyekt/xodim/chiqim, hujjat...) — tashqariga ADASHIB bosilganda yopilmaydi
// (kiritilgan ma'lumot yo'qolmasin). Faqat X / "Bekor qilish" tugmasi yoki Esc bilan yopiladi.
// Telefon sarlavhasi — kam ishlatiladigan tugmalar (e'lonlar, QR, bloklash, mavzu) bitta "⋯" menyuda:
// tepada faqat eng kerakli 4 ta tugma qoladi, barmoq bilan bosish oson bo'ladi.
function HeaderMoreMenu({ items, label }: { items: { key: string; icon: IconNode; label: string; tone: IconTone; onClick: () => void }[]; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative lg:hidden">
      <button onClick={() => setOpen(o => !o)} aria-label={label} title={label} aria-expanded={open}
        className={`btn btn-ghost w-9 h-9 p-0 rounded-full ${open ? "bg-muted text-foreground" : ""}`}>
        <MorphIcon icon={MoreHorizontal} className="w-5 h-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+10px)] z-[70] w-[min(17rem,calc(100vw-24px))] surface rounded-2xl p-1.5 animate-pop-in origin-top-right">
          {items.map(it => (
            <button key={it.key} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full flex items-center gap-3 px-2.5 py-2 min-h-[52px] rounded-xl text-left hover:bg-muted/60 active:bg-muted liquid-transition">
              <IconTile icon={it.icon} tone={it.tone} size="sm" variant="solid" />
              <span className="text-[15px] font-medium">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EscClose({ onClose }: { onClose: () => void }) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Faqat ENG USTDAGI oyna yopilsin (ichma-ich oynalar bo'lsa)
      const all = document.querySelectorAll("[data-esc-modal]");
      const mine = document.querySelector(`[data-esc-id="${id}"]`);
      if (all.length && all[all.length - 1] !== mine) return;
      ref.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const id = useRef(Math.random().toString(36).slice(2)).current;
  return <span hidden data-esc-modal data-esc-id={id} />;
}


// Manzil kiritish — yozayotganda takliflar (OpenStreetMap Nominatim orqali,
// backend proksi qiladi) va "joriy joylashuvni aniqlash" (GPS + teskari
// geokodlash) tugmasi bilan. Obyekt qo'shish VA tahrirlash — ikkalasida
// ham ishlatiladi.
export function LocationInput({ value, onChange, placeholder, onCoords }: { value: string; onChange: (v: string) => void; placeholder?: string; onCoords?: (c: { lat: number; lng: number } | null) => void }) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<{ label: string; lat?: number; lng?: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  // Tanlangan takliflar/GPS koordinatasi — xarita aynan shu joyni ko'rsatishi uchun
  const [coords, setCoordsState] = useState<{ lat: number; lng: number } | null>(null);
  const onCoordsRef = useRef(onCoords); onCoordsRef.current = onCoords;
  const setCoords = (c: { lat: number; lng: number } | null) => { setCoordsState(c); onCoordsRef.current?.(c); };
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
          className="w-full text-sm border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
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


// ─── Send Transfer Modal ───────────────────────────────────────────────────────
export function SendTransferModal({ currentUser, projects, allUsers, onClose, onSend, initialTransfer }:
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
        price: mat.price ? parseMoney(mat.price) || undefined : undefined,
        note: note || undefined
      });
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <EscClose onClose={onClose} />
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] supports-[height:1dvh]:max-h-[88dvh] overflow-hidden animate-slide-up-fade flex flex-col" onClick={e => e.stopPropagation()}>
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
                          <PriceField placeholder="0"
                            className="text-base sm:text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                            value={String(sel.price ?? "")} onChange={v => updateMat(sel.name, "price", v)}/>
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
                            <PriceField placeholder={t('sendTransfer.pricePlaceholder')}
                              className="text-base sm:text-sm border border-border rounded-lg px-2.5 py-1.5 bg-input-background focus:outline-none shadow-sm"
                              value={cm.price} onChange={v => {
                                const newMats = [...customMats];
                                newMats[i].price = v;
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
                          {/* Narx razvedkasi: birlik narxi bozordan baland bo'lsa ogohlantiradi
                              (owner 2026-10-29). Birlik kiritilmagan bo'lsa jim turadi. */}
                          <MarketPriceHint name={cm.name} unit={cm.unit} price={parseMoney(cm.price)} />
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


// ─── Transfer Row (used in My Transfers lists) ────────────────────────────────
export function TransferRow({ t, currentUser, allUsers, projects, onConfirm, onReject }:
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
    <div className={`border rounded-xl p-3 text-sm space-y-2 shadow-sm liquid-transition ${t.status === "confirmed" ? "border-green-500/25 bg-green-500/8" : t.status === "rejected" ? "border-red-500/25 bg-red-500/8" : "border-amber-500/25 bg-amber-500/8"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">{t.materialName}</p>
          <p className="text-muted-foreground font-mono text-sm">
            {t.quantity.toLocaleString()} {t.unit}
            {!!t.price && <span className="ml-1.5 text-primary font-semibold">· {(t.price * t.quantity).toLocaleString()} {tt('common.som')}</span>}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isSender ? <><span className="text-foreground font-medium">{tt('dashboard.youLabel')}</span> → {to?.name}</> : <>{from?.name} → <span className="text-foreground font-medium">{tt('dashboard.youLabel')}</span></>}
          </p>
          <p className="text-sm text-muted-foreground">{proj?.name} • {t.date || t.sentDate}</p>
          {t.note && <p className="text-sm text-muted-foreground italic">{t.note}</p>}
          {t.defect && <p className="text-sm text-amber-700 flex items-center gap-1 mt-0.5"><MorphIcon icon={AlertTriangle} className="w-2.5 h-2.5" />{t.defect}</p>}
          {t.status === "confirmed" && isSender && t.confirmedDate && (
            <p className="text-sm text-green-800 dark:text-green-400 font-medium mt-0.5">✓ {tt('dashboard.confirmedByLabel', { name: to?.name, date: t.confirmedDate })}</p>
          )}
        </div>
        <div className="flex-shrink-0">{statusBadge}</div>
      </div>
      {canConfirm && (
        <div className="space-y-1.5">
          <textarea rows={1} placeholder={tt('dashboard.defectPlaceholder')} value={defect} onChange={e => setDefect(e.target.value)}
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-input-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"/>
          <div className="flex gap-1.5">
            <button onClick={() => onConfirm(t.id, defect || undefined)}
              className="flex-1 flex items-center justify-center gap-1 text-sm bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold">
              <MorphIcon icon={Check} className="w-3 h-3" />{tt('dashboard.acceptBtn')}
            </button>
            <button onClick={() => onReject(t.id)}
              className="flex items-center justify-center gap-1 text-sm bg-red-500/15 text-red-700 dark:text-red-300 rounded px-2.5 py-1.5 hover:bg-red-500/100/25 font-semibold">
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
        <h2 className="text-sm font-bold uppercase tracking-wider font-display">{t('dashboard.materials')}</h2>
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
          <div className="text-center py-10 text-muted-foreground"><IconTile icon={Package} tone="orange" size="xl" variant="soft" className="mx-auto mb-3" /><p className="text-sm">{t('dashboard.emptyList')}</p></div>
        ) : shown.map(tr => (
          <TransferRow key={tr.id} t={tr} currentUser={currentUser} allUsers={allUsers} projects={projects} onConfirm={onConfirm} onReject={onReject}/>
        ))}
      </div>
    </div>
  );
}


// ─── Dashboard (Admin) ────────────────────────────────────────────────────────
// Backup yuklab olish / tiklash — AdminDashboard va Profil sahifasi ikkalasida ishlatiladi.
export function useBackupActions() {
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
    const typed = await promptDialog(t('dashboard.importConfirmPrompt') as string, { danger: true });
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


// ─── Umumiy "Boshqaruv" modal skeleton — jihoz/xavfsizlik/hujjat/ish haqi
// modallarining barchasi bir xil qobiq (header+yopish) ishlatadi. ────────────
export function ManagementModalShell({ icon, title, onClose, children }: { icon: any; title: string; onClose: () => void; children: React.ReactNode }) {
  useModalPresence();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" >
      <EscClose onClose={onClose} />
      <div className="glass-modal rounded-2xl w-full max-w-lg p-5 animate-slide-up-fade max-h-[85vh] supports-[height:1dvh]:max-h-[85dvh] overflow-y-auto scrollbar-hide" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={icon} className="w-4 h-4 text-primary" />{title}</h3>
          <button aria-label={i18n_common_close} onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const i18n_common_close = "Yopish";





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
    if (!await confirmDialog(t('common.confirmDelete') as string)) return;
    try { const r = await fetch(`${API_BASE}/api/announcements/${id}`, { method: 'DELETE' }); if (r.ok) load(); } catch {}
  };

  return (
    <ManagementModalShell icon={Megaphone} title={t('announcements.title')} onClose={onClose}>
      {canPost && (
        showForm ? (
          <Suspense fallback={<BootLoader />}><AnnouncementComposer endpoint="/api/announcements" onCancel={()=>setShowForm(false)} onPosted={()=>{ setShowForm(false); load(); }} /></Suspense>
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
                  <div className="mt-1"><Suspense fallback={null}><AnnouncementContent a={a} /></Suspense></div>
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





// ─── Currency utils ────────────────────────────────────────────────────────────
// Global rates — fetched from backend (CBU Uzbekistan) and cached
export let LIVE_USD_RATE = 12900;
export let LIVE_EUR_RATE = 14100;
export let LIVE_RATE_DATE = "";
// Kapitalbank kursi (server bank.uz'dan oladi): buy — kirim, sell — chiqim
export let LIVE_KAPITAL: { USD?: { buy: number; sell: number }; EUR?: { buy: number; sell: number }; updatedAt?: string } | null = null;
export let LIVE_RATE_SOURCE = "";

export async function fetchLiveCurrencyRates(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/currency/rates`);
    if (res.ok) {
      const data = await res.json();
      LIVE_USD_RATE = data.USD || LIVE_USD_RATE;
      LIVE_EUR_RATE = data.EUR || LIVE_EUR_RATE;
      LIVE_RATE_DATE = data.date || "";
      LIVE_KAPITAL = data.kapital || null;
      LIVE_RATE_SOURCE = data.source || "";
    }
  } catch {}
}

// Sarlavhadagi aylanma satr (owner 2026-10-26: "dollar kursi almashib tursin — yangiliklar, ob-havo va
// hokazo ham bo'lsin"). Bandlar serverdan keladi (/api/ticker: kurs, Toshkent ob-havosi, yangilik sarlavhalari),
// birinchi band — bugungi sana. Har 6 soniyada yumshoq almashadi; so'rov muvaffaqiyatsiz bo'lsa sana qoladi.
let TICKER_CACHE: { at: number; items: { kind: string; text: string; icon?: string }[] } = { at: 0, items: [] };

/** Firma nomi — mavjud kenglikka qarab shrift o'zi kichrayadi, to'liq sig'adi (owner 2026-10-27:
 *  "nomi to'lib tursin, lekin sal kichraytir, sig'adigan qilib"). Kesilgan "AKFAD…" bo'lmaydi. */
function CompanyName({ name }: { name: string }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    // Owner 2026-10-28: "bitta o'rtacha default qo'y — nomi kichik bo'lsa ham kichrayib
    // ketmasin". Shrift DOIM 16px; faqat nom haqiqatan sig'masa 13px gacha kichrayadi.
    let size = 16;
    el.style.fontSize = size + "px";
    while (size > 13 && el.scrollWidth > el.clientWidth + 1) { size -= 0.5; el.style.fontSize = size + "px"; }
  };
  useLayoutEffect(() => { fit(); }, [name]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <p ref={ref} className="font-bold tracking-tight leading-[1.15] whitespace-nowrap overflow-hidden text-ellipsis block w-full"
      style={{ fontSize: 16 }} title={name}>{name}</p>
  );
}

function HeaderTicker() {
  const { i18n } = useTranslation();
  const ru = i18n.language?.startsWith("ru");
  const now = new Date();
  const MON = ru ? ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] : ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"];
  const day = `${now.getDate()}-${MON[now.getMonth()]}`;
  const [items, setItems] = useState<{ kind: string; text: string }[]>(() => TICKER_CACHE.items);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    if (Date.now() - TICKER_CACHE.at < 15 * 60_000 && TICKER_CACHE.items.length) { setItems(TICKER_CACHE.items); return; }
    const tok = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
    fetch(`${API_BASE}/api/ticker`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d?.items) ? d.items.slice(0, 8) : [];
        if (!list.length) return;
        TICKER_CACHE = { at: Date.now(), items: list };
        if (alive) setItems(list);
      })
      .catch(() => { /* tarmoq yo'q — sana ko'rinadi */ });
    return () => { alive = false; };
  }, []);

  const all = [{ kind: "day", text: day }, ...items];

  const cur = all[i % all.length];
  // Owner 2026-10-27: "gap sig'mayapti — o'zi ko'rinmagan tarafiga qarab surilsin, qo'lda qilib bo'lmasin"
  // Owner 2026-10-28: matn ikonka USTIGA chiqib ketmasligi uchun u endi o'z "oynasi"
  // (clipRef) ichida suriladi — ikonka o'sha oynadan tashqarida, ustma-ust tushmaydi.
  const clipRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const box = clipRef.current, el = textRef.current;
    if (!box || !el) { setShift(0); return; }
    const over = Math.max(0, el.scrollWidth - box.clientWidth);
    setShift(over > 4 ? over + 6 : 0);
  }, [cur.text, cur.kind]);

  // Surilish tezligi — sekinroq (o'qishga qulay bo'lsin). Uzun gap bo'lsa band
  // shuncha uzoq turadi: gap OXIRIGACHA surilib bo'lmaguncha keyingisi chiqmaydi
  // (owner 2026-10-28: "gap tugamasdan oxirigacha boshqasi chiqvotti").
  const scrollSec = shift ? Math.max(5, shift / 11) : 0;
  const dwellMs = Math.round((shift ? scrollSec + 1.2 : 0) * 1000) || 6500;
  useEffect(() => {
    if (all.length < 2) return;
    const t = setTimeout(() => setI((v) => (v + 1) % all.length), Math.max(6500, dwellMs));
    return () => clearTimeout(t);
  }, [all.length, i, dwellMs]);
  const ICON: Record<string, typeof CalendarIcon> = { day: CalendarIcon, rate: DollarIcon, weather: SunIcon, news: NewsIcon };
  const tone = cur.kind === "rate" ? "text-emerald-600 dark:text-emerald-400"
    : cur.kind === "weather" ? "text-sky-600 dark:text-sky-400"
    : "text-muted-foreground";
  // Balandlik QAT'IY (h-[15px]) — satr almashganda sarlavha "sakramaydi"; yangi band pastdan ko'tariladi.
  return (
    <span className="relative block h-[16px] overflow-hidden min-w-0" data-testid="header-day-rate" title={cur.text}>
      {/* Owner 2026-10-28: "chiqadigan narsalar ikonlar ustiga chiqib ketvotti" — ilgari
          eski va yangi band bir vaqtning o'zida chizilib, matn ustma-ust tushardi.
          "wait": avval eskisi chiqib ketadi, keyin yangisi ko'tariladi. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={`${i}-${cur.kind}`}
          initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute inset-0 flex items-center gap-1 ${tone}`}>
          <MorphIcon icon={ICON[cur.kind] || CalendarIcon} className="w-[15px] h-[15px] flex-shrink-0 opacity-85" />
          {/* Owner 2026-10-27: belgi ikki marta chiqmasin — matn boshidagi $/emoji olib tashlanadi */}
          <span ref={clipRef} className="relative flex-1 min-w-0 overflow-hidden flex items-center"
            style={{ WebkitMaskImage: "linear-gradient(90deg, #000 0, #000 calc(100% - 14px), transparent 100%)", maskImage: "linear-gradient(90deg, #000 0, #000 calc(100% - 14px), transparent 100%)" }}>
            <motion.span ref={textRef} className="text-[12px] font-semibold leading-none whitespace-nowrap"
              animate={shift ? { x: [0, 0, -shift, -shift] } : { x: 0 }}
              transition={shift ? { duration: scrollSec, times: [0, 0.18, 0.86, 1], ease: "linear" } : { duration: 0.2 }}>{cur.text.replace(/^[\s$€₽ \p{Extended_Pictographic}]+/u, "")}</motion.span>
          </span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function fmtUsd(uzs: number): string { return "$" + fmtNumber(uzs / LIVE_USD_RATE); }



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
// Chegaralar (border) aniqroq ko'rinsin — mavzudagi shaffof border alfasi kuchaytiriladi
function boostBorder(c: string): string {
  const m = c.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
  if (!m) return c;
  const a = Math.min(0.32, Math.max(0.16, +m[4] * 1.75));
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${+a.toFixed(3)})`;
}
// Hozirgi qurilma turi — "tizim bo'yicha" rejim ikonkasi shu qurilmaga mos bo'ladi
export function deviceKind(): "phone" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = Math.min(window.innerWidth, window.screen?.width || window.innerWidth);
  const touch = window.matchMedia?.("(pointer: coarse)").matches;
  if (w < 640) return "phone";
  if (touch && w < 1280) return "tablet";
  return "desktop";
}
function themeVars(p: VarInput): Record<string, string> {
  p = { ...p, border: boostBorder(p.border) };
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
    light: themeVars({ primary:"#1B3A6B", accent:"#D2440F", secondary:"#E8EDF6", secondaryFg:"#1B3A6B", bg:"#F5F7FA", card:"#FFFFFF", fg:"#0F172A", muted:"#EEF1F6", mutedFg:"#5B6474", border:"rgba(15,23,42,0.09)", input:"#F1F4F8", ring:"#1B3A6B" }),
    dark:  themeVars({ primary:"#3E6DB5", accent:"#F26A3D", secondary:"#1A2233", secondaryFg:"#CBD5E1", bg:"#0A0E16", card:"#121826", fg:"#E8ECF3", muted:"#1A2130", mutedFg:"#8E9AAE", border:DARK_BORDER, input:"#161D2B", ring:"#5B8DD6" }) },
  { id: "ocean", name: "Okean", primary: "#0369A1", accent: "#0B7CAF",
    light: themeVars({ primary:"#0369A1", accent:"#0B7CAF", secondary:"#E0F0FA", secondaryFg:"#075985", bg:"#F4F8FB", card:"#FFFFFF", fg:"#0B2230", muted:"#EAF1F6", mutedFg:"#56707F", border:"rgba(8,47,73,0.09)", input:"#EEF4F8", ring:"#0369A1" }),
    dark:  themeVars({ primary:"#2A94D6", accent:"#22C3E6", secondary:"#10283A", secondaryFg:"#BAE0F5", bg:"#071118", card:"#0F1C26", fg:"#E3EEF4", muted:"#15242F", mutedFg:"#86A2B2", border:DARK_BORDER, input:"#132330", ring:"#38BDF8" }) },
  { id: "forest", name: "O'rmon", primary: "#166534", accent: "#12863D",
    light: themeVars({ primary:"#166534", accent:"#12863D", secondary:"#E1F3E6", secondaryFg:"#14532D", bg:"#F5F8F5", card:"#FFFFFF", fg:"#10241A", muted:"#EBF2EC", mutedFg:"#56685B", border:"rgba(20,50,30,0.09)", input:"#EEF4EF", ring:"#166534" }),
    dark:  themeVars({ primary:"#2E9E5B", accent:"#22C55E", secondary:"#13281B", secondaryFg:"#BBF7D0", bg:"#08100B", card:"#101B14", fg:"#E3F0E7", muted:"#16231B", mutedFg:"#8AA794", border:DARK_BORDER, input:"#15221A", ring:"#34D399" }) },
  { id: "purple", name: "Binafsha", primary: "#6D28D9", accent: "#7C3AED",
    light: themeVars({ primary:"#6D28D9", accent:"#7C3AED", secondary:"#EEE8FD", secondaryFg:"#5B21B6", bg:"#F7F6FB", card:"#FFFFFF", fg:"#1E1633", muted:"#EFEDF7", mutedFg:"#655F7A", border:"rgba(40,25,80,0.09)", input:"#F2F0F8", ring:"#6D28D9" }),
    dark:  themeVars({ primary:"#7C4DE0", accent:"#A78BFA", secondary:"#221A3A", secondaryFg:"#DDD6FE", bg:"#0D0A16", card:"#171224", fg:"#EDE9F6", muted:"#1E1830", mutedFg:"#A097BA", border:DARK_BORDER, input:"#1B1529", ring:"#A78BFA" }) },
  { id: "rose", name: "Atirgul", primary: "#BE123C", accent: "#E11D48",
    light: themeVars({ primary:"#BE123C", accent:"#E11D48", secondary:"#FDE6EA", secondaryFg:"#9F1239", bg:"#FAF6F7", card:"#FFFFFF", fg:"#2A1218", muted:"#F4ECEE", mutedFg:"#7C6268", border:"rgba(80,20,35,0.09)", input:"#F6F0F1", ring:"#BE123C" }),
    dark:  themeVars({ primary:"#E24B6A", accent:"#F43F5E", secondary:"#33171F", secondaryFg:"#FECDD3", bg:"#130A0D", card:"#1E1216", fg:"#F5E9EC", muted:"#27171C", mutedFg:"#BA969E", border:DARK_BORDER, input:"#24151A", ring:"#FB7185" }) },
  { id: "slate", name: "Tosh", primary: "#334155", accent: "#475569",
    light: themeVars({ primary:"#334155", accent:"#475569", secondary:"#E5E9EF", secondaryFg:"#1E293B", bg:"#F5F6F8", card:"#FFFFFF", fg:"#111827", muted:"#ECEEF2", mutedFg:"#5B6472", border:"rgba(17,24,39,0.09)", input:"#F0F2F5", ring:"#334155" }),
    dark:  themeVars({ primary:"#64748B", accent:"#94A3B8", secondary:"#1D222B", secondaryFg:"#CBD5E1", bg:"#0B0D11", card:"#14171D", fg:"#E7EAEF", muted:"#1B1F27", mutedFg:"#8F98A6", border:DARK_BORDER, input:"#181C23", ring:"#94A3B8" }) },
  { id: "amber", name: "Oltin rang", primary: "#B45309", accent: "#B16105",
    light: themeVars({ primary:"#B45309", accent:"#B16105", secondary:"#FBF0DD", secondaryFg:"#92400E", bg:"#F8F6F2", card:"#FFFFFF", fg:"#1F1A13", muted:"#F1EDE6", mutedFg:"#6E6458", border:"rgba(70,45,15,0.09)", input:"#F4F1EB", ring:"#B45309" }),
    dark:  themeVars({ primary:"#B87A1C", accent:"#F59E0B", secondary:"#2A2216", secondaryFg:"#FDE68A", bg:"#0F0D0A", card:"#1A1713", fg:"#F4EFE7", muted:"#221E19", mutedFg:"#AB9F8C", border:DARK_BORDER, input:"#1F1B16", ring:"#FBBF24" }) },
  { id: "teal", name: "Moviy-yashil", primary: "#0F766E", accent: "#0C8479",
    light: themeVars({ primary:"#0F766E", accent:"#0C8479", secondary:"#D9F3EE", secondaryFg:"#115E59", bg:"#F4F8F7", card:"#FFFFFF", fg:"#0D2422", muted:"#E9F1EF", mutedFg:"#536A66", border:"rgba(10,60,55,0.09)", input:"#EEF4F3", ring:"#0F766E" }),
    dark:  themeVars({ primary:"#1AA093", accent:"#14B8A6", secondary:"#0F2A27", secondaryFg:"#99F6E4", bg:"#071110", card:"#0F1C1A", fg:"#DFF0ED", muted:"#152523", mutedFg:"#86AAA4", border:DARK_BORDER, input:"#132220", ring:"#2DD4BF" }) },
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
  const barRef = useRef<HTMLDivElement>(null);
  // Owner 2026-10-22: ochilgandan keyin boshqa joy bosilsa, aylantirilsa yoki surilsa — yopilsin
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("touchmove", outside, { capture: true, passive: true });
    window.addEventListener("resize", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("touchmove", outside, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const confirmed = expenses.filter(e=>e.status==="confirmed");
  const total = confirmed.reduce((a,e)=>a+e.amount,0);
  const byProj = projects.map(p=>({name:p.name,amount:confirmed.filter(e=>e.projectId===p.id).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.amount>0);
  const byType = (Object.keys(EXP_LABELS) as ExpType[]).map(k=>({name:expLabel(t, k),amount:confirmed.filter(e=>e.type===k).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.amount>0);
  return (
    <div ref={barRef} className="expense-glass flex-shrink-0 overflow-hidden text-white z-20">
      {open&&(
        <div className="border-b border-white/10 px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[60vh] supports-[height:1dvh]:max-h-[60dvh] overflow-y-auto">
          <div><p className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-2">{t('finance.byProject')}</p>
            {byProj.map(d=><div key={d.name} className="flex items-center justify-between py-0.5"><span className="text-sm text-white/80 truncate mr-4">{d.name}</span><span className="text-sm font-mono font-semibold text-white flex-shrink-0">{fmt(d.amount)}</span></div>)}
          </div>
          <div><p className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-2">{t('finance.byType')}</p>
            {byType.map(d=><div key={d.name} className="flex items-center justify-between py-0.5"><span className="text-sm text-white/80">{d.name}</span><span className="text-sm font-mono font-semibold text-white">{fmt(d.amount)}</span></div>)}
          </div>

        </div>
      )}
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-2"><MorphIcon icon={TrendingDown} className="w-4 h-4 text-white/90" /><span className="text-sm text-white/90">{t('finance.totalExpenses')}</span></div>
        <div className="flex items-center gap-2 min-w-0"><CountUp value={total} format={fmt} className="text-sm font-bold font-mono truncate" testId="total-expenses-bar" /><MorphIcon icon={open ? ChevronUp : ChevronDown} className="w-4 h-4 text-white/60 flex-shrink-0" /></div>
      </button>
    </div>
  );
}

// ─── OTP kod qutilar (kirish kodi 4 xonali; dasturchi 2FA — 6) — auto-advance, backspace, paste ──────
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
    <div className={`relative flex justify-center ${length > 4 ? "gap-1.5 sm:gap-2" : "gap-2.5"}`}>
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
          className={`${length > 4 ? "w-11 h-14 sm:w-12 sm:h-16 text-xl" : "w-14 h-16 text-2xl"} flex items-center justify-center font-bold rounded-2xl border bg-white/50 dark:bg-black/20 shadow-inner liquid-transition ${error ? "border-red-500/50" : value.length === i ? "border-primary ring-2 ring-primary/50" : "border-border/50"}`}>
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
  const [codeLen, setCodeLen] = useState(4); // server aytgan kod uzunligi (owner 2026-10-28: kirish kodi yana 4 xonali)
  const [password, setPassword] = useState("");
  // Ish jarayonida obuna tugasa (API 402) — kirish ekrani darhol "obuna" holatida ochiladi
  // Owner 2026-10-30: "refreshdan keyin chiqib ketyapti — chiqib ketmasin".
  // Avval bu qiymat O'QILISHI BILAN o'chirilardi, shuning uchun sahifa
  // yangilansa obuna ekrani yo'qolib, telefon qadamiga qaytarardi. Endi
  // saqlanib turadi va faqat ikki holatda o'chadi: foydalanuvchi "Orqaga"
  // bossa yoki muvaffaqiyatli kirsa.
  // sessionStorage (localStorage emas): ichida to'lov tokeni bor, oyna
  // yopilishi bilan o'chib ketgani to'g'ri.
  const [initialBlockedInfo] = useState<BlockedInfo|null>(() => {
    try {
      const raw = sessionStorage.getItem('erp_subBlockedInfo');
      if (raw) {
        const v = JSON.parse(raw);
        if (v && (v.reason === 'pending' || v.reason === 'expired' || v.reason === 'rejected')) return v as BlockedInfo;
      }
      // Eski kalit (faqat sabab) — orqaga moslik uchun
      const old = sessionStorage.getItem('erp_subBlocked');
      if (old === 'pending' || old === 'expired' || old === 'rejected') return { reason: old };
    } catch { /* shaxsiy rejimda o'qib bo'lmaydi */ }
    return null;
  });
  const initialBlocked = initialBlockedInfo?.reason ?? null;
  const [step, setStep] = useState<"phone" | "code" | "devpass" | "blocked" | "qr">(initialBlocked ? "blocked" : "phone");
  const [blockedReason, setBlockedReason] = useState<'pending'|'expired'|'rejected'|null>(initialBlocked);
  // Obuna tugaganda server to'lov uchun token va tarif ma'lumotini ham beradi
  // (owner 2026-10-30) — shu ekranning o'zida to'lash uchun.
  const [blockedInfo, setBlockedInfo] = useState<BlockedInfo|null>(initialBlockedInfo);
  const clearBlocked = () => {
    setBlockedReason(null); setBlockedInfo(null);
    try { sessionStorage.removeItem('erp_subBlockedInfo'); sessionStorage.removeItem('erp_subBlocked'); } catch { /* ignore */ }
  };
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
      setCodeLen(Number(data.codeLength) === 6 ? 6 : 4);
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
          const info: BlockedInfo = {
            reason: data.subscriptionStatus,
            token: data.billingToken,
            selectedPlan: data.selectedPlan ?? null,
            periodEnd: data.periodEnd ?? null,
            canPay: data.canPay,
          };
          setBlockedInfo(info);
          // Sahifa yangilansa shu ekran joyida qolsin
          try { sessionStorage.setItem('erp_subBlockedInfo', JSON.stringify(info)); } catch { /* ignore */ }
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
      try { sessionStorage.removeItem('erp_subBlockedInfo'); sessionStorage.removeItem('erp_subBlocked'); } catch { /* ignore */ }
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
    if (step === "code" && code.length === codeLen) handleCodeSubmit();
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
        <h1 className="text-3xl font-bold font-display bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">{loginCompanyName}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('login.subtitle')}</p>
      </motion.div>
      <div className="mb-4 relative z-10">
        <LanguageSwitcher size="sm" value={i18n.language as SiteLang} onChange={l => setSiteLanguage(l)}/>
      </div>
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 280, damping: 26, delay: 0.08 }}
        className="w-full max-w-sm space-y-4 glass p-7 rounded-[2rem] border border-white/25 shadow-2xl shadow-primary/10 relative z-10 overflow-hidden">
        {error && <div className="bg-red-500/10 text-red-700 dark:text-red-400 text-sm p-3 rounded-lg border border-red-500/20 text-center">{error}</div>}

        <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 mb-4">
              <p className="text-sm text-muted-foreground leading-relaxed text-center">
                {t('login.botHintBefore')} <span className="font-semibold text-foreground">/start</span> {t('login.botHintAfter')}
              </p>
              <a href="https://t.me/qurilish_erp_bot" target="_blank" rel="noopener noreferrer" className="mt-2 text-sm font-semibold text-foreground flex items-center justify-center gap-1 hover:underline hover:text-primary">
                <MorphIcon icon={Send} className="w-3 h-3 text-primary" /> {t('login.goToBot', { handle: '@qurilish_erp_bot' })}
              </a>
            </div>
            <div>
              <label htmlFor="login-phone" className="text-sm font-medium block mb-1.5 ml-1 text-muted-foreground">{t('login.phoneLabel')}</label>
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
          <Suspense fallback={<BootLoader />}><QrLoginPanel onLogin={onLogin} onBack={() => setStep("phone")} /></Suspense>
        ) : step === "blocked" && blockedReason !== 'pending' ? (
          // Owner 2026-10-30: muddat tugaganda boshi berk ekran emas — tarif
          // tanlash, onlayn to'lov va "admin orqali" (bitta tugma) shu yerda.
          <Suspense fallback={null}>
            <SubscriptionBlocked
              info={blockedInfo || { reason: (blockedReason as 'expired' | 'rejected') || 'expired' }}
              adminHandle="@Sadriddinov_Jahongir"
              onBack={() => { clearBlocked(); setStep("phone"); setError(""); }} />
          </Suspense>
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
            </div>
            <a href="https://t.me/Sadriddinov_Jahongir" target="_blank" rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-500 text-white text-sm font-semibold py-3.5 rounded-full min-h-[44px] active:scale-[0.98] transition-transform">
              <MorphIcon icon={Send} className="w-4 h-4" /> {t('login.contactAdmin', { handle: '@Sadriddinov_Jahongir' })}
            </a>
            <button type="button" onClick={() => { clearBlocked(); setStep("phone"); setError(""); }}
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2">
              {t('login.back')}
            </button>
          </div>
        ) : step === "devpass" ? (
          <form onSubmit={handleDevLogin} className="space-y-4">
            <div className="bg-slate-800/5 border border-slate-800/10 rounded-xl p-3 mb-2 text-center">
              <p className="text-sm text-muted-foreground">{t('login.devLoginTitle')}</p>
              <p className="text-xs font-mono text-foreground mt-1">{phone}</p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5 ml-1 text-muted-foreground text-center">{t('login.passwordLabel')}</label>
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
                className="w-full text-sm text-primary hover:underline py-1 liquid-transition disabled:opacity-60">
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
            <button type="button" onClick={() => { setStep("phone"); setPassword(""); setDevResetStage("none"); }} className="w-full text-sm text-muted-foreground hover:text-foreground py-2 liquid-transition">
              {t('login.changeNumber')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-2 text-muted-foreground text-center">{t('login.codeLabel')}</label>
              <OtpBoxes value={code} length={codeLen} onChange={v => { setError(""); setCode(v); }} error={!!error} autoFocus/>
            </div>
            <button type="submit" disabled={submitting} className="w-full bg-gradient-to-r from-primary via-primary to-blue-700 text-white text-sm font-bold py-3.5 rounded-full shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98] liquid-transition disabled:opacity-60 disabled:pointer-events-none">
              {t('login.enterSystem')}
            </button>
            <div className="flex flex-col gap-2 pt-2">
              <button type="button" onClick={() => {
                if (timeLeft === 0) handlePhoneSubmit();
              }} className={`w-full text-sm font-medium py-2 rounded-lg liquid-transition ${timeLeft > 0 ? "text-muted-foreground/50 cursor-not-allowed" : "text-primary hover:bg-primary/10"}`}>
                {timeLeft > 0 ? t('login.resendCountdown', { time: `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` }) : t('login.resend')}
              </button>
              <button type="button" onClick={() => setStep("phone")} className="w-full text-sm text-muted-foreground hover:text-foreground py-2 liquid-transition">
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
    <main className="h-[100dvh] overflow-y-auto overscroll-contain bg-background">
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
          <p className="text-[11px] text-muted-foreground mt-2">
            {(data as any).progressSource === 'ai_photo' ? "Bajarilish — obyekt rasmlari bo'yicha AI bahosi" : (data as any).progressSource === 'manual' ? "Bajarilish — prorab/rahbar bahosi" : "Material yetkazib berish progressi"} (moliyaviy ma'lumot ko'rsatilmaydi)
            {(data as any).endDate && <> · Reja bo'yicha tugash: <b>{(data as any).endDate}</b></>}
          </p>
          {(data as any).aiNote && <p className="text-xs mt-2 rounded-xl bg-muted/50 px-3 py-2">🤖 {(data as any).aiNote}</p>}
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
  // Obuna tugagan/rad etilgan (API 402) — sessiya yopiladi, kirish ekranida obuna holati ko'rsatiladi
  useEffect(() => {
    const onSubBlocked = () => {
      localStorage.removeItem("currentUser"); localStorage.removeItem("token");
      setCurrentUser(null); setAuthView("login");
    };
    window.addEventListener('erp:subscription-blocked', onSubBlocked);
    // Hisob o'chirilgan yoki sessiya bekor qilingan (401) — xuddi shunday chiqish, faqat kirgan bo'lsa
    const onSessionEnded = () => {
      if (!localStorage.getItem("token")) return;
      localStorage.removeItem("currentUser"); localStorage.removeItem("token");
      setCurrentUser(null); setAuthView("login");
      toast.message(tApp('profile.sessionRevokedNotice'));
    };
    window.addEventListener('erp:session-ended', onSessionEnded);
    return () => { window.removeEventListener('erp:subscription-blocked', onSubBlocked); window.removeEventListener('erp:session-ended', onSessionEnded); };
  }, []);
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
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
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
  // Smena qayta ochilganda (yopiq paytda server ma'lumot bermagan) — ma'lumotlarni qayta yuklash uchun
  const [dataReloadKey, setDataReloadKey] = useState(0);
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
    // Ilovaning o'z oflayn navbati (api.ts) — SyncStatusBar o'zi tinglaydi (bu yerda faqat SW navbati)
    // Oflayn qilingan amal serverda rad etildi (masalan ruxsat yo'q) — foydalanuvchi bilsin
    const onRejected = () => toast.error(tApp('sync.rejected'));
    window.addEventListener('erp:offline-rejected', onRejected);
    // Navbat to'liq yuborildi — vaqtinchalik (oflayn) yozuvlar serverdagi haqiqiysi bilan almashsin
    const onSynced = () => {
      const tok = localStorage.getItem('token');
      if (!tok) return;
      fetch(API_BASE + "/api/transactions").then(r => r.ok ? r.json() : null).then((tData: any) => {
        if (!Array.isArray(tData)) return;
        const formattedT = tData.map((t: any) => ({ ...t, id: t.id || t._id }));
        setTransfers(formattedT.filter((t: any) => t.type === 'transfer'));
        setIncomes(formattedT.filter((t: any) => t.type === 'income'));
        setExpenses(formattedT.filter((t: any) => t.type !== 'transfer' && t.type !== 'income'));
      }).catch(() => {});
    };
    window.addEventListener('erp:offline-synced', onSynced);

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
      window.removeEventListener('erp:offline-rejected', onRejected);
      window.removeEventListener('erp:offline-synced', onSynced);
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
  // Chat belgisi — ChatList'dagi "O'qilmagan" jildi bilan bir xil manba (chatModel)
  const [navChatPrefs] = useChatPrefs(currentUser?.id || '');
  const navChatUnread = useMemo(() => {
    if (!liveUser) return 0;
    const list = buildChatEntries({ me: liveUser, users, groups, messages,
      groupSeen: navChatPrefs.groupSeen, baseline: navChatPrefs.baseline, readAllAt: navChatPrefs.readAllAt, supportName: '' });
    return navUnreadCount(list, new Set(navChatPrefs.muted));
  }, [liveUser, users, groups, messages, navChatPrefs]);

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
      // Ilova (exe/APK) va sayt alohida yoqiladi/o'chiriladi
      .then(d => setSiteEnabled(isNative() ? d?.appEnabled !== false : d?.siteEnabled !== false))
      .catch(() => {})
      .finally(() => setStatusChecking(false));
  };
  useEffect(() => { checkSiteStatus();
    // Ish jarayonida o'chirilsa (API 503 maintenance) — darhol tekshiramiz; har daqiqada ham
    const onMaint = () => checkSiteStatus();
    window.addEventListener('erp:maintenance', onMaint);
    const iv = setInterval(checkSiteStatus, 60_000);
    return () => { window.removeEventListener('erp:maintenance', onMaint); clearInterval(iv); };
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
  // Boshlang'ich/fondan qaytgandagi maxfiylik qoplamasi — qulf ekrani (yoki ochiq ilova) chizilgach olinadi
  useEffect(() => { if (!pinSyncing) hidePrivacyCover(); }, [appLocked, liveUser?.id, pinSyncing]);
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
  // Ixtiyoriy funksiyalar (kirim hisobi) — faqat tarifda ANIQ yoqilgan bo'lsa
  const OPTIONAL_FEATURES = ['income'];
  const hasFeature = (key: string) => OPTIONAL_FEATURES.includes(key) ? !!companyFeatures?.includes(key) : (!companyFeatures || companyFeatures.includes(key));
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
  // Android: orqa fonda ishlash (ilova yopilsa ham GPS + bildirishnomalar) — tizimga kirilganda yoqiladi,
  // chiqilganda to'xtatiladi.
  useEffect(() => {
    if (liveUser?.id) startBackground({ trackLocation: !!gpsTracking, intervalSec: 60 });
    else stopBackground();
  }, [liveUser?.id, gpsTracking]);

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
  const loadTodayAttendance = () => {
    if (!liveUser) return;
    if (!isWorkerRole) { setAttendanceChecked(true); return; }
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${API_BASE}/api/attendance/today`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTodayAttendance(d); else setTodayAttendance(null); })
      .catch(()=>{})
      .finally(() => setAttendanceChecked(true));
  };
  useEffect(() => { loadTodayAttendance();
    // Server "avval ishga keling" (423) desa — holatni darhol qayta tekshiramiz (masalan botdan ish tugatilgan)
    const onGate = () => loadTodayAttendance();
    window.addEventListener('erp:checkin-required', onGate);
    return () => window.removeEventListener('erp:checkin-required', onGate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUser?.id]);
  // Smena: ishchi "Ishga keldim" bosgan va hali "Ishni tugatdim" bosmagan bo'lsagina tizim ochiq
  const shiftClosed = isWorkerRole && (!todayAttendance?.checkIn || !!todayAttendance?.checkOut);
  const wasClosedRef = useRef(shiftClosed);
  useEffect(() => {
    if (wasClosedRef.current && !shiftClosed && attendanceChecked) setDataReloadKey(k => k + 1);
    wasClosedRef.current = shiftClosed;
  }, [shiftClosed, attendanceChecked]);

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
  // Refreshda yoki sahifaga qaytganda skroll joyi tiklanadi (owner 2026-10-19); chat o'z skrolini o'zi boshqaradi
  const pageScrollRef = useScrollMemory(page === "chat" ? "chat-off" : `${page}:${selProject?.id || ""}`);

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

      // Tizim bildirishnomasi ruxsati (Windows / Android / iOS / brauzer — platformaning o'zidan)
      ensureNotifyPermission().catch(()=>{});

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
        if (isChatMuted(liveUser.id, m)) return; // ovozsiz qilingan chat — toast ham, tizim bildirishnomasi ham yo'q
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
        if (!viewingChat || !appInForeground()) notifyOS(name, preview, { tag: 'qurilish-chat-' + m.fromUserId, url: '/?page=chat' });
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
        // allaqachon qo'ng'iroqda — CallOverlay mesh'ni boshqaradi; AI suhbat faol bo'lsa — "band" deb rad etamiz
        const decision = decideCallOffer({ from: d?.from, selfId: liveUser.id, webrtcActive: !!activeCallRef.current, aiActive: isAiCallActive() });
        if (decision === 'ignore') return;
        if (decision === 'busy') { socket.emit('call:reject', { to: d.from, from: liveUser.id, reason: 'busy' }); return; }
        sfx.unlock().catch(() => {});
        try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch {}
        setActiveCall({ direction: 'in', mode: d.mode || 'voice', peerId: d.from, groupId: d.groupId, offer: d.sdp, fromName: d.fromName });
        notifyOS(d.mode === 'video' ? "📹 Video qo'ng'iroq" : "📞 Qo'ng'iroq", `${d.fromName || ''} qo'ng'iroq qilmoqda`.trim(), { tag: 'call' });
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
        // Yashirin paytda o'tkazib yuborilgan zaxira so'rovlar — qaytishi bilan darhol bir marta
        if (document.visibilityState === 'visible' && pollSkipped) { pollSkipped = false; poll(); }
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
      // Oyna/ilova yashirin (fon, boshqa tab) bo'lsa zaxira so'rovlar yuborilmaydi — hech kim ko'rmaydi,
      // lekin har 12 s'da butun xabar/guruh/tranzaksiya ro'yxatlari qayta yuklanardi. Qaytganda darhol yangilanadi.
      const poll = () => { fetchMsgs(); fetchGroups(); fetchTx(); };
      let pollSkipped = false;
      const intv = setInterval(() => {
        if (document.visibilityState === 'hidden') { pollSkipped = true; return; }
        poll();
      }, 12000);
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
  }, [liveUser?.id, dataReloadKey]);

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
  // Owner 2026-10-23: PIN qulfi endi ilova USTIDAGI qatlam — avval ilova o'rniga chizilardi va ochilganda hammasi qayta
  // yuklanib, musiqa/video to'xtab qolardi. Orqadagi ilova `inert` (bosib ham, klaviatura bilan ham kirib bo'lmaydi).
  const lockEl = !appLocked ? null : forgotPin ? (
    <ForgotPinScreen
      onDone={() => { setForgotPin(false); playSound("unlock"); unlockApp(); setPinRefresh(v => v + 1); toast.success(tApp('pinLock.resetDone')); }}
      onCancel={() => setForgotPin(false)}
      onLogout={() => {
        setForgotPin(false); clearPin();
        localStorage.removeItem("currentUser"); localStorage.removeItem("token");
        setCurrentUser(null); setAuthView("login");
      }} />
  ) : (
    <PinLockScreen onUnlock={()=>{playSound("unlock");unlockApp();}}
      onForgot={() => setForgotPin(true)}
      onLockedOut={() => {
        toast.error("Ko'p marta noto'g'ri PIN kiritildi — xavfsizlik uchun qayta kirishingiz kerak.");
        localStorage.removeItem("currentUser"); localStorage.removeItem("token");
        setCurrentUser(null); setAuthView("login");
      }} />
  );
  const lockLayer = lockEl && (
    <div className="fixed inset-0 z-[999990] overflow-y-auto bg-background" data-testid="pin-lock-layer">{lockEl}</div>
  );
  const inertProps = appLocked ? ({ inert: "" } as Record<string, string>) : {};
  // Dasturchi (super-admin) — alohida panel: barcha firmalar va foydalanuvchilar
  if (liveUser.role === "dasturchi") return (
    <>
    <div {...inertProps} className={siteBg ? "with-bg min-h-[100dvh]" : "min-h-[100dvh]"} style={!siteBg ? undefined : (siteBg.startsWith("linear-gradient") || siteBg.startsWith("radial-gradient")) ? { background: siteBg } : { backgroundImage: `url(${siteBg})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }}>
      <Suspense fallback={<div className="min-h-screen bg-background"><SkeletonPage variant="dashboard" /></div>}>
        <DeveloperPanel currentUser={liveUser} onLogout={()=>{playSound("lock");setCurrentUser(null);setAuthView("login");}}
          profileEl={
            // Dasturchi uchun Profil (owner 2026-10-23): xavfsizlik + sayt ko'rinishi (til, rejim, rang, fon, shrift)
            <ProfilePage devMode currentUser={liveUser} projects={[]}
              // MUHIM: handleUpdateAvatar/handleUpdateUser shu "return"dan PASTDA e'lon qilingan — bu yerda ishlatilsa
              // "Cannot access before initialization" bilan butun panel yiqiladi. Dasturchi uchun mahalliy holat yetarli.
              onUpdateAvatar={(url) => setCurrentUser(c => c ? { ...c, avatar: url } : c)}
              onUpdateUser={(u) => setCurrentUser(u)}
              onLogout={()=>{playSound("lock");setCurrentUser(null);setAuthView("login");}}
              onCompanyNameChange={() => {}} onCompanyLogoChange={() => {}}
              onBgChange={bg => setSiteBg(bg)}
              colorTheme={colorTheme}
              onColorThemeChange={id => { setColorTheme(id); localStorage.setItem("erp_colorTheme", id); }}
              themeMode={themeMode}
              onThemeModeChange={m => { setThemeMode(m); localStorage.setItem("erp_themeMode", m); }}
              canEditCompany={false} todayAttendance={null} onCheckIn={() => {}} onCheckOut={() => {}}
              gpsTracking={false} onLockNow={lockAppNow} />
          }/>
      </Suspense>
      <AppToaster/>
    </div>
    {lockLayer}
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
  const unreadMsgs = navChatUnread;
  const isGpsAdmin = liveUser?.role === 'direktor' || liveUser?.role === 'orinbosar';
  const NAV: { key: NavPage; label: string; shortLabel?: string; icon: IconNode; badge?: number }[] = [
    { key: "dashboard", label: tApp('nav.dashboard'), shortLabel: tApp('nav.homeShort'), icon: Home },
    // Moliya endi HAMMAGA ko'rinadi — oddiy xodim o'z chiqimini kiritib,
    // faqat o'zinikini ko'radi (backend GET /api/transactions rolga qarab
    // filtrlaydi); direktor/orinbosar hammasini ko'radi va tasdiqlaydi.
    // FinancePage'ning o'zi ichida approve/reject tugmalari isAdmin bilan
    // allaqachon cheklangan — bu yerda faqat sahifaga KIRISH ochilmoqda.
    { key: "finance" as NavPage, label: tApp('nav.finance'), icon: DollarSign },
    ...(admin && hasFeature('reports') ? [
      { key: "reports" as NavPage, label: tApp('nav.reports'), shortLabel: tApp('nav.reportsShort'), icon: BarChart2 },
    ] : []),
    ...(isGpsAdmin && hasFeature('gps_tracking') ? [{ key: "gps" as NavPage, label: tApp('nav.gps'), shortLabel: tApp('nav.gpsShort'), icon: MapPin }] : []),
    { key: "chat", label: tApp('nav.chat'), shortLabel: tApp('nav.chatShort'), icon: MessageCircle, badge: unreadMsgs },
    { key: "profile", label: tApp('nav.profile'), icon: User },
  ];
  // Header — 3 ta mustaqil "orolcha" pill (logo / nav / bell+avatar), orqada
  // bar yo'q. Bir marta quriladi, ikkalasida (yuklanish skeleti VA asosiy
  // daraxt) ham xuddi shu elementning o'zi ishlatiladi — ikkita alohida
  // nusxa yozib, ular vaqt o'tishi bilan bir-biridan farqlanib ketishining
  // (drift) oldini oladi.
  const headerEl = (
    <header className="nav-blur-top flex items-center gap-2 px-3 flex-shrink-0 z-50 sticky top-0"
      style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))', paddingBottom: '0.625rem' }}>
      {/* Owner 2026-10-26: sarlavha yana balandlashib ketgandi — bitta qator: logo + firma nomi, kurs yonida kichik */}
      <div className="nav-pill-desktop flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 rounded-full min-w-0 flex-1 lg:flex-none lg:flex-shrink-0">
        <div className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-accent to-accent/75 shadow-sm flex-shrink-0">
          <CompanyLogo src={companyLogo} imgClass="w-full h-full object-contain" iconClass="w-[18px] h-[18px] text-white" />
        </div>
        {/* Owner 2026-10-27: nom na katta, na kichik — belgidan sal yirikroq, satr ostida */}
        <div className="flex flex-col justify-center min-w-0 flex-1 gap-[3px] overflow-hidden">
          <CompanyName name={companyName} />
          <HeaderTicker />
        </div>
      </div>
      <nav className="hidden lg:flex items-center gap-0.5 lg:gap-1 nav-pill-desktop px-1.5 py-1.5 rounded-full w-fit flex-shrink-0">
        {NAV.map(n=>(
          <button key={n.key} onClick={()=>{setPage(n.key);setSelProject(null);}}
            title={n.label} aria-label={n.label} className={`nav-item-desktop group relative flex items-center gap-1.5 lg:gap-2 text-sm md:text-[13px] lg:text-sm px-2.5 md:px-2.5 lg:px-4 py-2 lg:py-2.5 rounded-full z-10 liquid-transition whitespace-nowrap ${page===n.key?"text-white font-semibold":"text-muted-foreground hover:text-foreground hover:-translate-y-px"}`}>
            {page===n.key && (
              <motion.div layoutId="desktopNavPill" className="nav-active-pill absolute inset-0 rounded-full -z-10"
                transition={{ type: "spring", stiffness: 520, damping: 36 }}  />
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
          className="btn btn-ghost w-9 h-9 p-0 rounded-full hidden lg:inline-flex">
          <MorphIcon icon={Megaphone} className="w-[18px] h-[18px]" />
        </button>
        {hasFeature('qr_tools') && (
          <button onClick={()=>setQrScanOpen(true)} title={tApp('qrScanner.title')} aria-label={tApp('qrScanner.title')}
            className="btn btn-ghost w-9 h-9 p-0 rounded-full hidden lg:inline-flex">
            <MorphIcon icon={QrCode} className="w-[18px] h-[18px]" />
          </button>
        )}
        <button onClick={lockAppNow} title={tApp('profile.lockNowBtn')} aria-label={tApp('profile.lockNowBtn')}
          className="btn btn-ghost w-9 h-9 p-0 rounded-full hidden lg:inline-flex">
          <MorphIcon icon={Lock} className="w-[18px] h-[18px]" />
        </button>
        <Suspense fallback={null}><NotificationCenter messages={messages} transfers={transfers} expenses={expenses} users={users} currentUser={liveUser}
          onOpenChat={()=>{setPage("chat");setSelProject(null);}} onOpenDashboard={()=>{setPage("dashboard");setSelProject(null);}}/></Suspense>
        <button onClick={cycleThemeMode} title={themeMode==="light"?"Yorug'":themeMode==="dark"?"Qorong'i":"Tizim bo'yicha"}
          aria-label={themeMode==="light"?"Yorug'":themeMode==="dark"?"Qorong'i":"Tizim bo'yicha"}
          className="btn btn-ghost w-9 h-9 p-0 rounded-full hidden lg:inline-flex">
          <MorphIcon icon={themeMode==="light"?Sun:themeMode==="dark"?Moon:(deviceKind()==="phone"?Smartphone:deviceKind()==="tablet"?TabletIcon:Monitor)} className="w-[18px] h-[18px]" />
        </button>
        <HeaderMoreMenu label={tApp('common.more', "Yana")} items={[
          { key: "ann", icon: Megaphone, tone: "orange", label: tApp('announcements.title'), onClick: () => setShowAnnouncements(true) },
          ...(hasFeature('qr_tools') ? [{ key: "qr", icon: QrCode, tone: "violet" as IconTone, label: tApp('qrScanner.title'), onClick: () => setQrScanOpen(true) }] : []),
          { key: "lock", icon: Lock, tone: "slate", label: tApp('profile.lockNowBtn'), onClick: lockAppNow },
          { key: "theme", icon: themeMode==="light"?Sun:themeMode==="dark"?Moon:Smartphone, tone: "amber",
            label: `${tApp('profile.appearanceMode')}: ${themeMode==="light"?tApp('profile.themeLight'):themeMode==="dark"?tApp('profile.themeDark'):tApp('profile.themeSystem')}`, onClick: cycleThemeMode },
        ]} />
        <button onClick={()=>{setPage("profile");setSelProject(null);}} aria-label={tApp('nav.profile')} className="flex items-center gap-2 hover:bg-white/5 pl-1 pr-1 2xl:pr-3 py-1 rounded-full liquid-transition">
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
  if (shiftClosed) return (
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
            <p className="text-sm text-muted-foreground mt-1">{todayAttendance?.checkOut ? tApp('checkinGate.finishedInstruction', "Bugungi ishingiz tugatilgan. Qayta ishlash uchun \"Ishga keldim\"ni bosing — joylashuvingiz olinadi.") : tApp('checkinGate.instruction')}</p>
          </div>
          <button onClick={async () => { if (await confirmDialog(tApp('checkinGate.confirmPrompt'))) handleCheckIn(); }} disabled={attendancePending}
            className="w-full btn btn-primary text-base py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60">
            {attendancePending ? <MorphIcon icon={Loader2} className="w-5 h-5 animate-spin" /> : <MorphIcon icon={MapPin} className="w-5 h-5" />}
            {tApp('checkinGate.checkInBtn')}
          </button>
          <button onClick={()=>{playSound("lock");markManualLogout();localStorage.removeItem("currentUser"); localStorage.removeItem("token"); setCurrentUser(null); setAuthView("login");}}
            className="text-xs text-muted-foreground hover:text-foreground underline">{tApp('checkinGate.logout')}</button>
        </motion.div>
      </main>
      <Suspense fallback={null}><AnnouncementPopup /></Suspense>
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
      if (res.ok) { const data = await res.json(); const row = {...data, id: data._id || data.id}; if (data.type === 'income') setIncomes(p=>[...p, row]); else setExpenses(p=>[...p, row]); }
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
  // Tahrirlash/o'chirish/qadash — darhol ko'rsatiladi; server rad etsa (ruxsat yo'q, tarmoq) eski holat qaytadi
  const patchMsgOptimistic = async (id: string, apply: (m: Msg) => Msg, req: () => Promise<Response>) => {
    const before = messages.find(m => m.id === id);
    setMessages(p => p.map(m => m.id === id ? apply(m) : m));
    let errText = '';
    try {
      const r = await req();
      if (r.ok) return;
      errText = (await r.json().catch(() => null))?.error || '';
    } catch (err) { console.error(err); }
    if (before) setMessages(p => p.map(m => m.id === id ? before : m));
    toast.error(errText || tApp('chat.actionFailed'));
  };
  const handleEditMsg = (id: string, newText: string) => patchMsgOptimistic(id, m => ({ ...m, text: newText, edited: true }),
    () => fetch(`${API_BASE}/api/messages/${id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text: newText }) }));
  const handleDeleteMsg = (id: string) => patchMsgOptimistic(id, m => ({ ...m, deleted: true, text: '' }),
    () => fetch(`${API_BASE}/api/messages/${id}`, { method: "DELETE" }));
  const handlePinMsg = (id: string) => {
    const next = !messages.find(m => m.id === id)?.pinned;
    return patchMsgOptimistic(id, m => ({ ...m, pinned: next }),
      () => fetch(`${API_BASE}/api/messages/${id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ pinned: next }) }));
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
    <>
    <div {...inertProps} className={`h-[100dvh] flex flex-col overflow-hidden font-['Inter',sans-serif] ${siteBg ? 'with-bg' : ''}`} style={(() => { if (!siteBg) return { background: 'var(--background)' }; const isImg = !siteBg.startsWith('linear-gradient') && !siteBg.startsWith('radial-gradient'); return isImg ? { backgroundImage: `url(${siteBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : { background: siteBg }; })()}>
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
      {/* Telefonda ochiq suhbat — Telegram'dagidek butun ekran: ilova sarlavhasi yashirinadi (suhbat sarlavhasi o'zi safe-area'ni oladi) */}
      <div className={(page === 'chat' && chatIsOpen) ? "hidden md:contents" : "contents"}>{headerEl}</div>

      {/* Aloqa/sinxronlash holati — sarlavha ostida to'liq enli qator (SyncStatusBar.tsx) */}
      <SyncStatusBar isOffline={isOffline} sw={{ count: syncPending, status: syncStatus }} />

      {/* Top bar — admin only (Mobile/Tablet only) */}
      <div className={(page === 'chat' && chatIsOpen) ? "hidden md:block lg:hidden" : "block lg:hidden"}>
        {admin && <BottomFinanceBar expenses={expenses} projects={projects}/>}
      </div>

      {/* Main */}
      <main ref={page === "chat" ? undefined : pageScrollRef} key={`${page}:${selProject?.id || ''}`} className={`page-enter main-fade bg-background flex-1 overflow-hidden flex flex-col relative ${(page === 'chat' && chatIsOpen) ? '' : 'main-pb-safe'}`}>
        {/* Admin dashboard */}
        {page==="dashboard" && admin && !selProject && (
          <Suspense fallback={<SkeletonPage variant="dashboard" />}>
          <AdminDashboard currentUser={liveUser} users={users} projects={projects} transfers={transfers}
            setUsers={setUsers} onSendTransfer={handleSendTransfer} onConfirmTransfer={handleConfirmTransfer}
            onRejectTransfer={handleRejectTransfer} onSelectProject={p=>{setSelProject(p);}} onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser} onDeleteUser={handleDeleteUser}
            onAddProject={(project)=>{
              setProjects(p=>[...p, project]);
            }} hasFeature={hasFeature}/>
          </Suspense>
        )}
        {/* Non-admin dashboard: just their transfers */}
        {page==="dashboard" && !admin && !selProject && (
          <MyTransfersPanel currentUser={liveUser} transfers={transfers} allUsers={users} projects={projects}
            onConfirm={handleConfirmTransfer} onReject={handleRejectTransfer} onSend={()=>setShowSend(true)}/>
        )}
        {/* Object detail */}
        {page==="dashboard" && selProject && currentProject && (
          <Suspense fallback={<SkeletonPage variant="list" />}>
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
          </Suspense>
        )}
        {page==="finance" && (
          <Suspense fallback={<SkeletonPage variant="list" />}>
          <FinancePage allowIncome={false} incomes={incomes} onIncomeAdded={(x)=>setIncomes(p=>[...p, x])} currentUser={liveUser} users={users} projects={projects} expenses={expenses}
            onAddExpense={handleAddExpense} onConfirm={handleConfirmExpense}
            onApprove={handleApproveExpense} onReject={handleRejectExpense}
            onUpdated={(x)=>{ if (x.type === 'income') setIncomes(p=>p.map(e=>e.id===x.id?x:e)); else setExpenses(p=>p.map(e=>e.id===x.id?x:e)); }}
            onDeleted={(id)=>{ setExpenses(p=>p.filter(e=>e.id!==id)); setIncomes(p=>p.filter(e=>e.id!==id)); }}/>
          </Suspense>
        )}
        {page==="reports" && admin && (
          <Suspense fallback={<SkeletonPage variant="dashboard" />}>
            <ReportsPage projects={projects} expenses={expenses} incomes={incomes} showIncome={['direktor','orinbosar'].includes(liveUser.role) || !!liveUser.isOwner} users={users}/>
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
            <GpsTrackingPage users={users} gpsLocations={gpsLocations} projects={projects as any} refreshing={gpsRefreshing} onRefresh={fetchGpsLocations} transfers={transfers} expenses={expenses}/>
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
      {/* Pastki navigatsiya — teng kenglikdagi 6 ta tab, faol tabda belgi ortida sirg'aluvchi gradient "pill",
          yozuvlar har doim bir qatorda (qirqilmaydi, ikki qatorga tushmaydi) */}
      <nav className={`ios-bottom-bar flex items-stretch ${(page==='chat' && chatIsOpen) || anyBigModalOpen ? 'ios-bottom-bar-hidden' : ''}`}>
        {NAV.map(n => {
          const active = page === n.key;
          return (
          <motion.button key={n.key} onClick={() => { setPage(n.key); setSelProject(null); }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 520, damping: 30 }}
            aria-label={n.label}
            aria-current={active ? "page" : undefined}
            className="nav-tab flex-1 min-w-0 flex flex-col items-center justify-center gap-1 h-[60px] relative z-10 select-none"
          >
            <span className="relative flex items-center justify-center w-[54px] h-[32px]">
              {active && (
                <motion.span layoutId="mobileNavActivePill" className="nav-pill-indicator absolute inset-0 rounded-full"
                  transition={{ type: "spring", stiffness: 520, damping: 36 }} />
              )}
              <motion.span className="relative z-[1] flex items-center justify-center"
                animate={active ? { scale: 1.08 } : { scale: 1 }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }}>
                <MorphIcon icon={n.icon} className="w-[22px] h-[22px]" strokeWidth={active ? 2.1 : 1.8} />
              </motion.span>
              {!!n.badge && n.badge>0 && (
                <span data-testid={`nav-badge-${n.key}`} className="badge-pulse absolute -top-1 right-1 min-w-[16px] h-4 px-0.5 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold shadow ring-2 ring-[var(--card)] z-[2]">{n.badge > 9 ? '9+' : n.badge}</span>
              )}
            </span>
            <span className="nav-tab__label block max-w-full px-0.5 truncate whitespace-nowrap transition-colors duration-300">
              {n.shortLabel || n.label}
            </span>
          </motion.button>
          );
        })}
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
        // MUHIM: AIAssistant doim montaj qilinadi (yopiq holda ham) — shu sabab chunk yuklanayotganda bu
        // skelet HAR sahifa ochilishida/yangilanishida ekranda chiqib qolardi. Endi faqat oyna ochiq bo'lsa.
        <Suspense fallback={!aiOpen ? null :
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

      {/* AI ovozli yordamchi (kiruvchi AI qo'ng'iroq + ovozli suhbat) — barcha firma xodimlari uchun bir marta
          (dasturchi bu yerga yetmaydi — u DeveloperPanel'da). busy: WebRTC qo'ng'iroq paytida AI qo'ng'iroq
          avtomatik "band" deb rad etiladi. */}
      <Suspense fallback={null}>
        <AiVoiceRoot currentUser={liveUser} busy={!!activeCall} />
      </Suspense>
      {/* Android: fonda ishlash ruxsati (Telegram kabi) — faqat kerak bo'lsa ko'rinadi */}
      {isAndroid() && (
        <Suspense fallback={null}>
          <BackgroundPermissionPrompt userId={liveUser?.id} />
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
              <div className="max-h-[60vh] supports-[height:1dvh]:max-h-[60dvh] overflow-y-auto scrollbar-hide p-3 space-y-3">
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
      <Suspense fallback={null}><AnnouncementPopup /></Suspense>

      {/* Bildirishnoma toast'lari */}
      <AppToaster/>
    </div>
    {lockLayer}
    </>
  );
}
