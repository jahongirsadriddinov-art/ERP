import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { SkeletonList } from "./Skeleton";

// Dasturchi paneli → "Xatolar" (owner 2026-10-22): server/sayt/bot/fon ishlari xatolari guruhlangan holda
// (backend services/errorTracker.ts → GET /api/errors/events). Tafsilot: qayerda, kod joyi, ekran va oxirgi
// amal, stack, oxirgi holatlar; "Hal qilindi" — qayta chiqsa dasturchiga yana Telegram xabari boradi.
type Source = "server" | "client" | "bot" | "worker";
type Item = {
  id: string; source: Source; kind?: string; message: string; where?: string; topFrame?: string; page?: string;
  count: number; users: number; firstSeen: string; lastSeen: string; resolved: boolean; reopenedCount?: number; platform?: string; appVersion?: string;
};
type Occ = { at: string; where?: string; page?: string; action?: string; userId?: string; companyId?: string; role?: string; platform?: string; appVersion?: string; status?: number };
type Detail = Item & {
  stack?: string; componentStack?: string; action?: string; breadcrumbs?: string[]; companies: number; lastRole?: string; userAgent?: string; occurrences: Occ[];
};
type Status = "open" | "resolved" | "all";

const SOURCE_TONE: Record<Source, string> = {
  server: "bg-red-500/10 text-red-700 dark:text-red-300",
  client: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  bot: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  worker: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};
