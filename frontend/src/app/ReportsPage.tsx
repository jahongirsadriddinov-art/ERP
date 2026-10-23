import { useEffect, useMemo, useRef, useState } from "react";
import { oneOf, usePersistentState } from "./lib/persistentState";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, Legend, ComposedChart, Line,
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { Project, Expense, AppUser, ExpType, EXP_LABELS, fmt, expLabel, roleLabel } from "./App";
import { API_BASE } from "./api";
import { lazy, Suspense } from "react";
const ControlPanel = lazy(() => import("./ControlPanel"));

// Yorqin, bir-biridan aniq ajraladigan ranglar (qorong'i va yorug' fonda ham o'qiladi)
const PALETTE = ["#6366F1", "#F97316", "#10B981", "#F43F5E", "#06B6D4", "#EAB308", "#A855F7", "#3B82F6"];
const TYPE_COLOR: Record<string, string> = { material: "#F97316", oylik: "#6366F1", jihozlar: "#06B6D4", transport: "#10B981", boshqa: "#A855F7" };
const INC = "#10B981", EXP = "#F97316", BAL = "#6366F1";
const short = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e9 ? `${s}${(a / 1e9).toFixed(1)} mlrd` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1)} mln` : a >= 1e3 ? `${s}${Math.round(a / 1e3)} ming` : `${s}${Math.round(a)}`; };
const iso = (d: Date) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
const ddmm = (s: string) => s.slice(5).split("-").reverse().join(".");

type Range = "7" | "30" | "month" | "90" | "year" | "all" | "custom";

// Telefon (≤767px): filtr paneli yig'iladi, grafiklar pastroq, jadval o'rniga kartalar.
function useNarrow() {
  const q = "(max-width: 767px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-xl text-xs max-w-[240px]">
      {label != null && <p className="font-semibold mb-1">{label}</p>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted-foreground truncate">{p.name}</span>
          <span className="ml-auto font-mono font-semibold whitespace-nowrap">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children, delay = 0, className = "", right, testId }: { title?: string; children: React.ReactNode; delay?: number; className?: string; right?: React.ReactNode; testId?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, type: "spring", stiffness: 300, damping: 28 }}
      data-testid={testId} className={`surface border border-border rounded-2xl p-3 sm:p-4 min-w-0 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
          <p className="text-sm font-semibold font-display min-w-0 truncate">{title}</p>
          {right}
        </div>
      )}
      {children}
    </motion.div>
  );
}

// Gorizontal ulush chizig'i bilan ro'yxat qatori (telefonda grafikdan ko'ra o'qishga oson)
function ShareRow({ label, sub, value, pct, color }: { label: string; sub?: string; value: string; pct: number; color: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 text-xs min-w-0">
        <span className="font-semibold truncate min-w-0">{label}</span>
        {sub && <span className="text-[10px] text-muted-foreground truncate min-w-0">{sub}</span>}
        <span className="ml-auto font-mono font-semibold whitespace-nowrap">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} /></div>
    </div>
  );
}

