import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Delete, Fingerprint, LogOut, Building2, Lock, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { isAndroid, isDesktopPointer } from "./platform";

// ─── Ilova qulfi (PIN kod + ixtiyoriy biometrik) ──────────────────────────
// To'liq telefon+kod login har safar qayta so'ralmasin uchun — Telegram'dagi
// kabi: bir marta kirilgandan keyin PIN o'rnatiladi, ilova fondan uzoq vaqt
// (>1 daqiqa) qaytganda shu PIN (yoki yoqilgan bo'lsa — barmoq izi/Face ID)
// so'raladi. Serverga HECH NARSA yuborilmaydi — bu faqat shu qurilmadagi,
// allaqachon amal qilayotgan JWT sessiyani ochish/berkitish uchun mahalliy
// qulf, xavfsizlik jihatidan qurilmaning o'zi (uni qo'lga kiritgan odam)dan
// himoya, server autentifikatsiyasining o'rnini bosmaydi.

const PIN_HASH_KEY = "erp_pinHash";
const PIN_SALT_KEY = "erp_pinSalt";
const BIOMETRIC_KEY = "erp_biometricEnabled";
const LAST_ACTIVE_KEY = "erp_lastActiveAt";
const LOCK_TIMEOUT_KEY = "erp_lockTimeoutMin";
const FAILED_ATTEMPTS_KEY = "erp_pinFailedAttempts";
// Standart — Telegram'ning o'zidagi taxminiy chegara: fondan shundan ko'proq
// vaqt o'tib qaytsa qulflanadi, tezkor ilova almashtirishda (masalan boshqa
// ilovaga bir soniyaga o'tib qaytish) bezovta qilmaydi. Profilda o'zgartirish
// mumkin (getLockTimeoutMs/setLockTimeoutMin).
const DEFAULT_LOCK_TIMEOUT_MIN = 1;
export const LOCK_TIMEOUT_OPTIONS = [1, 5, 15, 30, 60];

export function getLockTimeoutMin(): number {
  const v = Number(localStorage.getItem(LOCK_TIMEOUT_KEY));
  return LOCK_TIMEOUT_OPTIONS.includes(v) ? v : DEFAULT_LOCK_TIMEOUT_MIN;
}
export function setLockTimeoutMin(min: number): void {
  localStorage.setItem(LOCK_TIMEOUT_KEY, String(min));
}
function getLockThresholdMs(): number {
  return getLockTimeoutMin() * 60 * 1000;
}

// PIN'ni ko'r-ko'rona urinib topishga qarshi — 5 marta ketma-ket noto'g'ri
// kiritilsa, mahalliy PIN tozalanadi va to'liq qayta login talab qilinadi
// (4 xonali PIN'da atigi 10 000 kombinatsiya bor — cheklovsiz urinish
// amalda uni foydasiz qiladi).
const MAX_FAILED_ATTEMPTS = 5;
function recordFailedAttempt(): number {
  const n = (Number(localStorage.getItem(FAILED_ATTEMPTS_KEY)) || 0) + 1;
  localStorage.setItem(FAILED_ATTEMPTS_KEY, String(n));
  return n;
}
function resetFailedAttempts(): void {
  localStorage.removeItem(FAILED_ATTEMPTS_KEY);
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isPinSet(): boolean {
  return !!localStorage.getItem(PIN_HASH_KEY);
}
export async function setPin(pin: string): Promise<void> {
  const salt = randomHex(16);
  localStorage.setItem(PIN_SALT_KEY, salt);
  localStorage.setItem(PIN_HASH_KEY, await sha256Hex(salt + pin));
}
// Muvaffaqiyatli bo'lsa urinishlar hisobini nolga tushiradi; noto'g'ri bo'lsa
// hisoblaydi va MAX_FAILED_ATTEMPTS'ga yetganda PIN'ning o'zini tozalaydi
// (qo'pol kuch bilan taxmin qilishning oldi — chaqiruvchi shu holatda
// to'liq logout qilishi kerak, `lockedOut: true` shuni bildiradi).
export async function verifyPin(pin: string): Promise<{ ok: boolean; lockedOut?: boolean; attemptsLeft?: number }> {
  const hash = localStorage.getItem(PIN_HASH_KEY);
  if (!hash) return { ok: false };
  const salt = localStorage.getItem(PIN_SALT_KEY) || '';
  const ok = (await sha256Hex(salt + pin)) === hash;
  if (ok) { resetFailedAttempts(); return { ok: true }; }
  const attempts = recordFailedAttempt();
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    clearPin();
    resetFailedAttempts();
    return { ok: false, lockedOut: true };
  }
  return { ok: false, attemptsLeft: MAX_FAILED_ATTEMPTS - attempts };
}
export function clearPin(): void {
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(BIOMETRIC_KEY);
}
export function isBiometricEnabled(): boolean {
  return localStorage.getItem(BIOMETRIC_KEY) === '1';
}
export function setBiometricEnabled(v: boolean): void {
  localStorage.setItem(BIOMETRIC_KEY, v ? '1' : '0');
}
const WEBAUTHN_CRED_KEY = "erp_webauthnCredId";

