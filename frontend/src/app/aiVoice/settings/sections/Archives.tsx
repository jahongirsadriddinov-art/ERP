import "../../../i18n/aiVoiceNs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Archive from "@hugeicons/core-free-icons/Archive02Icon";
import Download from "@hugeicons/core-free-icons/Download04Icon";
import { downloadFile, isNotReady, type ApiResult, type AiTranscriptArchive } from "../api";
import { archiveFileName, fmtBytes, normalizeArchives } from "../platform/helpers";
import { Card, Notice, Skeleton } from "../ui";

// Suhbatlar arxivi: 7 kundan keyin bazadan siqilgan JSONL faylga o'tkazilgan suhbatlar. Firma direktori —
// o'z firmasi (adminApi), dasturchi — barcha firmalar (platformApi). Yuklab olish token bilan (fetch → blob).
export default function Archives({ fetcher, urlOf, showCompany, testId = "ai-archives" }: {
  fetcher: () => Promise<ApiResult<unknown>>; urlOf: (id: string) => string; showCompany?: boolean; testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const h = (s: string, o?: Record<string, unknown>) => t(`aiVoice.ui.history.${s}`, o as any) as string;
  const [list, setList] = useState<AiTranscriptArchive[] | null | false | "nr">(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true;
    fetcher().then((r) => { if (alive) setList(r.ok ? normalizeArchives(r.data) : isNotReady(r) ? "nr" : false); });
    return () => { alive = false; };
  }, [fetcher]);
  const fmt = new Intl.DateTimeFormat(i18n.language === "ru" ? "ru-RU" : "uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Tashkent" });
  const d = (s: string) => { const x = new Date(s); return Number.isNaN(x.getTime()) ? s : fmt.format(x); };

  const get = async (a: AiTranscriptArchive) => {
    setBusy(a.id);
    const ok = await downloadFile(urlOf(a.id), archiveFileName(a));
    setBusy("");
    if (!ok) toast.error(h("downloadFailed"));
  };

  return (
    <Card icon={Archive} title={h("archTitle")} hint={h("archHint")} testId={testId}>
      {list === null ? <Skeleton h="h-24" /> : list === "nr" ? <Notice>{h("archNotReady")}</Notice> : list === false ? (
        <Notice tone="warn">{t("aiVoice.common.error")}</Notice>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-5">{h("archEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-3" data-testid={`ai-archive-${a.id}`}>
              <div className="flex-1 min-w-0">
                {showCompany && a.companyName && <p className="text-[11px] font-semibold text-primary truncate">{a.companyName}</p>}
                <p className="text-sm font-semibold tabular-nums truncate">
                  {a.periodFrom === a.periodTo ? d(a.periodFrom) : h("period", { from: d(a.periodFrom), to: d(a.periodTo) })}
                  {a.part && a.part > 1 ? <span className="text-muted-foreground font-normal"> · {h("part", { n: a.part })}</span> : null}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {a.conversations !== undefined ? `${h("conversations", { n: a.conversations })} · ` : ""}{fmtBytes(a.size)}{a.createdAt ? ` · ${h("created", { date: d(a.createdAt) })}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => get(a)} disabled={!!busy}
                className="h-9 px-3 rounded-xl border border-border text-xs font-semibold inline-flex items-center gap-1.5 flex-shrink-0 hover:border-primary/50 disabled:opacity-60">
                <MorphIcon icon={Download} className="w-4 h-4" /><span className="hidden sm:inline">{busy === a.id ? "…" : h("download")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
