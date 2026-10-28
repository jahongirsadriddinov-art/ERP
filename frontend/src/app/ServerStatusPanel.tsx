import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import { API_BASE } from "./api";
import { SkeletonList } from "./Skeleton";

// Server holati (owner 2026-10-19): UptimeRobot monitorlari — backend read-only kalit bilan so'raydi (60 s kesh).
type Monitor = { id: number; name: string; url: string; status: "up" | "down" | "paused" | "pending"; uptime: { d1: number | null; d7: number | null; d30: number | null }; responseMs: number | null };
type Res = { configured: boolean; monitors: Monitor[]; error?: string };

// TURN — qo'ng'iroq ovozini router/NAT ortidan o'tkazib beradigan relay server
// (owner 2026-10-28: "admin paneldan kuzatishni qo'sh"). Qo'ng'iroq uzilsa, sababi
// odatda shu yerda ko'rinadi: credential muddati tugagan yoki kvota to'lgan.
type Turn = { configured: boolean; ok?: boolean; usageGB?: number | null; quotaGB?: number; percent?: number | null; problem?: string | null };

const TONE: Record<Monitor["status"], string> = {
  up: "bg-emerald-500", down: "bg-red-500", paused: "bg-muted-foreground", pending: "bg-amber-500",
};
const fmt = (v: number | null) => (v === null ? "—" : `${v}%`);

export default function ServerStatusPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<Res | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/dev/uptime`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      setData(j && typeof j === "object" ? j : { configured: true, monitors: [], error: "network" });
      const tr = await fetch(`${API_BASE}/api/dev/turn`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (tr && typeof tr === "object") setTurn(tr);
    } catch {
      setData({ configured: true, monitors: [], error: "network" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(iv);
  }, [load]);

  if (!data) return <SkeletonList items={3} />;
  if (!data.configured) {
    return <p className="text-sm text-muted-foreground py-8 text-center max-w-md mx-auto">{t("devPanel.server.notConfigured")}</p>;
  }
  const down = data.monitors.filter((m) => m.status === "down").length;
  return (
    <div className="space-y-3 max-w-3xl mx-auto w-full" data-testid="dev-server-status">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${down ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}>
          {down ? t("devPanel.server.someDown", { count: down }) : t("devPanel.server.allUp")}
        </p>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label={t("devPanel.refresh")}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground disabled:opacity-50">
          <MorphIcon icon={RefreshCw} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      {data.error && <p className="text-xs text-amber-700 dark:text-amber-300">{t("devPanel.server.fetchError")}</p>}
      {turn?.configured && (
        <div className="surface rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${turn.ok ? "bg-emerald-500" : "bg-red-500 animate-pulse"}`} />
            <p className="text-sm font-semibold flex-1">Qo'ng'iroq serveri (TURN)</p>
            <p className="text-xs font-mono text-muted-foreground">
              {turn.usageGB != null ? `${turn.usageGB.toFixed(2)} / ${turn.quotaGB} GB` : `— / ${turn.quotaGB} GB`}
            </p>
          </div>
          {turn.percent != null && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${turn.percent >= 90 ? "bg-red-500" : turn.percent >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.max(1, turn.percent)}%` }} />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {turn.ok
              ? `Ishlayapti${turn.percent != null ? ` — oylik kvotaning ${turn.percent}% ishlatilgan` : ""}. Kvota tugasa qo'ng'iroq uziladi.`
              : "Ishlamayapti — credential muddati tugagan yoki kalit noto'g'ri. Metered panelida yangi credential yarating va uning API Key'ini METERED_API_KEY ga qo'ying."}
          </p>
        </div>
      )}
      {data.monitors.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{t("devPanel.server.empty")}</p>
      ) : data.monitors.map((m) => (
        <div key={m.id} className="surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${TONE[m.status]} ${m.status === "down" ? "animate-pulse" : ""}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{m.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{m.url}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 text-center text-[11px] sm:w-80">
            <div><p className="font-mono font-bold text-sm">{fmt(m.uptime.d1)}</p><p className="text-muted-foreground">{t("devPanel.server.d1")}</p></div>
            <div><p className="font-mono font-bold text-sm">{fmt(m.uptime.d7)}</p><p className="text-muted-foreground">{t("devPanel.server.d7")}</p></div>
            <div><p className="font-mono font-bold text-sm">{fmt(m.uptime.d30)}</p><p className="text-muted-foreground">{t("devPanel.server.d30")}</p></div>
            <div><p className="font-mono font-bold text-sm">{m.responseMs === null ? "—" : `${m.responseMs} ms`}</p><p className="text-muted-foreground">{t("devPanel.server.response")}</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}
