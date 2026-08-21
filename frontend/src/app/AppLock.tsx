import { useEffect, useState } from "react";
import { Delete, Fingerprint, LogOut, Building2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { isAndroid } from "./platform";

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
// Telegram'ning o'zidagi taxminiy chegara — fondan shundan ko'proq vaqt
// o'tib qaytsa qulflanadi, tezkor ilova almashtirishda (masalan boshqa
// ilovaga bir soniyaga o'tib qaytish) bezovta qilmaydi.
const LOCK_THRESHOLD_MS = 60 * 1000;

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
export async function verifyPin(pin: string): Promise<boolean> {
  const hash = localStorage.getItem(PIN_HASH_KEY);
  if (!hash) return false;
  const salt = localStorage.getItem(PIN_SALT_KEY) || '';
  return (await sha256Hex(salt + pin)) === hash;
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
// Hozircha faqat Android — Windows'da (Tauri exe) Windows Hello uchun mos,
// sinovdan o'tgan native plagin yo'q, shuning uchun bu yerda ATAYLAB
// yoqilmagan (ishlamaydigan tugma ko'rsatishdan ko'ra yashirish afzal).
export const biometricSupported = (): boolean => isAndroid();

export async function tryBiometricUnlock(): Promise<boolean> {
  if (!biometricSupported()) return false;
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
    return !!last && Date.now() - last > LOCK_THRESHOLD_MS;
  });

  useEffect(() => {
    if (!pinIsSet) return;
    markActiveNow();

    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        markActiveNow();
      } else {
        const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
        if (last && Date.now() - last > LOCK_THRESHOLD_MS) setLocked(true);
        markActiveNow();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [pinIsSet]);

  return { locked, unlock: () => setLocked(false) };
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

function PinPad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-[280px] mx-auto">
      {keys.map((k, i) => k === "" ? <div key={i} /> : (
        <button key={i} type="button"
          onClick={() => k === "del" ? onDelete() : onDigit(k)}
          className="h-16 rounded-2xl bg-muted/50 hover:bg-muted active:scale-95 flex items-center justify-center text-xl font-semibold liquid-transition">
          {k === "del" ? <Delete className="w-5 h-5" /> : k}
        </button>
      ))}
    </div>
  );
}

const PIN_LEN = 4;

// ─── Birinchi login'dan keyin — PIN o'rnatish (majburiy, bir marta) ──────
export function PinSetupScreen({ onDone }: { onDone: () => void }) {
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
        setError("PIN kodlar mos kelmadi, qaytadan urinib ko'ring");
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
      <h1 className="text-xl font-bold mb-1.5">{stage === "enter" ? "PIN kod o'rnating" : "PIN kodni tasdiqlang"}</h1>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-xs">
        {stage === "enter"
          ? "Ilovani tezroq va xavfsiz ochish uchun 4 xonali PIN kod o'rnating."
          : "Xotirangizda qolishi uchun PIN kodni qayta kiriting."}
      </p>
      <AnimatePresence mode="wait">
        <motion.div key={stage} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
          <PinDots length={PIN_LEN} filled={current.length} />
        </motion.div>
      </AnimatePresence>
      {error && <p className="text-xs text-red-500 mb-4 text-center">{error}</p>}
      <PinPad onDigit={onDigit} onDelete={() => setCurrent(current.slice(0, -1))} />
    </main>
  );
}

// ─── Qulf ekrani — fondan uzoq vaqtdan keyin qaytganda ────────────────────
export function PinLockScreen({ onUnlock, onForgot }: { onUnlock: () => void; onForgot: () => void }) {
  const [pin, setPinInput] = useState("");
  const [error, setError] = useState(false);
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
      const ok = await verifyPin(next);
      if (ok) { onUnlock(); return; }
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
      <h1 className="text-xl font-bold mb-1.5">Ilova qulflangan</h1>
      <p className="text-sm text-muted-foreground mb-8">PIN kodni kiriting</p>
      <motion.div animate={error ? { x: [0, -10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }}>
        <PinDots length={PIN_LEN} filled={pin.length} />
      </motion.div>
      {error && <p className="text-xs text-red-500 mb-4">Noto'g'ri PIN kod</p>}
      <PinPad onDigit={onDigit} onDelete={() => setPinInput(pin.slice(0, -1))} />

      {isBiometricEnabled() && biometricSupported() && (
        <button onClick={attemptBiometric} disabled={biometricBusy}
          className="mt-6 flex items-center gap-2 text-sm text-primary font-semibold py-2 px-4 rounded-full hover:bg-primary/10 disabled:opacity-50">
          <Fingerprint className="w-4 h-4" /> {biometricBusy ? "Tekshirilmoqda..." : "Barmoq izi / Face ID"}
        </button>
      )}
      <button onClick={onForgot} className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <LogOut className="w-3.5 h-3.5" /> PIN kodni unutdingizmi? Qayta kiring
      </button>
    </main>
  );
}
