import "../../../../i18n/aiVoiceNs";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProfile, OfficeAgent, Setup } from "./officeApi";
import AgentPanel from "./AgentPanel";
import { Desktop, GameView, type ErpLink } from "./Desktop";
import { newBridge, places, type SeatKind, type Target } from "./walk";
import type { ScreenHub } from "./screens";
import type { OfficeSceneProps } from "./OfficeScene";

// AI ofis — "Ofisga kirish": to'liq ekran (Fullscreen API; bo'lmasa — sahifa ustidagi qatlam), o'yin uslubidagi boshqaruv.
//  Kompyuter: WASD/strelkalar — yurish, Shift — yugurish, sichqoncha — qarash (bosilganda Pointer Lock), E — harakat, V — ko'rinish.
//  Telefon: chap pastda joystik, ekranning qolgan qismini surish — qarash, polga tegish — o'sha joyga borish.
//  Yaqinida: agent → buyruq paneli; puf/divan/stul → o'tirish (kino, Pong, ovqat); kofe mashinasi → choy; o'z stolingiz → kompyuter.
const OfficeScene = lazy(() => import("./OfficeScene"));
type K = (key: string, o?: any) => string;

export default function WalkMode({ agents, profiles, setup, scene, onExit, onChanged, onProfile, onNavigate, erpLinks }: {
  agents: OfficeAgent[]; profiles: AgentProfile[]; setup: Setup | null;
  scene: Pick<OfficeSceneProps, "compact" | "dark" | "zoneNames" | "youLabel" | "showAllLabels">;
  onExit: () => void; onChanged: () => void; onProfile: () => void; onNavigate?: (key: string) => void; erpLinks: ErpLink[];
}) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<Target | null>(null);
  const [seat, setSeat] = useState<SeatKind | null>(null);
  const [talking, setTalking] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const [hub, setHub] = useState<ScreenHub | null>(null);
  const [locked, setLocked] = useState(false);
  const [fp, setFp] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const bridge = useMemo(() => newBridge(() => {}, () => {}), []);
  bridge.onNear = setNear;
  bridge.onSeat = setSeat;
  const touch = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const overlay = !!talking || seat === "computer" || seat === "game";

  // To'liq ekran (bo'lmasa — qatlam baribir butun oynani egallaydi)
  useEffect(() => {
    const el = root.current;
    try { el?.requestFullscreen?.().catch(() => {}); } catch { /* headless / iOS */ }
    let was = false;
    const onFs = () => { if (document.fullscreenElement) was = true; else if (was) onExit(); };
    const onLock = () => setLocked(document.pointerLockElement === el);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("pointerlockchange", onLock);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("pointerlockchange", onLock);
      document.body.style.overflow = prev;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* */ }
      try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* */ }
    };
  }, [onExit]);

  const interact = useCallback(() => {
    if (seat) { bridge.cmds.push({ type: "stand" }); return; }
    if (!near) return;
    if (near.kind === "agent") { setTalking(near.id); try { document.exitPointerLock?.(); } catch { /* */ } }
    else if (near.kind === "seat") bridge.cmds.push({ type: "sit", target: near });
    else { setHolding(true); setNote(k("walk.gotTea")); }
  }, [seat, near, bridge, k]);
  useEffect(() => { if (seat === "computer" || seat === "game") try { document.exitPointerLock?.(); } catch { /* */ } }, [seat]);
  useEffect(() => { if (!note) return; const i = setTimeout(() => setNote(null), 2500); return () => clearTimeout(i); }, [note]);

  // Klaviatura
  useEffect(() => {
    const keys = new Set<string>();
    const upd = () => {
      const i = bridge.input;
      i.mz = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      i.mx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      i.run = keys.has("shift");
    };
    const typing = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable); };
    const kd = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const key = e.key.toLowerCase();
      if (key === "escape") { if (talking) setTalking(null); else if (seat) bridge.cmds.push({ type: "stand" }); else if (!document.pointerLockElement && !document.fullscreenElement) onExit(); return; }
      if (overlay) return;
      if (key === "e") { interact(); e.preventDefault(); return; }
      if (key === "v") { bridge.input.fp = !bridge.input.fp; setFp(bridge.input.fp); return; }
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) { keys.add(key); upd(); e.preventDefault(); }
    };
    const ku = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); upd(); };
    const blur = () => { keys.clear(); upd(); };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur); blur(); };
  }, [bridge, interact, overlay, talking, seat, onExit]);

  // Sichqoncha / barmoq bilan qarash
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (overlay || (e.target as HTMLElement).closest("[data-ui]")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    if (locked) return;
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    bridge.input.lookX += dx * (touch ? 1.6 : 1); bridge.input.lookY += dy * (touch ? 1.2 : 1);
    d.x = e.clientX; d.y = e.clientY;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || overlay) return;
    if (d.moved < 6 && e.pointerType === "mouse" && !locked && !(e.target as HTMLElement).closest("[data-ui]")) {
      try { (root.current as any)?.requestPointerLock?.()?.catch?.(() => {}); } catch { /* */ }
    }
  };
  // Pointer lock paytida harakat (mousemove hujjatda)
  useEffect(() => {
    if (!locked) return;
    const mm = (e: MouseEvent) => { bridge.input.lookX += e.movementX; bridge.input.lookY += e.movementY; };
    document.addEventListener("mousemove", mm);
    return () => document.removeEventListener("mousemove", mm);
  }, [locked, bridge]);

  const sel = talking ? agents.find((a) => a.id === talking) : null;
  const prompt = seat ? k("walk.stand")
    : !near ? null
      : near.kind === "agent" ? k("walk.talk", { name: near.name })
        : near.kind === "tea" ? k("walk.tea")
          : k(`walk.sit.${near.seat}`);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return agents.filter((a) => !s || a.name.toLowerCase().includes(s)).slice(0, 60);
  }, [agents, q]);

  return (
    <div ref={root} className="fixed inset-0 z-[90] bg-[#0f1115] select-none overscroll-none touch-none" data-testid="ai-office-walk"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
      onContextMenu={(e) => e.preventDefault()}>
      <Suspense fallback={null}>
        <OfficeScene agents={agents} selectedId={talking} onSelect={() => {}} resetKey={0} {...scene}
          walk={{ bridge, talkingId: talking, holding }} onHub={setHub} />
      </Suspense>

      {/* Yuqori panel */}
      <div data-ui className="absolute top-2 left-2 right-2 flex items-start gap-2 pointer-events-none" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="pointer-events-auto flex gap-1.5">
          <button type="button" onClick={onExit} data-testid="ai-office-exit" className="h-9 px-3.5 rounded-full bg-black/60 text-white text-[13px] font-semibold backdrop-blur">✕ {k("walk.exit")}</button>
          <button type="button" onClick={() => setMenu((v) => !v)} data-testid="ai-office-goto" aria-expanded={menu} className="h-9 px-3.5 rounded-full bg-black/60 text-white text-[13px] font-semibold backdrop-blur">🧭 {k("walk.goto")}</button>
          {!touch && <button type="button" onClick={() => { bridge.input.fp = !bridge.input.fp; setFp(bridge.input.fp); }} className="h-9 px-3 rounded-full bg-black/60 text-white text-[12px] font-semibold backdrop-blur">{fp ? "1P" : "3P"}</button>}
        </div>
        {!touch && <p className="hidden md:block ml-auto max-w-[460px] text-right text-[11px] text-white/80 bg-black/45 rounded-xl px-3 py-1.5 backdrop-blur">{k("walk.keys")}</p>}
      </div>
      {menu && (
        <div data-ui className="absolute top-14 left-2 w-[min(320px,calc(100vw-16px))] max-h-[min(70vh,560px)] flex flex-col rounded-2xl bg-card text-foreground border border-border shadow-2xl z-30" data-testid="ai-office-goto-menu">
          <div className="p-2 border-b border-border">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={k("search")} className="w-full h-9 rounded-xl border border-border bg-background px-3 text-sm" data-testid="ai-office-goto-search" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
            {!q && places().map((p) => (
              <button key={p.key} type="button" data-testid={`ai-office-goto-place-${p.key}`}
                onClick={() => { bridge.cmds.push({ type: "goto", key: p.key, x: p.x, z: p.z, face: p.face }); setMenu(false); }}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-muted">📍 {p.key === "computer" ? k("zones.owner") : k(`zones.${p.zone}`)}</button>
            ))}
            {list.map((a) => (
              <button key={a.id} type="button" data-testid={`ai-office-goto-agent-${a.id}`}
                onClick={() => { bridge.cmds.push({ type: "gotoAgent", id: a.id }); setMenu(false); setQ(""); }}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-muted flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} />{a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Harakat taklifi */}
      {prompt && !overlay && (
        <div data-ui className="absolute left-1/2 -translate-x-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] md:bottom-8 z-20">
          <button type="button" onClick={interact} data-testid="ai-office-interact"
            className="h-12 pl-2 pr-5 rounded-full bg-white text-[#1f2328] shadow-2xl font-semibold text-[14px] inline-flex items-center gap-2.5">
            {!touch && <kbd className="w-8 h-8 rounded-full bg-[#1f2328] text-white grid place-items-center text-[13px] font-bold">E</kbd>}
            {touch && <span className="w-8 h-8 rounded-full bg-[#D97757] text-white grid place-items-center">✋</span>}
            {prompt}
          </button>
        </div>
      )}
      {note && <div className="absolute left-1/2 -translate-x-1/2 top-16 z-20 px-4 py-2 rounded-full bg-black/70 text-white text-[13px]" data-testid="ai-office-note">{note}</div>}
      {seat === "cinema" && <div className="absolute left-1/2 -translate-x-1/2 top-16 z-20 px-4 py-2 rounded-full bg-black/60 text-white text-[12px]">🎬 {k("walk.movie")}</div>}
      {!locked && !touch && !overlay && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="w-1.5 h-1.5 rounded-full bg-white/70" /></div>}

      {touch && !overlay && <Joystick onMove={(x, z) => { bridge.input.mx = x; bridge.input.mz = z; bridge.input.run = Math.hypot(x, z) > 0.92; }} />}

      {/* Agent bilan suhbat — buyruq paneli */}
      {sel && (
        <div data-ui className="absolute z-40 right-0 top-0 bottom-0 w-full sm:w-[420px] bg-card text-foreground border-l border-border shadow-2xl overflow-y-auto overscroll-contain" data-testid="ai-office-walk-panel">
          <AgentPanel key={sel.id} agent={sel} profile={profiles.find((p) => p.key === sel.id)} profiles={profiles} setup={setup}
            onClose={() => setTalking(null)} onChanged={onChanged} onProfile={onProfile} onOpenAgent={(id) => setTalking(id)} />
        </div>
      )}
      {seat === "computer" && (
        <div data-ui className="absolute inset-0 z-40">
          <Desktop pong={hub?.pong || null} links={erpLinks} onClose={() => bridge.cmds.push({ type: "stand" })}
            onLink={(key) => { onExit(); onNavigate?.(key); }} />
        </div>
      )}
      {seat === "game" && (
        <div data-ui className="absolute inset-0 z-40 grid place-items-center p-3 bg-black/50">
          <div className="w-full max-w-[760px] aspect-[16/10] max-h-full flex flex-col">
            <GameView pong={hub?.pong || null} k={k} big />
            <button type="button" onClick={() => bridge.cmds.push({ type: "stand" })} className="mt-2 self-center h-9 px-4 rounded-full bg-white text-[#1f2328] text-[13px] font-semibold">{k("walk.stand")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ekrandagi joystik (telefon): chap pastda; markazdan og'ish → harakat yo'nalishi. */
function Joystick({ onMove }: { onMove: (x: number, z: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const R = 52;
  const upd = (e: React.PointerEvent) => {
    const b = base.current!.getBoundingClientRect();
    let dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    setKnob({ x: dx, y: dy });
    onMove(dx / R, -dy / R);
  };
  const end = () => { id.current = null; setKnob({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div data-ui ref={base} data-testid="ai-office-joystick"
      className="absolute z-20 left-[max(1rem,env(safe-area-inset-left))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] w-[128px] h-[128px] rounded-full bg-white/15 border border-white/30 backdrop-blur touch-none"
      onPointerDown={(e) => { e.stopPropagation(); id.current = e.pointerId; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); upd(e); }}
      onPointerMove={(e) => { e.stopPropagation(); if (id.current === e.pointerId) upd(e); }}
      onPointerUp={(e) => { e.stopPropagation(); end(); }} onPointerCancel={end}>
      <div className="absolute left-1/2 top-1/2 w-14 h-14 -ml-7 -mt-7 rounded-full bg-white/80 shadow-lg" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
