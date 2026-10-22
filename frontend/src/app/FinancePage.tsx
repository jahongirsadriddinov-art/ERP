import { useState, useRef } from "react";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import DollarSign from "@hugeicons/core-free-icons/DollarSignIcon";
import TrendingDown from "@hugeicons/core-free-icons/TradeDownIcon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Copy from "@hugeicons/core-free-icons/Copy01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import { MorphIcon } from "morphicons/react";
import { SwipeRow } from "./components/SwipeRow";
import { IncomePanel } from "./IncomePanel";
import { usePersistentState, oneOf } from "./lib/persistentState";
import { confirmDialog } from "./lib/confirmDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { guessExpType } from "./lib/expense";
import { EXP_LABELS, EscClose, LIVE_EUR_RATE, LIVE_RATE_DATE, LIVE_USD_RATE, expLabel, exportExpensesToCsv, fmt, fmtUsd, isAdmin, resizeImageFile, roleLabel, type AppUser, type ExpType, type Expense, type Project } from "./App";

// ─── Finance Page ──────────────────────────────────────────────────────────────
export function FinancePage({ currentUser, users, projects, expenses, onAddExpense, onConfirm, onApprove, onReject, allowIncome, onUpdated, onDeleted, incomes = [], onIncomeAdded }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; expenses: Expense[]; onAddExpense: (e: Expense) => void; onConfirm: (id: string) => void; onApprove?: (id: string, note?: string) => void; onReject?: (id: string) => void; allowIncome?: boolean;
    onUpdated?: (e: Expense) => void; onDeleted?: (id: string) => void; incomes?: Expense[]; onIncomeAdded?: (e: Expense) => void }) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [editExp, setEditExp] = useState<Expense|null>(null);
  // Owner 2026-10-22: tepadagi filtrlar ochilib-yopiladi (pastdagi asosiy ro'yxat ko'rinsin)
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Owner 2026-10-22: o'zi qo'shganini — o'zi (tasdiqlanmaguncha), hammasini — direktor/o'rinbosar (backend bilan bir xil qoida)
  const isBoss = ['direktor','orinbosar'].includes(currentUser.role) || !!(currentUser as any).isOwner;
  // Kirim bo'limi — faqat direktor/o'rinbosar (owner 2026-10-22)
  const [section, setSection] = usePersistentState<"exp" | "inc">("finance.section", "exp", oneOf(["exp", "inc"]));
  const showIncome = isBoss && section === "inc";
  const canEdit = (e: Expense) => isBoss || (e.createdById === currentUser.id && e.status !== "confirmed");
  const removeExp = async (e: Expense) => {
    if (!(await confirmDialog(t('finance.deleteConfirm', { defaultValue: "Bu yozuv o'chirilsinmi?" }), { danger: true, okText: t('common.delete', { defaultValue: "O'chirish" }) }))) return;
    try {
      const r = await fetch(`${API_BASE}/api/transactions/${e.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || t('common.error', { defaultValue: 'Xatolik' })); return; }
      onDeleted?.(e.id);
      toast.success(t('finance.deleted', { defaultValue: "O'chirildi" }));
    } catch { toast.error(t('common.networkError', { defaultValue: "Internet bilan aloqa yo'q" })); }
  };
  const [filter, setFilter] = useState<"all"|ExpType>("all");
  const [projFilter, setProjFilter] = useState("all");
  const [detailExp, setDetailExp] = useState<Expense|null>(null);
  const [showCurrency, setShowCurrency] = useState(false);
  const [currencyAmount, setCurrencyAmount] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"uzs2usd"|"usd2uzs"|"uzs2eur"|"eur2uzs">("uzs2usd");

  const filteredExpenses = expenses.filter(e => (filter==="all"||e.type===filter) && (projFilter==="all"||e.projectId===projFilter));

  const totalExpense = expenses.filter(e=>e.status==="confirmed").reduce((a,e)=>a+e.amount,0);
  const isAdmin = ['direktor','orinbosar'].includes(currentUser.role);
  const pendingMe = isAdmin
    ? expenses.filter(e=>e.requiresAdminApproval&&e.status==="pending").length
    : expenses.filter(e=>e.toUserId===currentUser.id&&e.status==="pending").length;
  const typeClr: Record<string,string> = {
    oylik:"bg-blue-500/15 text-blue-700 dark:text-blue-300",
    material:"bg-orange-500/15 text-orange-800 dark:text-orange-300",
    jihozlar:"bg-purple-500/15 text-purple-700 dark:text-purple-300",
    transport:"bg-teal-500/15 text-teal-700 dark:text-teal-300",
    boshqa:"bg-muted text-muted-foreground"
  };

  const sectionTabs = isBoss && (
    <div className="flex p-1 rounded-full bg-muted flex-shrink-0" role="tablist" data-testid="finance-section">
      {(["exp", "inc"] as const).map((s) => (
        <button key={s} type="button" role="tab" aria-selected={section === s} onClick={() => setSection(s)}
          className={`flex-1 h-10 rounded-full text-sm font-semibold liquid-transition ${section === s ? (s === "inc" ? "bg-emerald-600 text-white" : "bg-primary text-white") : "text-muted-foreground"}`}>
          {s === "exp" ? t('income.expensesTab') : t('income.tab')}
        </button>
      ))}
    </div>
  );
  if (showIncome) return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      {sectionTabs}
      <IncomePanel currentUser={currentUser} users={users} projects={projects} incomes={incomes}
        onAdded={(x) => onIncomeAdded?.(x)} onUpdated={(x) => onUpdated?.(x)} onDeleted={(id) => onDeleted?.(id)} />
    </div>
  );
  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-hidden">
      {sectionTabs}
      {/* Header */}
      <div className="surface px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-bold font-['Roboto_Slab',serif]">{t('finance.title')}</h2>
          <p className="text-sm md:text-xs text-muted-foreground">{t('finance.totalConfirmed')} <span className="font-semibold text-accent">{fmt(totalExpense)}</span> <span className="text-[10px] text-muted-foreground/70">≈ {fmtUsd(totalExpense)}</span></p>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingMe>0&&<span className="text-sm md:text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-full font-semibold flex items-center gap-1 badge-pulse"><MorphIcon icon={Clock} className="w-3 h-3" />{t('finance.pendingCount', { count: pendingMe })}</span>}
          <button onClick={()=>setShowCurrency(v=>!v)} title={t('currency.title')} aria-label={t('currency.title')} className="btn btn-outline flex items-center gap-1 text-sm md:text-xs px-2.5 py-1.5 rounded-full"><MorphIcon icon={DollarSign} className="w-3 h-3" /></button>
          <button onClick={()=>setShowAdd(true)} className="btn btn-accent flex items-center gap-1 text-sm md:text-xs px-3 py-1.5 rounded-full"><MorphIcon icon={Plus} className="w-3 h-3" />{t('finance.addExpense')}</button>
        </div>
      </div>
      {/* Currency converter mini widget */}
      {showCurrency && (
        <div className="surface px-4 py-3 flex-shrink-0 animate-slide-up-fade">
          <p className="text-[10px] font-semibold text-muted-foreground mb-2">{t('currency.title')} — 1 USD = {LIVE_USD_RATE.toLocaleString()} UZS &nbsp;|&nbsp; 1 EUR = {LIVE_EUR_RATE.toLocaleString()} UZS{LIVE_RATE_DATE ? ` (${LIVE_RATE_DATE})` : ""}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={currencyMode} onChange={e=>setCurrencyMode(e.target.value as any)} className="text-[10px] bg-muted text-muted-foreground px-2 py-1 rounded-full font-semibold border-0 focus:outline-none cursor-pointer flex-shrink-0">
              <option value="uzs2usd">UZS → USD</option>
              <option value="usd2uzs">USD → UZS</option>
              <option value="uzs2eur">UZS → EUR</option>
              <option value="eur2uzs">EUR → UZS</option>
            </select>
            <input type="number" value={currencyAmount} onChange={e=>setCurrencyAmount(e.target.value)}
              placeholder={currencyMode.startsWith("uzs")?"UZS":currencyMode.startsWith("usd")?"USD":"EUR"}
              className="flex-1 min-w-[80px] text-sm border border-border rounded-xl px-3 py-1.5 bg-input-background focus:outline-none"/>
            {(() => {
              const n = parseFloat(currencyAmount);
              const result = currencyAmount && !isNaN(n) ? (
                currencyMode==="uzs2usd" ? "$" + (n/LIVE_USD_RATE).toFixed(2) :
                currencyMode==="usd2uzs" ? (n*LIVE_USD_RATE).toLocaleString() + " UZS" :
                currencyMode==="uzs2eur" ? "€" + (n/LIVE_EUR_RATE).toFixed(2) :
                currencyMode==="eur2uzs" ? (n*LIVE_EUR_RATE).toLocaleString() + " UZS" : null
              ) : null;
              return (
                <button type="button" disabled={!result} title={result ? t('currency.copyHint') : undefined}
                  onClick={() => { if (!result) return; navigator.clipboard?.writeText(result).then(() => toast.success(t('currency.copied'))).catch(() => {}); }}
                  className="ml-auto flex items-center gap-1.5 text-sm font-bold text-accent font-mono text-right liquid-transition rounded-lg px-1.5 py-0.5 -mr-1.5 hover:bg-accent/10 active:scale-95 disabled:cursor-default disabled:hover:bg-transparent">
                  {result || "—"}
                  {result && <MorphIcon icon={Copy} className="w-3 h-3 opacity-50 flex-shrink-0" />}
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Filters */}
      {/* Filtr: yig'ilgan holatda bitta qator (tanlangan obyekt/tur), bosilsa ochiladi */}
      <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} data-testid="finance-filters-toggle"
        className="surface px-4 h-11 flex items-center gap-2 flex-shrink-0 min-w-0 text-sm">
        <span className="font-semibold flex-shrink-0">{t('finance.filter', { defaultValue: 'Filtr' })}</span>
        <span className="text-muted-foreground truncate min-w-0">
          {(projFilter === "all" ? t('finance.allObjects') : projects.find(p => p.id === projFilter)?.name || "—")} · {filter === "all" ? t('finance.all') : expLabel(t, filter)}
        </span>
        <span className={`ml-auto text-muted-foreground transition-transform flex-shrink-0 ${filtersOpen ? "rotate-180" : ""}`}>▾</span>
      </button>
      {/* Owner 2026-10-22: telefonda tanlov ekrandan chiqib ketardi — to'liq kenglikda, matn qisqaradi; turlar gorizontal suriladi */}
      {filtersOpen && <div className="surface px-3 py-2.5 flex flex-col gap-2 flex-shrink-0 min-w-0 overflow-hidden animate-slide-up-fade">
        <select className="w-full min-w-0 max-w-full truncate h-10 text-sm border border-border rounded-full px-3 bg-input-background focus:outline-none" value={projFilter} onChange={e=>setProjFilter(e.target.value)}>
          <option value="all">{t('finance.allObjects')}</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3">
          <button onClick={()=>setFilter("all")} className={`flex-shrink-0 h-9 text-sm px-3.5 rounded-full font-medium liquid-transition ${filter==="all"?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{t('finance.all')}</button>
          {(Object.keys(EXP_LABELS) as ExpType[]).map(k=><button key={k} onClick={()=>setFilter(k)} className={`flex-shrink-0 h-9 text-sm px-3.5 rounded-full font-medium liquid-transition ${filter===k?"bg-primary text-white":"bg-muted text-muted-foreground hover:bg-secondary"}`}>{expLabel(t, k)}</button>)}
        </div>
      </div>}

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 scrollbar-hide">
        {filteredExpenses.length===0
          ? <div className="text-center py-10 text-muted-foreground"><MorphIcon icon={Wallet} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('finance.notFound')}</p></div>
          : filteredExpenses.map(e=>{
              const to=users.find(u=>u.id===e.toUserId);
              const proj=projects.find(p=>p.id===e.projectId);
              const creator=users.find(u=>u.id===e.createdById);
              const canConfirm=e.toUserId===currentUser.id&&e.status==="pending"&&!e.requiresAdminApproval;
              // approverId belgilangan bo'lsa — FAQAT o'sha admin tasdiqlay oladi
              // (backend PATCH /:id/approve'dagi bir xil qoida). approverId yo'q
              // (eski) yozuvlar uchun — eski xatti-harakat, istalgan admin tasdiqlaydi.
              const canAdminApprove=isAdmin&&e.requiresAdminApproval&&e.status==="pending"&&(!e.approverId||e.approverId===currentUser.id);
              const approver=e.approverId?users.find(u=>u.id===e.approverId):undefined;
              const borderColor = e.status==="confirmed" ? "#22c55e" : e.requiresAdminApproval ? "#e5633a" : "#f59e0b";
              return (
                <SwipeRow key={e.id} testId="finance-row" onOpen={()=>setDetailExp(e)}
                  actions={canEdit(e) ? [
                    { key: "edit", label: t('common.edit', { defaultValue: "O'zgartirish" }), icon: Edit, tone: "primary", onClick: () => setEditExp(e) },
                    { key: "del", label: t('common.delete', { defaultValue: "O'chirish" }), icon: Trash, tone: "danger", onClick: () => { void removeExp(e); } },
                  ] : []}>
                <div className="w-full text-left surface rounded-2xl p-3 text-sm md:text-xs hover:bg-muted/20 liquid-transition" style={{ borderLeft: `4px solid ${borderColor}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${typeClr[e.type] || "bg-muted text-muted-foreground"}`}>{expLabel(t, e.type as ExpType) || e.type}</span>
                        {e.requiresAdminApproval&&e.status==="pending"&&<span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-accent/15 text-accent">{t('approvalChain.needsApproval')}</span>}
                      </div>
                      <p className="font-semibold text-foreground">{e.anomaly && <span className="mr-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">⚠ {t('finance.anomaly', { defaultValue: "G'ayrioddiy" })}</span>}{e.description || expLabel(t, e.type as ExpType)}</p>
                      <p className="text-sm md:text-xs text-muted-foreground mt-0.5">{proj?.name || e.objectLabel || "—"}{e.recipientName ? ` • 👤 ${e.recipientName}` : ""} • {e.date}</p>
                      {to&&<p className="text-sm md:text-xs text-muted-foreground">{t('finance.to')} <span className="font-medium">{to.name}</span></p>}
                      {creator&&<p className="text-sm md:text-xs text-muted-foreground">{t('finance.createdBy')} {creator.name}</p>}
                      {approver&&e.status==="pending"&&<p className="text-sm md:text-xs text-muted-foreground">{t('approvalChain.approver')} <span className="font-medium">{approver.name}</span></p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-accent">{fmt(e.amount)}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{fmtUsd(e.amount)}</p>
                      {e.status==="confirmed"
                        ?<p className="text-[9px] text-green-800 dark:text-green-400 font-semibold mt-1 flex items-center gap-0.5 justify-end"><MorphIcon icon={CheckCircle} className="w-2.5 h-2.5" />{t('finance.confirmed')}</p>
                        :<p className="text-[9px] text-amber-800 dark:text-amber-400 font-semibold mt-1 flex items-center gap-0.5 justify-end"><MorphIcon icon={Clock} className="w-2.5 h-2.5" />{t('finance.pending')}</p>}
                    </div>
                  </div>
                  {canConfirm&&<button onClick={e2=>{e2.stopPropagation();onConfirm(e.id);}} className="mt-2 w-full text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={Check} className="w-3 h-3" />{t('finance.confirmAction')}</button>}
                  {canAdminApprove&&(
                    <div className="mt-2 flex gap-2" onClick={e2=>e2.stopPropagation()}>
                      <button onClick={()=>onApprove?.(e.id)} className="flex-1 text-sm md:text-xs bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={Check} className="w-3 h-3" />{t('approvalChain.approve')}</button>
                      <button onClick={()=>onReject?.(e.id)} className="flex-1 text-sm md:text-xs bg-red-600 text-white rounded py-1.5 hover:bg-red-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={X} className="w-3 h-3" />{t('approvalChain.reject')}</button>
                    </div>
                  )}
                </div>
                </SwipeRow>
              );
            })
        }
      </div>

      {showAdd&&<AddExpenseModal currentUser={currentUser} projects={projects} allUsers={users} onClose={()=>setShowAdd(false)} onAdd={onAddExpense} allowIncome={allowIncome}/>}
      {detailExp&&<ExpenseDetailModal expense={detailExp} users={users} projects={projects} onClose={()=>setDetailExp(null)}/>}
      {editExp&&<EditExpenseModal expense={editExp} projects={projects} onClose={()=>setEditExp(null)} onSaved={(x)=>{ setEditExp(null); onUpdated?.(x); }}/>}
    </div>
  );
}

// ─── Add Expense Modal ─────────────────────────────────────────────────────────
export function AddExpenseModal({ currentUser, projects, allUsers, onClose, onAdd, allowIncome }:
  { currentUser: AppUser; projects: Project[]; allUsers: AppUser[]; onClose: () => void; onAdd: (e: Expense) => void; allowIncome?: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ type: "oylik" as ExpType, amount: "", projectId: projects[0]?.id || "", description: "", toUserId: "", approverId: "", date: new Date().toISOString().split("T")[0] });
  const [err, setErr] = useState("");
  const [boshqaRows, setBoshqaRows] = useState<{ name: string; price: string }[]>([{ name: "", price: "" }]);
  // Chek/nakladnoy suratidan to'ldirish — AI summa, sana, tavsif va turni o'qiydi; foydalanuvchi tekshirib yuboradi
  const receiptRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const scanReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setScanning(true); setErr("");
    try {
      const dataUrl = await resizeImageFile(file, 1600, 0.85);
      const r = await fetch(`${API_BASE}/api/transactions/scan-receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl.split(",")[1], mimeType: "image/jpeg" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || t('common.error')); return; }
      const type = (["oylik", "material", "jihozlar", "transport", "boshqa"].includes(d.category) ? d.category : "material") as ExpType;
      setForm(f => ({ ...f, type: type === "boshqa" ? "material" : type, amount: String(Math.round(d.amount)), description: d.description || f.description, date: d.date || f.date }));
      toast.success(t('addExpense.receiptRead', "Chek o'qildi — tekshirib, yuboring"));
    } catch { setErr(t('common.error')); }
    finally { setScanning(false); }
  };

  const boshqaTotal = boshqaRows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  // Admin (direktor/orinbosar) o'zi chiqim yaratsa — tasdiqlash shart emas
  // (backendda ham xuddi shu qoida: creator direktor/orinbosar bo'lsa
  // requiresAdminApproval qo'yilmaydi). Boshqa har qanday rol — kim
  // tasdiqlashini ANIQ tanlashi SHART.
  const needsApprover = !isAdmin(currentUser.role);
  const approverOptions = allUsers.filter(u => (u.role === 'direktor' || u.role === 'orinbosar') && u.id !== currentUser.id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (needsApprover && !form.approverId) { setErr(t('addExpense.errApproverRequired')); return; }

    if (form.type === "boshqa") {
      const valid = boshqaRows.filter(r => r.name.trim() && r.price);
      if (valid.length === 0) { setErr(t('addExpense.errNeedMaterial')); return; }
      onAdd({
        id: `e${Date.now()}`,
        type: "boshqa",
        amount: boshqaTotal,
        toUserId: form.toUserId || undefined,
        approverId: needsApprover ? form.approverId : undefined,
        projectId: form.projectId,
        description: valid.map(r => `${r.name}: ${Number(r.price).toLocaleString()} so'm`).join("; "),
        date: form.date,
        status: form.toUserId ? "pending" : "confirmed",
        createdById: currentUser.id
      });
      onClose();
      return;
    }

    if (!form.amount || +form.amount <= 0) { setErr(t('addExpense.errAmountRequired')); return; }
    if (form.type === "oylik" && !form.toUserId) { setErr(t('addExpense.errSalaryRecipient')); return; }
    if ((form.type as string) === "income") {
      onAdd({ id: `i${Date.now()}`, type: "income" as any, amount: +form.amount, projectId: form.projectId, description: form.description, date: form.date, status: "confirmed", createdById: currentUser.id });
      onClose();
      return;
    }
    onAdd({
      id: `e${Date.now()}`,
      type: form.type,
      amount: +form.amount,
      toUserId: form.toUserId || undefined,
      approverId: needsApprover ? form.approverId : undefined,
      projectId: form.projectId,
      description: form.description,
      date: form.date,
      status: form.toUserId ? "pending" : "confirmed",
      createdById: currentUser.id
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" >
      <EscClose onClose={onClose} />
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] supports-[height:1dvh]:max-h-[88dvh] overflow-y-auto scrollbar-hide animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={TrendingDown} className="w-4 h-4 text-accent" />{t('addExpense.title')}</h3>
          <button aria-label={t('addExpense.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <input ref={receiptRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={scanReceipt} />
          <button type="button" onClick={() => receiptRef.current?.click()} disabled={scanning}
            className="w-full h-11 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.04] text-primary text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/10 liquid-transition disabled:opacity-60">
            {scanning ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <span aria-hidden>📷</span>}
            {scanning ? t('addExpense.receiptReading', "Chek o'qilmoqda...") : t('addExpense.receiptBtn', "Chek suratidan to'ldirish")}
          </button>
          {err && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
              <MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0" />{err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.typeLabel')}</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.type} onChange={e => { setErr(""); setForm({...form, type: e.target.value as ExpType, toUserId: "", description: ""}); }}>
                {(Object.keys(EXP_LABELS) as ExpType[]).map(k => <option key={k} value={k}>{expLabel(t, k)}</option>)}
                {allowIncome && isAdmin(currentUser.role) && <option value="income">{t('finance.incomeType', "Kirim (tushum)")}</option>}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.dateLabel')}</label>
              <input type="date" className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.date} onChange={e => setForm({...form, date: e.target.value})} required/>
            </div>
          </div>

          {/* Boshqa: dynamic material rows — replaces amount + description fields */}
          {form.type === "boshqa" ? (
            <div>
              <label className="text-[10px] font-bold block mb-2 text-muted-foreground uppercase tracking-wider">{t('addExpense.materialsLabel')}</label>
              <div className="space-y-2">
                {boshqaRows.map((row, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input placeholder={t('addExpense.materialPlaceholder', { n: i + 1 })}
                      className="flex-1 text-sm border border-border rounded-lg px-2.5 py-2 bg-input-background focus:outline-none"
                      value={row.name} onChange={e => { const r = [...boshqaRows]; r[i] = {...r[i], name: e.target.value}; setBoshqaRows(r); }}/>
                    <input type="number" min="0" placeholder={t('addExpense.pricePlaceholder')}
                      className="w-28 text-sm border border-border rounded-lg px-2.5 py-2 bg-input-background focus:outline-none"
                      value={row.price} onChange={e => { const r = [...boshqaRows]; r[i] = {...r[i], price: e.target.value}; setBoshqaRows(r); }}/>
                    {boshqaRows.length > 1 && (
                      <button type="button" onClick={() => setBoshqaRows(rows => rows.filter((_, j) => j !== i))}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-red-500/10 liquid-transition">
                        <MorphIcon icon={X} className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setBoshqaRows(r => [...r, { name: "", price: "" }])}
                className="mt-2.5 flex items-center gap-1.5 text-sm text-primary hover:bg-primary/5 px-2.5 py-1.5 rounded-lg liquid-transition font-semibold">
                <MorphIcon icon={Plus} className="w-3.5 h-3.5" />{t('addExpense.addRow')}
              </button>
              {boshqaTotal > 0 && (
                <div className="mt-2.5 flex items-center justify-between p-3 rounded-xl border border-accent/20" style={{ background: "rgba(217,70,15,0.05)" }}>
                  <span className="text-xs text-muted-foreground font-semibold">{t('addExpense.totalPayment')}</span>
                  <span className="text-sm font-bold text-accent">{boshqaTotal.toLocaleString()} so'm</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.amountLabel')}</label>
                <input type="number" min="1" className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                  placeholder={t('addExpense.amountPlaceholder')} value={form.amount} onChange={e => { setErr(""); setForm({...form, amount: e.target.value}); }} required/>
              </div>
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
                  {t('addExpense.descLabel')} <span className="normal-case font-normal">{t('addExpense.optional')}</span>
                </label>
                <input className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                  placeholder={t('addExpense.descPlaceholder')} value={form.description} onChange={e => { setErr(""); setForm({...form, description: e.target.value}); }}/>
                {(() => {
                  const g = guessExpType(form.description);
                  return g && g !== form.type && g !== "boshqa" ? (
                    <button type="button" onClick={() => setForm({ ...form, type: g })}
                      className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/15">
                      🤖 {t('addExpense.aiSuggest', { defaultValue: "Tavsif bo'yicha tur" })}: <b>{expLabel(t, g)}</b> — {t('addExpense.apply', { defaultValue: "qo'llash" })}
                    </button>
                  ) : null;
                })()}
              </div>
            </>
          )}

          {projects.length > 0 && (
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.objectLabel')}</label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.projectId} onChange={e => setForm({...form, projectId: e.target.value})}>
                <option value="">{t('addExpense.objectNone')}</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
              {t('addExpense.toLabel')} {form.type === "oylik" ? <span className="text-accent normal-case">*</span> : <span className="normal-case font-normal">{t('addExpense.optional')}</span>}
            </label>
            <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
              value={form.toUserId} onChange={e => { setErr(""); setForm({...form, toUserId: e.target.value}); }}>
              <option value="">{t('addExpense.toSelectPlaceholder')}</option>
              {allUsers.filter(u => u.id !== currentUser.id).map(u => <option key={u.id} value={u.id}>{u.name} ({roleLabel(t, u.role)})</option>)}
            </select>
          </div>

          {needsApprover && (
            <div>
              <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
                {t('addExpense.approverLabel')} <span className="text-accent normal-case">*</span>
              </label>
              <select className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
                value={form.approverId} onChange={e => { setErr(""); setForm({...form, approverId: e.target.value}); }} required>
                <option value="">{t('addExpense.approverPlaceholder')}</option>
                {approverOptions.map(u => <option key={u.id} value={u.id}>{u.name} ({roleLabel(t, u.role)})</option>)}
              </select>
              {approverOptions.length === 0 && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">{t('addExpense.noApprovers')}</p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm border border-border rounded-xl px-3 py-2.5 hover:bg-muted liquid-transition font-medium">{t('addExpense.cancel')}</button>
            <button type="submit" className="flex-1 text-sm text-white rounded-xl px-3 py-2.5 font-bold liquid-transition shadow-sm"
              style={{ background: "linear-gradient(135deg, #D2440F 0%, #c03d0d 100%)" }}>
              {t('addExpense.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ExpenseDetailModal({ expense, users, projects, onClose }: { expense: Expense; users: AppUser[]; projects: Project[]; onClose: () => void }) {
  const { t } = useTranslation();
  const to = users.find(u => u.id === expense.toUserId);
  const proj = projects.find(p => p.id === expense.projectId);
  const creator = users.find(u => u.id === expense.createdById);
  const confirmer = users.find(u => u.id === expense.confirmedById);
  const approver = expense.approverId ? users.find(u => u.id === expense.approverId) : undefined;
  const rows: [string, string][] = [
    ...(expense.currency && expense.currency !== 'UZS' && expense.originalAmount
      ? [[t('finance.originalAmount', { defaultValue: 'Asl summa' }), `${expense.originalAmount.toLocaleString('ru-RU')} ${expense.currency === 'USD' ? '$' : '€'}`] as [string, string]] : []),
    [t('reports.table.date'), expense.date],
    [t('reports.table.type'), expLabel(t, expense.type)],
    [t('finance.to'), to?.name || expense.recipientName || "—"],
    [t('reports.table.project'), proj?.name || expense.objectLabel || "—"],
    [t('finance.createdBy'), creator?.name || "—"],
    ...(approver && expense.status === 'pending' ? [[t('approvalChain.approver'), approver.name] as [string, string]] : []),
    ...(confirmer ? [[t('finance.confirmedBy'), confirmer.name] as [string, string]] : []),
  ];
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm overflow-hidden animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Wallet} className="w-4 h-4 text-accent" />{t('finance.detailTitle')}</h3>
          <button aria-label={t('common.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <p className="text-base font-bold text-foreground">{expense.description || expLabel(t, expense.type)}</p>
            <p className="text-lg font-bold text-accent font-mono mt-1">{fmt(expense.amount)} <span className="text-sm font-normal text-muted-foreground">≈ {fmtUsd(expense.amount)}</span></p>
          </div>
          <div className="surface divide-y divide-border/50 overflow-hidden">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-3 py-2 text-sm md:text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground">{value}</span>
              </div>
            ))}
          </div>
          {expense.approvalHistory && expense.approvalHistory.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">{t('approvalChain.history')}</p>
              <div className="space-y-1.5">
                {expense.approvalHistory.map((h, i) => (
                  <div key={i} className={`flex items-start gap-2 text-[10px] rounded-lg px-2.5 py-1.5 ${h.action==='approved'?'bg-green-500/10 text-green-700 dark:text-green-400':'bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                    {h.action==='approved'?<MorphIcon icon={CheckCircle} className="w-3 h-3 mt-0.5 flex-shrink-0" />:<MorphIcon icon={X} className="w-3 h-3 mt-0.5 flex-shrink-0" />}
                    <span>{h.action==='approved'?t('approvalChain.approvedBy',{name:h.name}):t('approvalChain.rejectedBy',{name:h.name})} — {h.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => exportExpensesToCsv([expense], users, projects, `chiqim_${expense.date}.csv`)}
            className="btn btn-outline w-full flex items-center justify-center gap-1.5 text-sm md:text-xs py-2.5 rounded-full">
            <MorphIcon icon={Download} className="w-3.5 h-3.5" />{t('reports.exportExcel')}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Chiqimni tahrirlash (owner 2026-10-22) ────────────────────────────────────
export function EditExpenseModal({ expense, projects, onClose, onSaved }: { expense: Expense; projects: Project[]; onClose: () => void; onSaved: (e: Expense) => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(String(expense.amount || ""));
  const [description, setDescription] = useState(expense.description || "");
  const [type, setType] = useState<string>(expense.type);
  const [date, setDate] = useState(expense.date || "");
  const [projectId, setProjectId] = useState(expense.projectId || "");
  const [busy, setBusy] = useState(false);
  const isIncome = expense.type === "income";
  const save = async () => {
    const body: Record<string, unknown> = {};
    const a = Number(String(amount).replace(/\s/g, ""));
    if (a !== expense.amount) body.amount = a;
    if (description.trim() !== (expense.description || "")) body.description = description.trim();
    if (!isIncome && type !== expense.type) body.type = type;
    if (date !== expense.date) body.date = date;
    if (projectId !== (expense.projectId || "")) body.projectId = projectId || null;
    if (!Object.keys(body).length) { onClose(); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/transactions/${expense.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.errors?.[0]?.message || d.error || t('common.error', { defaultValue: 'Xatolik' })); return; }
      toast.success(t('common.saved', { defaultValue: 'Saqlandi' }));
      onSaved({ ...expense, ...d, id: d.id || d._id || expense.id });
    } catch { toast.error(t('common.networkError', { defaultValue: "Internet bilan aloqa yo'q" })); }
    finally { setBusy(false); }
  };
  const field = "w-full h-12 rounded-xl border border-border bg-input-background px-3 text-base sm:text-sm focus:outline-none focus:border-primary";
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <EscClose onClose={onClose} />
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3 max-h-[92dvh] overflow-y-auto animate-slide-up-fade" data-testid="edit-expense">
        <div className="mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
        <h3 className="text-base font-bold">{isIncome ? t('finance.editIncome', { defaultValue: "Kirimni o'zgartirish" }) : t('finance.editExpense', { defaultValue: "Chiqimni o'zgartirish" })}</h3>
        <label className="block"><span className="text-xs font-semibold text-muted-foreground">{t('finance.amount', { defaultValue: "Summa (so'm)" })}</span>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ""))} className={field} /></label>
        <label className="block"><span className="text-xs font-semibold text-muted-foreground">{t('finance.description', { defaultValue: 'Izoh' })}</span>
          <input value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className={field} /></label>
        {!isIncome && (
          <div><span className="text-xs font-semibold text-muted-foreground">{t('finance.type', { defaultValue: 'Turi' })}</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(Object.keys(EXP_LABELS) as ExpType[]).map((k) => (
                <button key={k} type="button" onClick={() => setType(k)} className={`h-10 px-4 rounded-full text-sm font-semibold ${type === k ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>{expLabel(t, k)}</button>
              ))}
            </div></div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs font-semibold text-muted-foreground">{t('finance.date', { defaultValue: 'Sana' })}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label>
          <label className="block"><span className="text-xs font-semibold text-muted-foreground">{t('finance.object', { defaultValue: 'Obyekt' })}</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-12 rounded-xl border border-border font-semibold">{t('common.cancel', { defaultValue: 'Bekor qilish' })}</button>
          <button type="button" disabled={busy || !Number(String(amount).replace(/\s/g, ""))} onClick={save} className="flex-1 h-12 rounded-xl bg-primary text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2" data-testid="edit-expense-save">
            {busy && <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" />}{t('common.save', { defaultValue: 'Saqlash' })}
          </button>
        </div>
      </div>
    </div>
  );
}
