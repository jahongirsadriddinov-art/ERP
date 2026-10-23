import "../../../../i18n/aiVoiceNs";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Copy from "@hugeicons/core-free-icons/Copy01Icon";
import Send from "@hugeicons/core-free-icons/Sent02Icon";
import Del from "@hugeicons/core-free-icons/Delete02Icon";
import Retry from "@hugeicons/core-free-icons/RefreshIcon";
import Tick from "@hugeicons/core-free-icons/Tick02Icon";
import Gear from "@hugeicons/core-free-icons/Settings02Icon";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import { Badge, type Tone } from "../../ui";
import AgentChat from "./AgentChat";
import { officeApi, TEAMS, type AgentProfile, type AgentTask, type OfficeAgent, type PlanItem, type Setup, type TaskStatus } from "./officeApi";

// AI ofis — agent kartasi: holat, buyruq qutisi, vazifalar (natija, nusxa, Telegram'ga yuborish, tasdiqlash), sozlash.
type K = (key: string, o?: any) => string;

export const activityTone = (a: OfficeAgent) => a.activity === "task" ? "#5ea8ff" : a.activity === "call" ? "#2dd4bf" : a.activity === "chat" ? "#a78bfa"
  : a.activity === "review" ? "#ffb020" : a.task?.status === "failed" ? "#ff3b30" : a.task?.status === "done" ? "#34c759" : "#b8b2aa";

export function agoText(iso: string, k: K): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return k("ago.now");
  if (s < 3600) return k("ago.min", { n: Math.floor(s / 60) });
  if (s < 86400) return k("ago.hour", { n: Math.floor(s / 3600) });
  return k("ago.day", { n: Math.floor(s / 86400) });
}

const STATUS_TONE: Record<TaskStatus, Tone> = { queued: "gray", review: "amber", running: "sky", done: "green", failed: "red", cancelled: "gray" };
const ACTIVE: TaskStatus[] = ["queued", "review", "running"];

async function copy(text: string, k: K) {
  try { await navigator.clipboard.writeText(text); toast.success(k("actions.copied")); } catch { toast.error(k("errors.generic")); }
}
const errMsg = (e: string, k: K) => (["rate_limited", "too_many_active", "agent_disabled", "not_configured", "invalid", "name_taken", "too_many"].includes(e) ? k(`errors.${e}`) : k("errors.generic"));

