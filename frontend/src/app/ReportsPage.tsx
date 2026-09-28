import { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, Legend,
} from "recharts";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { Project, Expense, AppUser, ExpType, EXP_LABELS, fmt, exportExpensesToCsv, expLabel } from "./App";
import { API_BASE } from "./api";
import { saveOrShareBlob } from "./platform";

// Yorqin, bir-biridan aniq ajraladigan ranglar (qorong'i va yorug' fonda ham o'qiladi)
const PALETTE = ["#6366F1", "#F97316", "#10B981", "#F43F5E", "#06B6D4", "#EAB308", "#A855F7", "#3B82F6"];
const TYPE_COLOR: Record<string, string> = { material: "#F97316", oylik: "#6366F1", jihozlar: "#06B6D4", transport: "#10B981", boshqa: "#A855F7" };
const short = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} mlrd` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} mln` : n >= 1e3 ? `${Math.round(n / 1e3)} ming` : String(Math.round(n));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;

type Range = "7" | "30" | "month" | "90" | "year" | "all" | "custom";

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-xl text-xs">
      {label != null && <p className="font-semibold mb-1">{label}</p>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-mono font-semibold">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children, delay = 0, className = "", right }: { title?: string; children: React.ReactNode; delay?: number; className?: string; right?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, type: "spring", stiffness: 300, damping: 28 }}
      className={`surface border border-border rounded-2xl p-4 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold font-['Roboto_Slab',serif]">{title}</p>
          {right}
        </div>
      )}
      {children}
    </motion.div>
  );
}

export default function ReportsPage({ projects, expenses, incomes, users }:
  { projects: Project[]; expenses: Expense[]; incomes: Expense[]; users: AppUser[] }) {
  const { t } = useTranslation();
  const [selProj, setSelProj] = useState("all");
  const [range, setRange] = useState<Range>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");

  const today = iso(new Date());
  const [dateFrom, dateTo] = useMemo((): [string, string] => {
    const d = new Date();
    if (range === "custom") return [customFrom, customTo];
    if (range === "all") return ["", ""];
    if (range === "month") return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), today];
    if (range === "year") return [iso(new Date(d.getFullYear(), 0, 1)), today];
    const from = new Date(d); from.setDate(d.getDate() - (Number(range) - 1));
    return [iso(from), today];
  }, [range, customFrom, customTo, today]);

  const inRange = (e: Expense, from: string, to: string) => (!from || e.date >= from) && (!to || e.date <= to);
  const byProj = (e: Expense) => selProj === "all" || e.projectId === selProj;
  const confirmedExp = expenses.filter(e => e.status === "confirmed" && byProj(e));
  const filtExp = confirmedExp.filter(e => inRange(e, dateFrom, dateTo));
  const filtInc = incomes.filter(e => e.status === "confirmed" && byProj(e) && inRange(e, dateFrom, dateTo));
  const total = filtExp.reduce((a, e) => a + e.amount, 0);
  const totalIncome = filtInc.reduce((a, e) => a + e.amount, 0);
  const net = totalIncome - total;

  // Oldingi xuddi shunday uzunlikdagi davr bilan solishtirish (Δ %)
  const prevTotal = useMemo(() => {
    if (!dateFrom || !dateTo) return null;
    const len = daysBetween(dateFrom, dateTo);
    const pTo = new Date(dateFrom); pTo.setDate(pTo.getDate() - 1);
    const pFrom = new Date(pTo); pFrom.setDate(pTo.getDate() - (len - 1));
    return confirmedExp.filter(e => inRange(e, iso(pFrom), iso(pTo))).reduce((a, e) => a + e.amount, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, expenses, selProj]);
  const delta = prevTotal != null && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const spanDays = dateFrom && dateTo ? daysBetween(dateFrom, dateTo) : Math.max(1, new Set(filtExp.map(e => e.date)).size);

  // Trend: 62 kungacha — kunlik, undan ko'p — oylik
  const trend = useMemo(() => {
    const monthly = !(dateFrom && dateTo && daysBetween(dateFrom, dateTo) <= 62);
    const key = (d: string) => monthly ? d.slice(0, 7) : d;
    const map = new Map<string, { k: string; chiqim: number; kirim: number }>();
    if (!monthly && dateFrom && dateTo) {
      for (let d = new Date(dateFrom); iso(d) <= dateTo; d.setDate(d.getDate() + 1)) map.set(iso(d), { k: iso(d), chiqim: 0, kirim: 0 });
    }
    for (const e of filtExp) { const k = key(e.date); const r = map.get(k) || { k, chiqim: 0, kirim: 0 }; r.chiqim += e.amount; map.set(k, r); }
    for (const e of filtInc) { const k = key(e.date); const r = map.get(k) || { k, chiqim: 0, kirim: 0 }; r.kirim += e.amount; map.set(k, r); }
    return [...map.values()].sort((a, b) => a.k.localeCompare(b.k)).map(r => ({ ...r, label: monthly ? r.k : r.k.slice(5).split("-").reverse().join(".") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtExp.length, filtInc.length, dateFrom, dateTo, total, totalIncome]);

  const byType = (Object.keys(EXP_LABELS) as ExpType[])
    .map(k => ({ key: k, name: expLabel(t, k), value: filtExp.filter(e => e.type === k).reduce((a, e) => a + e.amount, 0) }))
    .filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  // Obyektlarni turlar bo'yicha solishtirish (stacked)
  const objCompare = projects.map(p => {
    const row: any = { name: p.name.length > 18 ? p.name.slice(0, 17) + "…" : p.name, total: 0 };
    for (const k of Object.keys(EXP_LABELS)) {
      const v = filtExp.filter(e => e.projectId === p.id && e.type === k).reduce((a, e) => a + e.amount, 0);
      row[k] = v; row.total += v;
    }
    return row;
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);

  // Byudjet holati — butun davr bo'yicha (byudjet obyektning umumiy limiti)
  const budgetRows = projects.map(p => {
    const spent = expenses.filter(e => e.projectId === p.id && e.status === "confirmed").reduce((a, e) => a + e.amount, 0);
    const budget = p.budget || 0;
    const percent = budget > 0 ? Math.round((spent / budget) * 100) : null;
    return { id: p.id, name: p.name, budget, spent, percent };
  }).filter(r => r.budget > 0).sort((a, b) => (b.percent || 0) - (a.percent || 0));
  const totalBudget = budgetRows.reduce((a, r) => a + r.budget, 0);
  const totalBudgetSpent = budgetRows.reduce((a, r) => a + r.spent, 0);

  const weekdays = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
  const byWeekday = weekdays.map((name, i) => ({
    name,
    chiqim: filtExp.filter(e => ((new Date(e.date + "T00:00:00").getDay() + 6) % 7) === i).reduce((a, e) => a + e.amount, 0),
  }));
  const topExpenses = [...filtExp].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const tableRows = [...filtExp].sort((a, b) => sortBy === "amount" ? b.amount - a.amount : b.date.localeCompare(a.date));

  const doExport = async () => {
    if (filtExp.length === 0) { toast.warning(t('reports.exportEmpty')); return; }
    const projLabel = selProj === "all" ? "barcha" : (projects.find(p => p.id === selProj)?.name || "obyekt");
    const rangeLabel = [dateFrom, dateTo].filter(Boolean).join("_") || today;
    const name = `hisobot_${projLabel}_${rangeLabel}`.replace(/\s+/g, "-");
    setExporting(true);
    try {
      const qs = new URLSearchParams({ ...(dateFrom && { from: dateFrom }), ...(dateTo && { to: dateTo }), ...(selProj !== "all" && { projectId: selProj }) });
      const token = localStorage.getItem("token");
      const r = await fetch(`${API_BASE}/api/export1c/report?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(String(r.status));
      const saved = await saveOrShareBlob(`${name}.xlsx`, await r.blob());
      if (!saved.ok) toast.error(t('common.error'));
    } catch {
      exportExpensesToCsv(filtExp, users, projects, `${name}.csv`); // server ishlamasa — CSV zaxira
    }
    setExporting(false);
  };

  const ranges: [Range, string][] = [
    ["7", t('reports.r7', { defaultValue: "7 kun" })], ["30", t('reports.r30', { defaultValue: "30 kun" })],
    ["month", t('reports.rMonth', { defaultValue: "Bu oy" })], ["90", t('reports.r90', { defaultValue: "3 oy" })],
    ["year", t('reports.rYear', { defaultValue: "Bu yil" })], ["all", t('reports.rAll', { defaultValue: "Hammasi" })],
    ["custom", t('reports.rCustom', { defaultValue: "Tanlash" })],
  ];
  const kpis = [
    { label: t('reports.totalExpense'), value: fmt(total), sub: delta != null ? `${delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} ${Math.abs(delta)}% ${t('reports.vsPrev', { defaultValue: "oldingi davrga nisbatan" })}` : "", tone: delta != null && delta > 0 ? "text-rose-500" : "text-emerald-500", grad: "from-orange-500/20 to-rose-500/10" },
    { label: t('reports.pnlIncome'), value: fmt(totalIncome), sub: `${filtInc.length} ${t('reports.ops', { defaultValue: "ta amal" })}`, tone: "text-muted-foreground", grad: "from-emerald-500/20 to-cyan-500/10" },
    { label: t('reports.pnlNet'), value: `${net >= 0 ? "+" : ""}${fmt(net)}`, sub: "", tone: "", grad: net >= 0 ? "from-emerald-500/20 to-emerald-500/5" : "from-rose-500/25 to-rose-500/5", valueTone: net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400" },
    { label: t('reports.perDay', { defaultValue: "Kunlik o'rtacha" }), value: fmt(Math.round(total / spanDays)), sub: `${filtExp.length} ${t('reports.ops', { defaultValue: "ta amal" })}`, tone: "text-muted-foreground", grad: "from-indigo-500/20 to-violet-500/10" },
  ];

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      <div className="surface border border-border rounded-2xl px-4 py-3 flex flex-col gap-2.5 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <h2 className="text-base font-bold font-['Roboto_Slab',serif] flex-shrink-0">{t('reports.title')}</h2>
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
            <select className="text-sm md:text-xs border border-border rounded-full px-3 py-1.5 bg-input-background focus:outline-none" value={selProj} onChange={e => setSelProj(e.target.value)}>
              <option value="all">{t('reports.allProjects')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={doExport} disabled={exporting} className="btn btn-accent flex items-center gap-1.5 text-sm md:text-xs px-3.5 py-1.5 rounded-full flex-shrink-0 disabled:opacity-60">
              <MorphIcon icon={Download} className={`w-3.5 h-3.5 ${exporting ? "animate-bounce" : ""}`} />{t('reports.exportExcel')}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {ranges.map(([k, l]) => (
            <button key={k} onClick={() => setRange(k)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap border liquid-transition ${range === k ? "bg-primary text-white border-primary shadow-md shadow-primary/25" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}>{l}</button>
          ))}
          {range === "custom" && (
            <div className="flex items-center gap-1.5 ml-1">
              <input type="date" className="text-xs border border-border rounded-full px-2.5 py-1.5 bg-input-background" value={customFrom} onChange={e => setCustomFrom(e.target.value)} aria-label={t('reports.dateFrom')} />
              <span className="text-muted-foreground">—</span>
              <input type="date" className="text-xs border border-border rounded-full px-2.5 py-1.5 bg-input-background" value={customTo} onChange={e => setCustomTo(e.target.value)} aria-label={t('reports.dateTo')} />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain space-y-3 pb-2 px-0.5">
        {/* KPI kartalari */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 28 }}
              className={`relative overflow-hidden rounded-2xl border border-border p-4 bg-gradient-to-br ${k.grad}`}>
              <p className="text-xs text-muted-foreground font-medium">{k.label}</p>
              <p className={`text-lg md:text-xl font-bold font-mono mt-1 truncate ${(k as any).valueTone || ""}`}>{k.value}</p>
              {k.sub && <p className={`text-[11px] mt-1 font-medium ${k.tone}`}>{k.sub}</p>}
            </motion.div>
          ))}
        </div>

        {/* Trend */}
        <Card title={t('reports.trend', { defaultValue: "Dinamika: chiqim va kirim" })} delay={0.05}>
          {trend.length === 0 ? <p className="text-sm text-muted-foreground py-10 text-center">{t('reports.exportEmpty')}</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F97316" stopOpacity={0.45} /><stop offset="100%" stopColor="#F97316" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10B981" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }} tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Area type="monotone" dataKey="chiqim" name={t('reports.expense')} stroke="#F97316" strokeWidth={2.5} fill="url(#gExp)" dot={false} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="kirim" name={t('reports.pnlIncome')} stroke="#10B981" strokeWidth={2.5} fill="url(#gInc)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Donut */}
          <Card title={t('reports.byType')} delay={0.08}>
            {byType.length === 0 ? <p className="text-sm text-muted-foreground py-10 text-center">{t('reports.exportEmpty')}</p> : (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="relative w-[200px] h-[200px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byType} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} cornerRadius={6} stroke="none">
                        {byType.map(d => <Cell key={d.key} fill={TYPE_COLOR[d.key] || PALETTE[0]} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">{t('reports.totalExpense')}</p>
                    <p className="text-sm font-bold font-mono">{short(total)}</p>
                  </div>
                </div>
                <div className="flex-1 w-full space-y-2">
                  {byType.map(d => {
                    const pct = total ? Math.round((d.value / total) * 100) : 0;
                    return (
                      <div key={d.key}>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLOR[d.key] }} />
                          <span className="font-medium">{d.name}</span>
                          <span className="ml-auto font-mono">{fmt(d.value)}</span>
                          <span className="w-9 text-right text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: TYPE_COLOR[d.key] }} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Hafta kunlari */}
          <Card title={t('reports.byWeekday', { defaultValue: "Hafta kunlari bo'yicha" })} delay={0.1}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byWeekday} margin={{ left: 0, right: 8 }}>
                <defs><linearGradient id="gWd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366F1" /><stop offset="100%" stopColor="#A855F7" /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "currentColor", opacity: 0.7 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }} tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Bar dataKey="chiqim" name={t('reports.expense')} fill="url(#gWd)" radius={[8, 8, 2, 2]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Obyektlarni solishtirish */}
        {objCompare.length > 0 && (
          <Card title={t('reports.compareObjects', { defaultValue: "Obyektlarni solishtirish (turlar bo'yicha)" })} delay={0.12}>
            <ResponsiveContainer width="100%" height={Math.max(160, objCompare.length * 46 + 40)}>
              <BarChart data={objCompare} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} horizontal={false} />
                <XAxis type="number" tickFormatter={short} tick={{ fontSize: 10, fill: "currentColor", opacity: 0.6 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "currentColor", opacity: 0.8 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                {Object.keys(EXP_LABELS).map((k, i, arr) => (
                  <Bar key={k} dataKey={k} stackId="a" name={expLabel(t, k as ExpType)} fill={TYPE_COLOR[k]} maxBarSize={26}
                    radius={i === arr.length - 1 ? [0, 8, 8, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Byudjet nazorati */}
          <Card title={t('reports.budgetVsActual')} delay={0.14}
            right={totalBudget > 0 ? <span className="text-xs font-mono text-muted-foreground">{Math.round((totalBudgetSpent / totalBudget) * 100)}%</span> : undefined}>
            {budgetRows.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">{t('reports.noBudget', { defaultValue: "Obyektlarga byudjet kiritilmagan" })}</p> : (
              <div className="space-y-3">
                {budgetRows.map(r => {
                  const p = r.percent || 0;
                  const color = p >= 100 ? "#F43F5E" : p >= 80 ? "#EAB308" : "#10B981";
                  return (
                    <div key={r.id}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold truncate">{r.name}</span>
                        <span className="font-mono whitespace-nowrap">{short(r.spent)} / {short(r.budget)}</span>
                        <span className="px-1.5 py-0.5 rounded-md font-bold text-[10px] text-white" style={{ background: color }}>{p}%</span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, p)}%`, background: `linear-gradient(90deg, ${color}aa, ${color})` }} />
                        <div className="absolute top-0 bottom-0 w-px bg-foreground/30" style={{ left: "80%" }} title="80%" />
                      </div>
                      {p >= 100 && <p className="text-[10px] text-rose-500 mt-1">{t('reports.overBudget', { percent: p })}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Eng katta chiqimlar */}
          <Card title={t('reports.topExpenses', { defaultValue: "Eng katta chiqimlar" })} delay={0.16}>
            {topExpenses.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">{t('reports.exportEmpty')}</p> : (
              <div className="space-y-2">
                {topExpenses.map((e, i) => {
                  const proj = projects.find(p => p.id === e.projectId);
                  return (
                    <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{e.description || expLabel(t, e.type)}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{e.date} · {proj?.name || e.objectLabel || "—"} · {expLabel(t, e.type)}</p>
                      </div>
                      <span className="text-sm font-bold font-mono whitespace-nowrap">{short(e.amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Batafsil jadval */}
        <Card title={t('reports.detailedTable')} delay={0.18} className="!p-0 overflow-hidden"
          right={undefined}>
          <div className="flex items-center justify-between px-4 pb-2 -mt-1">
            <span className="text-xs text-muted-foreground">{tableRows.length} {t('reports.ops', { defaultValue: "ta amal" })}</span>
            <div className="flex gap-1">
              {(["date", "amount"] as const).map(k => (
                <button key={k} onClick={() => setSortBy(k)} className={`text-[11px] px-2.5 py-1 rounded-full border ${sortBy === k ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground"}`}>
                  {k === "date" ? t('reports.table.date') : t('reports.table.amount')}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm md:text-xs">
              <thead className="sticky top-0 bg-card z-10"><tr className="border-y border-border">{[t('reports.table.date'), t('reports.table.description'), t('reports.table.type'), t('reports.table.to'), t('reports.table.project'), t('reports.table.amount')].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {tableRows.map(e => {
                  const to = users.find(u => u.id === e.toUserId);
                  const proj = projects.find(p => p.id === e.projectId);
                  return (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{e.date}</td>
                      <td className="px-3 py-2 max-w-[220px] truncate">
                        {e.anomaly && <span className="mr-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600" title={t('reports.anomaly', { defaultValue: "G'ayrioddiy katta chiqim" })}>⚠</span>}
                        {e.description || expLabel(t, e.type)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: TYPE_COLOR[e.type] || PALETTE[0] }}>{expLabel(t, e.type)}</span></td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{to?.name ?? e.recipientName ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{proj?.name ?? e.objectLabel ?? "-"}</td>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{fmt(e.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
