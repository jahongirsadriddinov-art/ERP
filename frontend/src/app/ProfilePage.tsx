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
import TextFont from "@hugeicons/core-free-icons/TextFontIcon";
import { FONTS, fontById, getAppFont, applyAppFont, ensureFont } from "./lib/fonts";
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
import type { LandingFocus } from "./LandingPage";
import { Avatar, BG_TEMPLATES, COLOR_THEMES, CompanyLogo, FinancePage, RoleBadge, fmtWorkDuration, isAdmin, resizeImageFile } from "./App";
import type { AppUser, Project } from "./App";

// App.tsx'dan ajratilgan — faqat shu sahifa ochilganda yuklanadi (boshlang'ich yuklanish tezroq).
// ─── Audit Log mini viewer (Admin only) ──────────────────────────────────────
function AuditLogSection({ token }: { token: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/audit-logs?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { const d = await res.json(); setLogs(d.logs || []); }
    } catch {}
    finally { setLoading(false); }
  };

  const ACTION_LABELS: Record<string,string> = {
    create: t('profile.auditCreate'), update: t('profile.auditUpdate'), delete: t('profile.auditDelete'),
    approve: t('profile.auditApprove'), reject: t('profile.auditReject'), confirm: t('profile.auditConfirm'),
    login: t('profile.auditLogin'), logout: t('profile.auditLogout'), upload: t('profile.auditUpload'),
    checkin: t('profile.auditCheckin'), checkout: t('profile.auditCheckout'), scan_qr: t('profile.auditScanQr'),
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.22 }}
      className="surface rounded-2xl overflow-hidden">
      <button onClick={() => { setOpen(o => { if (!o) load(); return !o; })}
      } className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="icon-chip"><MorphIcon icon={BarChart2} className="w-4 h-4" /></div>
          <span className="text-sm font-medium">{t('profile.auditLogTitle')}</span>
        </div>
        <MorphIcon icon={open ? ChevronUp : ChevronDown} className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-2">
          <div className="flex justify-end mb-2">
            <button onClick={async () => {
                try {
                  const r = await fetch(`${API_BASE}/api/audit-logs/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!r.ok) throw new Error();
                  await saveOrShareBlob(`audit-${new Date().toISOString().slice(0, 10)}.csv`, await r.blob());
                } catch { toast.error(t('common.error')); }
              }}
              className="flex items-center gap-1.5 text-xs font-semibold border border-border rounded-full px-3 py-1.5 hover:bg-muted liquid-transition">
              <MorphIcon icon={Download} className="w-3.5 h-3.5" />{t('profile.auditExport', { defaultValue: "Excel/CSV yuklab olish" })}
            </button>
          </div>
          {loading && <SkeletonList items={4} withAvatar={false} />}
          {!loading && logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{t('profile.auditEmpty')}</p>}
          <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-hide">
            {logs.map(log => (
              <div key={log._id} className="text-xs bg-muted/50 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground truncate">{log.userName}</span>
                  <span className="text-muted-foreground flex-shrink-0">{new Date(log.createdAt).toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tashkent' })} {new Date(log.createdAt).toLocaleDateString('uz-UZ', { month:'short', day:'numeric', timeZone:'Asia/Tashkent' })}</span>
                </div>
                <p className="text-muted-foreground mt-0.5">{ACTION_LABELS[log.action] || log.action} · {log.entity}</p>
                <p className="text-foreground/70 truncate">{log.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}


// "Kurslarim" (o'quv kurslari) o'rniga — foydalanuvchi "kurs" deganda VALYUTA
// KURSINI nazarda tutgan edi. Backend'da bu allaqachon tayyor edi
// (/api/currency/rates — O'zbekiston Markaziy Banki'dan USD/EUR, soatlik
// keshlanadi), lekin frontendda faqat FinancePage'ning ichki konvertatsiyasi
// uchun ishlatilgan, alohida ko'rinadigan joyi yo'q edi — shu joy shu bo'ladi.
function CurrencyPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const [rates, setRates] = useState<{ UZS: number; USD: number; EUR: number; date: string; source: string; cbuUsd?: number; cbuEur?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ usd: '', eur: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/currency/rates`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setRates(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openEdit = () => {
    setForm({ usd: rates?.USD ? String(Math.round(rates.USD)) : '', eur: rates?.EUR ? String(Math.round(rates.EUR)) : '' });
    setEditing(true);
  };

  const saveCustom = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token') || '';
      const r = await fetch(`${API_BASE}/api/currency/custom`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usdRate: form.usd ? Number(form.usd) : null, eurRate: form.eur ? Number(form.eur) : null }),
      });
      if (!r.ok) { const e = await r.json().catch(()=>({})); toast.error(e.error || t('currency.genericError')); return; }
      toast.success(t('currency.rateSaved'));
      setEditing(false);
      load();
    } catch { toast.error(t('currency.serverError')); }
    finally { setSaving(false); }
  };

  // "CBU kursiga qaytarish" — o'z kursini o'chirib, markaziy bank kursiga qaytadi
  const resetToCbu = async () => {
    setForm({ usd: '', eur: '' });
    setSaving(true);
    try {
      const token = localStorage.getItem('token') || '';
      await fetch(`${API_BASE}/api/currency/custom`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usdRate: null, eurRate: null }),
      });
      toast.success(t('currency.resetToCbuDone'));
      setEditing(false);
      load();
    } catch { toast.error(t('currency.serverError')); }
    finally { setSaving(false); }
  };

  const rows = rates ? [
    { code: 'USD', label: t('currency.usdName'), icon: DollarSign, value: rates.USD },
    { code: 'EUR', label: t('currency.eurName'), icon: Euro, value: rates.EUR },
  ] : [];

  return (
    <div className="space-y-3">
      {loading ? (
        <SkeletonList items={2} withAvatar={false} />
      ) : rates && editing ? (
        <div className="surface p-4 space-y-3 rounded-2xl">
          <h3 className="text-sm font-bold">{t('currency.setCustomTitle')}</h3>
          <p className="text-xs text-muted-foreground -mt-2">{t('currency.setCustomHint')}</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('currency.usdLabel')}</label>
            <input type="number" value={form.usd} onChange={e => setForm(p => ({...p, usd: e.target.value}))}
              placeholder={String(Math.round(rates.cbuUsd || rates.USD))}
              className="w-full bg-muted/60 border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary"/>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('currency.eurLabel')}</label>
            <input type="number" value={form.eur} onChange={e => setForm(p => ({...p, eur: e.target.value}))}
              placeholder={String(Math.round(rates.cbuEur || rates.EUR))}
              className="w-full bg-muted/60 border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary"/>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={saveCustom} disabled={saving} className="flex-1 btn btn-primary text-sm py-2.5 rounded-xl disabled:opacity-60">{t('currency.save')}</button>
            <button onClick={() => setEditing(false)} disabled={saving} className="flex-1 btn btn-outline text-sm py-2.5 rounded-xl">{t('currency.cancel')}</button>
          </div>
          {rates.source === 'company' && (
            <button onClick={resetToCbu} disabled={saving} className="w-full text-xs text-muted-foreground underline pt-1">{t('currency.resetToCbuBtn')}</button>
          )}
        </div>
      ) : rates ? (
        <>
          {rows.map(r => (
            <div key={r.code} className="surface rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="icon-chip"><MorphIcon icon={r.icon} className="w-4 h-4" /></div>
                <div>
                  <p className="text-sm font-semibold">1 {r.code}</p>
                  <p className="text-xs text-muted-foreground">{r.label}</p>
                </div>
              </div>
              <p className="text-base font-bold">{Math.round(r.value).toLocaleString('uz-UZ')} {t('common.som')}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground text-center pt-1">
            {t('currency.sourceLabel')} {rates.source === 'company' ? t('currency.sourceCompany') : rates.source === 'CBU Uzbekistan' ? t('currency.sourceCbu') : t('currency.sourceDefault')} • {rates.date}
          </p>
          <div className="flex gap-2">
            <button onClick={load} className="flex-1 btn btn-outline text-sm py-2.5 rounded-xl flex items-center justify-center gap-2">
              <MorphIcon icon={RefreshCw} className="w-4 h-4" />{t('currency.refresh')}
            </button>
            {canEdit && (
              <button onClick={openEdit} className="flex-1 btn btn-primary text-sm py-2.5 rounded-xl flex items-center justify-center gap-2">
                <MorphIcon icon={Edit} className="w-4 h-4" />{t('currency.edit')}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="surface p-8 text-center rounded-2xl">
          <MorphIcon icon={AlertCircle} className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-medium">{t('currency.fetchError')}</p>
          <button onClick={load} className="btn btn-outline text-xs px-4 py-2 rounded-xl mt-3">{t('currency.retry')}</button>
        </div>
      )}
    </div>
  );
}

// Barmoq izi/Face ID orqali ochish. Android'da @capacitor/native-biometric
// (ro'yxatdan o'tish shart emas), boshqa platformalarda (veb, iOS Safari,
// Windows exe) WebAuthn orqali — bu holatda YOQISHNING O'ZIDA bir marta
// Face ID/Touch ID/Windows Hello so'raladi (kalit shu qurilmada yaratiladi).
// Qurilma umuman qo'llab-quvvatlamasa — karta o'zi ko'rsatilmaydi
// (ishlamaydigan tugma o'rniga).
function BiometricToggleCard({ currentUserId }: { currentUserId: string }) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(() => isBiometricEnabled());
  const [busy, setBusy] = useState(false);
  const isNative = nativeBiometricSupported();

  useEffect(() => {
    let cancelled = false;
    biometricAvailable().then(ok => { if (!cancelled) setAvailable(ok); });
    return () => { cancelled = true; };
  }, []);

  if (available !== true) return null;

  const toggle = async () => {
    if (busy) return;
    const next = !enabled;
    if (next && !isNative) {
      // Veb/WebAuthn — avval ro'yxatdan o'tkazamiz, muvaffaqiyatli
      // bo'lmasa (bekor qildi, qurilmada Face ID/Touch ID sozlanmagan)
      // yoqilmaydi.
      setBusy(true);
      const ok = await registerWebAuthnBiometric(currentUserId);
      setBusy(false);
      if (!ok) { toast.error(t('profile.biometricSetupFailed')); return; }
    }
    setBiometricEnabled(next);
    setEnabled(next);
  };

  const label = isNative ? t('profile.biometricLabelNative') : t('profile.biometricLabelWeb');

  return (
    <div className="surface rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('profile.biometricSubtitle')}</p>
      </div>
      <button onClick={toggle} disabled={busy}
        aria-label={label}
        className={`relative w-12 h-7 rounded-full flex-shrink-0 liquid-transition disabled:opacity-50 ${enabled ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow liquid-transition ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// PIN xavfsizlik sozlamalari — avtomatik bloklash vaqti (moslashuvchan) va
// PIN kodni almashtirish (avval eskisi tekshiriladi).
function SecuritySettingsCard() {
  const { t } = useTranslation();
  const [timeoutMin, setTimeoutMinState] = useState(() => getLockTimeoutMin());
  const [changingPin, setChangingPin] = useState(false);
  return (
    <div className="surface rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold mb-0.5">{t('profile.autoLockTitle')}</p>
        <p className="text-xs text-muted-foreground mb-3">{t('profile.autoLockSubtitle')}</p>
        <div className="flex flex-wrap gap-1.5">
          {LOCK_TIMEOUT_OPTIONS.map(min => (
            <button key={min} onClick={() => { setLockTimeoutMin(min); setTimeoutMinState(min); }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium liquid-transition ${timeoutMin === min ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-secondary"}`}>
              {min < 60 ? t('profile.minutesShort', { min }) : t('profile.hoursShort', { h: min / 60 })}
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => setChangingPin(true)}
        className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl border border-border/60 hover:bg-muted liquid-transition">
        <MorphIcon icon={Lock} className="w-4 h-4"  /> {t('profile.changePinBtn')}
      </button>
      {changingPin && (
        <ChangePinModal onClose={() => setChangingPin(false)}
          onChanged={() => { setChangingPin(false); toast.success(t('profile.pinChanged')); }} />
      )}
    </div>
  );
}

