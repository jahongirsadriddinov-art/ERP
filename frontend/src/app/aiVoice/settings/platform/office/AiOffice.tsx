import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Crown from "@hugeicons/core-free-icons/CrownIcon";
import Tag from "@hugeicons/core-free-icons/Tag01Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import { isNotReady } from "../../api";
import { Notice, Skeleton } from "../../ui";
import { officeApi, TEAMS, type AgentProfile, type OfficeAgent, type Setup } from "./officeApi";
import AgentPanel, { NewAgentForm, activityTone, agoText } from "./AgentPanel";

// Dasturchi paneli → AI platforma → "AI ofis" (owner 2026-10-22). 3D sahna (OfficeScene) alohida lazy chunk'da —
// three.js boshqa sahifalarga ta'sir qilmaydi. Holat har 5 s (sahifa ko'rinib turganda) /platform/office'dan.
const OfficeScene = lazy(() => import("./OfficeScene"));

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const useCompact = () => {
  const q = "(max-width: 640px)";
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return !!m;
};

export default function AiOffice() {
  const { t } = useTranslation();
  const k = (key: string, o?: any) => t(`aiVoice.office.${key}`, o) as string;
  const [agents, setAgents] = useState<OfficeAgent[] | null>(null);
  const [state, setState] = useState<"ok" | "err" | "nr">("ok");
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const compact = useCompact();
  const webgl = useMemo(hasWebGL, []);
  const panelRef = useRef<HTMLDivElement>(null);

  const loadOffice = useCallback(async () => {
    const r = await officeApi.office();
    if (r.ok && r.data?.agents) { setAgents(r.data.agents); setState("ok"); }
    else setState(isNotReady(r) ? "nr" : "err");
  }, []);
  const loadProfiles = useCallback(async () => {
    const r = await officeApi.agents();
    if (r.ok && r.data) { setProfiles(r.data.agents || []); setSetup(r.data.setup || null); }
  }, []);

  useEffect(() => {
    loadOffice();
    loadProfiles();
    const tick = () => { if (!document.hidden) loadOffice(); };
    const id = setInterval(tick, 5_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [loadOffice, loadProfiles]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id && compact) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const changed = () => { loadOffice(); };

  const sel = agents?.find((a) => a.id === selected) || null;
  const profile = sel ? profiles.find((p) => p.key === sel.id) : undefined;
  const count = (f: (a: OfficeAgent) => boolean) => (agents || []).filter(f).length;
  const byTeam = useMemo(() => {
    const m = new Map<string, OfficeAgent[]>();
    for (const a of agents || []) {
      const team = TEAMS.includes(a.team as any) ? a.team : "growth";
      if (!m.has(team)) m.set(team, []);
      m.get(team)!.push(a);
    }
    return TEAMS.filter((x) => m.has(x)).map((x) => [x, m.get(x)!] as const);
  }, [agents]);

  if (state === "nr") return <Notice tone="lock" testId="ai-office-nr">{k("notReady")}</Notice>;

  const panel = sel && (
    <AgentPanel key={sel.id} agent={sel} profile={profile} profiles={profiles} setup={setup} onClose={() => setSelected(null)}
      onChanged={changed} onProfile={loadProfiles} />
  );

  return (
    <div className="space-y-3" data-testid="ai-office">
      <div className="surface no-lift border border-border rounded-2xl p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-bold">{k("title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{k("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold" data-testid="ai-office-stats">
          <Stat dot="#5ea8ff" label={k("stats.working")} n={count((a) => a.busy)} />
          <Stat dot="#ffb020" label={k("stats.review")} n={count((a) => a.activity === "review")} />
          <Stat dot="#b8b2aa" label={k("stats.idle")} n={count((a) => !a.busy && a.activity !== "review")} />
        </div>
        <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
          <button type="button" onClick={() => select("manager")} data-testid="ai-office-goal"
            className="h-8 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 text-white" style={{ background: "#D97757" }}>
            <MorphIcon icon={Crown} className="w-3.5 h-3.5" />{k("goal")}
          </button>
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll} data-testid="ai-office-labels"
            className={`h-8 px-3 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 ${showAll ? "bg-foreground text-background border-foreground" : "border-border bg-card/60 text-muted-foreground"}`}>
            <MorphIcon icon={Tag} className="w-3.5 h-3.5" />{k("labels")}
          </button>
          <button type="button" onClick={() => setAdding((v) => !v)} data-testid="ai-office-add"
            className="h-8 px-3 rounded-full border border-border bg-card/60 text-[12px] font-semibold inline-flex items-center gap-1.5">
            <MorphIcon icon={Plus} className="w-3.5 h-3.5" />{k("newAgent")}
          </button>
        </div>
        {adding && <div className="w-full"><NewAgentForm onDone={() => { setAdding(false); loadProfiles(); loadOffice(); }} /></div>}
      </div>

      {state === "err" && <Notice tone="warn" testId="ai-office-err">{k("loadError")}</Notice>}

      <div className="relative rounded-2xl overflow-hidden border border-border h-[62vh] min-h-[380px] sm:h-[640px]"
        style={{ background: "radial-gradient(120% 90% at 50% 0%, #fbf7f1 0%, #efe9e1 60%, #e6ddd2 100%)" }}>
        {!webgl ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground" data-testid="ai-office-nowebgl">{k("noWebgl")}</div>
        ) : agents ? (
          <Suspense fallback={<div className="absolute inset-0 p-4"><Skeleton h="h-full" /></div>}>
            <OfficeScene agents={agents} selectedId={selected} onSelect={select} showAllLabels={showAll} compact={compact} />
          </Suspense>
        ) : (
          <div className="absolute inset-0 p-4"><Skeleton h="h-full" /></div>
        )}
        <div className="pointer-events-none absolute left-3 bottom-3 hidden sm:block text-[11px] text-[#5b5148] bg-white/70 backdrop-blur rounded-full px-3 py-1.5">
          {k("hint")}
        </div>
        {sel && !compact && (
          <div className="absolute top-3 right-3 bottom-3 w-[390px] max-w-[calc(100%-24px)] overflow-y-auto overscroll-contain rounded-2xl bg-card/95 backdrop-blur border border-border shadow-xl">
            {panel}
          </div>
        )}
      </div>

      {sel && compact && <div ref={panelRef} className="rounded-2xl bg-card border border-border">{panel}</div>}

      {/* Agentlar ro'yxati — WebGL bo'lmasa ham ishlaydi, kirish imkoniyati (a11y) */}
      <div className="space-y-3" data-testid="ai-office-list">
        {byTeam.map(([team, list]) => (
          <div key={team}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{k(`teams.${team}`)}</p>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-1.5">
              {list.map((a) => (
                <button key={a.id} type="button" onClick={() => select(a.id)} data-testid={`ai-office-agent-${a.id}`} aria-pressed={selected === a.id}
                  className={`text-left rounded-xl border px-2.5 py-2 flex items-center gap-2 liquid-transition ${selected === a.id ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:bg-card"}`}>
                  <span className="w-7 h-7 rounded-lg flex-shrink-0 relative" style={{ background: "#D97757", boxShadow: `inset 0 -6px 0 ${a.color}` }}>
                    <span className="absolute top-2 left-[7px] w-[3px] h-[6px] bg-[#1d1410]" /><span className="absolute top-2 right-[7px] w-[3px] h-[6px] bg-[#1d1410]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold truncate">{a.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: activityTone(a) }} />
                      {a.task && a.activity !== "idle" ? a.task.text : k(`activity.${a.activity}`)}
                      {a.since && a.busy ? ` · ${agoText(a.since, k)}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-card/60">
      <span className="w-2 h-2 rounded-full" style={{ background: dot }} />{label}<b className="tabular-nums">{n}</b>
    </span>
  );
}
