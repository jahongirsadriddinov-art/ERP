import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "../../../ui";
import { smmApi, SMM_FORMATS, type SmmFormat, type SmmMode, type SmmRunRow, type SmmSettings, type SmmStatus } from "./smmApi";
import { downloadBlob, extOf, fmtBytes, smmStore, type SmmLocal } from "./smmStore";
import { smmErr } from "./SmmPostCard";

// SMM sozlamalari (owner 2026-10-23): ulanishlar (Telegram kanal, Instagram — qo'llanma bilan), avtopilot (off / tasdiq bilan /
// to'liq avto), jadval (kunlar × vaqtlar, Toshkent), formatlar, til, kunlik limit, favqulodda to'xtatish; qurilmadagi fayllar.
type K = (key: string, o?: Record<string, unknown>) => string;
const DAYS = [1, 2, 3, 4, 5, 6, 7];

export default function SmmSettingsPanel({ settings, status, onSaved }: { settings: SmmSettings | null; status: SmmStatus | null; onSaved: () => void }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.smm.${key}`, o) as string;
  const [f, setF] = useState<SmmSettings | null>(settings);
  const [newTime, setNewTime] = useState("18:00");
  const [runs, setRuns] = useState<SmmRunRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => { setF(settings); }, [settings]);
  useEffect(() => { smmApi.runs().then((r) => { if (r.ok) setRuns(r.data.runs); }); }, [settings]);
  if (!f) return <div className="h-24 rounded-xl bg-muted/40 animate-pulse" />;

  const save = async (patch: Partial<SmmSettings>) => {
    const next = { ...f, ...patch };
    setF(next);
    setSaving(true);
    const r = await smmApi.saveSettings({
      mode: next.mode, days: next.days, times: next.times, formats: next.formats, language: next.language, targets: next.targets, dailyCap: next.dailyCap, paused: next.paused,
    });
    setSaving(false);
    if (!r.ok) { toast.error(smmErr(r.error, k)); return; }
    setF(r.data.settings);
    toast.success(k("settingsSaved"));
    onSaved();
  };
  const chip = (on: boolean) => `h-8 px-3 rounded-full border text-[12px] font-semibold ${on ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`;
  const ig = status?.instagram, tg = status?.telegram;

  return (
    <div className="space-y-3" data-testid="smm-settings">
      {/* Ulanishlar */}
      <section className="rounded-xl border border-border p-2.5 space-y-2">
        <p className="text-[12.5px] font-bold">{k("connections")}</p>
        <div className="flex items-start gap-2 text-[12px]" data-testid="smm-conn-tg">
          <Badge tone={tg?.channel ? "green" : tg?.bot ? "amber" : "red"}>Telegram</Badge>
          <span className="text-muted-foreground">{tg?.channel ? k("tgChannelOk", { name: tg.channelName || "" }) : tg?.bot ? k("tgOwnChat") : k("tgNoBot")} {k("tgViews")}</span>
        </div>
        <div className="flex items-start gap-2 text-[12px]" data-testid="smm-conn-ig">
          <Badge tone={ig?.configured && ig.publicUrl ? "green" : "amber"}>Instagram</Badge>
          <span className="text-muted-foreground flex-1">
            {ig?.configured ? k("igOk", { name: ig.username ? `@${ig.username}` : "", via: ig.via === "instagram" ? "Instagram Login" : "Facebook Page" }) : k("igNo")}
            {ig?.expiresAt && ` · ${k("igExpires", { d: new Date(ig.expiresAt).toLocaleDateString() })}`}
            {ig?.refreshError && ` · ${k("igRefreshErr")}: ${ig.refreshError}`}
            {ig?.configured && !ig.publicUrl && ` · ${k("err.public_url_required")}`}
          </span>
        </div>
        {ig?.configured && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold" data-testid="smm-ig-check"
              onClick={async () => { const r = await smmApi.igCheck(); if (r.ok) toast.success(k("igChecked", { name: r.data.username, n: r.data.followers ?? "—" })); else toast.error(smmErr(r.error, k)); onSaved(); }}>{k("igCheck")}</button>
            <button type="button" className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold"
              onClick={async () => { const r = await smmApi.igRefresh(); if (r.ok) toast.success(k("igRefreshed")); else toast.error(smmErr(r.error, k)); onSaved(); }}>{k("igRefresh")}</button>
          </div>
        )}
        <ul className="space-y-0.5" data-testid="smm-checklist">
          {(status?.items || []).map((i) => (
            <li key={i.key} className="flex items-start gap-1.5 text-[11.5px]">
              <span className={`mt-0.5 w-3.5 h-3.5 rounded-full grid place-items-center text-[9px] font-bold flex-shrink-0 ${i.ok ? "bg-emerald-500 text-white" : i.ok === null ? "bg-muted text-muted-foreground" : i.required ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"}`}>{i.ok ? "✓" : i.ok === null ? "?" : "!"}</span>
              <span className="min-w-0"><code className="font-mono font-semibold">{i.key}</code>{!i.required && <span className="text-muted-foreground"> · {k("optional")}</span>}
                <span className="block text-muted-foreground">{k(`env.${i.key}`)}</span></span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setGuide((v) => !v)} className="text-[12px] font-semibold underline" data-testid="smm-guide-toggle">{k("guideTitle")}</button>
        {guide && (
          <ol className="list-decimal pl-5 space-y-1 text-[11.5px] text-muted-foreground" data-testid="smm-guide">
            {Array.from({ length: 9 }, (_, i) => <li key={i}>{k(`guide.${i + 1}`)}</li>)}
          </ol>
        )}
      </section>

      {/* Avtopilot */}
      <section className="rounded-xl border border-border p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[12.5px] font-bold flex-1">{k("autopilot")}</p>
          {saving && <span className="text-[11px] text-muted-foreground">{k("saving")}</span>}
        </div>
        <div className="grid gap-1.5" role="radiogroup" aria-label={k("autopilot")}>
          {(["off", "approve", "auto"] as SmmMode[]).map((m) => (
            <label key={m} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer ${f.mode === m ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" name="smm-mode" checked={f.mode === m} onChange={() => save({ mode: m })} data-testid={`smm-mode-${m}`} className="mt-0.5" />
              <span><span className="text-[12.5px] font-semibold block">{k(`mode.${m}`)}</span><span className="text-[11px] text-muted-foreground">{k(`modeHint.${m}`)}</span></span>
            </label>
          ))}
        </div>
        {f.envKill && <p className="text-[11.5px] text-red-600">{k("envKill")}</p>}
        <label className="flex items-center gap-2 text-[12px] font-semibold text-red-600">
          <input type="checkbox" checked={f.paused} onChange={(e) => save({ paused: e.target.checked })} data-testid="smm-paused" />{k("paused")}
        </label>

        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("schedule")}</p>
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={f.days.includes(d)} className={chip(f.days.includes(d))} data-testid={`smm-day-${d}`}
              onClick={() => save({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() })}>{k(`days.${d}`)}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {f.times.map((tm) => (
            <span key={tm} className="h-8 pl-3 pr-1 rounded-full border border-border text-[12px] font-semibold inline-flex items-center gap-1">{tm}
              <button type="button" aria-label={k("removeTime")} className="w-6 h-6 rounded-full hover:bg-muted" onClick={() => save({ times: f.times.filter((x) => x !== tm) })}>×</button></span>
          ))}
          {f.times.length < 6 && (
            <span className="inline-flex items-center gap-1">
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-[12px]" aria-label={k("time")} data-testid="smm-time-input" />
              <button type="button" className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold" data-testid="smm-time-add"
                onClick={() => { if (/^\d{2}:\d{2}$/.test(newTime) && !f.times.includes(newTime)) save({ times: [...f.times, newTime].sort() }); }}>{k("addTime")}</button>
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-muted-foreground" data-testid="smm-per-week">{k("perWeek", { n: f.perWeek })}{f.next ? ` · ${k("next", { d: new Date(f.next).toLocaleString() })}` : ""}</p>

        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("formatsTitle")}</p>
        <div className="flex flex-wrap gap-1">
          {SMM_FORMATS.map((x) => (
            <button key={x} type="button" aria-pressed={f.formats.includes(x)} className={chip(f.formats.includes(x))}
              onClick={() => { const n = f.formats.includes(x) ? f.formats.filter((y) => y !== x) : [...f.formats, x]; if (n.length) save({ formats: n as SmmFormat[] }); }}>{k(`formats.${x}`)}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-muted-foreground">{k("language")}
            <select value={f.language} onChange={(e) => save({ language: e.target.value as SmmSettings["language"] })} className="w-full h-8 rounded-lg border border-border bg-background px-2 text-[12px]" data-testid="smm-language">
              <option value="uz">O'zbekcha</option><option value="ru">Русский</option><option value="both">{k("langBoth")}</option>
            </select>
          </label>
          <label className="block text-[11px] text-muted-foreground">{k("dailyCap")}
            <input type="number" min={1} max={10} value={f.dailyCap} onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 10) save({ dailyCap: n }); }} className="w-full h-8 rounded-lg border border-border bg-background px-2 text-[12px]" />
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-[12px]">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.targets.instagram} onChange={(e) => save({ targets: { ...f.targets, instagram: e.target.checked } })} />Instagram</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.targets.telegram} onChange={(e) => save({ targets: { ...f.targets, telegram: e.target.checked } })} />{k("tgChannel")}</label>
        </div>
        <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/40 px-2.5 py-2">{k("deviceNote")}</p>
      </section>

      {runs.length > 0 && (
        <section className="rounded-xl border border-border p-2.5 space-y-1" data-testid="smm-runs">
          <p className="text-[12.5px] font-bold">{k("runs")}</p>
          {runs.slice(0, 10).map((r) => (
            <p key={r.key} className="text-[11.5px] flex gap-1.5 items-start">
              <Badge tone={r.status === "published" ? "green" : r.status === "failed" ? "red" : r.status === "prepared" ? "amber" : "gray"}>{k(`run.${r.status}`)}</Badge>
              <span className="text-muted-foreground min-w-0">{new Date(r.at).toLocaleString()} — {r.note || r.topic || ""}</span>
            </p>
          ))}
        </section>
      )}

      <DeviceFiles k={k} />
    </div>
  );
}

function DeviceFiles({ k }: { k: K }) {
  const [list, setList] = useState<SmmLocal[]>([]);
  const load = useCallback(() => { smmStore.list().then(setList); }, []);
  useEffect(() => { load(); return smmStore.subscribe(load); }, [load]);
  const total = list.reduce((s, x) => s + x.size, 0);
  return (
    <section className="rounded-xl border border-border p-2.5 space-y-1.5" data-testid="smm-device">
      <p className="text-[12.5px] font-bold">{k("deviceFiles")} · {fmtBytes(total)}</p>
      <p className="text-[11px] text-muted-foreground">{k("deviceFilesHint")}</p>
      {list.slice(0, 30).map((x) => (
        <div key={x.id} className="flex items-center gap-2 text-[11.5px]">
          <span className="flex-1 min-w-0 truncate">{x.kind === "video" ? "🎬" : "🖼"} {x.title || x.id}</span>
          <span className="text-muted-foreground tabular-nums">{fmtBytes(x.size)}</span>
          <button type="button" className="underline" onClick={async () => { const r = await smmStore.get(x.id); if (r) downloadBlob(r.blob, `qurilisherp-${x.id}.${extOf(r.blob.type)}`); }}>{k("save")}</button>
          <button type="button" className="text-red-600 underline" onClick={() => smmStore.remove(x.id)}>{k("delete")}</button>
        </div>
      ))}
      {!list.length && <p className="text-[11.5px] text-muted-foreground">{k("deviceEmpty")}</p>}
    </section>
  );
}
