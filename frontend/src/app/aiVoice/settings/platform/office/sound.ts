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
    emit();
  },
  subscribe(l: L) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useMuted = () => useSyncExternalStore(sound.subscribe, () => muted, () => true);

// ───────────── O'z qo'shiqlari pleyeri ─────────────
export interface Track { id: string; name: string; url: string }
interface PState { tracks: Track[]; index: number; playing: boolean; volume: number }
let ps: PState = { tracks: [], index: 0, playing: false, volume: 0.6 };
const pl = new Set<L>();
const pemit = () => { ps = { ...ps }; pl.forEach((l) => l()); emit(); };
let audio: HTMLAudioElement | null = null;
const el = () => {
  if (!audio && typeof Audio !== "undefined") {
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => player.next());
    audio.addEventListener("pause", () => { if (ps.playing && audio?.paused && !audio.ended) { ps.playing = false; pemit(); } });
  }
  return audio;
};
export const player = {
  get state() { return ps; },
  subscribe(l: L) { pl.add(l); return () => { pl.delete(l); }; },
  setTracks(t: Track[]) { ps.tracks = t; if (ps.index >= t.length) ps.index = 0; if (!t.length) player.pause(); pemit(); },
  play(i = ps.index) {
    const a = el(); const t = ps.tracks[i];
    if (!a || !t) return;
    if (a.src !== t.url) a.src = t.url;
    ps.index = i; ps.playing = true;
    a.volume = ps.volume; a.muted = muted;
    a.play().catch(() => { ps.playing = false; pemit(); });
    pemit();
  },
  pause() { audio?.pause(); ps.playing = false; pemit(); },
  toggle() { if (ps.playing) player.pause(); else player.play(); },
  next() { if (!ps.tracks.length) return; player.play((ps.index + 1) % ps.tracks.length); },
  setVolume(v: number) { ps.volume = Math.max(0, Math.min(1, v)); if (audio) audio.volume = ps.volume; pemit(); },
  syncMute() { if (audio) audio.muted = muted; },
  stop() { audio?.pause(); if (audio) audio.removeAttribute("src"); ps.playing = false; pemit(); },
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
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(lang)) || voices.find((x) => x.lang.toLowerCase().startsWith(lang === "uz" ? "tr" : "ru"));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang === "uz" ? "uz-UZ" : "ru-RU";
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