export default function AgentPanel({ agent, profile, profiles, setup, onClose, onChanged, onProfile, onOpenAgent, onSpeak }: {
  agent: OfficeAgent; profile?: AgentProfile; profiles: AgentProfile[]; setup: Setup | null;
  onClose: () => void; onChanged: () => void; onProfile: () => void; onOpenAgent: (id: string) => void;
  /** Agent javobini 3D'da gap pufagi qilib ko'rsatish (null — tugadi). */
  onSpeak?: (text: string | null) => void;
}) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const taskable = agent.kind === "code" || agent.kind === "content";
  const isBoss = agent.id === "manager";
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [all, setAll] = useState<AgentTask[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!taskable) return;
    const r = await officeApi.tasks(agent.id, 15);
    if (r.ok && r.data) setTasks(r.data.tasks);
    if (isBoss) {
      const a = await officeApi.tasks(undefined, 100);
      if (a.ok && a.data) setAll(a.data.tasks);
    }
  }, [agent.id, taskable, isBoss]);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 5_000);
    return () => clearInterval(id);
  }, [load]);

  const submit = async (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    const r = await officeApi.createTask(agent.id, v);
    setBusy(false);
    if (!r.ok) { toast.error(errMsg(r.error, k)); return; }
    toast.success(k("command.sent"));
    setText("");
    load(); onChanged();
  };
  const act = async (p: Promise<{ ok: boolean; error: string }>, ok?: string) => {
    const r = await p;
    if (!r.ok) toast.error(errMsg(r.error, k));
    else if (ok) toast.success(ok);
    load(); onChanged();
  };

  const placeholder = isBoss ? k("command.manager") : agent.id === "reporter" ? k("command.reporter") : agent.id === "feature" ? k("command.feature") : k("command.placeholder");
  const needSetup = setup && ((agent.kind === "code" && !setup.codeReady) || (agent.kind === "content" && !setup.contentReady));
  const childOf = new Map(all.map((x) => [x.id, x]));
  const nameOf = (key: string) => profiles.find((p) => p.key === key)?.name || key;

  return (
    <div className="p-3.5 space-y-3" data-testid="ai-office-panel">
      <div className="flex items-start gap-2.5">
        <span className="w-10 h-10 rounded-xl flex-shrink-0 relative" style={{ background: "#D97757", boxShadow: `inset 0 -8px 0 ${agent.color}` }}>
          <span className="absolute top-3 left-[11px] w-1 h-2 bg-[#1d1410]" /><span className="absolute top-3 right-[11px] w-1 h-2 bg-[#1d1410]" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold truncate" data-testid="ai-office-panel-name">{agent.name}</p>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            <Badge>{k(`kinds.${agent.kind}`)}</Badge>
            {TEAMS.includes(agent.team as any) && <Badge tone="sky">{k(`teams.${agent.team}`)}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5" data-testid="ai-office-panel-status">
            <span className="w-2 h-2 rounded-full" style={{ background: activityTone(agent) }} />
            {k(`activity.${agent.activity}`)}{agent.since ? ` · ${k("since", { t: agoText(agent.since, k) })}` : ""}
          </p>
          {profile?.description && <p className="text-[11.5px] text-muted-foreground mt-1">{profile.description}</p>}
        </div>
        {profile && taskable && (
          <button type="button" onClick={() => setEditing((v) => !v)} aria-label={k("edit.title")} className="w-8 h-8 rounded-full grid place-items-center hover:bg-muted">
            <MorphIcon icon={Gear} className="w-4 h-4" />
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={k("close")} className="w-8 h-8 rounded-full grid place-items-center hover:bg-muted" data-testid="ai-office-panel-close">
          <MorphIcon icon={X} className="w-4 h-4" />
        </button>
      </div>

      {agent.kind !== "tg" && <AgentChat key={agent.id} agent={agent} taskable={taskable} onCommand={(v) => submit(v)} onSpeak={onSpeak} />}

      {editing && profile && <EditAgent profile={profile} onSaved={() => { setEditing(false); onProfile(); onChanged(); }} />}

      {!taskable ? (
        <p className="text-xs text-muted-foreground rounded-xl bg-muted/40 px-3 py-2.5">{k("command.noTasks")}</p>
      ) : (
        <>
          {needSetup && <SetupList setup={setup!} kind={agent.kind === "code" ? "code" : agent.id === "reporter" ? "reporter" : "content"} />}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground" htmlFor="ai-office-cmd">{k("command.label")}</label>
            <textarea id="ai-office-cmd" data-testid="ai-office-command" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000}
              placeholder={placeholder}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-y min-h-[72px] focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <div className="flex flex-wrap items-center gap-1.5">
              {agent.id === "reporter" && [k("quick.today"), k("quick.week")].map((q) => (
                <button key={q} type="button" onClick={() => submit(q)} disabled={busy} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold hover:bg-muted">{q}</button>
              ))}
              <button type="button" onClick={() => submit()} disabled={busy || !text.trim()} data-testid="ai-office-send"
                className="ml-auto h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <MorphIcon icon={Send} className="w-4 h-4" />{k("command.send")}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{agent.id === "reporter" ? k("report") : k("tasks")}</p>
            {tasks === null ? <div className="h-16 rounded-xl bg-muted/40 animate-pulse" />
              : !tasks.length ? <p className="text-xs text-muted-foreground" data-testid="ai-office-no-tasks">{k("empty")}</p>
                : tasks.map((x) => (
                  <TaskCard key={x.id} task={x} k={k} profiles={profiles} childOf={childOf} nameOf={nameOf} onOpenAgent={onOpenAgent}
                    onCancel={() => act(officeApi.cancel(x.id))} onRetry={(id = x.id) => act(officeApi.retry(id))}
                    onApprove={(b) => act(officeApi.approve(x.id, b))}
                    onSend={async (target, index) => {
                      // kanal sozlanmagan bo'lsa server o'zingizning Telegram chatingizga yuboradi — shuni aytamiz
                      const r: any = await officeApi.send(x.id, target, index);
                      if (!r.ok) toast.error(errMsg(r.error, k));
                      else toast.success(target === "channel" && r.data?.sentTo === "developer" ? k("actions.sentToMeNoChannel") : k("actions.sentTg"));
                      load(); onChanged();
                    }} />
                ))}
          </div>
        </>
      )}
    </div>
  );
}

function TaskCard({ task, k, profiles, childOf, nameOf, onCancel, onRetry, onApprove, onSend, onOpenAgent }: {
  task: AgentTask; k: K; profiles: AgentProfile[]; childOf: Map<string, AgentTask>; nameOf: (key: string) => string; onOpenAgent: (id: string) => void;
  onCancel: () => void; onRetry: (id?: string) => void; onApprove: (b: { spec?: string; plan?: PlanItem[] }) => void;
  onSend: (target: "channel" | "developer", index?: number) => void;
}) {
  const [spec, setSpec] = useState(task.spec || "");
  const [plan, setPlan] = useState<PlanItem[]>(task.plan || []);
  useEffect(() => { setSpec(task.spec || ""); setPlan(task.plan || []); }, [task.id, task.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const taskable = profiles.filter((p) => (p.kind === "code" || p.kind === "content") && p.enabled && p.key !== "manager" && p.key !== "reporter");
  const isReport = task.agentKey === "reporter";
  const isPlan = task.agentKey === "manager";

  return (
    <div className="rounded-xl border border-border bg-background/60 p-2.5 space-y-2" data-testid={`ai-office-task-${task.id}`}>
      <div className="flex items-start gap-2">
        <Badge tone={STATUS_TONE[task.status]}>{k(`status.${task.status}`)}</Badge>
        <p className="text-[12.5px] font-medium flex-1 min-w-0 break-words">{task.text}</p>
        <span className="text-[10.5px] text-muted-foreground whitespace-nowrap">{agoText(task.createdAt, k)}</span>
      </div>

      {task.status === "review" && task.spec !== undefined && !isPlan && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">{k("spec")}</p>
          <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={8} data-testid="ai-office-spec"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[12.5px] font-mono leading-relaxed" />
          <button type="button" onClick={() => onApprove({ spec })} data-testid="ai-office-approve"
            className="h-9 px-4 rounded-full bg-emerald-600 text-white text-[13px] font-semibold inline-flex items-center gap-1.5">
            <MorphIcon icon={Tick} className="w-4 h-4" />{k("actions.approve")}
          </button>
        </div>
      )}

      {isPlan && plan.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">{task.status === "review" ? k("plan") : k("board")}</p>
          {plan.map((p, i) => {
            const child = p.taskId ? childOf.get(p.taskId) : undefined;
            return task.status === "review" ? (
              <div key={i} className="flex gap-1.5 items-start" data-testid={`ai-office-plan-row-${i}`}>
                <select value={p.agentKey} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, agentKey: e.target.value } : x)))}
                  className="h-9 rounded-lg border border-border bg-background px-1.5 text-[12px] max-w-[42%]">
                  {taskable.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
                </select>
                <textarea value={p.text} rows={2} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" />
                <button type="button" aria-label={k("actions.remove")} onClick={() => setPlan(plan.filter((_, j) => j !== i))} className="w-8 h-9 grid place-items-center text-muted-foreground hover:text-red-600">
                  <MorphIcon icon={Del} className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2 text-[12px] rounded-lg bg-muted/30 px-2 py-1.5">
                <b className="whitespace-nowrap">{nameOf(p.agentKey)}</b>
                <span className="flex-1 min-w-0 truncate text-muted-foreground">{p.text}</span>
                {child && <Badge tone={STATUS_TONE[child.status]}>{k(`status.${child.status}`)}</Badge>}
                {child && child.status === "failed" && (
                  <button type="button" onClick={() => onRetry(child.id)} aria-label={k("actions.retry")} className="w-7 h-7 grid place-items-center rounded-full hover:bg-muted"><MorphIcon icon={Retry} className="w-3.5 h-3.5" /></button>
                )}
              </div>
            );
          })}
          {task.status === "review" && (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setPlan([...plan, { agentKey: taskable[0]?.key || "feature", text: "" }])} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold">{k("actions.addRow")}</button>
              <button type="button" onClick={() => onApprove({ plan: plan.filter((p) => p.text.trim()) })} disabled={!plan.some((p) => p.text.trim())} data-testid="ai-office-approve-plan"
                className="h-8 px-3.5 rounded-full bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <MorphIcon icon={Tick} className="w-3.5 h-3.5" />{k("actions.approvePlan")}
              </button>
            </div>
          )}
        </div>
      )}

      {task.summary && (
        <div className="relative rounded-lg bg-muted/40 px-2.5 py-2 pr-9">
          <p className="text-[12.5px] whitespace-pre-wrap break-words" data-testid="ai-office-summary">{task.summary}</p>
          <button type="button" onClick={() => copy(task.summary!, k)} aria-label={k("actions.copy")} className="absolute top-1.5 right-1.5 w-7 h-7 grid place-items-center rounded-full hover:bg-background">
            <MorphIcon icon={Copy} className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {task.items.map((it, i) => {
        const full = [it.title, it.text, (it.hashtags || []).join(" ")].filter(Boolean).join("\n\n");
        return (
          <div key={i} className="rounded-lg border border-border px-2.5 py-2 space-y-1" data-testid={`ai-office-item-${i}`}>
            {it.title && <p className="text-[12.5px] font-bold">{it.title}</p>}
            <p className="text-[12.5px] whitespace-pre-wrap break-words">{it.text}</p>
            {!!it.hashtags?.length && <p className="text-[11.5px] text-sky-700 dark:text-sky-300">{it.hashtags.join(" ")}</p>}
            <div className="flex gap-1.5 pt-0.5">
              <button type="button" onClick={() => copy(full, k)} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold inline-flex items-center gap-1"><MorphIcon icon={Copy} className="w-3.5 h-3.5" />{k("actions.copy")}</button>
              <button type="button" onClick={() => onSend("channel", i)} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold inline-flex items-center gap-1"><MorphIcon icon={Telegram} className="w-3.5 h-3.5" />{k("actions.toChannel")}</button>
            </div>
          </div>
        );
      })}

      {task.spawnedKey && (
        <button type="button" onClick={() => onOpenAgent(task.spawnedKey!)} data-testid="ai-office-open-spawned"
          className="h-8 px-3.5 rounded-full text-white text-[12px] font-semibold" style={{ background: "#D97757" }}>{k("actions.openAgent")}</button>
      )}

      {task.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="h-7 px-2.5 rounded-full bg-foreground text-background text-[11.5px] font-semibold inline-flex items-center">{l.label}</a>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {isReport && task.status === "done" && (
          <button type="button" onClick={() => onSend("developer")} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold inline-flex items-center gap-1" data-testid="ai-office-send-dev">
            <MorphIcon icon={Telegram} className="w-3.5 h-3.5" />{k("actions.toDev")}
          </button>
        )}
        {ACTIVE.includes(task.status) && (
          <button type="button" onClick={onCancel} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold text-red-600" data-testid="ai-office-cancel">{k("actions.cancel")}</button>
        )}
        {(task.status === "queued" || task.status === "failed") && (
          <button type="button" onClick={() => onRetry()} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold inline-flex items-center gap-1"><MorphIcon icon={Retry} className="w-3.5 h-3.5" />{k("actions.retry")}</button>
        )}
        {task.log.length > 0 && (
          <details className="w-full text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none">{k("actions.log")} · {task.log[task.log.length - 1].text}</summary>
            <ul className="mt-1 space-y-0.5">{task.log.map((l, i) => <li key={i}><span className="tabular-nums">{new Date(l.at).toLocaleTimeString().slice(0, 5)}</span> — {l.text}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}

function SetupList({ setup, kind }: { setup: Setup; kind: "code" | "content" | "reporter" }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.setup.${key}`, o) as string;
  const items = setup.items.filter((i) => i.for === kind || (kind === "reporter" && i.for === "content"));
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-2.5 space-y-1.5" data-testid="ai-office-setup">
      <p className="text-[12.5px] font-bold">{k("title")}</p>
      <p className="text-[11.5px] text-muted-foreground">{kind === "code" ? k("code") : k("content")}</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-1.5 text-[11.5px]">
            <span className={`mt-0.5 w-3.5 h-3.5 rounded-full grid place-items-center text-[9px] font-bold flex-shrink-0 ${i.ok ? "bg-emerald-500 text-white" : i.ok === null ? "bg-muted text-muted-foreground" : "bg-amber-500 text-white"}`}>{i.ok ? "✓" : i.ok === null ? "?" : "!"}</span>
            <span className="min-w-0">
              <code className="font-mono font-semibold">{i.key.replace(" (GitHub)", "")}</code>
              <span className="text-muted-foreground"> — {i.where === "github" ? k("github") : k("backend")}{!i.required ? ` · ${k("optional")}` : ""}{i.ok === null ? ` · ${k("unknown")}` : ""}</span>
              <span className="block text-muted-foreground">{k(`items.${i.key.includes("GitHub") ? "AGENT_CALLBACK_SECRET_GH" : i.key}`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditAgent({ profile, onSaved }: { profile: AgentProfile; onSaved: () => void }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const [f, setF] = useState({ name: profile.name, description: profile.description, systemPrompt: profile.systemPrompt, enabled: profile.enabled });
  const save = async () => {
    const r = await officeApi.updateAgent(profile.key, f);
    if (!r.ok) { toast.error(errMsg(r.error, k)); return; }
    toast.success(k("edit.saved"));
    onSaved();
  };
  const input = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]";
  return (
    <div className="rounded-xl border border-border p-2.5 space-y-2" data-testid="ai-office-edit">
      <p className="text-[12.5px] font-bold">{k("edit.title")}</p>
      <label className="block text-[11px] text-muted-foreground">{k("edit.name")}<input className={input} value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="block text-[11px] text-muted-foreground">{k("edit.description")}<input className={input} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label className="block text-[11px] text-muted-foreground">{k("edit.prompt")}<textarea className={`${input} font-mono`} rows={5} value={f.systemPrompt} maxLength={4000} onChange={(e) => setF({ ...f, systemPrompt: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />{k("edit.enabled")}</label>
      <button type="button" onClick={save} className="h-8 px-4 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold">{k("edit.save")}</button>
    </div>
  );
}

export function NewAgentForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const [f, setF] = useState({ name: "", kind: "code" as "code" | "content", team: "platform", description: "", systemPrompt: "" });
  const save = async () => {
    if (!f.name.trim()) return;
    const r = await officeApi.createAgent({ ...f, name: f.name.trim() });
    if (!r.ok) { toast.error(errMsg(r.error, k)); return; }
    toast.success(k("edit.created"));
    onDone();
  };
  const input = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]";
  return (
    <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-border p-2.5" data-testid="ai-office-new">
      <label className="block text-[11px] text-muted-foreground">{k("edit.name")}<input className={input} value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="ai-office-new-name" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] text-muted-foreground">{k("edit.kind")}
          <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as any })}>
            <option value="code">{k("kinds.code")}</option><option value="content">{k("kinds.content")}</option>
          </select>
        </label>
        <label className="block text-[11px] text-muted-foreground">{k("edit.team")}
          <select className={input} value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}>
            {TEAMS.filter((x) => x !== "lead" && x !== "assistants").map((x) => <option key={x} value={x}>{k(`teams.${x}`)}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-[11px] text-muted-foreground sm:col-span-2">{k("edit.description")}<input className={input} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label className="block text-[11px] text-muted-foreground sm:col-span-2">{k("edit.prompt")}<textarea className={input} rows={3} value={f.systemPrompt} maxLength={4000} onChange={(e) => setF({ ...f, systemPrompt: e.target.value })} /></label>
      <div className="sm:col-span-2"><button type="button" onClick={save} disabled={!f.name.trim()} className="h-8 px-4 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50">{k("edit.create")}</button></div>
    </div>
  );
}
