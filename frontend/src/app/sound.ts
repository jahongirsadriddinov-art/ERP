// Butun sayt uchun yagona ovoz effektlari (UI SFX) manbai — `uisfx`
// kutubxonasi asosida. Pack: "zen" (qog'oz varaqlanishi, yumshoq cho'tka,
// iliq yog'och, sokin qo'ng'iroqchalar) — QurilishERP'ning xotirjam,
// professional uslubiga "minimal" yoki "arcade" kabi paketlardan ko'ra
// yaxshiroq mos keladi.
//
// MUHIM: butun ilova bo'ylab FAQAT shu fayldagi `sfx` obyektidan
// foydalaning (o'z alohida player yaratmang) — aks holda pack/volume/mute
// holatlari sinxron bo'lmay qoladi. Boshqa modullar (soundToast.ts,
// soundClicks.ts, kelajakdagi sozlamalar paneli) hammasi shu yerdan import
// qiladi.
import { createUISFX, type CueName, type PlayOptions, type UISFXPlayer } from "uisfx";

const PREFERENCES_KEY = "qurilisherp:sound";

// "zen" paketi juda past eshitilardi (ayniqsa telefon karnayida). Kutubxona barcha ovozlarni
// `ctx.destination`ga ulaydi — o'z kontekstimizni beramiz va uning `destination`ini
// KUCHAYTIRGICH (gain) + SIQGICH (compressor, xirillamasligi uchun) zanjiriga almashtiramiz.
function createBoostedContext(): AudioContext | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const AC: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return undefined;
    const ctx = new AC({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 10; comp.attack.value = 0.002; comp.release.value = 0.12;
    const boost = ctx.createGain();
    boost.gain.value = 3.2;
    boost.connect(comp);
    comp.connect(ctx.destination);
    Object.defineProperty(ctx, "destination", { value: boost, configurable: true });
    return ctx;
  } catch {
    return undefined;
  }
}

export const sfx: UISFXPlayer = createUISFX({
  pack: "zen",
  volume: 0.8,
  context: createBoostedContext(),
  // pack/volume/enabled — localStorage'da saqlanadi, foydalanuvchi
  // tanlovi sahifa yangilansa ham, qurilma qayta ochilsa ham saqlanadi.
  preferences: { key: PREFERENCES_KEY },
});

// Brauzerning autoplay siyosati AudioContext'ni faqat ishonchli
// foydalanuvchi harakati (pointer/keyboard/touch) bilan ochishga ruxsat
// beradi — shuning uchun birinchi bosishda bir marta unlock qilamiz.
// Bu funksiya idempotent: bir necha marta chaqirilsa ham faqat bitta
// listener guruhi o'rnatiladi.
let unlockAttached = false;
export function attachSoundUnlock(): void {
  if (unlockAttached || typeof window === "undefined") return;
  unlockAttached = true;
  const unlock = () => {
    sfx.unlock().catch(() => {
      // Audio unlock muvaffaqiyatsiz bo'lsa ham ilova ishlashda davom etadi.
    });
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("touchstart", unlock, { once: true, passive: true });
}

/**
 * Har qanday joydan xavfsiz chaqirish uchun wrapper — Web Audio mavjud
 * bo'lmagan muhitda (masalan ba'zi WebView'lar) yoki mute holatida ham
 * ilova hech qachon bu sababdan buzilmaydi.
 */
export function playSound(cue: CueName, options?: PlayOptions) {
  try {
    return sfx.play(cue, options);
  } catch {
    return null;
  }
}

export function isSoundEnabled(): boolean {
  try {
    return sfx.isEnabled();
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    sfx.setEnabled(enabled);
    if (!enabled) sfx.stopAll();
  } catch {
    // ignore
  }
}

export function getSoundVolume(): number {
  try {
    return sfx.getVolume();
  } catch {
    return 0.55;
  }
}

export function setSoundVolume(volume: number): void {
  try {
    sfx.setVolume(volume);
  } catch {
    // ignore
  }
}

// Konsoldan tez tekshirish va nosozliklarni tuzatish uchun — masalan
// ProfilePage sozlamalar bo'limiga o'chirish/yoqish tugmasi qo'shilguncha:
//   window.__sfx.play('success')
//   window.__sfx.setEnabled(false)
declare global {
  interface Window {
    __sfx?: UISFXPlayer;
  }
}
if (typeof window !== "undefined") {
  window.__sfx = sfx;
}
