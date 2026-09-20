import { useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer
} from "recharts";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { Project, Expense, AppUser, ExpType, EXP_LABELS, CHART_COLORS, fmt, isAdmin, exportExpensesToCsv } from "./App";

// Ushbu sahifa recharts kutubxonasini ishlatadi (og'ir kutubxona) — shuning
// uchun alohida faylga chiqarilgan va App.tsx da React.lazy orqali faqat
// "Hisobotlar" bo'limiga kirilganda yuklanadi (boshlang'ich bundle kichrayadi).
export default function ReportsPage({ projects, expenses, incomes, users }:
  { projects: Project[]; expenses: Expense[]; incomes: Expense[]; users: AppUser[] }) {
  const { t } = useTranslation();
  const [selProj, setSelProj] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filtExp = (selProj==="all"?expenses:expenses.filter(e=>e.projectId===selProj))
    .filter(e=>e.status==="confirmed")
    .filter(e=>!dateFrom||e.date>=dateFrom)
    .filter(e=>!dateTo||e.date<=dateTo);
  const total = filtExp.reduce((a,e)=>a+e.amount,0);
  // Foyda-zarar (P&L) — avval bu sahifada UMUMAN yo'q edi (faqat xarajat
  // ko'rsatilardi, daromad tomoni yo'q). `incomes` App.tsx'da ALLAQACHON
  // alohida saqlanadi (type==='income' tranzaksiyalar) — shu yerga qo'shib,
  // haqiqiy foyda/zarar hisoblanadi.
  const filtInc = (selProj==="all"?incomes:incomes.filter(e=>e.projectId===selProj))
    .filter(e=>e.status==="confirmed")
    .filter(e=>!dateFrom||e.date>=dateFrom)
    .filter(e=>!dateTo||e.date<=dateTo);
  const totalIncome = filtInc.reduce((a,e)=>a+e.amount,0);
  const netProfit = totalIncome - total;
  // Byudjet vs haqiqat — har bir obyekt uchun rejalashtirilgan (Project.budget)
  // va haqiqiy sarflangan (shu obyektga bog'langan tasdiqlangan xarajatlar
  // yig'indisi) taqqoslanadi. Avval bu taqqoslash HECH QAYERDA yo'q edi.
  const budgetRows = projects.map(p => {
    const spent = expenses.filter(e => e.projectId === p.id && e.status === "confirmed").reduce((a, e) => a + e.amount, 0);
    const budget = p.budget || 0;
    const percent = budget > 0 ? Math.min(999, Math.round((spent / budget) * 100)) : null;
    return { id: p.id, name: p.name, budget, spent, percent, over: budget > 0 && spent > budget };
  }).filter(r => r.budget > 0 || r.spent > 0);
  const byType = (Object.keys(EXP_LABELS) as ExpType[]).map(k=>({name:EXP_LABELS[k],value:filtExp.filter(e=>e.type===k).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.value>0);
  const byProject = projects.map(p=>({name:p.name.split(" ").slice(0,2).join(" "),chiqim:expenses.filter(e=>e.projectId===p.id&&e.status==="confirmed").reduce((a,e)=>a+e.amount,0)}));
  const byPerson = users.filter(u=>!isAdmin(u.role)).map(u=>{const parts=u.name.split(" ");const shortName=parts[0]+(parts[1]?" "+parts[1][0]+".":"");return{name:shortName,total:expenses.filter(e=>e.toUserId===u.id&&e.status==="confirmed").reduce((a,e)=>a+e.amount,0)};}).filter(d=>d.total>0);
  const doExport = () => {
    if (filtExp.length === 0) { toast.warning(t('reports.exportEmpty')); return; }
    const projLabel = selProj === "all" ? "barcha" : (projects.find(p=>p.id===selProj)?.name || "obyekt");
    const rangeLabel = [dateFrom, dateTo].filter(Boolean).join("_") || new Date().toISOString().split("T")[0];
    exportExpensesToCsv(filtExp, users, projects, `hisobot_${projLabel}_${rangeLabel}.csv`.replace(/\s+/g, "-"));
  };
  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      <div className="surface px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5 flex-shrink-0">
        <h2 className="text-sm font-bold font-['Roboto_Slab',serif] flex-shrink-0">{t('reports.title')}</h2>
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <select className="text-sm md:text-xs border border-border rounded-full px-3 py-1.5 bg-input-background focus:outline-none" value={selProj} onChange={e=>setSelProj(e.target.value)}>
            <option value="all">{t('reports.allProjects')}</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <label className="text-sm md:text-xs text-muted-foreground flex-shrink-0">{t('reports.dateFrom')}</label>
            <input type="date" className="min-w-0 flex-1 text-sm md:text-xs border border-border rounded-full px-2.5 py-1.5 bg-input-background focus:outline-none" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-sm md:text-xs text-muted-foreground flex-shrink-0">{t('reports.dateTo')}</label>
            <input type="date" className="min-w-0 flex-1 text-sm md:text-xs border border-border rounded-full px-2.5 py-1.5 bg-input-background focus:outline-none" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
          </div>
          <button onClick={doExport} className="btn btn-accent flex items-center gap-1.5 text-sm md:text-xs px-3 py-1.5 rounded-full flex-shrink-0">
            <MorphIcon icon={Download} className="w-3.5 h-3.5" />{t('reports.exportExcel')}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3">
        {/* Foyda-zarar (P&L) */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="surface p-4">
          <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">{t('reports.pnlTitle')}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-sm md:text-xs text-muted-foreground">{t('reports.pnlIncome')}</p>
              <p className="text-sm font-bold font-mono mt-1 text-green-600 dark:text-green-400">{fmt(totalIncome)}</p>
            </div>
            <div>
              <p className="text-sm md:text-xs text-muted-foreground">{t('reports.pnlExpense')}</p>
              <p className="text-sm font-bold font-mono mt-1 text-accent">{fmt(total)}</p>
            </div>
            <div>
              <p className="text-sm md:text-xs text-muted-foreground">{t('reports.pnlNet')}</p>
              <p className={`text-sm font-bold font-mono mt-1 ${netProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{netProfit >= 0 ? "+" : ""}{fmt(netProfit)}</p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[[t('reports.totalExpense'),total,"text-accent"],[EXP_LABELS.material,filtExp.filter(e=>e.type==="material").reduce((a,e)=>a+e.amount,0),"text-orange-700"],[EXP_LABELS.oylik,filtExp.filter(e=>e.type==="oylik").reduce((a,e)=>a+e.amount,0),"text-blue-600"],[t('reports.other'),filtExp.filter(e=>!["material","oylik"].includes(e.type)).reduce((a,e)=>a+e.amount,0),"text-purple-600"]].map(([l,v,c],i)=>(
            <motion.div key={String(l)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i*0.04, type: "spring", stiffness: 300, damping: 28 }}
              className="surface p-3"><p className="text-sm md:text-xs text-muted-foreground">{String(l)}</p><p className={`text-sm font-bold font-mono mt-1 ${c}`}>{fmt(v as number)}</p></motion.div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, type: "spring", stiffness: 300, damping: 28 }} className="surface p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">{t('reports.byType')}</p>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart><Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                {byType.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
              </Pie><Tooltip formatter={(v:number)=>fmt(v)}/></PieChart>
            </ResponsiveContainer>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10, type: "spring", stiffness: 300, damping: 28 }} className="surface p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">{t('reports.byProject')}</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byProject}><XAxis dataKey="name" tick={{fontSize:9}} tickLine={false} axisLine={false}/><YAxis hide/><Tooltip formatter={(v:number)=>fmt(v)}/><Bar dataKey="chiqim" fill="#D9460F" radius={[3,3,0,0]} name={t('reports.expense')}/></BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>
        {budgetRows.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, type: "spring", stiffness: 300, damping: 28 }} className="surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border"><p className="text-sm md:text-xs font-semibold font-['Roboto_Slab',serif]">{t('reports.budgetVsActual')}</p></div>
            <div className="divide-y divide-border/50">
              {budgetRows.map(r => (
                <div key={r.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm md:text-xs font-semibold truncate">{r.name}</span>
                    <span className={`text-sm md:text-xs font-mono font-semibold whitespace-nowrap ${r.over ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                      {fmt(r.spent)} {r.budget > 0 && `/ ${fmt(r.budget)}`}
                    </span>
                  </div>
                  {r.percent != null && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${r.over ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.min(100, r.percent)}%` }} />
                    </div>
                  )}
                  {r.over && <p className="text-[10px] text-red-600 dark:text-red-400">{t('reports.overBudget', { percent: r.percent })}</p>}
                </div>
              ))}
            </div>
          </motion.div>
        )}
        {byPerson.length>0&&(
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14, type: "spring", stiffness: 300, damping: 28 }} className="surface p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">{t('reports.byPerson')}</p>
            <ResponsiveContainer width="100%" height={byPerson.length*40+20}>
              <BarChart data={byPerson} layout="vertical" margin={{right:80,left:10}}>
                <XAxis type="number" hide/><YAxis type="category" dataKey="name" tick={{fontSize:10}} tickLine={false} axisLine={false} width={90}/>
                <Tooltip formatter={(v:number)=>fmt(v)}/>
                <Bar dataKey="total" fill="#1B3A6B" radius={[0,3,3,0]} name={t('reports.payment')} label={{position:"right",fontSize:9,formatter:(v:number)=>v>0?fmt(v):""}}/>
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        )}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, type: "spring", stiffness: 300, damping: 28 }} className="surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><p className="text-sm md:text-xs font-semibold font-['Roboto_Slab',serif]">{t('reports.detailedTable')}</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:text-xs">
              <thead><tr className="border-b border-border bg-muted/40">{[t('reports.table.date'),t('reports.table.description'),t('reports.table.type'),t('reports.table.to'),t('reports.table.project'),t('reports.table.amount')].map(h=><th key={h} className="text-left px-3 py-2 text-sm md:text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {filtExp.slice().reverse().map(e=>{
                  const to=users.find(u=>u.id===e.toUserId);
                  const proj=projects.find(p=>p.id===e.projectId);
                  return (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{e.date}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate">{e.description || EXP_LABELS[e.type]}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="text-[9px] bg-muted px-1.5 py-0.5 rounded">{EXP_LABELS[e.type]}</span></td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{to?.name??"-"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{proj?.name??"-"}</td>
                      <td className="px-3 py-2 font-mono font-semibold text-accent whitespace-nowrap">{fmt(e.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
