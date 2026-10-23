import "../../../../i18n/aiVoiceNs";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Crown from "@hugeicons/core-free-icons/CrownIcon";
import Tag from "@hugeicons/core-free-icons/Tag01Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Reset from "@hugeicons/core-free-icons/Target02Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import { isNotReady } from "../../api";
import { Notice, Skeleton } from "../../ui";
import { officeApi, TEAMS, type AgentProfile, type OfficeAgent, type Setup } from "./officeApi";
import AgentPanel, { NewAgentForm, activityTone, agoText } from "./AgentPanel";
import type { ErpLink } from "./Desktop";
import { MediaHost, MuteButton } from "./MediaPanel";
import WeatherChip, { useOfficeWeather } from "./WeatherChip";
import { currentMovie, mediaStore, useMedia as useMediaState, youtubeThumb } from "./mediaStore";
import { useMuted, usePlayer } from "./sound";
import { assignIdle, computeLayout } from "./layout";

// Dasturchi paneli → "AI ofis" (owner 2026-10-22/23). Butun ko'rinish BITTA ekranga sig'adi (sahifa skrolisiz):
//  • kompyuterda — chapda 3D sahna (flex-1), o'ngda panel: jamoalar bo'yicha agentlar ro'yxati (qidiruv bilan) yoki tanlangan
//    agentning buyruq paneli / vazifalari — panel o'zi ichida skrol bo'ladi;
//  • telefonda — tepada sahna (~46%), pastda o'sha panel (ichki skrol).
// "Ofisga kirish" — to'liq ekranli yurish rejimi (WalkMode). 3D sahna (three.js) alohida lazy chunk'larda.
const OfficeScene = lazy(() => import("./OfficeScene"));
const WalkMode = lazy(() => import("./WalkMode"));
const HINT_KEY = "aiOffice.hint.v2";

const ZONES = ["lead", "dev", "call", "design", "secqa", "marketing", "finance", "support", "kitchen", "game", "cinema", "lounge", "owner"];

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const useMedia = (q: string) => {
  const [m, setM] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [q]);
  return m;
};
/** Ilova mavzusi (html.dark) — sahna foni shunga mos. */
const useDark = () => {
  const [d, setD] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setD(el.classList.contains("dark")));
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return d;
};
/** Agent hozir nima qilyapti — ro'yxat uchun (sahnadagi bilan bir xil: bo'sh agentning dam olish joyi assignIdle'dan). */
export function doingText(a: OfficeAgent, poiKind: string | undefined, k: (key: string, o?: any) => string): string {
  const task = a.task?.text || "";
  if (a.activity === "task") return a.id === "manager" ? k("doing.plan", { t: task }) : a.kind === "code" ? k("doing.code", { t: task }) : k("doing.write", { t: task });
  if (a.activity === "call") return k("doing.call");
  if (a.activity === "chat") return k("doing.chat");
  if (a.activity === "review") return k("doing.review", { t: task });
  if (poiKind) return k(`doing.${poiKind}`);
  return k("doing.desk");
}
const readHint = () => { try { return localStorage.getItem(HINT_KEY) !== "1"; } catch { return true; } };

