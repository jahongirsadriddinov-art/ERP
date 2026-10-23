import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { smmApi, type SmmAnalytics } from "./smmApi";
import { smmErr } from "./SmmPostCard";

// SMM statistikasi (owner 2026-10-23): Instagram ko'rsatkichlari (har 6 soatda server yangilaydi + "Yangilash"), jami,
// obunachilar dinamikasi, format bo'yicha o'rtacha faollik, eng yaxshi vaqt/format, postlar jadvali (eng yaxshisi tepada).
// Telegram kanal ko'rishlari bot API orqali olinmaydi — shuni aytamiz. recharts — lazy (faqat shu tab ochilganda).
type K = (key: string, o?: Record<string, unknown>) => string;
const TILES = ["posts", "reach", "views", "likes", "comments", "saved", "shares"] as const;
const SERIES = "var(--primary, #1B3A6B)";
const nf = (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat().format(n));

export default function SmmStats() {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.smm.${key}`, o) as string;
  const [a, setA] = useState<SmmAnalytics | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { smmApi.analytics().then((r) => { if (r.ok) setA(r.data); }); }, []);
  const refresh = async () => {
    setBusy(true);
    const r = await smmApi.refreshAnalytics();
    setBusy(false);
    if (!r.ok) { toast.error(smmErr(r.error, k)); return; }
    setA(r.data.summary);
  };
  if (!a) return <div className="h-32 rounded-xl bg-muted/40 animate-pulse" />;
  const tip = { contentStyle: { borderRadius: 10, fontSize: 12, border: "1px solid var(--border)", background: "var(--card, #fff)", color: "var(--foreground)" } };
  const fmtRows = a.byFormat.map((x) => ({ name: k(`formats.${x.key}`), v: x.avgEngagement, n: x.n }));
  const hist = a.account.history.filter((h) => h.followers !== null);
  return (
    <div className="space-y-3" data-testid="smm-stats">
      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-muted-foreground flex-1">{a.updatedAt ? k("statsUpdated", { d: new Date(a.updatedAt).toLocaleString() }) : k("statsNever")}</p>
        <button type="button" onClick={refresh} disabled={busy || !a.configured} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold disabled:opacity-50" data-testid="smm-stats-refresh">{busy ? k("working") : k("refresh")}</button>
      </div>
      {!a.configured && <p className="text-[11.5px] rounded-lg bg-amber-500/10 px-2.5 py-2">{k("statsNoIg")}</p>}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" data-testid="smm-stats-tiles">
        {a.account.latest?.followers !== undefined && (
          <div className="rounded-xl border border-border px-2.5 py-2"><p className="text-[10.5px] text-muted-foreground">{k("m.followers")}</p><p className="text-[16px] font-bold tabular-nums">{nf(Number(a.account.latest.followers))}</p></div>
        )}
        {TILES.map((m) => (
          <div key={m} className="rounded-xl border border-border px-2.5 py-2"><p className="text-[10.5px] text-muted-foreground">{k(`m.${m}`)}</p><p className="text-[16px] font-bold tabular-nums">{nf(a.totals[m])}</p></div>
        ))}
      </div>
      {(a.best.format || a.best.hour !== null) && (
        <p className="text-[12px] rounded-lg bg-emerald-500/10 px-2.5 py-2" data-testid="smm-best">
          {k("best", { f: a.best.format ? k(`formats.${a.best.format}`) : "—", h: a.best.hour !== null ? `${String(a.best.hour).padStart(2, "0")}:00` : "—" })}
        </p>
      )}
      {hist.length > 1 && (
        <figure className="rounded-xl border border-border p-2.5">
          <figcaption className="text-[12px] font-bold mb-1">{k("followersChart")}</figcaption>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={hist} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} stroke="currentColor" strokeOpacity={0.3} />
              <YAxis tick={{ fontSize: 10 }} width={40} stroke="currentColor" strokeOpacity={0.3} domain={["auto", "auto"]} />
              <Tooltip {...tip} formatter={(v: number) => [nf(v), k("m.followers")]} />
              <Line type="monotone" dataKey="followers" stroke={SERIES} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </figure>
      )}
      {fmtRows.length > 0 && (
        <figure className="rounded-xl border border-border p-2.5">
          <figcaption className="text-[12px] font-bold mb-1">{k("byFormatChart")}</figcaption>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={fmtRows} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="currentColor" strokeOpacity={0.3} />
              <YAxis tick={{ fontSize: 10 }} width={32} stroke="currentColor" strokeOpacity={0.3} />
              <Tooltip {...tip} cursor={{ fill: "currentColor", opacity: 0.05 }} formatter={(v: number) => [nf(v), k("avgEngagement")]} />
              <Bar dataKey="v" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      )}
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-[11.5px]" data-testid="smm-stats-table">
          <thead><tr className="text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-semibold">{k("post")}</th><th className="px-2 py-1.5 font-semibold text-right">{k("m.reach")}</th>
            <th className="px-2 py-1.5 font-semibold text-right">{k("m.likes")}</th><th className="px-2 py-1.5 font-semibold text-right">{k("m.comments")}</th>
            <th className="px-2 py-1.5 font-semibold text-right">{k("m.saved")}</th><th className="px-2 py-1.5 font-semibold text-right">{k("engagement")}</th>
          </tr></thead>
          <tbody>
            {a.posts.map((p) => (
              <tr key={`${p.taskId}-${p.index}`} className="border-t border-border">
                <td className="px-2 py-1.5 max-w-[12rem]"><span className="block truncate font-medium">{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline">{p.title || "—"}</a> : p.title || "—"}</span>
                  <span className="text-muted-foreground">{k(`formats.${p.kind}`)} · {new Date(p.publishedAt).toLocaleDateString()}</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{nf(p.metrics.reach)}</td><td className="px-2 py-1.5 text-right tabular-nums">{nf(p.metrics.likes)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{nf(p.metrics.comments)}</td><td className="px-2 py-1.5 text-right tabular-nums">{nf(p.metrics.saved)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{nf(p.engagement)}</td>
              </tr>
            ))}
            {!a.posts.length && <tr><td colSpan={6} className="px-2 py-3 text-muted-foreground">{k("statsEmpty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{k("tgStats", { n: a.telegram.sent })}</p>
    </div>
  );
}
