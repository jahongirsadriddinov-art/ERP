import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import TrendingUp from "@hugeicons/core-free-icons/TradeUpIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import { API_BASE } from "./api";
import { SwipeRow } from "./components/SwipeRow";
import { confirmDialog } from "./lib/confirmDialog";
import { EscClose, fmt, fmtUsd, roleLabel, type AppUser, type Expense, type Project } from "./App";
import { EditExpenseModal } from "./FinancePage";

// Kirim (owner 2026-10-22): kirimni faqat direktor va o'rinbosar kiritadi. Direktor hammaning kirimini KIM kiritgani
// bo'yicha ko'radi ("o'rinbosar shuncha so'm kirim qildi"), o'rinbosar — faqat o'zinikini (server shu qoida bilan beradi).

export function IncomePanel({ currentUser, users, projects, incomes, onAdded, onUpdated, onDeleted }: {
  currentUser: AppUser; users: AppUser[]; projects: Project[]; incomes: Expense[];
  onAdded: (e: Expense) => void; onUpdated: (e: Expense) => void; onDeleted: (id: string) => void;
}) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`income.${s}`, o as any) as string;
  const [person, setPerson] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<Expense | null>(null);
  const isDirector = currentUser.role === "direktor" || !!(currentUser as any).isOwner;

  const byPerson = useMemo(() => {
    const m = new Map<string, { id: string; total: number; count: number }>();
    for (const e of incomes) {
      const id = e.createdById || "—";
      const cur = m.get(id) || { id, total: 0, count: 0 };
      cur.total += e.amount || 0; cur.count++;
      m.set(id, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [incomes]);
  const total = incomes.reduce((a, e) => a + (e.amount || 0), 0);
  const shown = [...incomes].filter((e) => person === "all" || (e.createdById || "—") === person).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || (id === currentUser.id ? currentUser.name : "—");

  const remove = async (e: Expense) => {
    if (!(await confirmDialog(k("deleteConfirm"), { danger: true, okText: t("common.delete", { defaultValue: "O'chirish" }) }))) return;
    const r = await fetch(`${API_BASE}/api/transactions/${e.id}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { const d = await r?.json().catch(() => ({})); toast.error(d?.error || t("common.error", { defaultValue: "Xatolik" })); return; }
    onDeleted(e.id);
  };

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1" data-testid="income-panel">
      <div className="surface px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{isDirector ? k("totalAll") : k("totalMine")}</p>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{fmt(total)}</p>
          <p className="text-[11px] text-muted-foreground font-mono">≈ {fmtUsd(total)}</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="h-11 px-4 rounded-full bg-emerald-600 text-white font-semibold inline-flex items-center gap-1.5 flex-shrink-0" data-testid="income-add">
          <MorphIcon icon={Plus} className="w-4 h-4" />{k("add")}
        </button>
      </div>

      {isDirector && byPerson.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide flex-shrink-0 -mx-1 px-1" data-testid="income-people">
          <button type="button" onClick={() => setPerson("all")}
            className={`flex-shrink-0 rounded-2xl px-4 py-2.5 text-left border ${person === "all" ? "bg-primary text-white border-primary" : "surface border-border"}`}>
            <p className="text-xs font-semibold">{k("everyone")}</p>
            <p className="text-sm font-bold font-mono">{fmt(total)}</p>
          </button>
          {byPerson.map((p) => {
            const u = users.find((x) => x.id === p.id);
            return (
              <button key={p.id} type="button" onClick={() => setPerson(p.id)}
                className={`flex-shrink-0 rounded-2xl px-4 py-2.5 text-left border ${person === p.id ? "bg-primary text-white border-primary" : "surface border-border"}`}>
                <p className="text-xs font-semibold truncate max-w-[10rem]">{nameOf(p.id)}{u ? ` · ${roleLabel(t, u.role)}` : ""}</p>
                <p className="text-sm font-bold font-mono">{fmt(p.total)}</p>
                <p className="text-[10px] opacity-75">{k("count", { count: p.count })}</p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 scrollbar-hide">
        {shown.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground"><MorphIcon icon={TrendingUp} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm">{k("empty")}</p></div>
        ) : shown.map((e) => {
          const proj = projects.find((p) => p.id === e.projectId);
          return (
            <SwipeRow key={e.id} testId="income-row" actions={[
              { key: "edit", label: t("common.edit", { defaultValue: "Tahrirlash" }), icon: Edit, tone: "primary", onClick: () => setEdit(e) },
              { key: "del", label: t("common.delete", { defaultValue: "O'chirish" }), icon: Trash, tone: "danger", onClick: () => { void remove(e); } },
            ]}>
              <div className="surface rounded-2xl p-3.5 flex items-start justify-between gap-3" style={{ borderLeft: "4px solid #10b981" }}>
                <div className="min-w-0">
                  <p className="font-semibold text-[15px] truncate">{e.description || k("noNote")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{[proj?.name, e.date].filter(Boolean).join(" • ")}</p>
                  {isDirector && <p className="text-xs text-muted-foreground">{k("by")} <span className="font-medium text-foreground">{nameOf(e.createdById)}</span></p>}
                </div>
                <p className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-right flex-shrink-0">+{fmt(e.amount)}</p>
              </div>
            </SwipeRow>
          );
        })}
      </div>

      {showAdd && <AddIncomeModal currentUser={currentUser} projects={projects} onClose={() => setShowAdd(false)} onAdded={(x) => { setShowAdd(false); onAdded(x); }} />}
      {edit && <EditExpenseModal expense={edit} projects={projects} onClose={() => setEdit(null)} onSaved={(x) => { setEdit(null); onUpdated(x); }} />}
    </div>
  );
}

function AddIncomeModal({ currentUser, projects, onClose, onAdded }: { currentUser: AppUser; projects: Project[]; onClose: () => void; onAdded: (e: Expense) => void }) {
  const { t } = useTranslation();
  const k = (s: string) => t(`income.${s}`) as string;
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(amount.replace(/\s/g, ""));
  const save = async () => {
    if (!n) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/transactions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "income", amount: n, description: description.trim(), date, projectId: projectId || undefined, status: "confirmed", createdById: currentUser.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.errors?.[0]?.message || d.error || t("common.error", { defaultValue: "Xatolik" })); return; }
      toast.success(k("added"));
      onAdded({ ...d, id: d._id || d.id });
    } catch { toast.error(t("common.networkError", { defaultValue: "Internet bilan aloqa yo'q" })); }
    finally { setBusy(false); }
  };
  const field = "w-full h-12 rounded-xl border border-border bg-input-background px-3 text-base sm:text-sm focus:outline-none focus:border-primary";
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <EscClose onClose={onClose} />
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3 animate-slide-up-fade" data-testid="income-modal">
        <div className="mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
        <h3 className="text-base font-bold">{k("addTitle")}</h3>
        <label className="block"><span className="text-xs font-semibold text-muted-foreground">{k("amount")}</span>
          <input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ""))} className={field} placeholder="0" /></label>
        <label className="block"><span className="text-xs font-semibold text-muted-foreground">{k("source")}</span>
          <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} className={field} placeholder={k("sourcePh")} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs font-semibold text-muted-foreground">{t("finance.date", { defaultValue: "Sana" })}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label>
          <label className="block"><span className="text-xs font-semibold text-muted-foreground">{t("finance.object", { defaultValue: "Obyekt" })}</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 h-12 rounded-xl border border-border font-semibold">{t("common.cancel", { defaultValue: "Bekor qilish" })}</button>
          <button type="button" disabled={busy || !n} onClick={save} className="flex-1 h-12 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2" data-testid="income-save">
            {busy && <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" />}{t("common.save", { defaultValue: "Saqlash" })}
          </button>
        </div>
      </div>
    </div>
  );
}