// Android — @capacitor/native-biometric, avvaldan tayyor, ro'yxatdan
// o'tish shart emas.
export const nativeBiometricSupported = (): boolean => isAndroid();

// Veb (shu jumladan iOS Safari, Windows exe'ning WebView'i, va h.k.) —
// WebAuthn ("Face ID/Touch ID/Windows Hello ilova kod so'ramasdan turib
// tasdiqlashi mumkin bo'lgan brauzer standarti"). MUHIM: bu yerda WebAuthn
// SERVERGA HECH QANDAY narsa yubormaydigan, faqat MAHALLIY tekshiruv
// sifatida ishlatiladi — chaqiruv/credential butunlay shu qurilmada
// yaratiladi va tekshiriladi (haqiqiy parolsiz-login uchun odatda server
// challenge/public key saqlashi kerak bo'ladi, lekin bu yerga kerak emas —
// PIN kabi, faqat allaqachon amal qilayotgan sessiyani ochish/berkitish
// uchun mahalliy qulf).
export async function isWebAuthnAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;
    const fn = (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn !== 'function') return false;
    return await fn.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}
function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

// Biometrikni birinchi marta yoqishda chaqiriladi — Face ID/Touch ID/
// Windows Hello orqali bitta "kalit" yaratadi va uning ID'sini (nafaqat
// maxfiy qismini — bu ID ochiq, faqat "shu kalit shu qurilmada bor"ligini
// bildiradi) localStorage'da saqlaydi.
export async function registerWebAuthnBiometric(userId: string): Promise<boolean> {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "QurilishERP" },
        user: { id: randomBytes(16), name: userId || "erp-user", displayName: "QurilishERP" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        // residentKey: "discouraged" — MUHIM: shu bo'lmasa Android'dagi Chrome
        // buni "passkey" deb hisoblab, Face ID/barmoq izi o'rniga "Google
        // Password Manager'ga passkey saqlansinmi?" degan qo'shimcha
        // dialogni ko'rsatadi (chunki faqat discoverable/resident kalitlar
        // "passkey" hisoblanadi va bulutga sinxronlash uchun taklif
        // qilinadi). Bizga bulutga sinxronlanadigan passkey shart emas —
        // shu qurilmaga bog'liq, mahalliy qulf sifatida ishlatiladi (yuqoridagi
        // izohga qarang) — shuning uchun "discouraged" qilib to'g'ridan-to'g'ri
        // Face ID/Touch ID/barmoq izi/Windows Hello so'rovini chiqaramiz.
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(WEBAUTHN_CRED_KEY, toBase64(cred.rawId));
    return true;
  } catch {
    return false; // bekor qilindi yoki qurilmada platform authenticator yo'q
  }
}

