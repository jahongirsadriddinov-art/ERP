// TTS zaxirasi (design §4 Cascade): server ovoz sintezi ishlamay qolsa, AI javobi faqat matn (aiv:transcript)
// bo'lib keladi. Shu holda — shu javob uchun hech qanday audio kelmagan bo'lsa — matnni qurilmaning o'z
// speechSynthesis'i bilan o'qib beramiz. Audio kelayotgan bo'lsa hech narsa qilinmaydi (ikki marta gapirmasin).

export interface TtsFallback {
  /** AI audio kadri keldi. */
  noteAudio(): void;
  /** AI javobining yakuniy matni keldi. */
  onAssistantFinal(text: string, lang: "uz" | "ru"): void;
  cancel(): void;
  readonly speaking: boolean;
}

type Synth = Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices">;

export function createTtsFallback(opts: {
  synth?: Synth | null;
  makeUtterance?: (text: string) => SpeechSynthesisUtterance;
  delayMs?: number;
  /** Shuncha vaqt ichida audio kelgan bo'lsa — javob ovozli deb hisoblanadi. */
  audioWindowMs?: number;
  now?: () => number;
  onSpeakingChange?: (speaking: boolean) => void;
} = {}): TtsFallback {
  const synth: Synth | null = opts.synth !== undefined ? opts.synth
    : (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);
  const now = opts.now ?? (() => Date.now());
  const delayMs = opts.delayMs ?? 900;
  const audioWindowMs = opts.audioWindowMs ?? 2500;
  let lastAudioAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let speaking = false;
  const setSpeaking = (b: boolean) => { if (speaking !== b) { speaking = b; opts.onSpeakingChange?.(b); } };

  const speak = (text: string, lang: "uz" | "ru") => {
    if (!synth) return;
    try {
      const u = opts.makeUtterance ? opts.makeUtterance(text)
        : new SpeechSynthesisUtterance(text);
      const want = lang === "ru" ? "ru" : "uz";
      u.lang = want === "ru" ? "ru-RU" : "uz-UZ";
      const voices = synth.getVoices?.() || [];
      const v = voices.find((x) => x.lang?.toLowerCase().startsWith(want));
      if (v) u.voice = v;
      u.rate = 1;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(u);
    } catch {
      setSpeaking(false);
    }
  };

  return {
    noteAudio() {
      lastAudioAt = now();
      if (timer) { clearTimeout(timer); timer = null; }
    },
    onAssistantFinal(text, lang) {
      const clean = (text || "").trim();
      if (!clean || !synth) return;
      if (now() - lastAudioAt < audioWindowMs) return;
      if (timer) clearTimeout(timer);
      const startedAt = now();
      timer = setTimeout(() => {
        timer = null;
        if (lastAudioAt >= startedAt) return; // shu orada audio keldi
        speak(clean.slice(0, 600), lang);
      }, delayMs);
    },
    cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      try { if (speaking) synth?.cancel(); } catch { /* */ }
      setSpeaking(false);
    },
    get speaking() { return speaking; },
  };
}
