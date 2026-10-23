import "../../../../i18n/aiVoiceNs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, type Tone } from "../../ui";
import { officeApi, type AgentTask, type TaskStatus } from "./officeApi";
import type { ScreenHub } from "./screens";
import { beep } from "./sound";
import { GAME_IDS, hiscore, type Dir, type GameId } from "./games";
import { MediaPanel } from "./MediaPanel";
import { mediaStore, useMedia } from "./mediaStore";
import { fmtSize } from "./localMedia";

// AI ofis — egasining kompyuteri ("Mening ofisim" stolida o'tirganda ochiladi): ish stoli uslubidagi oyna va ilovalar —
// Claude (Boshliqqa buyruq), Vazifalar, Musiqa, Kino, Fayllar, O'yinlar (TV'dagi bilan bir xil canvas), ERP yorliqlari.
type K = (key: string, o?: any) => string;
const STATUS_TONE: Record<TaskStatus, Tone> = { queued: "gray", review: "amber", running: "sky", done: "green", failed: "red", cancelled: "gray" };
export interface ErpLink { key: string; label: string }

type App = "claude" | "tasks" | "music" | "cinema" | "files" | "game" | "erp";
export function Desktop({ hub, links, onLink, onClose }: { hub: ScreenHub | null; links: ErpLink[]; onLink: (key: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const [app, setApp] = useState<App>("claude");
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setClock(new Date()), 15_000); return () => clearInterval(i); }, []);
  const apps = [
    { key: "claude" as const, icon: "✳", label: "Claude" },
    { key: "tasks" as const, icon: "☰", label: k("pc.tasks") },
    { key: "music" as const, icon: "🎵", label: k("media.music") },
    { key: "cinema" as const, icon: "🎬", label: k("media.cinema") },
    { key: "files" as const, icon: "📁", label: k("pc.files") },
    { key: "game" as const, icon: "🎮", label: k("pc.game") },
    ...(links.length ? [{ key: "erp" as const, icon: "🏗", label: "ERP" }] : []),
  ];
  return (
    <div className="absolute inset-0 z-40 grid place-items-center p-2 sm:p-6 bg-black/40 backdrop-blur-sm" data-testid="ai-office-pc">
      <div className="w-full max-w-[880px] h-full max-h-[600px] rounded-2xl overflow-hidden border-[6px] border-[#1c1e23] shadow-2xl flex flex-col"
        style={{ background: "linear-gradient(135deg,#2b1d3a 0%,#1d2b4a 55%,#18383a 100%)" }}>
        <div className="flex-1 min-h-0 flex">
          <div className="w-[76px] sm:w-[92px] flex-shrink-0 p-2 flex flex-col gap-1.5 overflow-y-auto scrollbar-hide">
            {apps.map((a) => (
              <button key={a.key} type="button" onClick={() => setApp(a.key)} data-testid={`ai-office-pc-app-${a.key}`} aria-pressed={app === a.key}
                className={`rounded-xl py-2 flex flex-col items-center gap-1 text-[11px] font-semibold text-white/90 ${app === a.key ? "bg-white/20" : "hover:bg-white/10"}`}>
                <span className="w-9 h-9 rounded-lg grid place-items-center text-lg" style={{ background: a.key === "claude" ? "#D97757" : "rgba(255,255,255,.14)" }}>{a.icon}</span>
                <span className="truncate max-w-full">{a.label}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 m-2 ml-0 rounded-xl bg-card text-foreground overflow-hidden flex flex-col">
            {app === "claude" && <ClaudeApp k={k} />}
            {app === "tasks" && <TasksApp k={k} />}
            {app === "game" && <GameView hub={hub} k={k} />}
            {(app === "music" || app === "cinema") && <PcMedia app={app} k={k} />}
            {app === "files" && <FilesApp k={k} />}
            {app === "erp" && (
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2 content-start overflow-y-auto" data-testid="ai-office-pc-erp">
                <p className="col-span-full text-xs text-muted-foreground">{k("pc.erpHint")}</p>
                {links.map((l) => (
                  <button key={l.key} type="button" onClick={() => onLink(l.key)} data-testid={`ai-office-pc-link-${l.key}`}
                    className="rounded-xl border border-border px-3 py-3 text-[13px] font-semibold text-left hover:bg-muted">{l.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="h-9 flex-shrink-0 bg-black/45 flex items-center gap-2 px-3 text-white/90 text-[12px]">
          <span className="font-bold">QurilishERP OS</span>
          <span className="ml-auto tabular-nums">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <button type="button" onClick={onClose} data-testid="ai-office-pc-close" className="h-7 px-3 rounded-full bg-white/15 hover:bg-white/25 font-semibold">{k("walk.stand")}</button>
        </div>
      </div>
    </div>
  );
}

function ClaudeApp({ k }: { k: K }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await officeApi.tasks("manager", 8);
    if (r.ok && r.data) setTasks(r.data.tasks);
  }, []);
  useEffect(() => { load(); const i = setInterval(() => { if (!document.hidden) load(); }, 5_000); return () => clearInterval(i); }, [load]);
  const send = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true); setMsg(null);
    const r = await officeApi.createTask("manager", v);
    setBusy(false);
    if (r.ok) { setText(""); setMsg(k("command.sent")); load(); } else setMsg(k("errors.generic"));
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="ai-office-pc-claude">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg grid place-items-center text-white text-sm" style={{ background: "#D97757" }}>✳</span>
        <div className="min-w-0"><p className="text-[13px] font-bold leading-tight">Claude → {k("pc.manager")}</p><p className="text-[11px] text-muted-foreground leading-tight truncate">{k("command.manager")}</p></div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2" data-testid="ai-office-pc-tasks">
        {!tasks.length && <p className="text-xs text-muted-foreground">{k("empty")}</p>}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-xl border border-border px-3 py-2">
            <div className="flex items-center gap-2"><p className="text-[12.5px] font-semibold flex-1 min-w-0 truncate">{t.text}</p><Badge tone={STATUS_TONE[t.status]}>{k(`status.${t.status}`)}</Badge></div>
            {t.summary && <p className="text-[11.5px] text-muted-foreground mt-1">{t.summary}</p>}
            {!!t.plan?.length && <p className="text-[11px] text-muted-foreground mt-1">{t.plan.map((p) => `• ${p.agentKey}: ${p.text}`).join("  ")}</p>}
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-border flex gap-2 items-end">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} placeholder={k("command.placeholder")} data-testid="ai-office-pc-input"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <button type="button" onClick={send} disabled={busy || !text.trim()} data-testid="ai-office-pc-send"
          className="h-10 px-4 rounded-full text-white text-[13px] font-semibold disabled:opacity-50" style={{ background: "#D97757" }}>{k("command.send")}</button>
      </div>
      {msg && <p className="px-3 pb-2 text-[11.5px] text-muted-foreground" data-testid="ai-office-pc-msg">{msg}</p>}
    </div>
  );
}

function TasksApp({ k }: { k: K }) {
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  useEffect(() => { officeApi.tasks(undefined, 30).then((r) => setTasks(r.ok && r.data ? r.data.tasks : [])); }, []);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
      <p className="text-[13px] font-bold">{k("board")}</p>
      {tasks === null ? <p className="text-xs text-muted-foreground">…</p> : !tasks.length ? <p className="text-xs text-muted-foreground">{k("empty")}</p> : tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
          <span className="text-[11px] font-mono text-muted-foreground w-24 truncate">{t.agentKey}</span>
          <span className="text-[12px] flex-1 min-w-0 truncate">{t.text}</span>
          <Badge tone={STATUS_TONE[t.status]}>{k(`status.${t.status}`)}</Badge>
        </div>
      ))}
    </div>
  );
}

function PcMedia({ app, k }: { app: "music" | "cinema"; k: K }) {
  useEffect(() => { mediaStore.setTab(app); }, [app]);
  return <div className="flex-1 min-h-0"><MediaPanel k={k} embedded /></div>;
}

/** Fayllar: serverdagi qo'shiqlar, shu kompyuterdagi qo'shiq/videolar, kino havolasi — o'chirish. */
function FilesApp({ k }: { k: K }) {
  const m = useMedia();
  const media = m.media;
  const row = "flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5";
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-testid="ai-office-pc-files">
      <p className="text-[13px] font-bold">☁ {k("pc.onServer")}</p>
      {!media?.tracks.length && !media?.cinema && <p className="text-xs text-muted-foreground">{k("empty")}</p>}
      {media?.tracks.map((t) => (
        <div key={t.id} className={row}><span>🎵</span><span className="flex-1 min-w-0 truncate text-[12.5px]">{t.name}</span>
          <button type="button" onClick={() => mediaStore.save({ tracks: media.tracks.filter((x) => x.id !== t.id) })} className="w-7 h-7 rounded-full hover:bg-muted" aria-label={k("actions.remove")}>✕</button></div>
      ))}
      {media?.cinema && (
        <div className={row}><span>🎬</span><span className="flex-1 min-w-0 truncate text-[12.5px]">{media.cinema}</span>
          <button type="button" onClick={() => mediaStore.save({ cinema: "" })} className="w-7 h-7 rounded-full hover:bg-muted" aria-label={k("actions.remove")}>✕</button></div>
      )}
      <p className="text-[13px] font-bold">💻 {k("pc.onThisPc")}</p>
      {!m.local.length && <p className="text-xs text-muted-foreground">{k("empty")}</p>}
      {m.local.map((f) => (
        <div key={f.id} className={row} data-testid={`ai-office-file-${f.id}`}><span>{f.kind === "audio" ? "🎵" : "🎬"}</span>
          <span className="flex-1 min-w-0 truncate text-[12.5px]">{f.name}</span><span className="text-[11px] text-muted-foreground">{fmtSize(f.size)}</span>
          <button type="button" onClick={() => mediaStore.removeLocal(f.id)} className="w-7 h-7 rounded-full hover:bg-muted" aria-label={k("actions.remove")}>✕</button></div>
      ))}
    </div>
  );
}

