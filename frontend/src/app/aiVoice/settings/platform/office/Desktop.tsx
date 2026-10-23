import "../../../../i18n/aiVoiceNs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, type Tone } from "../../ui";
import { officeApi, type AgentTask, type TaskStatus } from "./officeApi";
import type { Pong } from "./screens";
import { beep } from "./sound";

// AI ofis — egasining kompyuteri ("Mening ofisim" stolida o'tirganda ochiladi): ish stoli uslubidagi oyna va ilovalar —
// Claude (Boshliqqa buyruq), Vazifalar, O'yin (Pong — TV'dagi bilan bir xil), ERP yorliqlari (chiqqandan keyin ochiladi).
type K = (key: string, o?: any) => string;
const STATUS_TONE: Record<TaskStatus, Tone> = { queued: "gray", review: "amber", running: "sky", done: "green", failed: "red", cancelled: "gray" };
export interface ErpLink { key: string; label: string }

export function Desktop({ pong, links, onLink, onClose }: { pong: Pong | null; links: ErpLink[]; onLink: (key: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const [app, setApp] = useState<"claude" | "tasks" | "game" | "erp">("claude");
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setClock(new Date()), 15_000); return () => clearInterval(i); }, []);
  const apps = [
    { key: "claude" as const, icon: "✳", label: "Claude" },
    { key: "tasks" as const, icon: "☰", label: k("pc.tasks") },
    { key: "game" as const, icon: "🎮", label: k("pc.game") },
    ...(links.length ? [{ key: "erp" as const, icon: "🏗", label: "ERP" }] : []),
  ];
  return (
    <div className="absolute inset-0 z-40 grid place-items-center p-2 sm:p-6 bg-black/40 backdrop-blur-sm" data-testid="ai-office-pc">
      <div className="w-full max-w-[880px] h-full max-h-[600px] rounded-2xl overflow-hidden border-[6px] border-[#1c1e23] shadow-2xl flex flex-col"
        style={{ background: "linear-gradient(135deg,#2b1d3a 0%,#1d2b4a 55%,#18383a 100%)" }}>
        <div className="flex-1 min-h-0 flex">
          <div className="w-[76px] sm:w-[92px] flex-shrink-0 p-2 flex flex-col gap-2">
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
            {app === "game" && <GameView pong={pong} k={k} />}
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

/** Pong: TV'dagi bilan bitta canvas (bir xil o'yin). Boshqaruv: W/S yoki ↑/↓, telefonda — tugmalar yoki barmoq bilan surish. */
export function GameView({ pong, k, big = false }: { pong: Pong | null; k: K; big?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    if (!pong || !host.current) return;
    const c = pong.canvas;
    c.style.width = "100%"; c.style.height = "100%"; c.style.objectFit = "contain"; c.style.imageRendering = "pixelated";
    host.current.appendChild(c);
    pong.playing = true; pong.input = 0; pong.score = [0, 0]; pong.onHit = () => beep(520 + Math.random() * 200);
    const keys = new Set<string>();
    const upd = () => { pong.input = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0); };
    const kd = (e: KeyboardEvent) => { const key = e.key.toLowerCase(); if (["w", "s", "arrowup", "arrowdown"].includes(key)) { keys.add(key); upd(); e.preventDefault(); e.stopPropagation(); } };
    const ku = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); upd(); };
    window.addEventListener("keydown", kd, true);
    window.addEventListener("keyup", ku, true);
    const i = setInterval(() => setScore([...pong.score] as [number, number]), 250);
    return () => {
      window.removeEventListener("keydown", kd, true); window.removeEventListener("keyup", ku, true); clearInterval(i);
      pong.playing = false; pong.input = null; pong.onHit = null;
      if (c.parentElement === host.current) host.current?.removeChild(c);
    };
  }, [pong]);
  const drag = useRef<number | null>(null);
  const hold = (v: number) => () => { if (pong) pong.input = v; };
  return (
    <div className={`flex-1 min-h-0 flex flex-col bg-[#070b1a] ${big ? "rounded-2xl overflow-hidden" : ""}`} data-testid="ai-office-game">
      <div ref={host} className="flex-1 min-h-0 touch-none"
        onPointerDown={(e) => { drag.current = e.clientY; }}
        onPointerMove={(e) => { if (drag.current !== null && pong) { const d = e.clientY - drag.current; pong.input = Math.max(-1, Math.min(1, d / 30)); } }}
        onPointerUp={() => { drag.current = null; if (pong) pong.input = 0; }} />
      <div className="flex items-center gap-2 p-2 text-white/90 text-[12px]">
        <button type="button" onPointerDown={hold(-1)} onPointerUp={hold(0)} onPointerLeave={hold(0)} className="w-11 h-11 rounded-xl bg-white/15 text-lg">▲</button>
        <button type="button" onPointerDown={hold(1)} onPointerUp={hold(0)} onPointerLeave={hold(0)} className="w-11 h-11 rounded-xl bg-white/15 text-lg">▼</button>
        <span className="ml-2">{k("pc.gameHint")}</span>
        <span className="ml-auto font-mono font-bold text-base tabular-nums" data-testid="ai-office-game-score">{score[0]} : {score[1]}</span>
      </div>
    </div>
  );
}
