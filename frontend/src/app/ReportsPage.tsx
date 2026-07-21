import { useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer
} from "recharts";
import { Project, Expense, AppUser, ExpType, EXP_LABELS, CHART_COLORS, fmt, isAdmin } from "./App";

// Ushbu sahifa recharts kutubxonasini ishlatadi (og'ir kutubxona) — shuning
// uchun alohida faylga chiqarilgan va App.tsx da React.lazy orqali faqat
// "Hisobotlar" bo'limiga kirilganda yuklanadi (boshlang'ich bundle kichrayadi).
export default function ReportsPage({ projects, expenses, users }:
  { projects: Project[]; expenses: Expense[]; users: AppUser[] }) {
  const [selProj, setSelProj] = useState("all");
  const filtExp = (selProj==="all"?expenses:expenses.filter(e=>e.projectId===selProj)).filter(e=>e.status==="confirmed");
  const total = filtExp.reduce((a,e)=>a+e.amount,0);
  const byType = (Object.keys(EXP_LABELS) as ExpType[]).map(k=>({name:EXP_LABELS[k],value:filtExp.filter(e=>e.type===k).reduce((a,e)=>a+e.amount,0)})).filter(d=>d.value>0);
  const byProject = projects.map(p=>({name:p.name.split(" ").slice(0,2).join(" "),chiqim:expenses.filter(e=>e.projectId===p.id&&e.status==="confirmed").reduce((a,e)=>a+e.amount,0)}));
  const byPerson = users.filter(u=>!isAdmin(u.role)).map(u=>{const parts=u.name.split(" ");const shortName=parts[0]+(parts[1]?" "+parts[1][0]+".":"");return{name:shortName,total:expenses.filter(e=>e.toUserId===u.id&&e.status==="confirmed").reduce((a,e)=>a+e.amount,0)};}).filter(d=>d.total>0);
  return (
    <div className="flex flex-col h-full">
      <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-bold font-['Roboto_Slab',serif]">Hisobotlar</h2>
        <select className="text-sm md:text-xs border border-border rounded px-2 py-1 bg-input-background focus:outline-none" value={selProj} onChange={e=>setSelProj(e.target.value)}>
          <option value="all">Barcha obyektlar</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollbar-hide space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["Jami chiqim",total,"text-accent"],[EXP_LABELS.material,filtExp.filter(e=>e.type==="material").reduce((a,e)=>a+e.amount,0),"text-orange-600"],[EXP_LABELS.oylik,filtExp.filter(e=>e.type==="oylik").reduce((a,e)=>a+e.amount,0),"text-blue-600"],["Boshqa",filtExp.filter(e=>!["material","oylik"].includes(e.type)).reduce((a,e)=>a+e.amount,0),"text-purple-600"]].map(([l,v,c])=>(
            <div key={String(l)} className="bg-card border border-border rounded-lg p-3"><p className="text-sm md:text-xs text-muted-foreground">{String(l)}</p><p className={`text-sm font-bold font-mono mt-1 ${c}`}>{fmt(v as number)}</p></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">Chiqim turlari</p>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart><Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                {byType.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
              </Pie><Tooltip formatter={(v:number)=>fmt(v)}/></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">Obyektlar bo'yicha</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byProject}><XAxis dataKey="name" tick={{fontSize:9}} tickLine={false} axisLine={false}/><YAxis hide/><Tooltip formatter={(v:number)=>fmt(v)}/><Bar dataKey="chiqim" fill="#D9460F" radius={[3,3,0,0]} name="Chiqim"/></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        {byPerson.length>0&&(
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm md:text-xs font-semibold mb-3 font-['Roboto_Slab',serif]">Xodimlar bo'yicha to'lovlar</p>
            <ResponsiveContainer width="100%" height={byPerson.length*40+20}>
              <BarChart data={byPerson} layout="vertical" margin={{right:80,left:10}}>
                <XAxis type="number" hide/><YAxis type="category" dataKey="name" tick={{fontSize:10}} tickLine={false} axisLine={false} width={90}/>
                <Tooltip formatter={(v:number)=>fmt(v)}/>
                <Bar dataKey="total" fill="#1B3A6B" radius={[0,3,3,0]} name="To'lov" label={{position:"right",fontSize:9,formatter:(v:number)=>v>0?fmt(v):""}}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><p className="text-sm md:text-xs font-semibold font-['Roboto_Slab',serif]">Batafsil jadval</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm md:text-xs">
              <thead><tr className="border-b border-border bg-muted/40">{["Sana","Tavsif","Tur","Kimga","Obyekt","Summa"].map(h=><th key={h} className="text-left px-3 py-2 text-sm md:text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {filtExp.slice().reverse().map(e=>{
                  const to=users.find(u=>u.id===e.toUserId);
                  const proj=projects.find(p=>p.id===e.projectId);
                  return (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{e.date}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate">{e.description}</td>
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
        </div>
      </div>
    </div>
  );
}