export function isWebAuthnRegistered(): boolean {
  return !!localStorage.getItem(WEBAUTHN_CRED_KEY);
}

async function verifyWebAuthnBiometric(): Promise<boolean> {
  const credId = localStorage.getItem(WEBAUTHN_CRED_KEY);
  if (!credId) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: fromBase64(credId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

// Biometrik tugmasi Profilda ko'rinishi uchun — Android'da nativega
// tayyorlik shart emas, boshqa platformalarda esa avval ro'yxatdan
// o'tilgan bo'lishi kerak (registerWebAuthnBiometric chaqirilgan bo'lsin).
export async function biometricAvailable(): Promise<boolean> {
  if (nativeBiometricSupported()) return true;
  return (await isWebAuthnAvailable()) ; // ro'yxatdan o'tish keyinroq, yoqish paytida
}
// Sinxron, tezkor tekshiruv (masalan qulf ekranida darhol chaqirish uchun)
// — allaqachon yoqilgan/ro'yxatdan o'tgan holatni tekshiradi, YANGI
// moslikni emas (shu uchun useEffect'da avval biometricAvailable() bilan
// asinxron tekshirilgan bo'lishi kerak, bu funksiya faqat "ishlatsa
// bo'ladimi" degan tezkor savolga javob beradi).
export const biometricSupported = (): boolean => nativeBiometricSupported() || isWebAuthnRegistered();

export async function tryBiometricUnlock(): Promise<boolean> {
  if (nativeBiometricSupported()) {
    try {
      const { NativeBiometric } = await import('capacitor-native-biometric');
      const avail = await NativeBiometric.isAvailable();
      if (!avail?.isAvailable) return false;
      await NativeBiometric.verifyIdentity({ reason: "Ilovaga kirish uchun tasdiqlang", title: "QurilishERP" });
      return true;
    } catch {
      return false; // bekor qilindi, ro'yxatdan o'tmagan, yoki qurilmada mavjud emas
    }
  }
  if (isWebAuthnRegistered()) return verifyWebAuthnBiometric();
  return false;
}

export function markActiveNow(): void {
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

// App fonga ketib qaytganda — chegaradan ko'p vaqt o'tgan bo'lsa qulflash
// kerakligini aniqlaydi. PIN o'rnatilmagan bo'lsa umuman ishlamaydi.
export function useAppLock(pinIsSet: boolean) {
  // MUHIM: boshlang'ich holatni to'g'ridan-to'g'ri localStorage'dan hisoblab
  // olamiz (useState'ga funksiya sifatida) — aks holda ilova TO'LIQ
  // yopilib (cold start, fon emas) qayta ochilganda effect ichida
  // markActiveNow() darhol chaqirilib, eski (soatlab oldingi) belgini
  // "hozir" bilan almashtirib, qulfni HECH QACHON ishga tushirmas edi.
  const [locked, setLocked] = useState(() => {
    if (!pinIsSet) return false;
    const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
    return !!last && Date.now() - last > getLockThresholdMs();
  });

  useEffect(() => {
    if (!pinIsSet) return;
    // XAVFSIZLIK MUHIM: qulf EKRANINING O'ZI ko'rsatilayotganda (locked=true)
    // faollik vaqtini "hozir"ga YANGILAMAYMIZ. Avval bu yerda shartsiz
    // markActiveNow() chaqirilardi — PIN ekrani ochiq turgan holatda sahifa
    // qayta yuklansa (masalan tortib-yangilash yoki WebView'ning o'zining
    // tabiiy pull-to-refresh imo-ishorasi — overscroll-behavior-y bilan
    // cheklanmagan, PIN ekrani doim "eng tepada" bo'lgani uchun har doim
    // shu imo-ishoraga ochiq), effekt DARHOL ishga tushib "faollik hozir
    // bo'ldi" deb belgilab qo'yardi. Natijada KEYINGI (masalan yana bir
    // tortib-yangilash) qayta yuklanishda useState boshlang'ich hisobi
    // "hozirgina faol bo'lgan" deb noto'g'ri xulosa chiqarib, PIN SO'RALMASDAN
    // to'g'ridan-to'g'ri saytga kirib ketardi.
    if (locked) return;
    markActiveNow();

    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        markActiveNow();
        return;
      }
      const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      const staleNow = !!last && Date.now() - last > getLockThresholdMs();
      if (staleNow) setLocked(true); // bu yerda markActiveNow() CHAQIRILMAYDI — xuddi shu sabab
      else markActiveNow();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [pinIsSet, locked]);

  // "lock" — qo'lda darhol bloklash tugmasi uchun (Profil'da). GPS kuzatuv
  // shu holatga BOG'LIQ EMAS — useGeoTracker App.tsx'da ushbu qulfdan oldin
  // (shartsiz) chaqiriladi, shuning uchun ekran bloklangan paytda ham
  // joylashuv yuborilishda davom etadi (aniq talab: "joylashuvni hardoim
  // oladigan bo'lsin").
  return { locked, unlock: () => { markActiveNow(); setLocked(false); }, lock: () => { markActiveNow(); setLocked(true); } };
}

// ─── PIN kiritish klaviaturasi (umumiy — o'rnatish va qulf ochishda ham) ──
function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      {Array.from({ length }).map((_, i) => (
        <motion.div key={i} animate={{ scale: i < filled ? 1.1 : 1 }}
          className={`w-3.5 h-3.5 rounded-full ${i < filled ? "bg-primary" : "bg-muted-foreground/25"}`} />
      ))}
    </div>
  );
}

// `value` — hozirgi kiritilgan raqamlar (chaqiruvchi ekranining current
// state'i). Ko'rinadigan katta tugmalar bilan bir qatorda, FAQAT laptop/
// desktopda (sichqoncha asosiy kirish qurilmasi bo'lganda) ko'rinmas
// haqiqiy <input> ham qo'yiladi — shu orqali jismoniy klaviatura/numpad'dan
// ham PIN teriladi (xuddi OtpBoxes'dagi bir xil naqsh). Telefon/planshetda
// BU QO'YILMAYDI — aks holda ekran klaviaturasi qo'shimcha, keraksiz holda
// chiqib, maxsus katta tugmalar bilan ikki karra bo'lib qolardi (aniq
// talab: "numpad faqat laptop/desktopda ishlasin, qolganda faqat ekrandagi").
function PinPad({ value, onDigit, onDelete }: { value: string; onDigit: (d: string) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const useHiddenInput = isDesktopPointer();
  useEffect(() => { if (useHiddenInput) hiddenRef.current?.focus(); }, [useHiddenInput]);

  const handleRealChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length > value.length) {
      for (const d of digits.slice(value.length)) onDigit(d);
    } else if (digits.length < value.length) {
      for (let i = 0; i < value.length - digits.length; i++) onDelete();
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="relative w-full max-w-[280px] mx-auto">
      {useHiddenInput && (
        <input
          ref={hiddenRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={e => handleRealChange(e.target.value)}
          aria-label={t('pinLock.pinInputAria')}
          className="absolute inset-0 opacity-0"
          style={{ pointerEvents: "none" }}
        />
      )}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k, i) => k === "" ? <div key={i} /> : (
          <button key={i} type="button"
            onClick={() => { hiddenRef.current?.focus(); k === "del" ? onDelete() : onDigit(k); }}
            className="h-16 rounded-2xl bg-muted/50 hover:bg-muted active:scale-95 flex items-center justify-center text-xl font-semibold liquid-transition">
            {k === "del" ? <Delete className="w-5 h-5" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

const PIN_LEN = 4;

// ─── Birinchi login'dan keyin — PIN o'rnatish (majburiy, bir marta) ──────
export function PinSetupScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  // MUHIM: bu yerdagi lokal state'lar modul darajasidagi `setPin` (import
  // qilingan, localStorage'ga yozadigan) funksiyasi bilan NOM TO'QNASHUVIGA
  // uchramasin deb ataylab "firstPin"/"confirmPin" deb nomlangan — avval
  // shu ikkisi ham "pin"/"setPin" edi va lokal useState setter chaqirilib,
  // import qilingan haqiqiy saqlovchi funksiya HECH QACHON chaqirilmagan,
  // shu sabab PIN hech qachon saqlanmay, ekran "qotib qolgandek" ko'rinardi.
  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const current = stage === "enter" ? firstPin : confirmPin;
  const setCurrent = stage === "enter" ? setFirstPin : setConfirmPin;

  const onDigit = (d: string) => {
    if (current.length >= PIN_LEN || saving) return;
    setError("");
    const next = current + d;
    setCurrent(next);
    if (next.length === PIN_LEN) {
      if (stage === "enter") {
        setTimeout(() => setStage("confirm"), 150);
      } else if (next === firstPin) {
        setSaving(true);
        setPin(next).then(onDone);
      } else {
        setError(t('pinLock.mismatchError'));
        setTimeout(() => { setFirstPin(""); setConfirmPin(""); setStage("enter"); }, 700);
      }
    }
  };

  return (
    <main className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6"
      style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mb-6 shadow-xl shadow-primary/20">
        <Building2 className="w-8 h-8 text-white" />
      </div>
      <h1 className="text-xl font-bold mb-1.5">{stage === "enter" ? t('pinLock.setupTitleEnter') : t('pinLock.setupTitleConfirm')}</h1>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-xs">
        {stage === "enter" ? t('pinLock.setupSubtitleEnter') : t('pinLock.setupSubtitleConfirm')}
      </p>
      <AnimatePresence mode="wait">
        <motion.div key={stage} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
          <PinDots length={PIN_LEN} filled={current.length} />
        </motion.div>
      </AnimatePresence>
      {error && <p className="text-xs text-red-500 mb-4 text-center">{error}</p>}
      <PinPad value={current} onDigit={onDigit} onDelete={() => setCurrent(current.slice(0, -1))} />
    </main>
  );
}

// ─── PIN kodni almashtirish (Profil'dan) — avval eskisi tekshiriladi ─────
export function ChangePinModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<"old" | "new" | "confirm">("old");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const current = stage === "old" ? oldPin : stage === "new" ? newPin : confirmPin;
  const setCurrent = stage === "old" ? setOldPin : stage === "new" ? setNewPin : setConfirmPin;

  const onDigit = async (d: string) => {
    if (current.length >= PIN_LEN || saving) return;
    setError("");
    const next = current + d;
    setCurrent(next);
    if (next.length !== PIN_LEN) return;

    if (stage === "old") {
      const result = await verifyPin(next);
      if (result.ok) {
        setTimeout(() => setStage("new"), 150);
      } else if (result.lockedOut) {
        onClose(); // App.tsx darajasida lockedOut allaqachon to'liq logout qiladi (App qayta render bo'ladi)
      } else {
        setError(t('pinLock.oldPinWrong'));
        setTimeout(() => setOldPin(""), 700);
      }
    } else if (stage === "new") {
      setTimeout(() => setStage("confirm"), 150);
    } else {
      if (next === newPin) {
        setSaving(true);
        await setPin(next);
        onChanged();
      } else {
        setError(t('pinLock.newMismatch'));
        setTimeout(() => { setNewPin(""); setConfirmPin(""); setStage("new"); }, 700);
      }
    }
  };

  const titles: Record<typeof stage, string> = {
    old: t('pinLock.changeTitleOld'),
    new: t('pinLock.changeTitleNew'),
    confirm: t('pinLock.changeTitleConfirm'),
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-background flex flex-col items-center justify-center p-6"
      style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      <button onClick={onClose} aria-label={t('common.close')} className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted"
        style={{ top: "max(1rem, env(safe-area-inset-top))" }}>
        <X className="w-5 h-5" />
      </button>
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mb-6 shadow-xl shadow-primary/20">
        <Lock className="w-8 h-8 text-white" />
      </div>
      <h1 className="text-xl font-bold mb-8">{titles[stage]}</h1>
      <AnimatePresence mode="wait">
        <motion.div key={stage} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
          <PinDots length={PIN_LEN} filled={current.length} />
        </motion.div>
      </AnimatePresence>
      {error && <p className="text-xs text-red-500 mb-4 text-center">{error}</p>}
      <PinPad value={current} onDigit={onDigit} onDelete={() => setCurrent(current.slice(0, -1))} />
    </div>,
    document.body
  );
}

// ─── Qulf ekrani — fondan uzoq vaqtdan keyin qaytganda ────────────────────
export function PinLockScreen({ onUnlock, onForgot, onLockedOut }: { onUnlock: () => void; onForgot: () => void; onLockedOut: () => void }) {
  const { t } = useTranslation();
  const [pin, setPinInput] = useState("");
  const [error, setError] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [biometricTried, setBiometricTried] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  const attemptBiometric = async () => {
    setBiometricBusy(true);
    const ok = await tryBiometricUnlock();
    setBiometricBusy(false);
    setBiometricTried(true);
    if (ok) onUnlock();
  };

  useEffect(() => {
    if (isBiometricEnabled() && biometricSupported()) attemptBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDigit = async (d: string) => {
    if (pin.length >= PIN_LEN) return;
    setError(false);
    const next = pin + d;
    setPinInput(next);
    if (next.length === PIN_LEN) {
      const result = await verifyPin(next);
      if (result.ok) { onUnlock(); return; }
      if (result.lockedOut) {
        // Juda ko'p noto'g'ri urinish — PIN ALLAQACHON tozalandi (endi
        // hech qanday PIN mavjud emas), shuning uchun tasdiqlash so'ralmaydi
        // (foydalanuvchida "bekor qilish" degan haqiqiy tanlov yo'q —
        // ekranda qolsa, hech narsa kirita olmaydigan tuzoqqa tushib qoladi).
        onLockedOut();
        return;
      }
      setAttemptsLeft(result.attemptsLeft ?? null);
      setError(true);
      setTimeout(() => setPinInput(""), 400);
    }
  };

  return (
    <main className="fixed inset-0 z-[999] bg-background flex flex-col items-center justify-center p-6"
      style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mb-6 shadow-xl shadow-primary/20">
        <Building2 className="w-8 h-8 text-white" />
      </div>
      <h1 className="text-xl font-bold mb-1.5">{t('pinLock.lockedTitle')}</h1>
      <p className="text-sm text-muted-foreground mb-8">{t('pinLock.lockedSubtitle')}</p>
      <motion.div animate={error ? { x: [0, -10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }}>
        <PinDots length={PIN_LEN} filled={pin.length} />
      </motion.div>
      {error && (
        <p className="text-xs text-red-500 mb-4">
          {t('pinLock.wrongPin')}{attemptsLeft != null && attemptsLeft <= 3 ? t('pinLock.attemptsLeft', { count: attemptsLeft }) : ''}
        </p>
      )}
      <PinPad value={pin} onDigit={onDigit} onDelete={() => setPinInput(pin.slice(0, -1))} />

      {isBiometricEnabled() && biometricSupported() && (
        <button onClick={attemptBiometric} disabled={biometricBusy}
          className="mt-6 flex items-center gap-2 text-sm text-primary font-semibold py-2 px-4 rounded-full hover:bg-primary/10 disabled:opacity-50">
          <Fingerprint className="w-4 h-4" /> {biometricBusy ? t('pinLock.checking') : t('pinLock.biometricBtn')}
        </button>
      )}
      <button onClick={onForgot} className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <LogOut className="w-3.5 h-3.5" /> {t('pinLock.forgotPin')}
      </button>
    </main>
  );
}