export default function ProfilePage({ currentUser, projects, onUpdateAvatar, onLogout, onUpdateUser, onCompanyNameChange, onCompanyLogoChange, onBgChange, onColorThemeChange, colorTheme, themeMode, onThemeModeChange, canEditCompany, todayAttendance, onCheckIn, onCheckOut, gpsTracking, gpsStatus, onLockNow, canBackup, backupLoading, onBackup, importLoading, onImportBackup, importFileRef }:
  { currentUser: AppUser; projects: Project[]; onUpdateAvatar: (url: string) => void; onLogout: () => void; onUpdateUser: (u: AppUser) => void; onCompanyNameChange: (name: string) => void; onCompanyLogoChange: (logo: string) => void; onBgChange: (bg: string) => void; onColorThemeChange: (id: string) => void; colorTheme: string; themeMode: "light"|"dark"|"system"; onThemeModeChange: (m: "light"|"dark"|"system") => void; canEditCompany?: boolean; todayAttendance: null | { status: string; checkIn?: string; checkOut?: string; workHours?: number }; onCheckIn: () => void; onCheckOut: () => void; gpsTracking: boolean; onLockNow: () => void; gpsStatus?: GpsStatus;
    canBackup?: boolean; backupLoading?: boolean; onBackup?: () => void; importLoading?: boolean; onImportBackup?: (e: React.ChangeEvent<HTMLInputElement>) => void; importFileRef?: React.RefObject<HTMLInputElement>; }) {
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
      const dataUrl = await resizeImageFile(file, 500, 0.85);
      onUpdateAvatar(dataUrl); // darhol ko'rinsin
      // MUHIM: avval rasm faqat xotirada (state) turardi — sahifa yangilansa o'chib ketardi.
      // Endi fayl sifatida yuklanadi va URL foydalanuvchi profiliga (serverga) saqlanadi.
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append('file', blob, `avatar-${Date.now()}.jpg`);
      const token = localStorage.getItem('token') || '';
      const upRes = await fetch(`${API_BASE}/api/messages/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.url) throw new Error(upData.error || t('profile.uploadFailed'));
      const res = await fetch(`${API_BASE}/api/users/${currentUser.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatar: upData.url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('profile.serverError'));
      onUpdateAvatar(upData.url);
      toast.success(t('profile.photoSaved', "Profil rasmi saqlandi"));
    } catch (err) { toast.error(err instanceof Error && err.message ? err.message : t('profile.imageUploadError')); }
    finally { e.target.value = ""; }
  };
  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const dataUrl = await resizeImageFile(file, 500, 0.9);
      // MUHIM: avval bu yerda tugardi — logotip localStorage'da base64
      // sifatida saqlanardi (Company modelidagi izoh aytganidek "server URL,
      // base64 EMAS" bo'lishi kerak edi), shu sabab FAQAT o'zgartirgan
      // odamning o'z brauzerida ko'rinardi. Endi haqiqiy fayl sifatida
      // yuklanadi (mavjud /api/messages/upload — Cloudinary'ga yuboradi,
      // chat media bilan bir xil) va SHU URL firmaga saqlanadi.
      const blob = await (await fetch(dataUrl)).blob();
      const form = new FormData();
      form.append('file', blob, `company-logo-${Date.now()}.jpg`);
      const token = localStorage.getItem('token') || '';
      const upRes = await fetch(`${API_BASE}/api/messages/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.url) throw new Error(upData.error || t('profile.uploadFailed'));

      const res = await fetch(`${API_BASE}/api/company/me`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ logoUrl: upData.url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('profile.serverError'));
      setCompanyLogo(upData.url); onCompanyLogoChange(upData.url);
      toast.success(t('profile.logoUpdated'));
    } catch (err) { toast.error(err instanceof Error ? err.message : t('profile.logoUploadError')); }
    finally { e.target.value = ""; }
  };
  const handleBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const url = await resizeImageFile(file, 1600, 0.82);
      setProfileBg(url); localStorage.setItem("erp_profileBg", url); onBgChange(url);
    } catch { toast.error(t('profile.bgUploadError')); }
    finally { e.target.value = ""; }
  };
  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    onUpdateUser({...currentUser, name: form.name, phone: form.phone});
    setIsEditing(false);
  };
  const [savingBrand, setSavingBrand] = useState(false);
  const saveBrand = async () => {
    const trimmed = brandInput.trim();
    if (trimmed.length < 2) { toast.error(t('profile.nameMinLength')); return; }
    setSavingBrand(true);
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch(`${API_BASE}/api/company/me`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('profile.serverError'));
      // MUHIM: avval FAQAT localStorage'ga yozilardi — o'zgartirgan odamning
      // o'z brauzeridan boshqa hech kimga (hatto shu odamning boshqa
      // qurilmasiga ham) ko'rinmasdi. Endi bazaga yozildi va boshqa ochiq
      // sessiyalar socket orqali (company:update) darhol yangilanadi.
      setCompanyName(trimmed);
      onCompanyNameChange(trimmed);
      setEditingBrand(false);
      toast.success(t('profile.nameUpdated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('profile.saveFailed'));
    } finally { setSavingBrand(false); }
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
    [t('profile.permViewFinance'), isAdmin(currentUser.role)],
    [t('profile.permAddExpense'), isAdmin(currentUser.role)],
    [t('profile.permAddUser'), isAdmin(currentUser.role)||currentUser.role==="brigadir"],
    [t('profile.permSendMaterial'), true],
    [t('profile.permConfirmMaterial'), true],
    [t('profile.permApproveSalary'), !isAdmin(currentUser.role)],
  ];

  const activeTheme = COLOR_THEMES.find(t => t.id === colorTheme) || COLOR_THEMES[0];
  const [appFont, setAppFont] = useState(getAppFont);
  const [activePanel, setActivePanel] = useState<null | "font" | "bg" | "appearance" | "color" | "perms" | "projects" | "language" | "subscription" | "currency" | "sound" | "devices" | "backup">(null);
  const APPEARANCE_LABELS: Record<string, string> = { light: t('profile.themeLight'), dark: t('profile.themeDark'), system: t('profile.themeSystem') };

  // ── Ovoz effektlari (uisfx, "zen" pack) — yoqilgan/o'chirilgan va balandlik
  // holati sfx obyektida (localStorage'da saqlanadi) yashaydi, bu yerda
  // faqat UI uchun ko'chirib olingan. ──
  const [soundOn, setSoundOnState] = useState(() => isSoundEnabled());
  const [soundVol, setSoundVolState] = useState(() => Math.round(getSoundVolume() * 100));
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setSoundOnState(enabled);
    if (enabled) playSound("toggle-on");
  };
  const handleSoundVolume = (percent: number) => {
    setSoundVolState(percent);
    setSoundVolume(percent / 100);
  };

  // "Ulangan qurilmalar" — profil bo'limi ochilganda yuklanadi (har safar
  // qayta ochilganda yangilanadi, "revoke" tugmasidan keyin ro'yxat darhol
  // to'g'ri ko'rinishi uchun).
  const [devicesList, setDevicesList] = useState<any[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revokingDevice, setRevokingDevice] = useState<string | null>(null);
  const loadDevices = () => {
    setDevicesLoading(true);
    fetch(`${API_BASE}/api/sessions`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setDevicesList(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setDevicesLoading(false));
  };
  useEffect(() => { if (activePanel === "devices") loadDevices(); }, [activePanel]);
  useEffect(() => { if (activePanel === "font") FONTS.forEach(f => ensureFont(f.id)); }, [activePanel]);
  const revokeDevice = async (id: string) => {
    setRevokingDevice(id);
    try {
      const r = await fetch(`${API_BASE}/api/sessions/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      if (r.ok) { setDevicesList(prev => prev.filter(d => d.id !== id)); toast.success(t('profile.deviceRevoked')); }
      else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setRevokingDevice(null);
  };
  const [revokingAll, setRevokingAll] = useState(false);
  const revokeAllDevices = async () => {
    if (!window.confirm(t('profile.confirmRevokeAll'))) return;
    setRevokingAll(true);
    try {
      const r = await fetch(`${API_BASE}/api/sessions/all`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      if (r.ok) { setDevicesList(prev => prev.filter(d => d.current)); toast.success(t('profile.allDevicesRevoked')); }
      else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setRevokingAll(false);
  };

  const [subData, setSubData] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(false);
  useEffect(() => {
    if (!isAdmin(currentUser.role)) return;
    setSubLoading(true);
    fetch(`${API_BASE}/api/admin/subscriptions/my`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    })
      .then(r => r.json())
      .then(d => setSubData(d))
      .catch(() => {})
      .finally(() => setSubLoading(false));
  }, [currentUser.role]);
  const myProjectCount = (currentUser.projectIds || []).length;

  // Click/Payme/Paynet orqali o'zi to'lash (Roxiy) — tariflar ENDI admin
  // panelidan (Dasturchi paneli → Tariflar) boshqariladi, shu sabab bu
  // yerda qattiq yozilmaydi, jonli (live) ro'yxatdan olinadi. XATO
  // TUZATILDI: avval bu yerda 3 ta qattiq yozilgan (eskirgan) tarif/narx
  // bo'lardi — admin narxni o'zgartirsa ham bu ro'yxat yangilanmasdi.
  const [payablePlans, setPayablePlans] = useState<{ key: string; label: string; amount: number }[]>([]);
  useEffect(() => {
    fetch(`${API_BASE}/api/plans`).then(r => r.ok ? r.json() : []).then((list: any[]) => {
      setPayablePlans(list.filter(p => p.amount > 0).map(p => ({ key: p.key, label: p.label, amount: p.amount })));
    }).catch(() => {});
  }, []);
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [renewPromoCode, setRenewPromoCode] = useState("");
  const handlePay = async (planKey: string) => {
    if (payingPlan) return;
    setPayingPlan(planKey);
    try {
      const r = await fetch(`${API_BASE}/api/admin/subscriptions/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ selectedPlan: planKey, promoCode: renewPromoCode.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { toast.error(d.error || t('profile.payError')); return; }
      // Tauri/Capacitor'da to'lov sahifasi ilova ichidagi WebView'da EMAS,
      // qurilmaning o'z (tizim) brauzerida ochilishi kerak — aks holda
      // Click/Payme/Paynet'ning qaytish/deep-link oqimi ilova ichida
      // "qamalib" qolishi mumkin.
      if (isNative()) await openExternalUrl(d.payUrl);
      else window.open(d.payUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('profile.payError'));
    } finally {
      setPayingPlan(null);
    }
  };

  const hasAttendanceCard = (currentUser.role === 'ishchi' || currentUser.role === 'prorab' || currentUser.role === 'brigadir') && !!todayAttendance?.checkIn;

  const menuRows = [
            { key: "bg" as const, icon: Palette, label: t('profile.bgThemes'), hint: null as string|null,
              swatch: (bannerStyle as any).background ? { background: (bannerStyle as any).background } : { backgroundImage: (bannerStyle as any).backgroundImage, backgroundSize: 'cover' } },
            { key: "appearance" as const, icon: themeMode === "light" ? Sun : themeMode === "dark" ? Moon : Monitor, label: t('profile.appearanceMode'), hint: APPEARANCE_LABELS[themeMode], swatch: null },
            { key: "color" as const, icon: Palette, label: t('profile.colorTheme'), hint: t(`profile.colorThemeNames.${activeTheme.id}`, { defaultValue: activeTheme.name }), swatch: { background: `linear-gradient(135deg, ${activeTheme.primary}, ${activeTheme.accent})` } },
            { key: "font" as const, icon: TextFont, label: t('profile.font', "Shrift"), hint: fontById(appFont).label, swatch: null },
            { key: "language" as const, icon: Languages, label: t('profile.language'), hint: langLabel(i18n.language as SiteLang), swatch: null },
            { key: "perms" as const, icon: CheckCircle, label: t('profile.permissions'), hint: `${perms.filter(([,has])=>has).length}/${perms.length}`, swatch: null },
            { key: "projects" as const, icon: Building2, label: t('profile.myObjects'), hint: String(myProjectCount), swatch: null },
            // Tarifda "multi_currency" o'chirilgan bo'lsa bu qator umuman
            // ko'rsatilmaydi (subData.features hali kelmagan bo'lsa ham
            // ko'rsatiladi — yuklanish paytida bo'sh menyu ko'rinmasin).
            ...((!subData?.features || subData.features.includes('multi_currency')) ? [
              { key: "currency" as const, icon: DollarSign, label: t('profile.currencyRate'), hint: null as string|null, swatch: null },
            ] : []),
            { key: "sound" as const, icon: soundOn ? Volume2 : VolumeX, label: t('profile.sound'), hint: soundOn ? t('profile.soundOn') : t('profile.soundOff'), swatch: null },
            { key: "devices" as const, icon: Smartphone, label: t('profile.connectedDevices'), hint: null as string|null, swatch: null },
            ...(isAdmin(currentUser.role) ? [{ key: "subscription" as const, icon: CreditCard, label: t('profile.subscriptionStatus'),
              hint: subData?.status === 'active' ? (subData.daysLeft !== null ? t('profile.daysLeftValue', { count: subData.daysLeft }) : t('profile.subStatusActive')) : subData?.status === 'pending' ? t('profile.subStatusPending') : subData?.status === 'expired' ? t('profile.subStatusExpired') : subData?.status === 'rejected' ? t('profile.subStatusRejected') : subLoading ? "..." : t('common.notFound'),
              swatch: null }] : []),
            // XATO TUZATILDI ("backup'ni telefonga profil qismiga qo'sh"):
            // Backup/tiklash avval FAQAT desktop sarlavhasidagi statistika
            // qatorida bor edi — bu qator endi planshet/telefonda umuman
            // ko'rsatilmaydi (`hidden lg:flex`), shu sabab mobil foydalanuvchi
            // (direktor/o'rinbosar) uchun backup imkoni butunlay yo'qolgan
            // edi. Endi Profil bo'limida — barcha o'lchamda ko'rinadi.
            ...(canBackup ? [{ key: "backup" as const, icon: Download, label: t('profile.backupTitle'), hint: null as string|null, swatch: null }] : []),
  ];

  // ── Har bo'lim uchun alohida ekran (rasmdagi "Personal/General/..." kabi) ──
  if (activePanel) {
    const panelTitle = {
      font: t('profile.font', "Shrift"), bg: t('profile.bgThemes'), appearance: t('profile.appearanceMode'), color: t('profile.colorTheme'),
      perms: t('profile.permissions'), projects: t('profile.myObjects'), language: t('profile.language'),
      subscription: t('profile.subscriptionStatus'), currency: t('profile.currencyRate'), sound: t('profile.sound'),
      devices: t('profile.connectedDevices'), backup: t('profile.backupTitle'),
    }[activePanel];
    const activeRow = menuRows.find(r => r.key === activePanel);
    return (
      <motion.div key={activePanel} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 28 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="max-w-lg md:max-w-4xl lg:max-w-6xl 2xl:max-w-7xl mx-auto w-full pb-10 lg:pb-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-4 md:px-6 py-4 sticky top-0 lg:static bg-background/80 backdrop-blur-xl z-10 flex-shrink-0">
          <button onClick={() => setActivePanel(null)} aria-label={t('common.back')} className="btn btn-ghost w-10 h-10 p-0 rounded-full flex-shrink-0"><MorphIcon icon={ChevronLeft} className="w-5 h-5" /></button>
          {activeRow && (activeRow.swatch
            ? <div className="w-10 h-10 rounded-xl flex-shrink-0 hidden md:block" style={activeRow.swatch}/>
            : <div className="icon-chip w-10 h-10 hidden md:flex"><MorphIcon icon={activeRow.icon} className="w-5 h-5" /></div>)}
          <div className="min-w-0">
            <h2 className="text-base md:text-lg font-bold truncate">{panelTitle}</h2>
            {activeRow?.hint && <p className="text-xs text-muted-foreground truncate">{activeRow.hint}</p>}
          </div>
        </div>
        <div className="px-4 md:px-6 lg:grid lg:grid-cols-12 lg:gap-6 lg:flex-1 lg:min-h-0 lg:pb-4">
          {/* Chap: boshqa bo'limlarga tez o'tish (faqat kompyuterda) */}
          <aside className="hidden lg:flex lg:flex-col lg:col-span-4 xl:col-span-3 min-h-0 min-w-0 gap-3">
            <div className="surface border border-border rounded-2xl p-2 space-y-0.5 flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              {menuRows.map(row => (
                <button key={row.key} onClick={() => setActivePanel(row.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left border liquid-transition ${row.key === activePanel ? "bg-primary/10 text-primary font-semibold border-primary/30" : "border-transparent hover:bg-muted/40 hover:border-border text-foreground"}`}>
                  {row.swatch
                    ? <div className="w-8 h-8 rounded-lg flex-shrink-0" style={row.swatch}/>
                    : <div className="icon-chip w-8 h-8"><MorphIcon icon={row.icon} className="w-4 h-4" /></div>}
                  <span className="text-sm flex-1 truncate">{row.label}</span>
                  {row.hint && <span className="text-[11px] text-foreground/60 truncate max-w-[7rem] flex-shrink-0">{row.hint}</span>}
                </button>
              ))}
            </div>
            {/* Bloklash / chiqish — menyu bilan birga, kesilmasdan pastda */}
            <div className="space-y-2 flex-shrink-0">
              <button onClick={onLockNow} className="group w-full flex items-center gap-3 rounded-2xl border border-border bg-card/60 px-3.5 py-3 text-left hover:border-primary/40 hover:bg-primary/[0.05] liquid-transition">
                <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><MorphIcon icon={Lock} className="w-4 h-4" /></span>
                <span className="text-sm font-semibold whitespace-nowrap truncate">{t('profile.lockNowBtn')}</span>
              </button>
              <button onClick={() => { markManualLogout(); localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
                className="group w-full flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.04] px-3.5 py-3 text-left hover:border-red-500/45 hover:bg-red-500/10 liquid-transition">
                <span className="w-9 h-9 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center flex-shrink-0"><MorphIcon icon={LogOut} className="w-4 h-4" /></span>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400 whitespace-nowrap truncate">{t('profile.logout')}</span>
              </button>
            </div>
          </aside>
          <div className="space-y-4 lg:col-span-8 xl:col-span-9 min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin] px-0.5 py-0.5 lg:px-2 lg:py-2 lg:pr-3">
          {activePanel === "bg" && (
            <div className="surface border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex-1">{t('profile.chooseBgImage')}</p>
                <span className="text-[10px] text-muted-foreground hidden sm:block">{t('profile.appliesSiteWide')}</span>
              </div>
              <div className="p-3">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-7 gap-2">
                  {BG_TEMPLATES.map(bgT => {
                    const isCurrent = bgT.id === "default" ? (!profileBg || profileBg === "") : profileBg === bgT.value;
                    return (
                      <button key={bgT.id} onClick={() => applyBgTemplate(bgT.value)}
                        className={`relative rounded-lg sm:rounded-xl overflow-hidden border-2 liquid-transition ${isCurrent ? "border-primary shadow-md scale-[1.05]" : "border-transparent hover:border-primary/40"}`}
                        style={{ aspectRatio: "4/3", background: bgT.value || "var(--background)" }}>
                        {bgT.id === "default" && <div className="absolute inset-0 flex items-center justify-center bg-muted/60"><span className="text-[8px] text-muted-foreground font-semibold">{t('profile.none')}</span></div>}
                        {isCurrent && <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-white/95 rounded-full flex items-center justify-center shadow"><MorphIcon icon={Check} className="w-2 h-2 text-primary" /></div>}
                        {bgT.id !== "default" && <div className="absolute inset-x-0 bottom-0 py-0.5" style={{ background: "rgba(0,0,0,0.38)" }}><p className="text-center text-[7px] sm:text-[8px] text-white font-semibold">{t(`profile.bgTemplateNames.${bgT.id}`, { defaultValue: bgT.name })}</p></div>}
                      </button>
                    );
                  })}
                  <button onClick={() => bgRef.current?.click()}
                    className="relative rounded-lg sm:rounded-xl overflow-hidden border-2 border-dashed border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/40 flex flex-col items-center justify-center gap-0.5 liquid-transition"
                    style={{ aspectRatio: "4/3" }}>
                    <MorphIcon icon={Upload} className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-[7px] sm:text-[8px] text-muted-foreground font-semibold">{t('profile.uploadPhotoShort')}</p>
                  </button>
                </div>
              </div>
            </div>
          )}
          {activePanel === "font" && (
            <div className="surface border border-border overflow-hidden p-3">
              <p className="text-xs text-muted-foreground px-1 pb-3">{t('profile.fontHint', "Tanlangan shrift butun saytga (shu qurilmada) qo'llanadi. Hujjatlar shrifti hujjatlar bo'limida alohida tanlanadi.")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {FONTS.map(f => {
                  const active = appFont === f.id;
                  return (
                    <button key={f.id} onMouseEnter={() => ensureFont(f.id)} onFocus={() => ensureFont(f.id)}
                      onClick={() => { setAppFont(f.id); applyAppFont(f.id); toast.success(`${t('profile.font', "Shrift")}: ${f.label}`); }}
                      className={`text-left rounded-2xl border-2 px-4 py-3 liquid-transition ${active ? "border-primary bg-primary/10 shadow-lg shadow-primary/10" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{f.label}</span>
                        {active && <MorphIcon icon={Check} className="w-4 h-4 text-primary" />}
                      </span>
                      <span data-font-preview className="block text-xl mt-1 truncate" style={{ fontFamily: f.family }}>Qurilish ERP — Аа 123</span>
                      <span data-font-preview className="block text-xs text-muted-foreground mt-0.5 truncate" style={{ fontFamily: f.family }}>Oʻzbekcha matn · Русский текст</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {activePanel === "appearance" && (
            <div className="surface border border-border overflow-hidden">
              <div className="p-3">
                <div className="grid grid-cols-3 gap-2">
                  {([["light",t('profile.themeLight'),Sun],["dark",t('profile.themeDark'),Moon],["system",t('profile.themeSystem'),Monitor]] as [ "light"|"dark"|"system", string, IconNode ][]).map(([m,label,Icon]) => (
                    <button key={m} onClick={() => onThemeModeChange(m)}
                      className={`flex flex-col items-center gap-2 py-5 rounded-2xl border-2 liquid-transition ${themeMode===m ? "border-primary bg-primary/10 text-primary shadow-lg shadow-primary/10" : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"}`}>
                      <MorphIcon icon={Icon} className="w-6 h-6" />
                      <span className="text-sm font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activePanel === "color" && (
            <div className="surface border border-border overflow-hidden">
              <div className="px-3 py-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {COLOR_THEMES.map(ct => {
                    const ctName = t(`profile.colorThemeNames.${ct.id}`, { defaultValue: ct.name });
                    return (
                    <button key={ct.id} onClick={() => onColorThemeChange(ct.id)} title={ctName}
                      className={`flex items-center gap-3 p-3 rounded-2xl border-2 text-left liquid-transition group ${colorTheme === ct.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}>
                      <div
                        className="w-11 h-11 rounded-xl liquid-transition group-hover:scale-105 active:scale-95 relative flex-shrink-0"
                        style={{
                          background: `linear-gradient(135deg, ${ct.primary} 0%, ${ct.accent} 100%)`,
                          boxShadow: colorTheme === ct.id
                            ? `0 0 0 2px var(--card), 0 0 0 4px ${ct.primary}, 0 3px 10px ${ct.primary}50`
                            : "0 2px 5px rgba(0,0,0,0.18)",
                          transform: colorTheme === ct.id ? "scale(1.08)" : undefined,
                        }}>
                        {colorTheme === ct.id && <MorphIcon icon={Check} className="w-5 h-5 text-white absolute inset-0 m-auto drop-shadow" />}
                      </div>
                      <span className="text-sm font-semibold truncate">{ctName}</span>
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {activePanel === "perms" && (
            <div className="surface border border-border overflow-hidden">
              {perms.map(([label, has]) => (
                <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/20 liquid-transition">
                  <span className="text-sm text-foreground">{label}</span>
                  {has ? <MorphIcon icon={CheckCircle} className="w-4 h-4 text-green-500" /> : <MorphIcon icon={X} className="w-4 h-4 text-muted-foreground/30" />}
                </div>
              ))}
            </div>
          )}
          {activePanel === "projects" && (
            <div className="surface border border-border overflow-hidden">
              {(!currentUser.projectIds || currentUser.projectIds.length === 0)
                ? <p className="px-4 py-4 text-sm text-muted-foreground text-center">{t('profile.noneAssigned')}</p>
                : projects.filter(p => currentUser.projectIds.includes(p.id)).map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <MorphIcon icon={Building2} className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm truncate font-medium">{p.name}</span>
                  </div>
                ))
              }
            </div>
          )}
          {activePanel === "language" && (
            <div className="surface border border-border overflow-hidden p-5 flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground text-center">{t('profile.languageHint')}</p>
              <LanguageSwitcher value={i18n.language as SiteLang} onChange={changeLanguage}/>
            </div>
          )}
          {activePanel === "currency" && (
            <CurrencyPanel canEdit={isAdmin(currentUser.role) || !!currentUser.isOwner}/>
          )}
          {activePanel === "backup" && (
            <div className="surface border border-border overflow-hidden p-4 space-y-3">
              <p className="text-xs text-muted-foreground">{t('profile.backupHint')}</p>
              <button onClick={onBackup} disabled={backupLoading}
                className="w-full flex items-center justify-center gap-2 btn btn-outline py-3 rounded-xl text-sm font-semibold disabled:opacity-60">
                {backupLoading ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Download} className="w-4 h-4" />}
                {t('dashboard.backup')}
              </button>
              <input ref={importFileRef} type="file" accept="application/json" className="hidden" onChange={onImportBackup} />
              <button onClick={() => importFileRef?.current?.click()} disabled={importLoading}
                title={t('dashboard.importWarning') as string}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border border-destructive/30 text-destructive hover:bg-destructive/10 liquid-transition disabled:opacity-60">
                {importLoading ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Upload} className="w-4 h-4" />}
                {t('dashboard.importBackup')}
              </button>
            </div>
          )}
          {activePanel === "sound" && (
            <div className="surface border border-border overflow-hidden">
              <div className="p-3">
                <div className="grid grid-cols-2 gap-2">
                  {([[true, t('profile.soundOn'), Volume2], [false, t('profile.soundOff'), VolumeX]] as [boolean, string, IconNode][]).map(([val, label, Icon]) => (
                    <button key={String(val)} onClick={() => handleSoundToggle(val)}
                      className={`flex flex-col items-center gap-2 py-5 rounded-2xl border-2 liquid-transition ${soundOn===val ? "border-primary bg-primary/10 text-primary shadow-lg shadow-primary/10" : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"}`}>
                      <MorphIcon icon={Icon} className="w-6 h-6" />
                      <span className="text-sm font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {soundOn && (
                <div className="px-4 pb-4 pt-1 border-t border-border/50">
                  <label className="text-[10px] text-muted-foreground block mb-2 mt-3 uppercase tracking-wider font-bold">{t('profile.soundVolume')}</label>
                  <input type="range" min={0} max={100} step={5} value={soundVol}
                    onChange={e => handleSoundVolume(Number(e.target.value))}
                    onMouseUp={() => playSound("select")} onTouchEnd={() => playSound("select")}
                    className="w-full accent-primary" aria-label={t('profile.soundVolume')} />
                </div>
              )}
            </div>
          )}
          {activePanel === "devices" && (
            <div className="space-y-3">
              <div className="surface overflow-hidden">
                {devicesLoading ? (
                  <SkeletonList items={2} withAvatar={false} />
                ) : devicesList.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-10">{t('profile.noDevices')}</p>
                ) : (
                  <div className="divide-y divide-border/50">
                    {devicesList.map(d => (
                      <div key={d.id} className="flex items-center gap-3 px-4 py-3.5">
                        <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${d.loginMethod === 'qr' ? 'text-white' : 'icon-chip'}`}
                          style={d.loginMethod === 'qr' ? { background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" } : undefined}>
                          <MorphIcon icon={d.loginMethod === 'qr' ? QrCode : Smartphone} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate">{d.deviceLabel}</p>
                            {d.current && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 flex-shrink-0">{t('profile.thisDevice')}</span>}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {d.loginMethod === 'qr' ? t('profile.loginMethodQr') : d.loginMethod === 'dev' ? t('profile.loginMethodDev') : t('profile.loginMethodPassword')}
                            {' · '}{t('profile.lastSeen', { date: new Date(d.lastSeenAt || d.createdAt).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}
                          </p>
                        </div>
                        {!d.current && (
                          <button onClick={() => revokeDevice(d.id)} disabled={revokingDevice === d.id} aria-label={t('profile.revokeDevice')}
                            className="w-9 h-9 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center disabled:opacity-40 flex-shrink-0">
                            {revokingDevice === d.id ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={LogOutDevice} className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {devicesList.filter(d => !d.current).length > 0 && (
                <button onClick={revokeAllDevices} disabled={revokingAll}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10 disabled:opacity-50">
                  {revokingAll ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={LogOutDevice} className="w-4 h-4" />}
                  {t('profile.revokeAllDevices')}
                </button>
              )}
            </div>
          )}
          {activePanel === "subscription" && (
            <div className="surface border border-border overflow-hidden">
              {subLoading ? (
                <SkeletonList items={1} withAvatar={false} />
              ) : !subData || subData.status === 'none' ? (
                <div className="px-5 py-8 text-center space-y-2">
                  <MorphIcon icon={CreditCard} className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm font-medium">{t('profile.subscriptionNotFound')}</p>
                  <p className="text-xs text-muted-foreground">{t('profile.subscriptionContactDev')}</p>
                </div>
              ) : (() => {
                const statusColor: Record<string, string> = {
                  active: "text-green-600 bg-green-500/10 border-green-500/20",
                  pending: "text-amber-600 bg-amber-500/10 border-amber-500/20",
                  expired: "text-red-600 bg-red-500/10 border-red-500/20",
                  rejected: "text-red-600 bg-red-500/10 border-red-500/20",
                };
                const statusLabel: Record<string, string> = {
                  active: t('profile.subStatusActive'), pending: t('profile.subStatusPending'),
                  expired: t('profile.subStatusExpired'), rejected: t('profile.subStatusRejected'),
                };
                const cls = statusColor[subData.status] || "text-muted-foreground bg-muted/50 border-border";
                return (
                  <div className="divide-y divide-border/50">
                    <div className="flex items-center justify-between px-5 py-4">
                      <span className="text-sm font-semibold">{t('profile.statusLabel')}</span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${cls}`}>{statusLabel[subData.status] || subData.status}</span>
                    </div>
                    {subData.selectedPlan && (
                      <div className="flex items-center justify-between px-5 py-4">
                        <span className="text-sm font-medium text-muted-foreground">{t('profile.tarifLabel')}</span>
                        <span className="text-sm font-semibold capitalize">{subData.selectedPlan}</span>
                      </div>
                    )}
                    {subData.daysLeft !== null && subData.status === 'active' && (
                      <div className="flex items-center justify-between px-5 py-4">
                        <span className="text-sm font-medium text-muted-foreground">{t('profile.daysLeftLabel')}</span>
                        <span className={`text-sm font-bold ${subData.daysLeft <= 7 ? 'text-red-500' : subData.daysLeft <= 30 ? 'text-amber-500' : 'text-green-600'}`}>{t('profile.daysLeftValue', { count: subData.daysLeft })}</span>
                      </div>
                    )}
                    {subData.currentPeriodEnd && (
                      <div className="flex items-center justify-between px-5 py-4">
                        <div className="flex items-center gap-2 text-muted-foreground"><MorphIcon icon={Calendar} className="w-3.5 h-3.5" /><span className="text-sm font-medium">{t('profile.endDateLabel')}</span></div>
                        <span className="text-sm font-semibold">{new Date(subData.currentPeriodEnd).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent' })}</span>
                      </div>
                    )}
                    {subData.amount > 0 && (
                      <div className="flex items-center justify-between px-5 py-4">
                        <span className="text-sm font-medium text-muted-foreground">{t('profile.priceLabel')}</span>
                        <span className="text-sm font-semibold">{subData.amount.toLocaleString()} {t('common.som')}</span>
                      </div>
                    )}
                    {subData.status === 'active' && subData.daysLeft !== null && subData.daysLeft <= 30 && (
                      <div className="px-5 py-4 bg-amber-500/5">
                        <p className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5"><MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{t('profile.subExpiringWarning')}</p>
                      </div>
                    )}
                    {(subData.status === 'expired' || subData.status === 'rejected') && (
                      <div className="px-5 py-4 bg-red-500/5">
                        <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5"><MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{t('profile.subExpiredContact')} <a href="https://t.me/Sadriddinov_Jahongir" className="underline font-semibold">@Sadriddinov_Jahongir</a></p>
                      </div>
                    )}
                    {/* O'zi to'lash (Click/Payme/Paynet) — dasturchi tasdig'ini
                        kutmasdan. "rejected"da ko'rsatilmaydi: backend baribir
                        rad etadi, foydalanuvchini bekorga xatolikka olib
                        bormaslik uchun — o'rniga yuqoridagi "bog'laning" xabari. */}
                    {(subData.status === 'pending' || subData.status === 'expired') && (
                      <div className="px-5 py-4 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('profile.payPrompt')}</p>
                        <input value={renewPromoCode} onChange={e => setRenewPromoCode(e.target.value.toUpperCase())}
                          placeholder={t('register.promoCodePlaceholder')}
                          className="w-full text-sm border border-border/50 rounded-xl px-3 py-2.5 bg-white/50 dark:bg-black/20 font-mono uppercase mb-1" />
                        {payablePlans.map(plan => (
                          <button key={plan.key} disabled={!!payingPlan} onClick={() => handlePay(plan.key)}
                            className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl border border-border/60 hover:border-primary/50 hover:bg-primary/5 liquid-transition disabled:opacity-60 text-left">
                            <span className="text-sm font-semibold">{plan.label}</span>
                            <span className="flex items-center gap-2 text-sm font-bold text-primary">
                              {payingPlan === plan.key ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : `${plan.amount.toLocaleString()} ${t('common.som')}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="max-w-lg md:max-w-4xl lg:max-w-6xl 2xl:max-w-7xl mx-auto w-full pb-10 lg:pb-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">

      {/* ── Company Banner ─────────────────────────── */}
      <motion.div initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden flex-shrink-0 h-[140px] md:h-[150px] lg:h-[160px] md:mx-6 md:mt-4 md:rounded-3xl border border-border/60" style={{ ...bannerStyle }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.58) 100%)" }}/>
        {canEditCompany && (
          <button onClick={() => bgRef.current?.click()}
            className="absolute top-4 right-4 flex items-center gap-1.5 text-white text-xs px-3 py-2 rounded-full border border-white/25 liquid-transition hover:bg-white/20 active:scale-95"
            style={{ background: "rgba(0,0,0,0.30)", backdropFilter: "blur(12px)" }}>
            <MorphIcon icon={Upload} className="w-3.5 h-3.5" />{t('profile.uploadPhotoBtn')}
          </button>
        )}
        <input ref={bgRef} type="file" accept="image/*" className="hidden" onChange={handleBgFile}/>
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-4 md:px-8 md:pb-5 flex items-end gap-4">
          <div className="relative flex-shrink-0">
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-2 border-white/80 shadow-2xl overflow-hidden bg-white flex items-center justify-center ring-4 ring-black/10">
              <CompanyLogo src={companyLogo} imgClass="w-full h-full object-cover rounded-full" iconClass="w-8 h-8 text-primary" />
            </div>
            {canEditCompany && (
              <button onClick={() => logoRef.current?.click()} aria-label={t('profile.changeLogoAria')}
                className="absolute -bottom-0.5 -right-0.5 w-6 h-6 bg-white text-primary rounded-full flex items-center justify-center border border-border shadow-lg hover:bg-primary hover:text-white liquid-transition">
                <MorphIcon icon={Camera} className="w-3 h-3" />
              </button>
            )}
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile}/>
          </div>
          <div className="flex-1 pb-0.5">
            {canEditCompany && editingBrand ? (
              <div className="flex items-center gap-2">
                <input className="flex-1 text-white font-bold text-lg bg-transparent border-b-2 border-white/60 focus:border-white focus:outline-none pb-0.5"
                  value={brandInput} onChange={e => setBrandInput(e.target.value)} autoFocus disabled={savingBrand} onKeyDown={e => e.key === 'Enter' && saveBrand()}/>
                <button aria-label={t('common.save')} onClick={saveBrand} disabled={savingBrand} className="w-7 h-7 bg-white/20 text-white rounded-full flex items-center justify-center border border-white/30 hover:bg-white/30 liquid-transition disabled:opacity-50">{savingBrand ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Check} className="w-3.5 h-3.5" />}</button>
                <button aria-label={t('common.cancel')} onClick={() => setEditingBrand(false)} disabled={savingBrand} className="w-7 h-7 bg-black/20 text-white rounded-full flex items-center justify-center hover:bg-black/30 liquid-transition disabled:opacity-50"><MorphIcon icon={X} className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-white font-bold text-xl md:text-2xl drop-shadow-lg">{companyName}</p>
                {canEditCompany && (
                  <button onClick={() => { setBrandInput(companyName); setEditingBrand(true); }} aria-label={t('profile.editNameAria')}
                    className="p-1 text-white/60 hover:text-white rounded-lg hover:bg-white/10 liquid-transition">
                    <MorphIcon icon={Edit} className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <p className="text-white/65 text-xs mt-0.5">{t('profile.constructionCompany')}</p>
          </div>
        </div>
      </motion.div>

      <div className="px-4 md:px-6 mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:flex-1 lg:min-h-0 lg:pb-4">

        {/* Chap ustun: shaxsiy karta, davomat, bloklash/chiqish */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-4 lg:block lg:space-y-4 min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin] lg:px-1.5 lg:py-1.5">
        {/* ── Profile Card ──────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.02 }}
          className={`surface border border-border p-5 text-center relative ${hasAttendanceCard ? "" : "md:col-span-2 lg:col-span-1"}`}>
          {isAdmin(currentUser.role) && !isEditing && (
            <button aria-label={t('common.edit')} onClick={() => setIsEditing(true)} className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded-lg liquid-transition"><MorphIcon icon={Edit} className="w-4 h-4" /></button>
          )}
          <div className="relative inline-block mb-3">
            <Avatar user={currentUser} size="lg"/>
            <button onClick={() => fileRef.current?.click()} aria-label={t('profile.changePhotoAria')} className="absolute bottom-0 right-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center hover:bg-primary/90 border-2 border-white shadow-lg liquid-transition">
              <MorphIcon icon={Camera} className="w-3.5 h-3.5" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          {isEditing ? (
            <div className="space-y-3.5 mt-5 text-left animate-slide-up-fade">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1.5 ml-1 uppercase tracking-wider font-bold">{t('profile.nameLabel')}</label>
                <div className="relative">
                  <MorphIcon icon={User} className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition shadow-inner"
                    value={form.name} onChange={e => setForm({...form, name: e.target.value})}/>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1.5 ml-1 uppercase tracking-wider font-bold">{t('profile.phoneLabel')}</label>
                <div className="relative">
                  <MorphIcon icon={Phone} className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input inputMode="tel" className="w-full text-sm border border-border/50 rounded-2xl pl-11 pr-4 py-3 bg-white/50 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:outline-none focus:ring-2 focus:ring-primary/50 liquid-transition shadow-inner font-mono"
                    value={form.phone} onChange={e => setForm({...form, phone: e.target.value.replace(/[^\d+]/g, "")})}/>
                </div>
              </div>
              {form.phone !== currentUser.phone && (
                <div className="bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs p-3 rounded-2xl flex items-start gap-2 text-left"><MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><p>{t('profile.phoneChangeWarning')}</p></div>
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

        {/* Attendance + GPS card — faqat ishchi/prorab/brigadir uchun.
            MUHIM: "Ishga keldim" tugmasi endi BU YERDA emas — bosh sahifa
            darvozasida (App.tsx'dagi asosiy gate'da). Ishchi Profilga
            kirgan ekan, demak allaqachon check-in bosgan (aks holda gate
            uni bosh sahifadan chetga chiqarmagan bo'lardi) — shu sabab bu
            karta faqat "allaqachon kelgan" holatini ko'rsatadi. */}
        {(currentUser.role === 'ishchi' || currentUser.role === 'prorab' || currentUser.role === 'brigadir') && todayAttendance?.checkIn && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.22 }}
            className="surface rounded-2xl overflow-hidden">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="icon-chip"><MorphIcon icon={Calendar} className="w-4 h-4" /></div>
                  <span className="text-sm font-semibold">{t('attendance.today')}</span>
                </div>
                {todayAttendance?.status && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${todayAttendance.status==='present'?'bg-green-500/15 text-green-700 dark:text-green-400':todayAttendance.status==='late'?'bg-amber-500/15 text-amber-700 dark:text-amber-400':'bg-muted text-muted-foreground'}`}>
                    {todayAttendance.status==='present'?t('attendance.statusPresent'):todayAttendance.status==='late'?t('attendance.statusLate'):t('attendance.statusAbsent')}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1 mb-3">
                <p>{t('profile.todayLabel')} <span className="text-foreground font-medium">{new Date(todayAttendance.checkIn).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tashkent'})}</span></p>
                {todayAttendance.checkOut && <p>{t('profile.workEndedLabel')} <span className="text-foreground font-medium">{new Date(todayAttendance.checkOut).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tashkent'})}</span></p>}
                {todayAttendance.checkOut && <p>{t('profile.workedTimeLabel')} <span className="text-foreground font-medium">{fmtWorkDuration(todayAttendance.checkIn, todayAttendance.checkOut, t)}</span></p>}
              </div>
              {/* GPS holati — check-in'ga bog'liq boshlanadi, lekin check-out
                  bosilgach ham TO'XTAMAYDI (aniqlashtirilgan talab: "GPS har
                  doim olinsin"), shu sabab bu yerda checkOut tekshirilmaydi. */}
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${gpsTracking ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'}`}/>
                <span>{gpsTracking ? t('profile.gpsActive') : t('profile.gpsWaiting')}</span>
              </div>
              {/* GPS batafsil holati: aniqlik, batareya, moslashtirilgan interval,
                  oxirgi o'lchov, offline navbat va xatolik ogohlantirishlari. */}
              {gpsTracking && gpsStatus && (
                <div className="mb-3 space-y-2">
                  {(gpsStatus.state === 'denied' || gpsStatus.state === 'unavailable' || gpsStatus.state === 'timeout') && (
                    <p className="text-[11px] rounded-lg px-2.5 py-1.5 bg-red-500/10 text-red-600 dark:text-red-400">
                      ⚠ {t(gpsStatus.state === 'denied' ? 'gps.warnDenied' : gpsStatus.state === 'timeout' ? 'gps.warnTimeout' : 'gps.warnUnavailable')}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('gps.accuracy')}</p>
                      <p className={`font-semibold ${QUALITY_COLOR[accuracyQuality(gpsStatus.accuracy) || 'ok']}`}>
                        {gpsStatus.accuracy != null ? `±${gpsStatus.accuracy} m · ${t(`gps.q_${accuracyQuality(gpsStatus.accuracy)}`)}` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('gps.battery')}</p>
                      <p className={`font-semibold ${gpsStatus.battery != null && gpsStatus.battery <= 20 && !gpsStatus.charging ? 'text-red-600 dark:text-red-400' : ''}`}>
                        {gpsStatus.battery != null ? `${gpsStatus.battery}%${gpsStatus.charging ? ' ⚡' : ''}` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('gps.interval')}</p>
                      <p className="font-semibold">{gpsStatus.intervalMs ? t('gps.everySec', { sec: Math.round(gpsStatus.intervalMs / 1000) }) : '—'}{gpsStatus.moving != null ? ` · ${t(gpsStatus.moving ? 'gps.moving' : 'gps.still')}` : ''}</p>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('gps.lastFix')}</p>
                      <p className="font-semibold">{gpsStatus.lastFixAt ? new Date(gpsStatus.lastFixAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tashkent' }) : '—'}</p>
                    </div>
                  </div>
                  {(gpsStatus.queued > 0 || gpsStatus.network === 'offline') && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">📡 {t('gps.queuedNote', { count: gpsStatus.queued })}</p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                {!todayAttendance?.checkOut ? (
                  <button onClick={() => { if (confirm(t('profile.confirmFinishWork'))) onCheckOut(); }} className="flex-1 btn btn-outline text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 border-red-400/40 text-red-600 dark:text-red-400 hover:bg-red-500/10">
                    <MorphIcon icon={X} className="w-3.5 h-3.5" />{t('profile.finishWorkBtn')}
                  </button>
                ) : (
                  // XATO TUZATILDI ("ishni tugatgandan keyin ishga keldim tugmasi
                  // ko'rinmayapti"): avval bu yerda faqat statik "tugatildi" matni
                  // bo'lardi, kun ichida qayta ishga kirish (masalan tanaffusdan
                  // keyin) imkoni UMUMAN ko'rinmasdi — backend (bot.ts/attendance.ts)
                  // buni allaqachon qo'llab-quvvatlaydi, shu sabab tugma ham qaytdi.
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="text-center text-xs text-green-600 dark:text-green-400 font-medium">
                      ✓ {t('profile.todayWorkDone', { duration: fmtWorkDuration(todayAttendance.checkIn, todayAttendance.checkOut, t) || t('gps.minutesShort', { min: 0 }) })}
                    </div>
                    <button onClick={() => { if (confirm(t('checkinGate.confirmPrompt'))) onCheckIn(); }} className="btn btn-primary text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5">
                      <MorphIcon icon={Check} className="w-3.5 h-3.5" />{t('profile.resumeWorkBtn')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 md:col-span-2">
          {/* Qo'lda bloklash — 1 daqiqa kutmasdan, darhol PIN ekraniga o'tadi.
            Barcha qurilmalarda (veb/APK/exe) ko'rinadi — biometrikdan farqli,
            bunga maxsus native imkoniyat kerak emas. */}
        <button onClick={onLockNow} className="group w-full flex items-center gap-3 rounded-2xl border border-border bg-card/60 px-3.5 py-3 text-left hover:border-primary/40 hover:bg-primary/[0.05] liquid-transition">
                <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><MorphIcon icon={Lock} className="w-4 h-4" /></span>
                <span className="text-sm font-semibold whitespace-nowrap truncate">{t('profile.lockNowBtn')}</span>
        </button>

        <motion.button initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.26 }}
          onClick={() => { markManualLogout(); localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
          className="group w-full flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.04] px-3.5 py-3 text-left hover:border-red-500/45 hover:bg-red-500/10 liquid-transition">
                <span className="w-9 h-9 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center flex-shrink-0"><MorphIcon icon={LogOut} className="w-4 h-4" /></span>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400 whitespace-nowrap truncate">{t('profile.logout')}</span>
        </motion.button>
          </div>
        </div>

        {/* O'ng ustun: sozlamalar katakchalari, audit, xavfsizlik, ilova yuklash */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-4 min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin] lg:px-2 lg:py-2 lg:pr-3">
        {/* ── Sozlamalar menyusi: telefonda ro'yxat, planshet/noutbukda katakchalar ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.06 }}>
          <div className="surface border border-border overflow-hidden md:hidden">
            {menuRows.map((row, i) => (
              <button key={row.key} onClick={() => setActivePanel(row.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 liquid-transition text-left ${i > 0 ? "border-t border-border/50" : ""}`}>
                {row.swatch
                  ? <div className="w-10 h-10 rounded-xl flex-shrink-0" style={row.swatch}/>
                  : <div className="icon-chip"><MorphIcon icon={row.icon} className="w-4 h-4" /></div>}
                <span className="text-sm font-medium flex-1">{row.label}</span>
                {row.hint && <span className="text-xs text-muted-foreground">{row.hint}</span>}
                <MorphIcon icon={ChevronRight} className="w-4 h-4 text-muted-foreground/60" />
              </button>
            ))}
          </div>
          <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {menuRows.map(row => (
              <button key={row.key} onClick={() => setActivePanel(row.key)}
                className="surface border border-border rounded-2xl p-4 flex items-center gap-3 text-left hover:border-primary/50 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 liquid-transition min-w-0">
                {row.swatch
                  ? <div className="w-11 h-11 rounded-xl flex-shrink-0" style={row.swatch}/>
                  : <div className="icon-chip w-11 h-11"><MorphIcon icon={row.icon} className="w-5 h-5" /></div>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{row.label}</p>
                  {row.hint && <p className="text-xs text-muted-foreground truncate mt-0.5">{row.hint}</p>}
                </div>
                <MorphIcon icon={ChevronRight} className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
              </button>
            ))}
          </div>
        </motion.div>

        {/* Audit log — faqat admin, va tarifda yoqilgan bo'lsa (subData.features
            hali kelmagan bo'lsa ham ko'rsatiladi — quyida yozilganidek). */}
        {(currentUser.role === 'direktor' || currentUser.role === 'orinbosar' || currentUser.role === 'dasturchi') &&
          (!subData?.features || subData.features.includes('audit_log')) && (
          <AuditLogSection token={localStorage.getItem("token") || ""} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <SecuritySettingsCard />
          <BiometricToggleCard currentUserId={currentUser.id} />
        </div>

        {/* Ilovani yuklab olish — hali CI birorta ham APK/exe chiqarmagan
            bo'lsa (yoki hali yuklanmoqda) komponent o'zi HECH NARSA
            render qilmaydi (loadingFallback=false) — bo'sh joy qolmasin. */}
        {/* Ilovaning o'zida "ilovani yuklab oling" ma'nosiz — faqat veb saytda */}
        {!isNative() && <AppDownloadCards compact title={t('profile.appDownloadTitle')} loadingFallback={false} />}

        </div>
      </div>
    </div>
  );
}