const GAME_ICON: Record<GameId, string> = { pong: "🏓", snake: "🐍", blocks: "🧱", g2048: "🔢", breakout: "🧨", racer: "🏎", ttt: "❌⭕" };
/**
 * Mini-o'yinlar: TV'dagi bilan bitta canvas (PlayStation'da o'ynalsa TV'da ham ko'rinadi). Boshqaruv: strelkalar/WASD,
 * Space/Enter — A; telefonda — D-pad + A, canvas'ni surish (yo'nalish) yoki tegish (X-O).
 */
export function GameView({ hub, k, big = false }: { hub: ScreenHub | null; k: K; big?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [id, setId] = useState<GameId>(() => hub?.tvGame || "pong");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  useEffect(() => {
    if (!hub || !host.current) return;
    hub.setTvGame(id);
    const g = hub.game(id);
    const c = g.canvas;
    c.style.width = "100%"; c.style.height = "100%"; c.style.objectFit = "contain"; c.style.imageRendering = "pixelated";
    host.current.innerHTML = "";
    host.current.appendChild(c);
    g.playing = true; g.reset(); g.onHit = () => beep(480 + Math.random() * 240);
    const inp = hub.input;
    inp.dirs = []; inp.x = 0; inp.y = 0;
    const keys = new Set<string>();
    const map: Record<string, Dir> = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
    const upd = () => {
      inp.x = (keys.has("arrowright") || keys.has("d") ? 1 : 0) - (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
      inp.y = (keys.has("arrowdown") || keys.has("s") ? 1 : 0) - (keys.has("arrowup") || keys.has("w") ? 1 : 0);
    };
    const kd = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const key = e.key.toLowerCase();
      if (map[key]) { if (!keys.has(key)) inp.dirs.push(map[key]); keys.add(key); upd(); e.preventDefault(); e.stopPropagation(); }
      else if (key === " " || key === "enter") { inp.a = true; e.preventDefault(); e.stopPropagation(); }
    };
    const ku = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); upd(); };
    window.addEventListener("keydown", kd, true);
    window.addEventListener("keyup", ku, true);
    setBest(hiscore.get(id));
    const i = setInterval(() => { setScore(g.score); setBest(hiscore.get(id)); }, 300);
    return () => {
      window.removeEventListener("keydown", kd, true); window.removeEventListener("keyup", ku, true); clearInterval(i);
      g.playing = false; g.onHit = null; inp.x = 0; inp.y = 0; inp.dirs = [];
      if (c.parentElement === host.current) host.current?.removeChild(c);
    };
  }, [hub, id]);
  const sw = useRef<{ x: number; y: number; t: number } | null>(null);
  const press = (d: Dir) => () => { if (hub) hub.input.dirs.push(d); };
  const hold = (x: number, y: number) => () => { if (hub) { hub.input.x = x; hub.input.y = y; } };
  const btn = "w-11 h-11 rounded-xl bg-white/15 text-white text-lg active:bg-white/30 select-none";
  return (
    <div className={`flex-1 min-h-0 flex flex-col bg-[#070b1a] ${big ? "rounded-2xl overflow-hidden" : ""}`} data-multi-tap data-testid="ai-office-game">
      <div className="flex gap-1 p-1.5 overflow-x-auto scrollbar-hide flex-shrink-0">
        {GAME_IDS.map((g) => (
          <button key={g} type="button" onClick={() => setId(g)} aria-pressed={id === g} data-testid={`ai-office-game-${g}`}
            className={`h-8 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${id === g ? "bg-white text-[#070b1a]" : "bg-white/10 text-white/85"}`}>
            {GAME_ICON[g]} {k(`games.${g}`)}
          </button>
        ))}
      </div>
      <div ref={host} className="flex-1 min-h-0 touch-none"
        onPointerDown={(e) => { sw.current = { x: e.clientX, y: e.clientY, t: performance.now() }; }}
        onPointerUp={(e) => {
          const s0 = sw.current; sw.current = null;
          if (!s0 || !hub) return;
          const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
          if (Math.hypot(dx, dy) < 12) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            // canvas "contain" — 320x192 nisbatda; tegish koordinatasi o'yin maydoniga
            const scale = Math.min(r.width / 320, r.height / 192), w = 320 * scale, h = 192 * scale;
            hub.input.tap = { x: (e.clientX - r.left - (r.width - w) / 2) / w, y: (e.clientY - r.top - (r.height - h) / 2) / h };
            hub.input.a = true;
          } else hub.input.dirs.push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
        }} />
      <div className="flex items-center gap-1.5 p-2 text-white/90 text-[12px] flex-shrink-0">
        <div className="grid grid-cols-3 gap-1">
          <span /><button type="button" className={btn} onPointerDown={() => { press("up")(); hold(0, -1)(); }} onPointerUp={hold(0, 0)} onPointerLeave={hold(0, 0)} aria-label="up">▲</button><span />
          <button type="button" className={btn} onPointerDown={() => { press("left")(); hold(-1, 0)(); }} onPointerUp={hold(0, 0)} onPointerLeave={hold(0, 0)} aria-label="left">◀</button>
          <button type="button" className={btn} onPointerDown={() => { press("down")(); hold(0, 1)(); }} onPointerUp={hold(0, 0)} onPointerLeave={hold(0, 0)} aria-label="down">▼</button>
          <button type="button" className={btn} onPointerDown={() => { press("right")(); hold(1, 0)(); }} onPointerUp={hold(0, 0)} onPointerLeave={hold(0, 0)} aria-label="right">▶</button>
        </div>
        <button type="button" className="w-14 h-14 rounded-full bg-[#e5484d] text-white font-bold ml-2" onPointerDown={() => { if (hub) hub.input.a = true; }} data-testid="ai-office-game-a">A</button>
        <div className="ml-auto text-right">
          <p className="font-mono font-bold text-base tabular-nums" data-testid="ai-office-game-score">{score}</p>
          <p className="text-[11px] text-white/60">{k("pc.best")}: <span data-testid="ai-office-game-best">{best}</span></p>
          <p className="text-[10.5px] text-white/50 hidden sm:block">{k("pc.gameHint")}</p>
        </div>
      </div>
    </div>
  );
}
