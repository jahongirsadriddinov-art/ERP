import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { API_BASE } from "./api";

// ─── Ishbay hisob (owner 2026-10-19: ixtiyoriy) ──────────────────────────────────────────────────────────────
// Firma sozlamasida yoqilgan bo'lsa: prorab/rahbar bajarilgan hajm × narxni yozadi, rahbar (yoki obyekt prorabi)
// tasdiqlaydi — tasdiqlangani oylikka qo'shiladi.

// Firma funksiyalari — bir marta olinadi, sozlama o'zgarsa (erp:features) yangilanadi
let featuresCache: Record<string, boolean> | null = null;
let featuresPromise: Promise<Record<string, boolean>> | null = null;
export function useCompanyFeatures(): Record<string, boolean> | null {
  const [f, setF] = useState<Record<string, boolean> | null>(featuresCache);
  useEffect(() => {
    if (!featuresCache) {
      featuresPromise = featuresPromise || fetch(`${API_BASE}/api/company/features`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      featuresPromise.then((d) => { featuresCache = d; setF(d); });
    }
    const on = (e: Event) => { featuresCache = (e as CustomEvent).detail; setF(featuresCache); };
    window.addEventListener("erp:features", on);
    return () => window.removeEventListener("erp:features", on);
  }, []);
  return f;
}

type Log = { id: string; userId: string; userName: string; workName: string; unit: string; volume: number; rate: number; amount: number; date: string; status: "pending" | "approved" | "rejected"; createdBy?: { userId: string } };
type U = { id: string; name: string; role: string };

const money = (n: number) => Math.round(n).toLocaleString("ru-RU");
const inputCls = "h-10 w-full rounded-xl border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export function PieceworkTab({ objectId, users, currentUser, isBoss, isForeman }: { objectId: string; users: U[]; currentUser: { id: string }; isBoss: boolean; isForeman: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Log[] | null>(null);
  const [form, setForm] = useState({ userId: "", workName: "", unit: "m2", volume: "", rate: "" });
  const [saving, setSaving] = useState(false);
  const load = () => fetch(`${API_BASE}/api/worklogs?objectId=${objectId}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items || [])).catch(() => setItems([]));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [objectId]);

  const canAdd = isBoss || isForeman;
  const workers = users.filter((u) => ["ishchi", "brigadir", "prorab"].includes(u.role));
  const amount = (Number(form.volume) || 0) * (Number(form.rate) || 0);
  const add = async () => {
    setSaving(true);
    const r = await fetch(`${API_BASE}/api/worklogs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectId, userId: form.userId, workName: form.workName, unit: form.unit, volume: Number(form.volume), rate: Number(form.rate) }),
    }).catch(() => null);
    setSaving(false);
    const d = await r?.json().catch(() => null);
    if (r?.ok || r?.status === 202) { toast.success(t("piecework.added")); setForm({ ...form, workName: "", volume: "" }); void load(); }
    else toast.error(d?.error || t("common.error"));
  };
  const decide = async (id: string, decision: "approve" | "reject") => {
    const r = await fetch(`${API_BASE}/api/worklogs/${id}/${decision}`, { method: "PATCH" }).catch(() => null);
    if (r?.ok) void load(); else toast.error((await r?.json().catch(() => null))?.error || t("common.error"));
  };
  const total = (items || []).filter((x) => x.status === "approved").reduce((s, x) => s + x.amount, 0);

  return (
    <div className="p-3 space-y-3 max-w-3xl w-full mx-auto">
      {canAdd && (
        <motion.div className="surface rounded-2xl p-3 grid grid-cols-2 sm:grid-cols-6 gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} className={`${inputCls} col-span-2`} aria-label={t("piecework.worker")}>
            <option value="">{t("piecework.worker")}</option>
            {workers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input value={form.workName} onChange={(e) => setForm({ ...form, workName: e.target.value })} placeholder={t("piecework.workName")} className={`${inputCls} col-span-2`} />
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder={t("piecework.unit")} className={inputCls} />
          <input type="number" min={0} value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} placeholder={t("piecework.volume")} className={inputCls} />
          <input type="number" min={0} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder={t("piecework.rate")} className={`${inputCls} col-span-2 sm:col-span-3`} />
          <button type="button" disabled={saving || !form.userId || form.workName.trim().length < 2 || !(Number(form.volume) > 0)} onClick={add}
            className="btn btn-primary h-10 rounded-xl text-sm font-semibold col-span-2 sm:col-span-3 disabled:opacity-50">
            {t("piecework.add")}{amount > 0 ? ` · ${money(amount)} so'm` : ""}
          </button>
        </motion.div>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{t("piecework.listTitle")}</span>
        <span className="font-semibold text-foreground">{t("piecework.approvedTotal")}: {money(total)} so'm</span>
      </div>
      {items === null ? <div className="h-20 rounded-2xl bg-muted/50 animate-pulse" /> : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t("piecework.empty")}</p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((x) => (
              <motion.li key={x.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                className="surface rounded-xl px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{x.workName} · {x.volume} {x.unit}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{x.userName} · {x.date} · {money(x.rate)} × {x.volume} = <b>{money(x.amount)}</b></p>
                </div>
                {x.status === "pending" && (isBoss || (isForeman && x.createdBy?.userId !== currentUser.id)) ? (
                  <div className="flex gap-1 flex-shrink-0">
                    <button type="button" onClick={() => decide(x.id, "approve")} className="h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">{t("piecework.approve")}</button>
                    <button type="button" onClick={() => decide(x.id, "reject")} className="h-8 px-3 rounded-lg text-xs font-semibold bg-red-500/10 text-red-600">{t("piecework.reject")}</button>
                  </div>
                ) : (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${x.status === "approved" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : x.status === "rejected" ? "bg-red-500/10 text-red-600" : "bg-amber-500/12 text-amber-700"}`}>
                    {t(`piecework.status.${x.status}`)}
                  </span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