export default function ReportsPage({ projects, expenses, incomes, users, showIncome = false }:
  { projects: Project[]; expenses: Expense[]; incomes: Expense[]; users: AppUser[]; showIncome?: boolean }) {
  const { t } = useTranslation();
  const narrow = useNarrow();
  const [selProj, setSelProj] = useState("all");
  const [range, setRange] = useState<Range>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [tableKind, setTableKind] = useState<"exp" | "inc">("exp");
  const [tableLimit, setTableLimit] = useState(60);
  // Owner 2026-10-22: telefonda filtr paneli ekrandan chiqib ketardi — endi yig'iladigan: tepada ixcham qator
  // (joriy davr · obyekt), bosilganda to'liq panel ochiladi; tashqariga bosilganda yoki aylantirilganda yopiladi.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  // Owner 2026-10-19: "Nazorat" — o'g'irlik, narx, hujjat muddati, texnika va funksiyalar sozlamasi
  const [view, setView] = usePersistentState<"finance" | "control">("reports.view", "finance", oneOf(["finance", "control"]));
  // Owner 2026-10-22: kirim va chiqim ALOHIDA hisoblanadi; balans (kirim − chiqim) faqat foydalanuvchi yoqsa
  const [showBalance, setShowBalance] = usePersistentState<boolean>("reports.balance", false, (v) => typeof v === "boolean");

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: PointerEvent) => { if (headerRef.current && !headerRef.current.contains(e.target as Node)) setFiltersOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [filtersOpen]);

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
  const filtInc = showIncome ? incomes.filter(e => e.status === "confirmed" && byProj(e) && inRange(e, dateFrom, dateTo)) : [];
  const total = filtExp.reduce((a, e) => a + e.amount, 0);
  const totalIncome = filtInc.reduce((a, e) => a + e.amount, 0);
  const net = totalIncome - total;
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const projById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

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

  // Trend: 62 kungacha — kunlik (telefonda 31 kungacha), undan ko'p — oylik. "balans" — davr boshidan jamlanma.
  const trend = useMemo(() => {
    // Telefonda ustunlar ingichka chiziq bo'lib qolmasin: 14 kungacha — kunlik, 120 kungacha — haftalik.
    const len = dateFrom && dateTo ? daysBetween(dateFrom, dateTo) : Infinity;
    const mode: "day" | "week" | "month" = len <= (narrow ? 14 : 62) ? "day" : narrow && len <= 120 ? "week" : "month";
    const monthly = mode === "month";
    const monday = (d: string) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
    const key = (d: string) => mode === "month" ? d.slice(0, 7) : mode === "week" ? monday(d) : d;
    const map = new Map<string, { k: string; chiqim: number; kirim: number }>();
    if (!monthly && dateFrom && dateTo) {
      for (let d = new Date(dateFrom); iso(d) <= dateTo; d.setDate(d.getDate() + 1)) { const k = key(iso(d)); if (!map.has(k)) map.set(k, { k, chiqim: 0, kirim: 0 }); }
    }
    for (const e of filtExp) { const k = key(e.date); const r = map.get(k) || { k, chiqim: 0, kirim: 0 }; r.chiqim += e.amount; map.set(k, r); }
    for (const e of filtInc) { const k = key(e.date); const r = map.get(k) || { k, chiqim: 0, kirim: 0 }; r.kirim += e.amount; map.set(k, r); }
    let bal = 0;
    return [...map.values()].sort((a, b) => a.k.localeCompare(b.k)).map(r => {
      bal += r.kirim - r.chiqim;
      return { ...r, balans: bal, label: monthly ? `${r.k.slice(5)}.${r.k.slice(2, 4)}` : ddmm(r.k) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtExp.length, filtInc.length, dateFrom, dateTo, total, totalIncome, narrow]);

  const byType = (Object.keys(EXP_LABELS) as ExpType[])
    .map(k => ({ key: k, name: expLabel(t, k), value: filtExp.filter(e => e.type === k).reduce((a, e) => a + e.amount, 0) }))
    .filter(d => d.value > 0).sort((a, b) => b.value - a.value);

  // Obyektlarni turlar bo'yicha solishtirish (stacked)
  const nameMax = narrow ? 12 : 18;
  const objCompare = projects.map(p => {
    const row: any = { name: p.name.length > nameMax ? p.name.slice(0, nameMax - 1) + "…" : p.name, total: 0 };
    for (const k of Object.keys(EXP_LABELS)) {
      const v = filtExp.filter(e => e.projectId === p.id && e.type === k).reduce((a, e) => a + e.amount, 0);
      row[k] = v; row.total += v;
    }
    return row;
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, narrow ? 6 : 8);

  // Kirim monitoringi (owner 2026-10-22): obyektlar bo'yicha balans va kirimni kim kiritgani
  const objBalance = useMemo(() => {
    const m = new Map<string, { id: string; name: string; inc: number; exp: number }>();
    const get = (e: Expense) => {
      const id = e.projectId && projById.has(e.projectId) ? e.projectId : "_";
      let r = m.get(id);
      if (!r) { r = { id, name: id === "_" ? t('reports.noObject', { defaultValue: "Obyektsiz" }) : projById.get(id)!.name, inc: 0, exp: 0 }; m.set(id, r); }
      return r;
    };
    for (const e of filtInc) get(e).inc += e.amount;
    for (const e of filtExp) get(e).exp += e.amount;
    return [...m.values()].sort((a, b) => (b.inc - b.exp) - (a.inc - a.exp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtInc.length, filtExp.length, totalIncome, total, projById]);
  const incByPerson = useMemo(() => {
    const m = new Map<string, { id: string; v: number; n: number }>();
    for (const e of filtInc) { const id = e.createdById || "_"; const r = m.get(id) || { id, v: 0, n: 0 }; r.v += e.amount; r.n++; m.set(id, r); }
    return [...m.values()].sort((a, b) => b.v - a.v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtInc.length, totalIncome]);
  const maxObjAbs = Math.max(1, ...objBalance.map(r => Math.max(r.inc, r.exp)));

  // Byudjet holati — butun davr bo'yicha (byudjet obyektning umumiy limiti)
  const budgetRows = projects.map(p => {
    const spent = expenses.filter(e => e.projectId === p.id && e.status === "confirmed").reduce((a, e) => a + e.amount, 0);
    const budget = p.budget || 0;
    const percent = budget > 0 ? Math.round((spent / budget) * 100) : null;
    return { id: p.id, name: p.name, budget, spent, percent };
  }).filter(r => r.budget > 0).filter(r => selProj === "all" || r.id === selProj).sort((a, b) => (b.percent || 0) - (a.percent || 0));
  const totalBudget = budgetRows.reduce((a, r) => a + r.budget, 0);
  const totalBudgetSpent = budgetRows.reduce((a, r) => a + r.spent, 0);

  const weekdays = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
  const byWeekday = weekdays.map((name, i) => ({
    name,
    chiqim: filtExp.filter(e => ((new Date(e.date + "T00:00:00").getDay() + 6) % 7) === i).reduce((a, e) => a + e.amount, 0),
  }));
  const topExpenses = [...filtExp].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const isIncTable = tableKind === "inc" && showIncome;
  const tableSource = isIncTable ? filtInc : filtExp;
  const tableRows = [...tableSource].sort((a, b) => sortBy === "amount" ? b.amount - a.amount : b.date.localeCompare(a.date));

  const projLabel = selProj === "all" ? t('reports.allProjects') : (projById.get(selProj)?.name || t('reports.allProjects'));

  // Excel — endi ilovaning o'zida quriladi (lib/xlsx): ekranda ko'rinib turgan davr/obyekt, tartibli varaqlar.
  // Davomat varag'i uchun firma bo'yicha davomat so'raladi (bo'lmasa — varaqsiz).
  const doExport = async () => {
    if (filtExp.length === 0 && filtInc.length === 0) { toast.warning(t('reports.exportEmpty')); return; }
    setExporting(true);
    try {
      const [{ buildReportSheets, reportFileName }, { saveXlsx }] = await Promise.all([import("./lib/xlsx/reportWorkbook"), import("./lib/xlsx/download")]);
      const dates = [...filtExp, ...filtInc].map(e => e.date).filter(Boolean).sort();
      let aFrom = dateFrom || dates[0] || today;
      const aTo = dateTo || today;
      if (daysBetween(aFrom, aTo) > 400) { const d = new Date(aTo); d.setDate(d.getDate() - 399); aFrom = iso(d); }
      let attendance: any[] | null = null;
      try {
        const token = localStorage.getItem("token");
        const r = await fetch(`${API_BASE}/api/attendance?${new URLSearchParams({ all: "1", from: aFrom, to: aTo })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (r.ok) { const d = await r.json(); if (Array.isArray(d)) attendance = d; }
      } catch { /* davomatsiz */ }
      let companyName = "QurilishERP";
      try { companyName = localStorage.getItem("erp_companyName") || companyName; } catch { /* */ }
      const generatedAt = new Date();
      const scopedProjects = selProj === "all" ? projects : projects.filter(p => p.id === selProj);
      const sheets = buildReportSheets({
        companyName, from: dateFrom, to: dateTo, projectLabel: projLabel, generatedAt,
        expenses: filtExp, incomes: filtInc, includeIncome: showIncome, allTimeExpenses: confirmedExp,
        users, projects: scopedProjects, attendance,
      });
      const ok = await saveXlsx(reportFileName(projLabel, dateFrom, dateTo, generatedAt), sheets, { title: t('reports.title'), author: companyName, created: generatedAt });
      if (!ok) toast.error(t('common.error'));
    } catch (err) {
      console.error("[reports export]", err);
      toast.error(t('common.error'));
    }
    setExporting(false);
  };

  const ranges: [Range, string][] = [
    ["7", t('reports.r7', { defaultValue: "7 kun" })], ["30", t('reports.r30', { defaultValue: "30 kun" })],
    ["month", t('reports.rMonth', { defaultValue: "Bu oy" })], ["90", t('reports.r90', { defaultValue: "3 oy" })],
    ["year", t('reports.rYear', { defaultValue: "Bu yil" })], ["all", t('reports.rAll', { defaultValue: "Hammasi" })],
    ["custom", t('reports.rCustom', { defaultValue: "Tanlash" })],
  ];
  const rangeText = range === "custom"
    ? (customFrom || customTo ? `${customFrom ? ddmm(customFrom) : "…"} – ${customTo ? ddmm(customTo) : "…"}` : ranges[6][1])
    : ranges.find(r => r[0] === range)![1];
  const money = (n: number) => narrow && Math.abs(n) >= 1e6 ? `${short(n)} so'm` : fmt(n);
  const ops = t('reports.ops', { defaultValue: "ta amal" });
  const kpis: { label: string; value: string; title: string; sub: string; tone: string; grad: string; valueTone?: string }[] = [
    ...(showIncome ? [
      { label: t('reports.pnlIncome'), value: money(totalIncome), title: fmt(totalIncome), sub: `${filtInc.length} ${ops}`, tone: "text-muted-foreground", grad: "from-emerald-500/20 to-cyan-500/10" },
    ] : []),
    { label: t('reports.totalExpense'), value: money(total), title: fmt(total), sub: delta != null ? `${delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} ${Math.abs(delta)}% ${t('reports.vsPrev', { defaultValue: "oldingi davrga nisbatan" })}` : `${filtExp.length} ${ops}`, tone: delta != null && delta > 0 ? "text-rose-500" : delta != null ? "text-emerald-500" : "text-muted-foreground", grad: "from-orange-500/20 to-rose-500/10" },
    ...(showIncome && showBalance ? [
      { label: t('reports.balance', { defaultValue: "Balans (kirim − chiqim)" }), value: `${net > 0 ? "+" : ""}${money(net)}`, title: fmt(net), sub: net >= 0 ? t('reports.profit', { defaultValue: "Foyda" }) : t('reports.loss', { defaultValue: "Zarar" }), tone: net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400", grad: net >= 0 ? "from-emerald-500/20 to-emerald-500/5" : "from-rose-500/25 to-rose-500/5", valueTone: net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400" },
    ] : []),
    { label: t('reports.perDay', { defaultValue: "Kunlik o'rtacha" }), value: money(Math.round(total / spanDays)), title: fmt(Math.round(total / spanDays)), sub: `${spanDays} ${t('reports.days', { defaultValue: "kun" })}`, tone: "text-muted-foreground", grad: "from-indigo-500/20 to-violet-500/10" },
  ];
  const chartH = (desktop: number) => narrow ? Math.round(desktop * 0.8) : desktop;
  const yW = narrow ? 40 : 56;
  const axisTick = { fontSize: 10, fill: "currentColor", opacity: 0.6 };

  const viewToggle = (
    <div className="relative flex p-0.5 rounded-full bg-muted/60 flex-shrink-0" role="tablist">
      {(["finance", "control"] as const).map(v => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { setView(v); setFiltersOpen(false); }}
          className={`relative z-10 text-xs font-semibold px-3 py-1.5 rounded-full liquid-transition ${view === v ? "text-white" : "text-muted-foreground"}`}>
          {view === v && <motion.span layoutId="reportsViewPill" className="absolute inset-0 -z-10 rounded-full bg-primary" transition={{ type: "spring", stiffness: 480, damping: 34 }} />}
          {t(v === "finance" ? 'control.tabFinance' : 'control.tabControl')}
        </button>
      ))}
    </div>
  );

  const exportBtn = (
    <button type="button" onClick={doExport} disabled={exporting} data-testid="reports-export" aria-label={t('reports.exportExcel')} title={t('reports.exportExcel')}
      className="btn btn-accent flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-full flex-shrink-0 disabled:opacity-60 min-h-[34px]">
      <MorphIcon icon={Download} className={`w-3.5 h-3.5 ${exporting ? "animate-bounce" : ""}`} />
      <span>{narrow ? "Excel" : t('reports.exportExcel')}</span>
    </button>
  );

  const dateInput = "w-full min-w-0 max-w-full box-border text-xs border border-border rounded-full px-2.5 py-1.5 bg-input-background text-foreground";
  const filterPanel = (
    <div data-testid="reports-filter-panel" className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 min-w-0">
      <select aria-label={t('reports.table.project')} className="w-full md:w-56 min-w-0 max-w-full text-sm border border-border rounded-full px-3 py-1.5 bg-input-background focus:outline-none"
        value={selProj} onChange={e => setSelProj(e.target.value)}>
        <option value="all">{t('reports.allProjects')}</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0 md:flex-1">
        {ranges.map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setRange(k); if (narrow && k !== "custom") setFiltersOpen(false); }} aria-pressed={range === k}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap border liquid-transition ${range === k ? "bg-primary text-white border-primary shadow-md shadow-primary/25" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}>{l}</button>
        ))}
      </div>
      {range === "custom" && (
        <div className="grid grid-cols-2 gap-2 min-w-0 w-full md:w-80">
          <label className="min-w-0 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {t('reports.dateFrom')}
            <input type="date" className={dateInput} value={customFrom} onChange={e => setCustomFrom(e.target.value)} aria-label={t('reports.dateFrom')} />
          </label>
          <label className="min-w-0 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {t('reports.dateTo')}
            <input type="date" className={dateInput} value={customTo} onChange={e => setCustomTo(e.target.value)} aria-label={t('reports.dateTo')} />
          </label>
        </div>
      )}
    </div>
  );

  // Bitta, ikkala ko'rinishda ham bir xil sarlavha (owner 2026-10-22: "Nazorat"ga o'tganda sarlavha boshqacha bo'lib kesilardi)
  const header = (
    <div ref={headerRef} data-testid="reports-header" className="surface border border-border rounded-2xl px-3 py-2.5 flex flex-col gap-2 flex-shrink-0 min-w-0 relative z-20">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-base font-bold font-display min-w-0 truncate">{view === "control" ? t('control.title') : t('reports.title')}</h2>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {viewToggle}
          {view === "finance" && !narrow && exportBtn}
        </div>
      </div>
      {view === "finance" && narrow && (
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" data-testid="reports-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)}
            className="flex-1 min-w-0 flex items-center gap-2 rounded-full border border-border bg-input-background px-3 py-1.5 text-left min-h-[34px]">
            <MorphIcon icon={Calendar} className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-semibold whitespace-nowrap">{rangeText}</span>
            <span className="text-xs text-muted-foreground truncate min-w-0">· {projLabel}</span>
            <MorphIcon icon={ChevronDown} className={`w-3.5 h-3.5 ml-auto flex-shrink-0 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
          </button>
          {exportBtn}
        </div>
      )}
      {view === "finance" && (narrow ? (
        <AnimatePresence initial={false}>
          {filtersOpen && (
            <motion.div key="fp" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden min-w-0">
              <div className="pt-1 pb-0.5">{filterPanel}</div>
            </motion.div>
          )}
        </AnimatePresence>
      ) : filterPanel)}
    </div>
  );

  if (view === "control") {
    return (
      <div className="flex flex-col h-full p-3 gap-3 overflow-hidden min-w-0">
        {header}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-hide" data-testid="reports-control"><Suspense fallback={null}><ControlPanel /></Suspense></div>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden min-w-0">
      {header}

      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain space-y-3 pb-2 px-0.5 min-w-0" data-testid="reports-scroll"
        onScroll={() => { if (filtersOpen) setFiltersOpen(false); }}>
        {/* KPI kartalari */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
          {kpis.map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 28 }}
              className={`relative overflow-hidden rounded-2xl border border-border p-3 sm:p-4 min-w-0 bg-gradient-to-br ${k.grad}`}>
              <p className="text-[11px] sm:text-xs text-muted-foreground font-medium truncate">{k.label}</p>
              <p title={k.title} className={`text-base md:text-xl font-bold font-mono mt-1 truncate ${k.valueTone || ""}`}>{k.value}</p>
              {k.sub && <p className={`text-[10px] sm:text-[11px] mt-1 font-medium truncate ${k.tone}`}>{k.sub}</p>}
            </motion.div>
          ))}
        </div>

        {/* Trend: kirim bo'lsa — kirim/chiqim ustunlari + jamlanma balans chizig'i */}
        {showIncome && (
          <label className="surface rounded-2xl px-4 h-12 flex items-center justify-between gap-3 cursor-pointer" data-testid="reports-balance-toggle">
            <span className="text-sm font-semibold">{t('reports.showBalance', { defaultValue: "Balansni ko'rsatish (kirim − chiqim)" })}</span>
            <input type="checkbox" checked={showBalance} onChange={(e) => setShowBalance(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" />
          </label>
        )}
        <Card title={showIncome ? (showBalance ? t('reports.trendBalance', { defaultValue: "Kirim, chiqim va balans" }) : t('reports.trendIncExp', { defaultValue: "Kirim va chiqim" })) : t('reports.trendExp', { defaultValue: "Chiqimlar dinamikasi" })} delay={0.05}>
          {trend.length === 0 ? <p className="text-sm text-muted-foreground py-10 text-center">{t('reports.exportEmpty')}</p> : showIncome ? (
            <ResponsiveContainer width="100%" height={chartH(250)}>
              <ComposedChart data={trend} margin={{ left: 0, right: 4, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={12} />
                <YAxis tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} width={yW} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Bar dataKey="kirim" name={t('reports.pnlIncome')} fill={INC} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="chiqim" name={t('reports.expense')} fill={EXP} radius={[4, 4, 0, 0]} maxBarSize={18} />
                {showBalance && <Line type="monotone" dataKey="balans" name={t('reports.balanceShort', { defaultValue: "Balans" })} stroke={BAL} strokeWidth={2.5} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={chartH(240)}>
              <AreaChart data={trend} margin={{ left: 0, right: 4, top: 8 }}>
                <defs>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={EXP} stopOpacity={0.45} /><stop offset="100%" stopColor={EXP} stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={12} />
                <YAxis tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} width={yW} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="chiqim" name={t('reports.expense')} stroke={EXP} strokeWidth={2.5} fill="url(#gExp)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Kirim monitoringi */}
        {showIncome && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" data-testid="reports-income-section">
            <Card title={showBalance ? t('reports.balanceByObject', { defaultValue: "Obyektlar bo'yicha balans" }) : t('reports.incExpByObject', { defaultValue: "Obyektlar bo'yicha kirim va chiqim" })} delay={0.06}>
              {objBalance.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">{t('reports.exportEmpty')}</p> : (
                <div className="space-y-3">
                  {objBalance.slice(0, narrow ? 6 : 10).map(r => {
                    const b = r.inc - r.exp;
                    return (
                      <div key={r.id} className="min-w-0">
                        <div className="flex items-baseline gap-2 text-xs min-w-0">
                          <span className="font-semibold truncate min-w-0">{r.name}</span>
                          {showBalance && <span className={`ml-auto font-mono font-bold whitespace-nowrap ${b >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{b > 0 ? "+" : ""}{short(b)}</span>}
                        </div>
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 mt-1 text-[10px] text-muted-foreground">
                          <span>{t('reports.pnlIncome')}</span>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.inc / maxObjAbs) * 100}%`, background: INC }} /></div>
                          <span className="font-mono">{short(r.inc)}</span>
                          <span>{t('reports.expense')}</span>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.exp / maxObjAbs) * 100}%`, background: EXP }} /></div>
                          <span className="font-mono">{short(r.exp)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card title={t('reports.incomeByPerson', { defaultValue: "Kirimni kim kiritgan" })} delay={0.07}
              right={<span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{short(totalIncome)}</span>}>
              {incByPerson.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">{t('reports.noIncome', { defaultValue: "Tanlangan davrda kirim yo'q" })}</p> : (
                <div className="space-y-2.5">
                  {incByPerson.slice(0, 8).map((r, i) => {
                    const u = userById.get(r.id);
                    return <ShareRow key={r.id} label={u?.name || t('reports.unknown', { defaultValue: "Noma'lum" })}
                      sub={`${u ? roleLabel(t, u.role) + " · " : ""}${r.n} ${ops}`}
                      value={short(r.v)} pct={totalIncome ? (r.v / totalIncome) * 100 : 0} color={PALETTE[i % PALETTE.length]} />;
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Donut */}
          <Card title={t('reports.byType')} delay={0.08}>
            {byType.length === 0 ? <p className="text-sm text-muted-foreground py-10 text-center">{t('reports.exportEmpty')}</p> : (
              <div className="flex flex-col sm:flex-row items-center gap-4 min-w-0">
                <div className="relative w-[170px] h-[170px] sm:w-[200px] sm:h-[200px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byType} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="98%" paddingAngle={3} cornerRadius={6} stroke="none">
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
                <div className="flex-1 w-full min-w-0 space-y-2">
                  {byType.map(d => {
                    const pct = total ? Math.round((d.value / total) * 100) : 0;
                    return <ShareRow key={d.key} label={d.name} sub={`${pct}%`} value={narrow ? short(d.value) : fmt(d.value)} pct={pct} color={TYPE_COLOR[d.key]} />;
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Hafta kunlari */}
          <Card title={t('reports.byWeekday', { defaultValue: "Hafta kunlari bo'yicha" })} delay={0.1}>
            <ResponsiveContainer width="100%" height={chartH(200)}>
              <BarChart data={byWeekday} margin={{ left: 0, right: 4 }}>
                <defs><linearGradient id="gWd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366F1" /><stop offset="100%" stopColor="#A855F7" /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "currentColor", opacity: 0.7 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} width={yW} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Bar dataKey="chiqim" name={t('reports.expense')} fill="url(#gWd)" radius={[8, 8, 2, 2]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Obyektlarni solishtirish */}
        {objCompare.length > 0 && (
          <Card title={t('reports.compareObjects', { defaultValue: "Obyektlarni solishtirish (turlar bo'yicha)" })} delay={0.12}>
            <ResponsiveContainer width="100%" height={Math.max(150, objCompare.length * (narrow ? 38 : 46) + 50)}>
              <BarChart data={objCompare} layout="vertical" margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} horizontal={false} />
                <XAxis type="number" tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: narrow ? 10 : 11, fill: "currentColor", opacity: 0.8 }} tickLine={false} axisLine={false} width={narrow ? 84 : 120} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                {Object.keys(EXP_LABELS).map((k, i, arr) => (
                  <Bar key={k} dataKey={k} stackId="a" name={expLabel(t, k as ExpType)} fill={TYPE_COLOR[k]} maxBarSize={22}
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
                    <div key={r.id} className="min-w-0">
                      <div className="flex items-center gap-2 text-xs min-w-0">
                        <span className="font-semibold truncate min-w-0">{r.name}</span>
                        <span className="ml-auto font-mono whitespace-nowrap">{short(r.spent)} / {short(r.budget)}</span>
                        <span className="px-1.5 py-0.5 rounded-md font-bold text-[10px] text-white flex-shrink-0" style={{ background: color }}>{p}%</span>
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
                  const proj = projById.get(e.projectId);
                  return (
                    <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 min-w-0">
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{e.description || expLabel(t, e.type)}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{ddmm(e.date)} · {proj?.name || e.objectLabel || "—"} · {expLabel(t, e.type)}</p>
                      </div>
                      <span className="text-sm font-bold font-mono whitespace-nowrap">{short(e.amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Batafsil — telefonda kartalar, katta ekranda jadval */}
        <Card delay={0.18} className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 pt-3 sm:pt-4 pb-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold font-display">{t('reports.detailedTable')}</p>
              <span className="text-xs text-muted-foreground">{tableRows.length} {ops}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {showIncome && (["exp", "inc"] as const).map(k => (
                <button key={k} type="button" onClick={() => { setTableKind(k); setTableLimit(60); }} aria-pressed={tableKind === k}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${tableKind === k ? "bg-primary text-white border-primary" : "border-border text-muted-foreground"}`}>
                  {k === "exp" ? t('reports.expense') : t('reports.pnlIncome')}
                </button>
              ))}
              {(["date", "amount"] as const).map(k => (
                <button key={k} type="button" onClick={() => setSortBy(k)} aria-pressed={sortBy === k} className={`text-[11px] px-2.5 py-1 rounded-full border ${sortBy === k ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground"}`}>
                  {k === "date" ? t('reports.table.date') : t('reports.table.amount')}
                </button>
              ))}
            </div>
          </div>
          {narrow ? (
            <div className="px-3 pb-3 space-y-2">
              {tableRows.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">{t('reports.exportEmpty')}</p>}
              {tableRows.slice(0, tableLimit).map(e => {
                const to = e.toUserId ? userById.get(e.toUserId) : undefined;
                const proj = projById.get(e.projectId);
                return (
                  <div key={e.id} className="rounded-xl border border-border/60 px-3 py-2 min-w-0">
                    <div className="flex items-start gap-2 min-w-0">
                      <p className="text-sm font-medium min-w-0 flex-1 break-words line-clamp-2">
                        {e.anomaly && <span className="mr-1 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-600">⚠</span>}
                        {e.description || (isIncTable ? t('reports.pnlIncome') : expLabel(t, e.type))}
                      </p>
                      <span className={`text-sm font-bold font-mono whitespace-nowrap ${isIncTable ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{isIncTable ? "+" : ""}{fmt(e.amount)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-muted-foreground min-w-0">
                      <span className="font-mono">{ddmm(e.date)}</span>
                      {!isIncTable && <span className="text-[10px] font-semibold px-1.5 rounded-full text-white" style={{ background: TYPE_COLOR[e.type] || PALETTE[0] }}>{expLabel(t, e.type)}</span>}
                      <span className="truncate max-w-full">{proj?.name ?? e.objectLabel ?? "—"}</span>
                      {(to?.name || e.recipientName) && <span className="truncate max-w-full">→ {to?.name ?? e.recipientName}</span>}
                    </div>
                  </div>
                );
              })}
              {tableRows.length > tableLimit && (
                <button type="button" onClick={() => setTableLimit(l => l + 100)} className="w-full text-xs font-semibold text-primary py-2">
                  {t('reports.showMore', { defaultValue: "Yana ko'rsatish" })} ({tableRows.length - tableLimit})
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10"><tr className="border-y border-border">{[t('reports.table.date'), t('reports.table.description'), t('reports.table.type'), t('reports.table.to'), t('reports.table.project'), t('reports.table.amount')].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>
                  {tableRows.slice(0, Math.max(tableLimit, 500)).map(e => {
                    const to = e.toUserId ? userById.get(e.toUserId) : undefined;
                    const proj = projById.get(e.projectId);
                    return (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{e.date}</td>
                        <td className="px-3 py-2 max-w-[220px] truncate">
                          {e.anomaly && <span className="mr-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600" title={t('reports.anomaly', { defaultValue: "G'ayrioddiy katta chiqim" })}>⚠</span>}
                          {e.description || (isIncTable ? t('reports.pnlIncome') : expLabel(t, e.type))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: isIncTable ? INC : TYPE_COLOR[e.type] || PALETTE[0] }}>{isIncTable ? t('reports.pnlIncome') : expLabel(t, e.type)}</span></td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{to?.name ?? e.recipientName ?? "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{proj?.name ?? e.objectLabel ?? "-"}</td>
                        <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{fmt(e.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
