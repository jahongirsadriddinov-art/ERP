import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// ─── Umumiy ────────────────────────────────────────────────────────────────
const SPEEDS = [1, 1.5, 2, 3];
const SPEED_KEY = "erp_mediaSpeed";
const readSpeed = () => { try { const v = Number(localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(v) ? v : 1; } catch { return 1; } };
const saveSpeed = (v: number) => { try { localStorage.setItem(SPEED_KEY, String(v)); } catch { /* */ } };
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
// Telegram kabi: bir vaqtda faqat BITTA ovoz/video ijro etiladi
const PLAY_EVT = "erp:media-play";
const announcePlay = (el: HTMLMediaElement) => window.dispatchEvent(new CustomEvent(PLAY_EVT, { detail: el }));
function usePauseOthers(ref: React.RefObject<HTMLMediaElement>) {
  useEffect(() => {
    const on = (e: Event) => { const el = ref.current; if (el && (e as CustomEvent).detail !== el && !el.paused) el.pause(); };
    window.addEventListener(PLAY_EVT, on);
    return () => window.removeEventListener(PLAY_EVT, on);
  }, [ref]);
}
// Brauzerda yozilgan webm/ogg ovozlarda davomiylik ko'pincha "Infinity" — oxiriga sakratib aniqlanadi
function fixDuration(el: HTMLMediaElement, set: (d: number) => void) {
  if (Number.isFinite(el.duration) && el.duration > 0) { set(el.duration); return; }
  const onUpd = () => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      el.removeEventListener("timeupdate", onUpd);
      set(el.duration);
      el.currentTime = 0;
    }
  };
  el.addEventListener("timeupdate", onUpd);
  el.currentTime = 1e101;
}
const PlayIcon = ({ className = "" }) => <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>;
const PauseIcon = ({ className = "" }) => <svg viewBox="0 0 24 24" fill="currentColor" className={className}><rect x="6" y="4" width="4.5" height="16" rx="1.5" /><rect x="13.5" y="4" width="4.5" height="16" rx="1.5" /></svg>;

