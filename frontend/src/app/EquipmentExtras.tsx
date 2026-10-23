import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { RecordMenu, EditRecordModal, sendJson } from "./components/RecordEdit";

// ─── Texnika tafsiloti (owner 2026-10-19: "texnika telemetriyasi") ─────────────────────────────────────────
// Servis muddati/oralig'i, motor-soat, yoqilg'i me'yori; kunlik jurnal (soat, yoqilg'i); GPS-treker havolasi.
// Nazorat (services/insights) servis va yoqilg'i anomaliyasini shu ma'lumotlardan hisoblaydi.

const inputCls = "h-9 w-full rounded-lg border border-border bg-input-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export function EquipmentDetails({ eq, canManage, onChanged }: { eq: any; canManage: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const [svc, setSvc] = useState({
    nextServiceDate: eq.nextServiceDate || "", serviceIntervalHours: eq.serviceIntervalHours ?? "",
    lastServiceEngineHours: eq.lastServiceEngineHours ?? "", engineHours: eq.engineHours ?? "", fuelNormPerHour: eq.fuelNormPerHour ?? "",
  });
  const [log, setLog] = useState({ date: today(), hours: "", fuel: "", engineHours: "" });
  const [logs, setLogs] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [trackerUrl, setTrackerUrl] = useState("");
  const [editLog, setEditLog] = useState<any | null>(null);

  const loadLogs = () => fetch(`${API_BASE}/api/equipment/${eq.id}/logs`).then((r) => (r.ok ? r.json() : [])).then((d) => setLogs(Array.isArray(d) ? d : [])).catch(() => setLogs([]));
  useEffect(() => { void loadLogs(); /* eslint-disable-next-line */ }, [eq.id]);

  const saveSvc = async () => {
    setBusy(true);
    const body: any = {};
    for (const [k, v] of Object.entries(svc)) body[k] = v === "" ? null : k === "nextServiceDate" ? v : Number(v);
    const r = await fetch(`${API_BASE}/api/equipment/${eq.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { toast.success(t("equipmentX.saved")); onChanged(); } else toast.error((await r?.json().catch(() => null))?.error || t("common.error"));
  };
  const addLog = async () => {
    if (!log.hours && !log.fuel && !log.engineHours) return;
    setBusy(true);
    const r = await fetch(`${API_BASE}/api/equipment/${eq.id}/logs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: log.date, hours: log.hours || undefined, fuel: log.fuel || undefined, engineHours: log.engineHours || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) { setLog({ date: today(), hours: "", fuel: "", engineHours: "" }); toast.success(t("equipmentX.logged")); void loadLogs(); }
    else toast.error((await r?.json().catch(() => null))?.error || t("common.error"));
  };
  const makeTracker = async () => {
    const r = await fetch(`${API_BASE}/api/equipment/${eq.id}/tracker-token`, { method: "POST" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (r?.ok && d?.url) { setTrackerUrl(d.url); try { await navigator.clipboard.writeText(d.url); toast.success(t("equipmentX.trackerCopied")); } catch { /* */ } }
    else toast.error(t("common.error"));
  };

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
      <div className="pt-2 mt-2 border-t border-border/60 space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{t("equipmentX.logTitle")}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <input type="date" value={log.date} onChange={(e) => setLog({ ...log, date: e.target.value })} className={inputCls} aria-label={t("equipmentX.date")} />
            <input type="number" min={0} max={24} value={log.hours} onChange={(e) => setLog({ ...log, hours: e.target.value })} placeholder={t("equipmentX.hours")} className={inputCls} />
            <input type="number" min={0} value={log.fuel} onChange={(e) => setLog({ ...log, fuel: e.target.value })} placeholder={t("equipmentX.fuel")} className={inputCls} />
            <input type="number" min={0} value={log.engineHours} onChange={(e) => setLog({ ...log, engineHours: e.target.value })} placeholder={t("equipmentX.engineHours")} className={inputCls} />
          </div>
          <button type="button" onClick={addLog} disabled={busy || (!log.hours && !log.fuel && !log.engineHours)} className="btn btn-primary w-full mt-1.5 py-1.5 text-xs disabled:opacity-50">{t("equipmentX.addLog")}</button>
          {logs && logs.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {logs.slice(0, 15).map((l) => (
                <li key={l.id} className="text-[11px] flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="flex-1">{l.date}{l.source === "tracker" ? " · GPS" : ""}</span>
                  <span className="font-mono">{l.hours != null ? `${l.hours} h` : ""}{l.fuel != null ? ` · ${l.fuel} l` : ""}{l.engineHours != null ? ` · ${l.engineHours} m/h` : ""}</span>
                  <RecordMenu testId={`eqlog-menu-${l.id}`} onEdit={() => setEditLog(l)}
                    onDelete={async () => { const ok = await sendJson(`${API_BASE}/api/equipment/${eq.id}/logs/${l.id}`, "DELETE"); if (ok) void loadLogs(); return ok; }} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {canManage && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{t("equipmentX.serviceTitle")}</p>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-muted-foreground">{t("equipmentX.nextServiceDate")}
                <input type="date" value={svc.nextServiceDate} onChange={(e) => setSvc({ ...svc, nextServiceDate: e.target.value })} className={inputCls} /></label>
              <label className="text-[10px] text-muted-foreground">{t("equipmentX.serviceIntervalHours")}
                <input type="number" min={0} value={svc.serviceIntervalHours} onChange={(e) => setSvc({ ...svc, serviceIntervalHours: e.target.value })} className={inputCls} /></label>
              <label className="text-[10px] text-muted-foreground">{t("equipmentX.lastServiceEngineHours")}
                <input type="number" min={0} value={svc.lastServiceEngineHours} onChange={(e) => setSvc({ ...svc, lastServiceEngineHours: e.target.value })} className={inputCls} /></label>
              <label className="text-[10px] text-muted-foreground">{t("equipmentX.fuelNormPerHour")}
                <input type="number" min={0} value={svc.fuelNormPerHour} onChange={(e) => setSvc({ ...svc, fuelNormPerHour: e.target.value })} className={inputCls} /></label>
            </div>
            <button type="button" onClick={saveSvc} disabled={busy} className="btn btn-outline w-full mt-1.5 py-1.5 text-xs disabled:opacity-50">{t("common.save")}</button>
            <button type="button" onClick={makeTracker} className="w-full mt-1.5 text-[11px] text-primary hover:underline">{t("equipmentX.trackerBtn")}</button>
            {trackerUrl && <p className="text-[10px] break-all text-muted-foreground mt-1">{t("equipmentX.trackerHint")}<br /><span className="font-mono">{trackerUrl}</span></p>}
            {eq.lastSeenAt && <p className="text-[10px] text-muted-foreground mt-1">{t("equipmentX.lastSeen", { at: new Date(eq.lastSeenAt).toLocaleString() })}</p>}
          </div>
        )}
      </div>
      {editLog && (
        <EditRecordModal title={t("equipmentX.logTitle")} initial={editLog} onClose={() => setEditLog(null)}
          fields={[
            { key: "date", label: t("equipmentX.date"), type: "date" }, { key: "hours", label: t("equipmentX.hours"), type: "number" },
            { key: "fuel", label: t("equipmentX.fuel"), type: "number" }, { key: "engineHours", label: t("equipmentX.engineHours"), type: "number" },
          ]}
          onSave={async (v) => {
            const num = (x: string) => (x === "" ? null : Number(x));
            const ok = await sendJson(`${API_BASE}/api/equipment/${eq.id}/logs/${editLog.id}`, "PATCH", { date: v.date, hours: num(v.hours), fuel: num(v.fuel), engineHours: num(v.engineHours) });
            if (ok) void loadLogs();
            return ok;
          }} />
      )}
    </motion.div>
  );
}
