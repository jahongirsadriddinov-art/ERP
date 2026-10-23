import { useSyncExternalStore } from "react";

// AI ofis — ovoz: umumiy "ovozni o'chirish" (eslab qolinadi; standart — o'chiq), o'z qo'shiqlari pleyeri (bitta <audio>),
// agent ovozi (brauzer speechSynthesis), o'yin "bip"lari (WebAudio). Hamma narsa `muted` ga bo'ysunadi.
const KEY = "aiOffice.muted";
type L = () => void;
const listeners = new Set<L>();
const emit = () => listeners.forEach((l) => l());
const read = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
let muted = typeof window !== "undefined" ? read() : true;

export const sound = {
  get muted() { return muted; },
  setMuted(v: boolean) {
    muted = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* */ }
    if (v) { try { window.speechSynthesis?.cancel(); } catch { /* */ } }
    player.syncMute();
    rainSync();
    emit();
  },
  subscribe(l: L) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** Yomg'ir shovqini (ofis tashqarisi) — ovoz yoqilgan bo'lsa. */
  setRain(on: boolean) { rainOn = on; rainSync(); },
};
let rainOn = false;
let rainNode: { ctx: AudioContext; src: AudioBufferSourceNode; gain: GainNode } | null = null;
function rainSync() {
  const want = rainOn && !muted;
  try {
    if (want && !rainNode) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + w * 0.05; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      const gain = ctx.createGain(); gain.gain.value = 0.25;
      src.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
      src.start();
      rainNode = { ctx, src, gain };
    } else if (!want && rainNode) {
      rainNode.src.stop(); void rainNode.ctx.close(); rainNode = null;
    }
  } catch { /* */ }
}
export const useMuted = () => useSyncExternalStore(sound.subscribe, () => muted, () => true);

// ───────────── O'z qo'shiqlari pleyeri (bitta <audio>, sahifa/tab almashganda ham to'xtamaydi) ─────────────
// Qo'shiq — serverdagi (url) yoki shu kompyuterdagi (local — IndexedDB id). Oxirgi qo'shiq va joy (soniya) eslab qolinadi:
// qayta ochilganda o'sha joydan davom etadi.
export interface Track { id: string; name: string; url?: string; local?: string; size?: number }
interface PState { tracks: Track[]; index: number; playing: boolean; volume: number; time: number; duration: number }
const RESUME = "aiOffice.player";
const readResume = (): { id: string; time: number; volume?: number } | null => { try { return JSON.parse(localStorage.getItem(RESUME) || "null"); } catch { return null; } };
let ps: PState = { tracks: [], index: 0, playing: false, volume: readResume()?.volume ?? 0.6, time: 0, duration: 0 };
const pl = new Set<L>();
const pemit = () => { ps = { ...ps }; pl.forEach((l) => l()); emit(); };
let audio: HTMLAudioElement | null = null;
let pendingSeek = 0;
let lastSave = 0;
const saveResume = () => {
  const t = ps.tracks[ps.index];
  try { if (t) localStorage.setItem(RESUME, JSON.stringify({ id: t.id, time: Math.floor(audio?.currentTime || ps.time), volume: ps.volume })); } catch { /* */ }
};
let resolveUrl: (t: Track) => Promise<string | null> = async (t) => t.url || null;
/** Mahalliy (IndexedDB) qo'shiqlar uchun URL hal qiluvchi — mediaStore o'rnatadi. */
export function setTrackResolver(fn: (t: Track) => Promise<string | null>) { resolveUrl = fn; }
const el = () => {
  if (!audio && typeof Audio !== "undefined") {
    audio = new Audio();
    audio.preload = "metadata";
    audio.addEventListener("ended", () => player.next());
    audio.addEventListener("pause", () => { if (ps.playing && audio?.paused && !audio.ended) { ps.playing = false; saveResume(); pemit(); } });
    audio.addEventListener("loadedmetadata", () => { if (pendingSeek && audio) { try { audio.currentTime = pendingSeek; } catch { /* */ } pendingSeek = 0; } ps.duration = audio?.duration || 0; pemit(); });
    audio.addEventListener("timeupdate", () => {
      ps.time = audio?.currentTime || 0;
      const now = Date.now();
      if (now - lastSave > 3000) { lastSave = now; saveResume(); pemit(); }
    });
  }
  return audio;
};
export const player = {
  get state() { return ps; },
  subscribe(l: L) { pl.add(l); return () => { pl.delete(l); }; },
  setTracks(t: Track[]) {
    const cur = ps.tracks[ps.index]?.id;
    ps.tracks = t;
    const keep = cur ? t.findIndex((x) => x.id === cur) : -1;
    if (keep >= 0) ps.index = keep;
    else {
      const r = readResume();
      const i = r ? t.findIndex((x) => x.id === r.id) : -1;
      ps.index = i >= 0 ? i : 0;
      if (i >= 0 && !ps.playing) { pendingSeek = r!.time || 0; ps.time = pendingSeek; }
    }
    if (!t.length) player.pause();
    pemit();
  },
  async play(i = ps.index) {
    const a = el(); const t = ps.tracks[i];
    if (!a || !t) return;
    const url = await resolveUrl(t);
    if (!url) return;
    if (a.src !== url) { if (i !== ps.index) pendingSeek = 0; a.src = url; }
    ps.index = i; ps.playing = true;
    a.volume = ps.volume; a.muted = muted;
    a.play().catch(() => { ps.playing = false; pemit(); });
    pemit();
  },
  pause() { audio?.pause(); ps.playing = false; saveResume(); pemit(); },
  toggle() { if (ps.playing) player.pause(); else void player.play(); },
  next() { if (!ps.tracks.length) return; void player.play((ps.index + 1) % ps.tracks.length); },
  prev() { if (!ps.tracks.length) return; void player.play((ps.index - 1 + ps.tracks.length) % ps.tracks.length); },
  seek(sec: number) { if (audio) audio.currentTime = sec; ps.time = sec; pemit(); },
  setVolume(v: number) { ps.volume = Math.max(0, Math.min(1, v)); if (audio) audio.volume = ps.volume; saveResume(); pemit(); },
  syncMute() { if (audio) audio.muted = muted; },
  /** Haqiqiy to'xtatish (mini-pleyerdagi ■). */
  stop() { saveResume(); audio?.pause(); if (audio) audio.removeAttribute("src"); ps.playing = false; pemit(); },
};
export const usePlayer = () => useSyncExternalStore(player.subscribe, () => ps, () => ps);

