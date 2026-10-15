import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import History from "@hugeicons/core-free-icons/File01Icon";
import { adminApi, type AiAuditItem, type AiAuditPage, type ApiResult, isNotReady } from "../api";
import { Badge, Card, Chip, Notice, Skeleton, type Tone } from "../ui";

// Audit jurnali: AI bajargan har bir amal (sahifalangan, holat bo'yicha filtr). Argumentlar va tasdiq
// tokenlari serverdan umuman kelmaydi. Dasturchi paneli ham ishlatadi (fetcher + firma nomi ko'rinadi).
type Item = AiAuditItem & { companyName?: string };
type Fetcher = (p: { page: number; limit: number; status?: string }) => Promise<ApiResult<AiAuditPage & { items: Item[] }>>;
const STATUS_TONE: Record<string, Tone> = {
  ok: "green", confirmed: "green", denied: "red", error: "red", needs_confirmation: "amber", cancelled: "gray", expired: "gray", not_found: "gray",
};
const FILTERS = ["", "ok", "needs_confirmation", "denied", "error"];
const LIMIT = 20;

export default function AuditLog({ fetcher = adminApi.getAudit as Fetcher, title, hint, testId = "ai-audit" }: { fetcher?: Fetcher; title?: string; hint?: string; testId?: string } = {}) {
  const { t, i18n } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.audit.${s}`, o as any) as string;
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(AiAuditPage & { items: Item[] }) | null | false | "nr">(null);
  useEffect(() => {
    setData(null);
    fetcher({ page, limit: LIMIT, status: status || undefined }).then((r) => setData(r.ok && r.data && Array.isArray(r.data.items) ? r.data : isNotReady(r) ? "nr" : false));
  }, [page, status, fetcher]);
  const fmt = new Intl.DateTimeFormat(i18n.language === "ru" ? "ru-RU" : "uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  const pages = data && data !== "nr" ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <Card icon={History} title={title || t("aiVoice.ui.history.auditTitle")} hint={hint || t("aiVoice.ui.history.auditHint")} testId={testId}>
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-hide pb-1 -mx-1 px-1 mb-3">
        {FILTERS.map((f) => (
          <Chip key={f || "all"} active={status === f} onClick={() => { setStatus(f); setPage(1); }}>{f ? k(`status.${f}`) : k("all")}</Chip>
        ))}
      </div>
      {data === null ? <Skeleton h="h-32" /> : data === "nr" ? <Notice>{t("aiVoice.common.notReady")}</Notice> : data === false ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice> : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{k("empty")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {data.items.map((it) => (
              <li key={it.id} className="rounded-xl border border-border bg-card/60 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{it.tool}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {it.companyName ? `${it.companyName} · ` : ""}{fmt.format(new Date(it.at))} · {it.actorName || it.actorRole} · {it.channel}{it.targetName ? ` → ${it.targetName}` : ""}
                    </p>
                    {it.resultSummary && <p className="text-xs mt-1 break-words line-clamp-2">{it.resultSummary}</p>}
                  </div>
                  <Badge tone={STATUS_TONE[it.status] || "gray"}>{k(`status.${it.status}`)}</Badge>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 mt-3">
            <button type="button" className="h-9 px-3 rounded-xl border border-border text-xs font-semibold disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{k("prev")}</button>
            <span className="text-xs text-muted-foreground tabular-nums">{k("page", { page, pages })}</span>
            <button type="button" className="h-9 px-3 rounded-xl border border-border text-xs font-semibold disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{k("next")}</button>
          </div>
        </>
      )}
    </Card>
  );
}