export default function AiOffice({ fill = false, onNavigate, erpLinks = [], externalHost = false }: {
  /** Musiqa/kino pleyeri (MediaHost) ota panel ildizida o'rnatilgan — tab almashganda ham to'xtamaydi. */
  externalHost?: boolean;
  /** Ota konteyner balandligini to'liq egallash (Dasturchi paneli: flex-1 min-h-0). Aks holda — ekran balandligidan hisoblanadi. */
  fill?: boolean;
  /** Kompyuterdagi "ERP" yorliqlari bosilganda (yurish rejimidan chiqib) — ota panel bo'limini ochadi. */
  onNavigate?: (key: string) => void;
  erpLinks?: ErpLink[];
}) {
  const { t } = useTranslation();
  const k = useCallback((key: string, o?: any) => t(`aiVoice.office.${key}`, o) as string, [t]);
  const [agents, setAgents] = useState<OfficeAgent[] | null>(null);
  const [state, setState] = useState<"ok" | "err" | "nr">("ok");
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [hint, setHint] = useState(readHint);
  const [lost, setLost] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [walking, setWalking] = useState(false);
  const mm = useMediaState();
  const wx = useOfficeWeather();
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [speech, setSpeech] = useState<{ id: string; text: string } | null>(null);
  const muted = useMuted();
  const ps = usePlayer();
  const compact = useMedia("(max-width: 640px)");
  const wide = useMedia("(min-width: 1024px)");
  const dark = useDark();
  const webgl = useMemo(hasWebGL, []);
  const sideRef = useRef<HTMLDivElement>(null);

  const loadOffice = useCallback(async () => {
    const r = await officeApi.office();
    if (r.ok && r.data?.agents) { setAgents(r.data.agents); setState("ok"); }
    else setState(isNotReady(r) ? "nr" : "err");
  }, []);
  const loadProfiles = useCallback(async () => {
    const r = await officeApi.agents();
    if (r.ok && r.data) { setProfiles(r.data.agents || []); setSetup(r.data.setup || null); }
  }, []);

  useEffect(() => { void mediaStore.load(); }, []);
  useEffect(() => {
    loadOffice();
    loadProfiles();
    const tick = () => { if (!document.hidden) loadOffice(); };
    const id = setInterval(tick, 5_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [loadOffice, loadProfiles]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    if (id) { setAdding(false); sideRef.current?.scrollTo?.({ top: 0 }); }
  }, []);
  const changed = useCallback(() => { loadOffice(); loadProfiles(); }, [loadOffice, loadProfiles]);
  /** Ro'yxatdan tanlash — kamera agentga uchadi ("topish"). */
  const locate = useCallback((id: string) => { select(id); setFocus((f) => ({ id, n: (f?.n || 0) + 1 })); }, [select]);
  const onSpeak = useCallback((id: string) => (text: string | null) => setSpeech(text ? { id, text } : null), []);
  // Owner 2026-10-23: Esc bilan chiqqanda sahna "grafika xotirasi tozalandi" bo'lib qolardi — yurish rejimining
  // alohida 3D konteksti hali yopilmasdan asosiy sahna yangisini ochardi. Endi asosiy sahna ~0.7 s keyin ochiladi.
  const [settling, setSettling] = useState(false);
  const exitWalk = useCallback(() => {
    setWalking(false); setSettling(true);
    setTimeout(() => setSettling(false), 700);
  }, []);
  // WebGL konteksti yo'qolsa — avval brauzer o'zi qaytarishini kutamiz (odatda 1–3 s); qaytmasa (yoki 2-marta) — qo'lda qayta yuklash
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lostCount = useRef(0);
  const autoRemounts = useRef<number[]>([]);
  const lostCb = useCallback(() => {
    lostCount.current++;
    if (lostTimer.current) clearTimeout(lostTimer.current);
    lostTimer.current = setTimeout(() => {
      // Brauzer qaytarmadi — sahnani o'zimiz qayta yaratamiz (30 s ichida ko'pi bilan 3 marta), keyin qo'lda tugma
      const now = Date.now();
      autoRemounts.current = autoRemounts.current.filter((t) => now - t < 30_000);
      if (autoRemounts.current.length < 3) { autoRemounts.current.push(now); lostCount.current = 0; setSceneKey((n) => n + 1); return; }
      setLost(true);
    }, 1500);
  }, []);
  const restoredCb = useCallback(() => { if (lostTimer.current) clearTimeout(lostTimer.current); setLost(false); }, []);
  useEffect(() => () => { if (lostTimer.current) clearTimeout(lostTimer.current); }, []);
  const dismissHint = () => { setHint(false); try { localStorage.setItem(HINT_KEY, "1"); } catch { /* */ } };

  const sel = agents?.find((a) => a.id === selected) || null;
  const profile = sel ? profiles.find((p) => p.key === sel.id) : undefined;
  const count = (f: (a: OfficeAgent) => boolean) => (agents || []).filter(f).length;
  const byTeam = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = new Map<string, OfficeAgent[]>();
    for (const a of agents || []) {
      if (q && !a.name.toLowerCase().includes(q) && !(a.task?.text || "").toLowerCase().includes(q)) continue;
      const team = TEAMS.includes(a.team as any) ? a.team : "growth";
      if (!m.has(team)) m.set(team, []);
      m.get(team)!.push(a);
    }
    return TEAMS.filter((x) => m.has(x)).map((x) => [x, m.get(x)!] as const);
  }, [agents, query]);
  // Bo'sh agentlar qayerda (sahnadagi bilan bir xil hisob)
  const layoutKey = (agents || []).map((a) => `${a.id}:${a.team}:${a.kind}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout((agents || []).map((a) => ({ id: a.id, team: a.team, kind: a.kind }))), [layoutKey]);
  const slot = Math.floor(Date.now() / 45_000);
  const poiKind = useMemo(() => {
    const list = agents || [];
    const idle = list.filter((a) => a.activity === "idle" && !(a.id === "manager" && list.some((x) => x.busy && x.id !== "manager"))).map((a) => a.id);
    const m = assignIdle(idle, layout.pois, slot);
    return new Map([...m.entries()].map(([id, i]) => [id, layout.pois[i].kind as string]));
  }, [agents, layout, slot]);
  const movie = currentMovie(mm);
  const cinemaSrc = movie?.kind === "file" ? movie.src : null;
  const cinemaThumb = youtubeThumb(movie);
  const musicOn = ps.playing || (mm.yandexOn && !muted);
  const zoneNames = useMemo(() => Object.fromEntries(ZONES.map((z) => [z, k(`zones.${z}`)])), [k]);

  if (state === "nr") return <Notice tone="lock" testId="ai-office-nr">{k("notReady")}</Notice>;

  const sceneBg = dark
    ? "radial-gradient(120% 90% at 50% 0%, #2a2f3a 0%, #1b1f27 60%, #14171d 100%)"
    : "radial-gradient(120% 90% at 50% 0%, #f7f3ee 0%, #ece6de 60%, #e2d9ce 100%)";
  const height = fill ? "flex-1 min-h-0" : "h-[calc(100dvh-7rem)] min-h-[520px]";

  return (
    <div className={`flex flex-col gap-2 ${height}`} data-testid="ai-office">
      {/* Asboblar qatori — bitta qator (telefonda gorizontal skrol) */}
      <div className="relative flex-shrink-0 flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <div className="hidden lg:block flex-shrink-0 mr-1">
          <p className="text-sm font-bold leading-tight">{k("title")}</p>
          <p className="text-[11px] text-muted-foreground leading-tight">{k("subtitleShort")}</p>
        </div>
        <div className="flex gap-1.5 text-[11px] font-semibold flex-shrink-0" data-testid="ai-office-stats">
          <Stat dot="#5ea8ff" label={k("stats.working")} n={count((a) => a.busy)} />
          <Stat dot="#ffb020" label={k("stats.review")} n={count((a) => a.activity === "review")} />
          <Stat dot="#b8b2aa" label={k("stats.idle")} n={count((a) => !a.busy && a.activity !== "review")} />
        </div>
        <div className="flex gap-1.5 ml-auto flex-shrink-0">
          <WeatherChip />
          <MuteButton k={k} />
          <button type="button" onClick={() => (mm.music === "full" ? mediaStore.minimizeMusic() : mediaStore.openMusic())} aria-pressed={mm.music === "full"} data-testid="ai-office-media-open" disabled={!mm.media}
            className="h-8 px-3 rounded-full border border-border bg-card/60 text-[12px] font-semibold inline-flex items-center gap-1.5">
            🎵 {k("media.title")}
          </button>
          {webgl && (
            <button type="button" onClick={() => { setSelected(null); setWalking(true); }} disabled={!agents} data-testid="ai-office-enter"
              className="h-8 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 bg-foreground text-background disabled:opacity-50">
              🚪 {k("walk.enter")}
            </button>
          )}
          <button type="button" onClick={() => select("manager")} data-testid="ai-office-goal"
            className="h-8 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 text-white" style={{ background: "#D97757" }}>
            <MorphIcon icon={Crown} className="w-3.5 h-3.5" />{k("goal")}
          </button>
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll} data-testid="ai-office-labels"
            className={`h-8 px-3 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 ${showAll ? "bg-foreground text-background border-foreground" : "border-border bg-card/60 text-muted-foreground"}`}>
            <MorphIcon icon={Tag} className="w-3.5 h-3.5" />{k("labels")}
          </button>
          <button type="button" onClick={() => { setAdding((v) => !v); setSelected(null); }} aria-pressed={adding} data-testid="ai-office-add"
            className="h-8 px-3 rounded-full border border-border bg-card/60 text-[12px] font-semibold inline-flex items-center gap-1.5">
            <MorphIcon icon={Plus} className="w-3.5 h-3.5" />{k("newAgent")}
          </button>
        </div>
      </div>

      {state === "err" && <div className="flex-shrink-0"><Notice tone="warn" testId="ai-office-err">{k("loadError")}</Notice></div>}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2">
        {/* 3D sahna */}
        <div className={`relative rounded-2xl overflow-hidden border border-border flex-shrink-0 lg:flex-shrink lg:flex-1 lg:h-auto ${sel || adding ? "h-[36%]" : "h-[48%]"}`}
          style={{ background: sceneBg }} data-testid="ai-office-scene">
          {!webgl ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground" data-testid="ai-office-nowebgl">{k("noWebgl")}</div>
          ) : walking || settling ? (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">🚶 {k("walk.inside")}</div>
          ) : agents ? (
            <Suspense fallback={<div className="absolute inset-0 p-4"><Skeleton h="h-full" /></div>}>
              <OfficeScene key={sceneKey} agents={agents} selectedId={selected} onSelect={select} showAllLabels={showAll} compact={compact} dark={dark}
                resetKey={resetKey} zoneNames={zoneNames} youLabel={k("walk.you")} onContextLost={lostCb} onContextRestored={restoredCb}
                focus={focus} speech={speech} cinemaSrc={cinemaSrc} cinemaThumb={cinemaThumb} musicOn={musicOn} weather={wx.mode} hour={wx.hour} />
            </Suspense>
          ) : (
            <div className="absolute inset-0 p-4"><Skeleton h="h-full" /></div>
          )}
          {webgl && agents && !walking && (
            <button type="button" onClick={() => setResetKey((n) => n + 1)} data-testid="ai-office-reset" title={k("reset")} aria-label={k("reset")}
              className="absolute z-30 top-2 right-2 w-9 h-9 rounded-full grid place-items-center bg-card/85 backdrop-blur border border-border shadow-sm hover:bg-card">
              <MorphIcon icon={Reset} className="w-4 h-4" />
            </button>
          )}
          {hint && webgl && !walking && (
            <div className="absolute z-30 left-2 bottom-2 max-w-[calc(100%-16px)] flex items-center gap-1.5 text-[11px] bg-card/85 text-foreground backdrop-blur border border-border rounded-full pl-3 pr-1 py-1 shadow-sm" data-testid="ai-office-hint">
              <span className="truncate">{compact ? k("hintTouch") : k("hint")}</span>
              <button type="button" onClick={dismissHint} aria-label={k("close")} data-testid="ai-office-hint-close" className="w-6 h-6 rounded-full grid place-items-center hover:bg-muted flex-shrink-0">
                <MorphIcon icon={X} className="w-3 h-3" />
              </button>
            </div>
          )}
          {lost && (
            <div className="absolute inset-0 z-40 grid place-items-center bg-background/80 backdrop-blur p-4 text-center" data-testid="ai-office-lost">
              <div className="space-y-2">
                <p className="text-sm">{k("contextLost")}</p>
                <button type="button" onClick={() => { setLost(false); setSceneKey((n) => n + 1); }} className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold">{k("reload")}</button>
              </div>
            </div>
          )}
        </div>

        {/* Yon panel: ro'yxat yoki agent paneli — ichki skrol */}
        <div ref={sideRef} className="flex-1 min-h-0 lg:flex-none lg:w-[380px] xl:w-[420px] rounded-2xl border border-border bg-card overflow-y-auto overscroll-contain" data-testid="ai-office-side">
          {adding ? (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2"><p className="text-sm font-bold flex-1">{k("newAgent")}</p>
                <button type="button" onClick={() => setAdding(false)} aria-label={k("close")} className="w-8 h-8 rounded-full grid place-items-center hover:bg-muted"><MorphIcon icon={X} className="w-4 h-4" /></button>
              </div>
              <NewAgentForm onDone={() => { setAdding(false); loadProfiles(); loadOffice(); }} />
            </div>
          ) : sel ? (
            <AgentPanel key={sel.id} agent={sel} profile={profile} profiles={profiles} setup={setup} onClose={() => setSelected(null)}
              onChanged={changed} onProfile={loadProfiles} onOpenAgent={(id) => { loadProfiles(); loadOffice().then(() => locate(id)); }} onSpeak={onSpeak(sel.id)} />
          ) : (
            <div data-testid="ai-office-list">
              <div className="sticky top-0 z-10 bg-card/95 backdrop-blur p-2 border-b border-border">
                <label className="relative block">
                  <MorphIcon icon={Search} className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={k("search")} data-testid="ai-office-search" aria-label={k("search")}
                    className="w-full h-9 rounded-xl border border-border bg-background pl-8 pr-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
              </div>
              <div className="p-2 space-y-3">
                {!agents && <Skeleton h="h-40" />}
                {agents && !byTeam.length && <p className="text-xs text-muted-foreground px-1">{k("noMatch")}</p>}
                {byTeam.map(([team, list]) => (
                  <div key={team}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 px-1">{k(`teams.${team}`)} <span className="opacity-60">{list.length}</span></p>
                    <div className={`grid gap-1.5 ${wide ? "grid-cols-1" : "grid-cols-1 min-[420px]:grid-cols-2"}`}>
                      {list.map((a) => (
                        <button key={a.id} type="button" onClick={() => locate(a.id)} data-testid={`ai-office-agent-${a.id}`} aria-pressed={selected === a.id} title={k("locate")}
                          className={`text-left rounded-xl border px-2.5 py-2 flex items-center gap-2 liquid-transition ${selected === a.id ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:bg-muted/50"}`}>
                          <span className="w-7 h-7 rounded-lg flex-shrink-0 relative" style={{ background: "#D97757", boxShadow: `inset 0 -6px 0 ${a.color}` }}>
                            <span className="absolute top-2 left-[7px] w-[3px] h-[6px] bg-[#1d1410]" /><span className="absolute top-2 right-[7px] w-[3px] h-[6px] bg-[#1d1410]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-semibold truncate">{a.name}</span>
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: activityTone(a) }} />
                              <span className="truncate">{doingText(a, poiKind.get(a.id), k)}{a.since && a.busy ? ` · ${agoText(a.since, k)}` : ""}</span>
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {!externalHost && <MediaHost />}
      {walking && agents && (
        <Suspense fallback={<div className="fixed inset-0 z-[90] bg-[#0f1115]" />}>
          <WalkMode agents={agents} profiles={profiles} setup={setup} onExit={exitWalk} onChanged={changed} onProfile={loadProfiles}
            onNavigate={onNavigate} erpLinks={onNavigate ? erpLinks : []}
            scene={{ compact, dark, zoneNames, youLabel: k("walk.you"), showAllLabels: showAll, cinemaSrc, cinemaThumb, musicOn }} />
        </Suspense>
      )}
    </div>
  );
}

function Stat({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-card/60 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full" style={{ background: dot }} />{label}<b className="tabular-nums">{n}</b>
    </span>
  );
}