const fmtDate = (v?: string) => (v ? new Date(v).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function ErrorLogPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("open");
  const [source, setSource] = useState<"" | Source>("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(0);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ status, limit: "100" });
      if (source) qs.set("source", source);
      if (q.trim()) qs.set("q", q.trim());
      const r = await fetch(`${API_BASE}/api/errors/events?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
      setOpen(Number(j.open) || 0);
      setFailed(false);
    } catch {
      setFailed(true);
      setItems((prev) => prev || []);
    } finally {
      setBusy(false);
    }
  }, [status, source, q]);

  useEffect(() => {
    const h = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(h);
  }, [load, q]);

  const openDetail = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/errors/events/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setDetail(await r.json());
    } catch {
      toast.error(t("devPanel.errorLog.loadError"));
    }
  };

  const setResolved = async (resolved: boolean) => {
    if (!detail) return;
    const r = await fetch(`${API_BASE}/api/errors/events/${detail.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolved }),
    }).catch(() => null);
    if (!r?.ok) { toast.error(t("devPanel.errorLog.loadError")); return; }
    toast.success(t(resolved ? "devPanel.errorLog.resolvedToast" : "devPanel.errorLog.reopenedToast"));
    setDetail({ ...detail, resolved });
    void load();
  };

  if (detail) {
    const rows: Array<[string, string | undefined]> = [
      [t("devPanel.errorLog.where"), detail.where],
      [t("devPanel.errorLog.code"), detail.topFrame],
      [t("devPanel.errorLog.screen"), detail.page],
      [t("devPanel.errorLog.action"), detail.action],
      [t("devPanel.errorLog.breadcrumbs"), detail.breadcrumbs?.join(" → ")],
      [t("devPanel.errorLog.device"), [detail.platform, detail.appVersion && `v${detail.appVersion}`, detail.userAgent].filter(Boolean).join(" · ") || undefined],
      [t("devPanel.errorLog.role"), detail.lastRole],
      [t("devPanel.errorLog.firstSeen"), fmtDate(detail.firstSeen)],
      [t("devPanel.errorLog.lastSeen"), fmtDate(detail.lastSeen)],
    ];
    return (
      <div className="space-y-3 max-w-4xl mx-auto w-full" data-testid="err-detail">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDetail(null)} aria-label={t("devPanel.errorLog.back")}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground">
            <MorphIcon icon={ChevronLeft} className="w-4 h-4" />
          </button>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${SOURCE_TONE[detail.source]}`}>{t(`devPanel.errorLog.sources.${detail.source}`)}{detail.kind ? ` · ${detail.kind}` : ""}</span>
          <div className="flex-1" />
          {/* Owner 2026-10-22: xatoni nusxalab (dasturchiga/AI'ga) yuborish uchun — hamma tafsilot bitta matnda */}
          <button type="button" data-testid="err-copy" onClick={() => {
            const lines = [
              `[${detail.source}${detail.kind ? `/${detail.kind}` : ""}] ${detail.message}`,
              ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
              `Marta: ${detail.count} · Foydalanuvchilar: ${detail.users} · Firmalar: ${detail.companies}`,
              detail.action ? `Oxirgi amal: ${detail.action}` : "",
              detail.breadcrumbs?.length ? `Oldingi amallar: ${detail.breadcrumbs.join(" → ")}` : "",
              detail.userAgent ? `Qurilma: ${detail.userAgent}` : "",
              detail.stack ? `\nStack:\n${detail.stack}` : "",
              detail.componentStack ? `\nKomponentlar:\n${detail.componentStack}` : "",
            ].filter(Boolean).join("\n");
            navigator.clipboard?.writeText(lines).then(() => toast.success(t("devPanel.errorLog.copied", { defaultValue: "Nusxa olindi" })))
              .catch(() => toast.error(t("devPanel.errorLog.copyFailed", { defaultValue: "Nusxa olib bo'lmadi" })));
          }} className="px-3.5 py-2 rounded-full text-[13px] font-semibold bg-muted hover:bg-muted/70">📋 {t("devPanel.errorLog.copy", { defaultValue: "Nusxa olish" })}</button>
          {detail.resolved ? (
            <button type="button" data-testid="err-reopen" onClick={() => void setResolved(false)}
              className="px-3.5 py-2 rounded-full text-[13px] font-semibold bg-muted hover:bg-muted/70">{t("devPanel.errorLog.reopen")}</button>
          ) : (
            <button type="button" data-testid="err-resolve" onClick={() => void setResolved(true)}
              className="px-3.5 py-2 rounded-full text-[13px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700">✓ {t("devPanel.errorLog.resolve")}</button>
          )}
        </div>
        <div className="surface rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold break-words" data-testid="err-detail-message">{detail.message}</p>
          <p className="text-[12px] text-muted-foreground">
            {t("devPanel.errorLog.count", { count: detail.count })} · {t("devPanel.errorLog.users", { count: detail.users })} · {t("devPanel.errorLog.companies", { count: detail.companies })}
            {detail.reopenedCount ? ` · ${t("devPanel.errorLog.reopened", { count: detail.reopenedCount })}` : ""}
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-[12px] break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {detail.stack && (
          <div className="surface rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t("devPanel.errorLog.stack")}</p>
            <pre className="text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all" data-testid="err-stack">{detail.stack}</pre>
          </div>
        )}
        {detail.componentStack && (
          <div className="surface rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t("devPanel.errorLog.componentStack")}</p>
            <pre className="text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">{detail.componentStack.trim()}</pre>
          </div>
        )}
        {detail.occurrences?.length > 0 && (
          <div className="surface rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">{t("devPanel.errorLog.occurrences")}</p>
            <ul className="space-y-1.5 text-[12px]" data-testid="err-occurrences">
              {detail.occurrences.map((o, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 border-b border-border/50 pb-1.5 last:border-0">
                  <span className="font-mono text-muted-foreground">{fmtDate(o.at)}</span>
                  <span className="break-all">{o.where || o.page || "—"}</span>
                  {o.action && <span className="text-muted-foreground">· {o.action}</span>}
                  {(o.role || o.platform) && <span className="text-muted-foreground">· {[o.role, o.platform, o.appVersion && `v${o.appVersion}`].filter(Boolean).join(" ")}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const pill = (active: boolean) => `px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${active ? "bg-primary text-white" : "bg-muted/50 text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="space-y-3 max-w-4xl mx-auto w-full" data-testid="err-panel">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${open ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`} data-testid="err-open-count">
          {t("devPanel.errorLog.openCount", { count: open })}
        </p>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label={t("devPanel.refresh")}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground disabled:opacity-50">
          <MorphIcon icon={RefreshCw} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide" role="group">
        {(["open", "resolved", "all"] as Status[]).map((s) => (
          <button key={s} type="button" data-testid={`err-status-${s}`} aria-pressed={status === s} onClick={() => setStatus(s)} className={pill(status === s)}>{t(`devPanel.errorLog.${s}`)}</button>
        ))}
        <span className="w-px bg-border mx-1 flex-shrink-0" />
        {(["", "server", "client", "bot", "worker"] as const).map((s) => (
          <button key={s || "all"} type="button" data-testid={`err-source-${s || "all"}`} aria-pressed={source === s} onClick={() => setSource(s)} className={pill(source === s)}>
            {t(`devPanel.errorLog.sources.${s || "all"}`)}
          </button>
        ))}
      </div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("devPanel.errorLog.search")} aria-label={t("devPanel.errorLog.search")}
        className="w-full rounded-xl bg-muted/40 border border-border px-3 py-2 text-sm" />
      {failed && <p className="text-xs text-amber-700 dark:text-amber-300">{t("devPanel.errorLog.loadError")}</p>}
      {items === null ? (
        <SkeletonList items={4} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t("devPanel.errorLog.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" data-testid="err-row" onClick={() => void openDetail(it.id)}
                className="surface rounded-2xl p-3.5 w-full text-left hover:bg-muted/40 liquid-transition">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SOURCE_TONE[it.source]}`}>{t(`devPanel.errorLog.sources.${it.source}`)}</span>
                  {it.resolved && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">✓ {t("devPanel.errorLog.resolved")}</span>}
                  <span className="ml-auto text-[11px] text-muted-foreground font-mono">{fmtDate(it.lastSeen)}</span>
                </div>
                <p className="text-sm font-semibold line-clamp-2 break-words">{it.message}</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{[it.where, it.topFrame].filter(Boolean).join(" · ") || it.page || "—"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{t("devPanel.errorLog.count", { count: it.count })} · {t("devPanel.errorLog.users", { count: it.users })}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
