import { useState, useRef, useMemo, useEffect } from "react";
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
import { IconTile } from "./components/IconTile";
import { SwipeRow } from "./components/SwipeRow";
import { IncomePanel } from "./IncomePanel";
import { MoneyField, moneyOf, useShowInUzs, InUzsToggle, parseAmount, type Cur } from "./components/Money";
import { MoneyInput } from "./components/MoneyInput";
import { CountUp } from "./components/CountUp";
import { amountToInput, fmtNumber, parseMoney } from "./lib/money";
import UserIc from "@hugeicons/core-free-icons/UserIcon";
import PackageIc from "@hugeicons/core-free-icons/Package01Icon";
import WrenchIc from "@hugeicons/core-free-icons/Wrench01Icon";
import TruckIc from "@hugeicons/core-free-icons/TruckDeliveryIcon";
import MoreIc from "@hugeicons/core-free-icons/MoreHorizontalCircle01Icon";
import InvoiceIc from "@hugeicons/core-free-icons/Invoice01Icon";
import type { IconTone } from "./components/IconTile";
import { usePersistentState, oneOf } from "./lib/persistentState";
import { confirmDialog } from "./lib/confirmDialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { guessExpType } from "./lib/expense";
import { EXP_LABELS, EscClose, LIVE_EUR_RATE, LIVE_RATE_DATE, LIVE_USD_RATE, expLabel, exportExpensesToCsv, fmt, fmtUsd, isAdmin, resizeImageFile, roleLabel, type AppUser, type ExpType, type Expense, type Project } from "./App";
import { scanReceiptFile, type ScanStage } from "./lib/receiptScan";