// ─── Ovozli xabar (Telegram uslubi) ───────────────────────────────────────
export function VoicePlayer({ src, mine }: { src: string; mine?: boolean }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(readSpeed);
  const [listened, setListened] = useState(false);
  const dragging = useRef(false);
  usePauseOthers(audioRef);

  // Deterministik "to'lqin" naqshi (haqiqiy amplituda emas — og'ir dekodlashsiz)
  const bars = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
    return Array.from({ length: 36 }, (_, i) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const r = (seed >>> 8) / 0xFFFFFF;
      const env = Math.sin(Math.PI * (i + 0.5) / 36) * 0.5 + 0.5; // o'rtasi balandroq
      return 0.18 + r * 0.55 * env + 0.27 * env;
    });
  }, [src]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed]);

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (a.paused) { a.playbackRate = speed; announcePlay(a); a.play().catch(() => {}); setListened(true); }
    else a.pause();
  };
  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next); saveSpeed(next);
  };
  const seekTo = (clientX: number) => {
    const el = waveRef.current, a = audioRef.current;
    if (!el || !a || !duration) return;
    const r = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    a.currentTime = pct * duration;
    setCurrent(a.currentTime);
  };
  // Silliq progress: timeupdate soniyasiga ~4 marta keladi (sakrab-sakrab o'tardi) — o'ynayotganda
  // har kadrda (requestAnimationFrame) to'lqin ustidagi rangli qatlam to'g'ridan-to'g'ri DOM'da suriladi.
  const fillRef = useRef<HTMLDivElement>(null);
  const paint = () => {
    const a = audioRef.current, el = fillRef.current;
    if (!a || !el) return;
    const d = duration || (Number.isFinite(a.duration) ? a.duration : 0);
    const p = d ? Math.min(1, Math.max(0, a.currentTime / d)) : 0;
    el.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)`;
  };
  useEffect(() => {
    paint();
    if (!playing) return;
    let id = 0;
    const loop = () => { paint(); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, current]);
  const shownTime = playing || current > 0 ? fmt(Math.max(0, duration - current)) : fmt(duration);

  const accent = mine ? "bg-white" : "bg-primary";
  return (
    <div className="flex items-center gap-3 min-w-[230px] max-w-[290px] py-1 select-none">
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={e => fixDuration(e.currentTarget, setDuration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={e => { if (!dragging.current && Number.isFinite(e.currentTarget.duration)) setCurrent(e.currentTarget.currentTime); }}
        onEnded={() => { setPlaying(false); setCurrent(0); if (audioRef.current) audioRef.current.currentTime = 0; }} />
      <button onClick={toggle} aria-label={playing ? t('chat.pause') : t('chat.play')}
        className={`relative w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform shadow-lg
          ${mine ? "bg-white text-primary shadow-black/20" : "bg-primary text-white shadow-primary/30"}`}>
        {playing ? <PauseIcon className="w-[18px] h-[18px]" /> : <PlayIcon className="w-[18px] h-[18px] ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div ref={waveRef} className="relative h-8 flex items-center gap-[2px] cursor-pointer touch-none"
          onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekTo(e.clientX); }}
          onPointerMove={e => { if (dragging.current) seekTo(e.clientX); }}
          onPointerUp={e => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}>
          {bars.map((h, i) => (
            <div key={i} className={`flex-1 rounded-full ${mine ? "bg-white/30" : "bg-primary/25"}`}
              style={{ height: `${Math.max(14, Math.round(h * 100))}%` }} />
          ))}
          <div ref={fillRef} aria-hidden className="absolute inset-0 flex items-center gap-[2px] pointer-events-none will-change-[clip-path]"
            style={{ clipPath: "inset(0 100% 0 0)" }}>
            {bars.map((h, i) => (
              <div key={i} className={`flex-1 rounded-full ${accent}`} style={{ height: `${Math.max(14, Math.round(h * 100))}%` }} />
            ))}
          </div>
        </div>
        <div className={`flex items-center gap-2 mt-0.5 text-[11px] font-medium tabular-nums ${mine ? "text-white/80" : "text-muted-foreground"}`}>
          <span>{duration > 0 ? shownTime : "0:00"}</span>
          {!listened && !mine && <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />}
          <button onClick={cycleSpeed} aria-label={`${speed}x`}
            className={`ml-auto px-1.5 py-[1px] rounded-md text-[10px] font-bold leading-4 transition-colors
              ${speed !== 1 ? (mine ? "bg-white text-primary" : "bg-primary text-white") : (mine ? "bg-white/20 text-white" : "bg-primary/15 text-primary")}`}>
            {speed}x
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Video pleyer (maxsus boshqaruv) ──────────────────────────────────────
export function VideoPlayer({ src, className = "", compact, onExpand, autoPlay }: { src: string; className?: string; compact?: boolean; onExpand?: () => void; autoPlay?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(readSpeed);
  const [showUi, setShowUi] = useState(true);
  const [started, setStarted] = useState(!!autoPlay);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  usePauseOthers(ref);
  // Silliq progress chizig'i — o'ynayotganda har kadrda yangilanadi (timeupdate ~4 Hz sakraydi)
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => { const v = ref.current; if (v && !dragging.current) setCurrent(v.currentTime); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);
  const poke = () => {
    setShowUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (ref.current && !ref.current.paused) setShowUi(false); }, 2500);
  };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  const toggle = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    const v = ref.current; if (!v) return;
    if (v.paused) { v.playbackRate = speed; announcePlay(v); v.play().catch(() => {}); setStarted(true); poke(); }
    else { v.pause(); setShowUi(true); }
  };
  const seekTo = (clientX: number) => {
    const el = barRef.current, v = ref.current;
    if (!el || !v || !duration) return;
    const r = el.getBoundingClientRect();
    v.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
    setCurrent(v.currentTime);
  };
  const fullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpand) { ref.current?.pause(); onExpand(); return; }
    const el: any = wrapRef.current;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el);
  };
  const progress = duration ? (current / duration) * 100 : 0;
  const btn = "w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/15 active:scale-90 transition";

  return (
    <div ref={wrapRef} className={`relative overflow-hidden rounded-2xl bg-black group ${className}`}
      onMouseMove={poke} onClick={() => (started ? poke() : toggle())}>
      <video ref={ref} src={src} playsInline preload="metadata" autoPlay={autoPlay}
        className="w-full h-full max-h-[inherit] object-contain bg-black" onClick={toggle}
        onLoadedMetadata={e => fixDuration(e.currentTarget, setDuration)}
        onPlay={() => { setPlaying(true); poke(); }} onPause={() => { setPlaying(false); setShowUi(true); }}
        onTimeUpdate={e => { const v = e.currentTarget; if (!dragging.current) setCurrent(v.currentTime); if (v.buffered.length && duration) setBuffered(v.buffered.end(v.buffered.length - 1) / duration * 100); }}
        onEnded={() => { setPlaying(false); setShowUi(true); }} />

      {/* Markaziy katta tugma */}
      {!playing && (
        <button onClick={toggle} aria-label="Play"
          className={`absolute inset-0 m-auto ${compact ? "w-12 h-12" : "w-16 h-16"} rounded-full bg-black/45 backdrop-blur-md border border-white/25 text-white flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition`}>
          <PlayIcon className={compact ? "w-5 h-5 ml-0.5" : "w-7 h-7 ml-1"} />
        </button>
      )}
      {!started && duration > 0 && (
        <span className="absolute top-2 left-2 text-[11px] font-semibold text-white bg-black/55 backdrop-blur px-2 py-0.5 rounded-full tabular-nums">{fmt(duration)}</span>
      )}

      {/* Pastki boshqaruv paneli */}
      {started && (
        <div className={`absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-8 bg-gradient-to-t from-black/80 via-black/35 to-transparent transition-opacity duration-300 ${showUi ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onClick={e => e.stopPropagation()}>
          <div ref={barRef} className="relative h-4 flex items-center cursor-pointer touch-none"
            onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekTo(e.clientX); }}
            onPointerMove={e => { if (dragging.current) seekTo(e.clientX); }}
            onPointerUp={e => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}>
            <div className="absolute inset-x-0 h-1 rounded-full bg-white/25" />
            <div className="absolute left-0 h-1 rounded-full bg-white/40" style={{ width: `${buffered}%` }} />
            <div className="absolute left-0 h-1 rounded-full bg-primary" style={{ width: `${progress}%` }} />
            <div className="absolute w-3 h-3 rounded-full bg-white shadow -translate-x-1/2" style={{ left: `${progress}%` }} />
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <button onClick={toggle} className={btn} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4 ml-0.5" />}
            </button>
            <span className="text-[11px] text-white/90 font-medium tabular-nums">{fmt(current)} / {fmt(duration)}</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button onClick={e => { e.stopPropagation(); const n = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(n); saveSpeed(n); }}
                className="h-7 px-2 rounded-full text-[11px] font-bold text-white hover:bg-white/15">{speed}x</button>
              <button onClick={e => { e.stopPropagation(); const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }} className={btn} aria-label="Mute">
                {muted
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" /><path d="m17 9 5 6M22 9l-5 6" strokeLinecap="round" /></svg>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" /></svg>}
              </button>
              <button onClick={fullscreen} className={btn} aria-label="Fullscreen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