// ───────────── Agent ovozi ─────────────
/** Matnni ovoz chiqarib o'qish (o'chiq bo'lsa — jim). O'zbekcha ovoz bo'lmasa — rus/ingliz ovozi. */
export function speak(text: string, lang: "uz" | "ru", onEnd?: () => void): boolean {
  const ss = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (muted || !ss || typeof SpeechSynthesisUtterance === "undefined") { onEnd?.(); return false; }
  try {
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    const voices = ss.getVoices();
    // O'zbekcha ovoz kamdan-kam bor — bo'lmasa ANIQ rus ovozi (lotin matnini ham tushunarli o'qiydi); matn pufakda baribir ko'rinadi
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(lang)) || voices.find((x) => x.lang.toLowerCase().startsWith("ru"));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "ru-RU";
    u.rate = 1.02;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    ss.speak(u);
    return true;
  } catch { onEnd?.(); return false; }
}

// ───────────── O'yin "bip"lari ─────────────
let ac: AudioContext | null = null;
export function beep(freq = 660, ms = 50) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; o.type = "square";
    g.gain.value = 0.04;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + ms / 1000);
  } catch { /* */ }
}

// ───────────── Mikrofon → 16 kHz WAV (base64) ─────────────
/** MediaRecorder yozuvini (webm/ogg) 16 kHz mono WAV ga aylantiradi (Gemini transkriptori uchun). */
export async function blobToWav16k(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  let decoded: AudioBuffer;
  try { decoded = await ctx.decodeAudioData(buf.slice(0)); } finally { ctx.close?.().catch?.(() => {}); }
  const rate = 16_000;
  const len = Math.max(1, Math.floor((decoded.duration || decoded.length / decoded.sampleRate) * rate));
  let samples: Float32Array;
  if (typeof OfflineAudioContext !== "undefined") {
    const off = new OfflineAudioContext(1, len, rate);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    samples = (await off.startRendering()).getChannelData(0);
  } else {
    const ch = decoded.getChannelData(0), ratio = decoded.sampleRate / rate;
    samples = new Float32Array(len);
    for (let i = 0; i < len; i++) samples[i] = ch[Math.min(ch.length - 1, Math.floor(i * ratio))];
  }
  return pcmToWavBase64(samples, rate);
}
export function pcmToWavBase64(samples: Float32Array, rate: number): string {
  const n = samples.length, out = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); out.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, 1, true); out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, "data"); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  const bytes = new Uint8Array(out.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