// ─── Finance Page ──────────────────────────────────────────────────────────────
/** `arr.find(x => x.id === id)` bilan bir xil natija (birinchi moslik), lekin O(1) */
function firstById<T extends { id: string }>(arr: T[]): Map<string | undefined, T> {
  const m = new Map<string | undefined, T>();
  for (const x of arr) if (!m.has(x.id)) m.set(x.id, x);
  return m;
}

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
  // Kirim bo'limi — HAMMA rolga (owner 2026-10-23): rahbar hammaning kirimini, boshqalar faqat o'zinikini ko'radi (server beradi)
  const [section, setSection] = usePersistentState<"exp" | "inc">("finance.section", "exp", oneOf(["exp", "inc"]));
  const showIncome = section === "inc";
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
  // Har qator uchun users/projects.find (qatorlar × xodimlar) o'rniga — bir marta tuziladigan id → yozuv xaritasi
  const userById = useMemo(() => firstById(users), [users]);
  const projById = useMemo(() => firstById(projects), [projects]);

  const totalExpense = expenses.filter(e=>e.status==="confirmed").reduce((a,e)=>a+e.amount,0);
  const isAdmin = ['direktor','orinbosar'].includes(currentUser.role);
  const pendingMe = isAdmin
    ? expenses.filter(e=>e.requiresAdminApproval&&e.status==="pending").length
    : expenses.filter(e=>e.toUserId===currentUser.id&&e.status==="pending").length;
  const [inUzs, setInUzs] = useShowInUzs();
  const hasFx = expenses.some((e) => e.currency && e.currency !== "UZS");
  // Har bir turning ikonkasi va rangi — karta nuri, ikonka va summa shu rangda (owner 2026-10-23: premium kartalar)
  const TYPE_LOOK: Record<string, { icon: any; tone: IconTone; acc: string }> = {
    oylik: { icon: UserIc, tone: "blue", acc: "#3b82f6" }, material: { icon: PackageIc, tone: "orange", acc: "#f97316" },
    jihozlar: { icon: WrenchIc, tone: "violet", acc: "#8b5cf6" }, transport: { icon: TruckIc, tone: "teal", acc: "#14b8a6" },
    boshqa: { icon: MoreIc, tone: "slate", acc: "#64748b" }, expense: { icon: InvoiceIc, tone: "amber", acc: "#f59e0b" },
  };
  const sectionTabs = (
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
          <h2 className="text-sm font-bold font-display">{t('finance.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('finance.totalConfirmed')} <CountUp value={totalExpense} format={fmt} className="font-semibold text-accent" testId="finance-total" /> <CountUp value={totalExpense} format={fmtUsd} className="text-[10px] text-muted-foreground/70" prefix="≈ " /></p>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingMe>0&&<span className="text-sm bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-full font-semibold flex items-center gap-1 badge-pulse"><MorphIcon icon={Clock} className="w-3 h-3" />{t('finance.pendingCount', { count: pendingMe })}</span>}
          <button onClick={()=>setShowCurrency(v=>!v)} title={t('currency.title')} aria-label={t('currency.title')} className="btn btn-outline flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-full"><MorphIcon icon={DollarSign} className="w-3 h-3" /></button>
          <button onClick={()=>setShowAdd(true)} className="btn btn-accent flex items-center gap-1 text-sm px-3 py-1.5 rounded-full"><MorphIcon icon={Plus} className="w-3 h-3" />{t('finance.addExpense')}</button>
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
            <MoneyInput value={currencyAmount} onChange={setCurrencyAmount} currency={currencyMode.startsWith("uzs") ? "UZS" : "USD"}
              placeholder={currencyMode.startsWith("uzs")?"UZS":currencyMode.startsWith("usd")?"USD":"EUR"}
              className="flex-1 min-w-[80px] text-sm border border-border rounded-xl px-3 py-1.5 bg-input-background focus:outline-none"/>
            {(() => {
              const n = parseMoney(currencyAmount);
              const result = currencyAmount && n > 0 ? (
                currencyMode==="uzs2usd" ? "$" + fmtNumber(n/LIVE_USD_RATE) :
                currencyMode==="usd2uzs" ? fmtNumber(Math.round(n*LIVE_USD_RATE)) + " UZS" :
                currencyMode==="uzs2eur" ? "€" + fmtNumber(n/LIVE_EUR_RATE) :
                currencyMode==="eur2uzs" ? fmtNumber(Math.round(n*LIVE_EUR_RATE)) + " UZS" : null
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

      {hasFx && <div className="flex justify-end px-1 flex-shrink-0"><InUzsToggle value={inUzs} onChange={setInUzs} /></div>}
      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 scrollbar-hide">
        {filteredExpenses.length===0
          ? <div className="text-center py-10 text-muted-foreground"><IconTile icon={Wallet} tone="green" size="xl" variant="soft" className="mx-auto mb-3" /><p className="text-sm">{t('finance.notFound')}</p></div>
          : filteredExpenses.map(e=>{
              const to=userById.get(e.toUserId);
              const proj=projById.get(e.projectId);
              const creator=userById.get(e.createdById);
              const canConfirm=e.toUserId===currentUser.id&&e.status==="pending"&&!e.requiresAdminApproval;
              // approverId belgilangan bo'lsa — FAQAT o'sha admin tasdiqlay oladi
              // (backend PATCH /:id/approve'dagi bir xil qoida). approverId yo'q
              // (eski) yozuvlar uchun — eski xatti-harakat, istalgan admin tasdiqlaydi.
              const canAdminApprove=isAdmin&&e.requiresAdminApproval&&e.status==="pending"&&(!e.approverId||e.approverId===currentUser.id);
              const approver=e.approverId?userById.get(e.approverId):undefined;
              return (
                <SwipeRow key={e.id} testId="finance-row" onOpen={()=>setDetailExp(e)}
                  actions={canEdit(e) ? [
                    { key: "edit", label: t('common.edit', { defaultValue: "O'zgartirish" }), icon: Edit, tone: "primary", onClick: () => setEditExp(e) },
                    { key: "del", label: t('common.delete', { defaultValue: "O'chirish" }), icon: Trash, tone: "danger", onClick: () => { void removeExp(e); } },
                  ] : []}>
                {/* Owner 2026-10-23: premium karta — tur ikonkasi, rangli nur, summa gradientda; holat va tur — chiplar */}
                {(() => { const look = TYPE_LOOK[e.type] || TYPE_LOOK.boshqa; const m = moneyOf(e, inUzs); return (
                <div className="fin-card w-full text-left" style={{ ["--acc" as any]: look.acc }}>
                  <div className="flex items-start gap-3">
                    <IconTile icon={look.icon} tone={look.tone} size="md" variant="soft" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[15px] font-semibold leading-snug text-foreground line-clamp-2 min-w-0">{e.description || expLabel(t, e.type as ExpType)}</p>
                        <p className="fin-amount text-[17px] whitespace-nowrap flex-shrink-0"><CountUp value={m.num} format={m.fmt} /></p>
                      </div>
                      {/* Owner 2026-10-28: valyutali summa ikki qator bo'lganda butun kartaning
                          ichi pastga surilardi. Endi "≈ so'm" qatori summaning TAGIDA emas,
                          chiplar qatorining O'NG chekkasida — karta balandligi o'zgarmaydi. */}
                      <div className="flex items-start justify-between gap-2 mt-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="fin-chip" style={{ ["--chip" as any]: look.acc }}>{expLabel(t, e.type as ExpType) || e.type}</span>
                        {e.status==="confirmed"
                          ?<span className="fin-chip" style={{ ["--chip" as any]: "#10b981" }}><MorphIcon icon={CheckCircle} className="w-3 h-3" />{t('finance.confirmed')}</span>
                          :<span className="fin-chip" style={{ ["--chip" as any]: "#f59e0b" }}><MorphIcon icon={Clock} className="w-3 h-3" />{t('finance.pending')}</span>}
                        {e.anomaly && <span className="fin-chip" style={{ ["--chip" as any]: "#f59e0b" }}>⚠ {t('finance.anomaly', { defaultValue: "G'ayrioddiy" })}</span>}
                        {e.requiresAdminApproval&&e.status==="pending"&&<span className="fin-chip" style={{ ["--chip" as any]: "#e5633a" }}>{t('approvalChain.needsApproval')}</span>}
                      </div>
                        {m.sub && <p className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums flex-shrink-0 leading-5">{m.sub}</p>}
                      </div>
                      <p className="text-[13px] text-muted-foreground mt-1.5 truncate">
                        {[proj?.name || e.objectLabel, e.date].filter(Boolean).join(" · ")}
                      </p>
                      {(to || e.recipientName || creator || (approver && e.status==="pending")) && (
                        <p className="text-[12px] text-muted-foreground/90 mt-0.5 truncate">
                          {[(to?.name || e.recipientName) ? `→ ${to?.name || e.recipientName}` : "", creator ? `✍ ${creator.name}` : "", approver && e.status==="pending" ? `⏳ ${approver.name}` : ""].filter(Boolean).join("   ")}
                        </p>
                      )}
                    </div>
                  </div>
                  {canConfirm&&<button onClick={e2=>{e2.stopPropagation();onConfirm(e.id);}} className="mt-2 w-full text-sm bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={Check} className="w-3 h-3" />{t('finance.confirmAction')}</button>}
                  {canAdminApprove&&(
                    <div className="mt-2 flex gap-2" onClick={e2=>e2.stopPropagation()}>
                      <button onClick={()=>onApprove?.(e.id)} className="flex-1 text-sm bg-green-600 text-white rounded py-1.5 hover:bg-green-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={Check} className="w-3 h-3" />{t('approvalChain.approve')}</button>
                      <button onClick={()=>onReject?.(e.id)} className="flex-1 text-sm bg-red-600 text-white rounded py-1.5 hover:bg-red-700 font-semibold flex items-center justify-center gap-1"><MorphIcon icon={X} className="w-3 h-3" />{t('approvalChain.reject')}</button>
                    </div>
                  )}
                </div>
                ); })()}
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
  // Valyuta — tahrirlashdagidek (owner 2026-10-26): so'm / $ / €, server kurs bo'yicha so'mga o'giradi
  const [currency, setCurrency] = useState<Cur>("UZS");
  const [err, setErr] = useState("");
  // Owner 2026-10-23: materiallar ro'yxati (nomi + narxi) FAQAT "Material" turida; "Boshqa" — oddiy: nomi + summa
  const [matRows, setMatRows] = useState<{ name: string; price: string }[]>([{ name: "", price: "" }]);
  // "Boshqa" — nima ekanini qo'lda yozish yoki avval yozilganlardan tanlash (owner 2026-10-22)
  const [otherLabel, setOtherLabel] = useState("");
  const savedLabels: string[] = (() => { try { return JSON.parse(localStorage.getItem("erp_otherLabels") || "[]"); } catch { return []; } })();
  // Chek/nakladnoy suratidan to'ldirish — AI summa, sana, tavsif va turni o'qiydi; foydalanuvchi tekshirib yuboradi
  const receiptRef = useRef<HTMLInputElement>(null);      // galereya / fayl
  const receiptCamRef = useRef<HTMLInputElement>(null);   // kamera
  const [scanning, setScanning] = useState(false);
  // Bosqich (siqish / yuklash / o'qish) va oyna yopilsa so'rovni bekor qilish (lib/receiptScan.ts)
  const [scanStage, setScanStage] = useState<ScanStage | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  useEffect(() => () => scanAbort.current?.abort(), []);
  const scanReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setScanning(true); setErr("");
    scanAbort.current?.abort();
    const ac = new AbortController(); scanAbort.current = ac;
    try {
      const res = await scanReceiptFile(file, { resize: resizeImageFile, fetch: (...a) => fetch(...a), url: `${API_BASE}/api/transactions/scan-receipt` }, { signal: ac.signal, onStage: setScanStage });
      if (!res.ok) { if (res.kind !== 'cancelled') setErr(res.message); return; }
      const d = res.data;
      const type = (["oylik", "material", "jihozlar", "transport", "boshqa"].includes(d.category) ? d.category : "material") as ExpType;
      const t2 = type === "boshqa" ? "material" : type;
      setForm(f => ({ ...f, type: t2, amount: amountToInput(Math.round(d.amount)), description: d.description || f.description, date: d.date || f.date }));
      if (t2 === "material") setMatRows([{ name: d.description || "", price: amountToInput(Math.round(d.amount)) }]);
      toast.success(t('addExpense.receiptRead', "Chek o'qildi — tekshirib, yuboring"));
    } catch { setErr(t('common.error')); }
    finally { if (scanAbort.current === ac) { setScanning(false); setScanStage(null); } }
  };

  const matTotal = matRows.reduce((s, r) => s + parseMoney(r.price), 0);
  const amountNum = parseMoney(form.amount);
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

    if (form.type === "material") {
      const valid = matRows.filter(r => r.name.trim() && parseMoney(r.price) > 0);
      if (valid.length === 0) { setErr(t('addExpense.errNeedMaterial')); return; }
      onAdd({
        id: `e${Date.now()}`,
        type: "material",
        amount: valid.reduce((s, r) => s + parseMoney(r.price), 0),
        toUserId: form.toUserId || undefined,
        approverId: needsApprover ? form.approverId : undefined,
        projectId: form.projectId,
        description: valid.map(r => `${r.name.trim()}: ${fmtNumber(parseMoney(r.price))} so'm`).join("; "),
        date: form.date,
        status: form.toUserId ? "pending" : "confirmed",
        createdById: currentUser.id
      });
      onClose();
      return;
    }

    if (form.type === "boshqa" && !otherLabel.trim()) { setErr(t('addExpense.errOtherName', "Chiqim nomini yozing")); return; }
    if (!(amountNum > 0)) { setErr(t('addExpense.errAmountRequired')); return; }
    if (form.type === "oylik" && !form.toUserId) { setErr(t('addExpense.errSalaryRecipient')); return; }
    if (form.type === "boshqa") {
      try { localStorage.setItem("erp_otherLabels", JSON.stringify([otherLabel.trim(), ...savedLabels.filter(l => l !== otherLabel.trim())].slice(0, 15))); } catch { /* */ }
    }
    if ((form.type as string) === "income") {
      onAdd({ id: `i${Date.now()}`, type: "income" as any, amount: amountNum, ...(currency !== "UZS" ? { currency } : {}), projectId: form.projectId, description: form.description, date: form.date, status: "confirmed", createdById: currentUser.id });
      onClose();
      return;
    }
    onAdd({
      id: `e${Date.now()}`,
      type: form.type,
      amount: amountNum,
      ...(currency !== "UZS" ? { currency } : {}),
      toUserId: form.toUserId || undefined,
      approverId: needsApprover ? form.approverId : undefined,
      projectId: form.projectId,
      description: form.type === "boshqa" ? otherLabel.trim() : form.description,
      date: form.date,
      status: form.toUserId ? "pending" : "confirmed",
      createdById: currentUser.id
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-kb-sheet>
      <EscClose onClose={onClose} />
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] supports-[height:1dvh]:max-h-[88dvh] overflow-y-auto overscroll-contain scrollbar-hide animate-slide-up-fade" data-testid="add-expense" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={TrendingDown} className="w-4 h-4 text-accent" />{t('addExpense.title')}</h3>
          <button aria-label={t('addExpense.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {/* Owner 2026-10-28: "galereyadan qo'yish yo'q ekan — galereya yoki kamera tanlash bo'lsin".
              Ilgari bitta tugma edi va u capture="environment" bilan telefonda TO'G'RIDAN-TO'G'RI
              kamerani ochardi — allaqachon olingan chek suratini qo'yib bo'lmasdi. Endi ikkita
              manba: kamera (capture bilan) va galereya (capture'siz — rasm/fayl tanlash). */}
          <input ref={receiptCamRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={scanReceipt} />
          <input ref={receiptRef} type="file" accept="image/*" className="hidden" onChange={scanReceipt} />
          {scanning ? (
            <div className="w-full h-11 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.04] text-primary text-sm font-bold flex items-center justify-center gap-2">
              <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" />
              {scanStage === 'compress' ? t('addExpense.receiptCompress', "Surat tayyorlanmoqda...") : scanStage === 'upload' ? t('addExpense.receiptUpload', "Yuklanmoqda...") : t('addExpense.receiptReading', "Chek o'qilmoqda...")}
            </div>
          ) : (
            <div>
              <p className="text-[10px] font-bold mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.receiptBtn', "Chek suratidan to'ldirish")}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => receiptCamRef.current?.click()}
                  className="h-11 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.04] text-primary text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/10 liquid-transition">
                  <span aria-hidden>📷</span>{t('addExpense.receiptCamera', "Kamera")}
                </button>
                <button type="button" onClick={() => receiptRef.current?.click()}
                  className="h-11 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.04] text-primary text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/10 liquid-transition">
                  <span aria-hidden>🖼</span>{t('addExpense.receiptGallery', "Galereya")}
                </button>
              </div>
            </div>
          )}
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

          {/* Material: materiallar ro'yxati (nomi + narxi) — summa avtomatik */}
          {form.type === "material" ? (
            <div>
              <label className="text-[10px] font-bold block mb-2 text-muted-foreground uppercase tracking-wider">{t('addExpense.materialsLabel')}</label>
              <div className="space-y-2">
                {matRows.map((row, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input placeholder={t('addExpense.materialPlaceholder', { n: i + 1 })} data-testid="mat-name"
                      className="flex-1 min-w-0 text-base sm:text-sm border border-border rounded-lg px-2.5 h-11 bg-input-background focus:outline-none"
                      value={row.name} onChange={e => { const r = [...matRows]; r[i] = {...r[i], name: e.target.value}; setMatRows(r); }}/>
                    <PriceField placeholder={t('addExpense.pricePlaceholder')} testId="mat-price" wrapClassName="w-44 flex-shrink-0"
                      className="text-base sm:text-sm border border-border rounded-lg px-2.5 h-11 bg-input-background focus:outline-none"
                      value={row.price} onChange={v => { setErr(""); const r = [...matRows]; r[i] = {...r[i], price: v}; setMatRows(r); }}/>
                    {matRows.length > 1 && (
                      <button type="button" aria-label={t('common.delete', { defaultValue: "O'chirish" })} onClick={() => setMatRows(rows => rows.filter((_, j) => j !== i))}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-red-500/10 liquid-transition">
                        <MorphIcon icon={X} className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setMatRows(r => [...r, { name: "", price: "" }])}
                className="mt-2.5 flex items-center gap-1.5 text-sm text-primary hover:bg-primary/5 px-2.5 py-1.5 rounded-lg liquid-transition font-semibold">
                <MorphIcon icon={Plus} className="w-3.5 h-3.5" />{t('addExpense.addRow')}
              </button>
              {matTotal > 0 && (
                <div className="mt-2.5 flex items-center justify-between p-3 rounded-xl border border-accent/20" style={{ background: "rgba(217,70,15,0.05)" }}>
                  <span className="text-xs text-muted-foreground font-semibold">{t('addExpense.totalPayment')}</span>
                  <span className="text-sm font-bold text-accent tabular-nums" data-testid="mat-total">{fmt(matTotal)}</span>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Boshqa — oddiy: nomi (qo'lda yoki avval yozilganlardan) + summa */}
              {form.type === "boshqa" && (
                <div>
                  <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">{t('addExpense.otherNameLabel', "Nomi *")}</label>
                  <input list="erp-other-labels" value={otherLabel} onChange={e => { setErr(""); setOtherLabel(e.target.value); }} maxLength={60}
                    placeholder={t('addExpense.otherNamePh', "Masalan: Ovqat, Ijara, Kommunal")}
                    className="w-full min-w-0 h-11 text-base sm:text-sm border border-border rounded-xl px-3 bg-input-background focus:outline-none" data-testid="other-label" />
                  <datalist id="erp-other-labels">{savedLabels.map(l => <option key={l} value={l} />)}</datalist>
                </div>
              )}
              <MoneyField label={t('addExpense.amountLabel')} amount={form.amount} currency={currency}
                onAmount={v => { setErr(""); setForm(f => ({ ...f, amount: v })); }} onCurrency={setCurrency}
                side={(form.type as string) === "income" ? "buy" : "sell"} testId="expense-amount"
                className="w-full h-11 text-base sm:text-sm border border-border rounded-lg px-2.5 bg-input-background focus:outline-none tabular-nums" />
              {form.type !== "boshqa" && (
              <div>
                <label className="text-[10px] font-bold block mb-1.5 text-muted-foreground uppercase tracking-wider">
                  {t('addExpense.descLabel')} <span className="normal-case font-normal">{t('addExpense.optional')}</span>
                </label>
                <input className="w-full text-base sm:text-sm border border-border rounded-lg px-2.5 py-2.5 bg-input-background focus:outline-none"
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
              )}
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
              <div key={label} className="flex items-center justify-between px-3 py-2 text-sm">
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
            className="btn btn-outline w-full flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-full">
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
  const fx = expense.currency && expense.currency !== "UZS" && expense.originalAmount ? expense.currency as Cur : null;
  const [currency, setCurrency] = useState<Cur>(fx || "UZS");
  const [amount, setAmount] = useState(() => amountToInput(fx ? expense.originalAmount : expense.amount, fx || "UZS"));
  const [description, setDescription] = useState(expense.description || "");
  const [type, setType] = useState<string>(expense.type);
  const [date, setDate] = useState(expense.date || "");
  const [projectId, setProjectId] = useState(expense.projectId || "");
  const [busy, setBusy] = useState(false);
  const isIncome = expense.type === "income";
  const save = async () => {
    const body: Record<string, unknown> = {};
    const a = parseAmount(String(amount));
    const origCur = fx || "UZS";
    if (currency !== origCur || a !== (fx ? expense.originalAmount : expense.amount)) { body.amount = a; if (currency !== "UZS" || origCur !== "UZS") body.currency = currency; }
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
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" data-kb-sheet>
      <EscClose onClose={onClose} />
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3 max-h-[92dvh] overflow-y-auto overscroll-contain animate-slide-up-fade" data-testid="edit-expense">
        <div className="mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
        <h3 className="text-base font-bold">{isIncome ? t('finance.editIncome', { defaultValue: "Kirimni o'zgartirish" }) : t('finance.editExpense', { defaultValue: "Chiqimni o'zgartirish" })}</h3>
        <MoneyField label={t('finance.amountShort', { defaultValue: "Summa" })} amount={amount} currency={currency} onAmount={setAmount} onCurrency={setCurrency} className={field} side={isIncome ? "buy" : "sell"} />
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
          <button type="button" disabled={busy || !parseAmount(amount)} onClick={save} className="flex-1 h-12 rounded-xl bg-primary text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2" data-testid="edit-expense-save">
            {busy && <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" />}{t('common.save', { defaultValue: 'Saqlash' })}
          </button>
        </div>
      </div>
    </div>
  );
}
