import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { API_BASE } from "../api";

// Shaxsiy zaxira nusxalar (vaqt bo'yicha ro'yxat, bir bosishda tiklash) va "Xavfli zona" (tanlab tozalash).
// Faqat direktor / o'rinbosar ko'radi; server ham shuni tekshiradi.
type Snap = { id: string; reason: string; reasonLabel: string; note?: string; by?: string; counts: Record<string, number>; sizeBytes: number; createdAt: string };

const fmtDate = (s: string) => new Date(s).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
const total = (c: Record<string, number>) => Object.values(c || {}).reduce((a, b) => a + (b || 0), 0);
const REASON_TONE: Record<string, string> = {
  auto_daily: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
  manual: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  pre_reset: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
  pre_restore: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25",
  pre_delete: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
};

export function SnapshotsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useTranslation();
  const [list, setList] = useState<Snap[] | null>(null);
  const [busy, setBusy] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const load = () => fetch(`${API_BASE}/api/admin/snapshots`).then(r => r.ok ? r.json() : []).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [refreshKey]);

  const take = async () => {
    setBusy("take");
    try {
      const r = await fetch(`${API_BASE}/api/admin/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) toast.error(d.error || t("common.error")); else { toast.success(t("safety.snapTaken", "Nusxa saqlandi")); load(); }
    } finally { setBusy(""); }
  };
  const restore = async (id: string) => {
    setBusy(id);
    try {
      const r = await fetch(`${API_BASE}/api/admin/snapshots/${id}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || t("common.error")); return; }
      toast.success(t("safety.restored", "Ma'lumotlar tiklandi — sahifa yangilanadi"));
      setTimeout(() => window.location.reload(), 1200);
    } finally { setBusy(""); setConfirmId(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold">{t("safety.snapsTitle", "Zaxira nusxalar")}</p>
          <p className="text-xs text-muted-foreground">{t("safety.snapsHint", "Har kuni avtomatik olinadi, tozalash va tiklashdan oldin ham. Kerakli vaqtni tanlab bir bosishda qaytaring.")}</p>
        </div>
        <button type="button" onClick={take} disabled={!!busy} className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60 flex-shrink-0">
          {busy === "take" ? "..." : t("safety.takeNow", "Hozir nusxa olish")}
        </button>
      </div>
      {list === null ? <div className="h-24 rounded-xl bg-muted/40 animate-pulse" /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("safety.noSnaps", "Hali nusxa yo'q — birinchisi bugun avtomatik olinadi")}</p>
      ) : (
        <ul className="space-y-2 max-h-[420px] overflow-y-auto overscroll-contain pr-1">
          {list.map(s => (
            <li key={s.id} className="rounded-2xl border border-border bg-card/70 p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold tabular-nums">{fmtDate(s.createdAt)}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${REASON_TONE[s.reason] || "border-border"}`}>{s.reasonLabel}</span>
                    <span className="text-[11px] text-muted-foreground">{total(s.counts)} {t("safety.records", "yozuv")} · {(s.sizeBytes / 1024).toFixed(0)} KB{s.by ? ` · ${s.by}` : ""}</span>
                  </div>
                  {s.note && <p className="text-[11px] text-muted-foreground mt-1 break-words">{s.note}</p>}
                </div>
                {confirmId === s.id ? (
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button type="button" disabled={!!busy} onClick={() => restore(s.id)} className="h-9 px-3 rounded-lg bg-amber-500 text-black text-xs font-bold">{busy === s.id ? "..." : t("safety.yesRestore", "Ha, tiklash")}</button>
                    <button type="button" onClick={() => setConfirmId(null)} className="h-8 px-3 rounded-lg border border-border text-xs">{t("common.cancel")}</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmId(s.id)} disabled={!!busy} className="h-9 px-3 rounded-lg border border-primary/40 text-primary text-xs font-bold hover:bg-primary/10 flex-shrink-0">{t("safety.restore", "Tiklash")}</button>
                )}
              </div>
              {confirmId === s.id && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">{t("safety.restoreWarn", "Ma'lumotlar shu vaqtdagi holatga qaytadi. Hozirgi holat ham avval avtomatik saqlanadi — keyin uni ham qaytarish mumkin.")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DangerZone({ companyName, onDone }: { companyName: string; onDone?: () => void }) {
  const { t } = useTranslation();
  const [scopes, setScopes] = useState<{ key: string; label: string }[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${API_BASE}/api/admin/reset-scopes`).then(r => r.ok ? r.json() : []).then(setScopes).catch(() => {}); }, []);
  const ready = (all || sel.length > 0) && text.trim().toLowerCase() === companyName.trim().toLowerCase();
  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/admin/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scopes: all ? "all" : sel, confirmText: text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || t("common.error")); return; }
      toast.success(t("safety.resetDone", "Tozalandi. Oldingi holat nusxasi saqlandi — kerak bo'lsa tiklang."));
      setSel([]); setAll(false); setText(""); onDone?.();
      setTimeout(() => window.location.reload(), 1500);
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border-2 border-red-500/40 bg-red-500/[0.04] p-4 space-y-3">
      <div>
        <p className="text-sm font-extrabold text-red-600 dark:text-red-400">⚠️ {t("safety.dangerTitle", "Xavfli zona — ma'lumotlarni tozalash")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t("safety.dangerHint", "Tanlangan bo'limlar butunlay o'chiriladi. O'chirishdan oldin avtomatik zaxira nusxa olinadi — yuqoridagi ro'yxatdan qaytarish mumkin.")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {scopes.map(s => (
          <label key={s.key} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${all || sel.includes(s.key) ? "border-red-500/50 bg-red-500/[0.07]" : "border-border bg-card/60"}`}>
            <input type="checkbox" disabled={all} checked={all || sel.includes(s.key)} onChange={() => setSel(p => p.includes(s.key) ? p.filter(x => x !== s.key) : [...p, s.key])} className="w-4 h-4 accent-red-600 flex-shrink-0" />
            <span className="text-sm min-w-0">{s.label}</span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2.5 rounded-xl border border-red-500/50 px-3 py-2.5 cursor-pointer bg-red-500/[0.06]">
        <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} className="w-4 h-4 accent-red-600" />
        <span className="text-sm font-bold text-red-600 dark:text-red-400">{t("safety.resetAll", "Hammasini tozalash (rahbarlar hisobi va firma qoladi)")}</span>
      </label>
      <div>
        <p className="text-xs mb-1">{t("safety.typeName", "Tasdiqlash uchun firma nomini yozing:")} <b>{companyName}</b></p>
        <input value={text} onChange={e => setText(e.target.value)} className="w-full text-sm border border-red-500/40 rounded-xl px-3 py-2.5 bg-background focus:outline-none focus:ring-2 focus:ring-red-500/40" />
      </div>
      <button type="button" disabled={!ready || busy} onClick={run}
        className="w-full h-12 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-red-700 liquid-transition">
        {busy ? "..." : t("safety.resetBtn", "Tanlanganlarni butunlay o'chirish")}
      </button>
    </div>
  );
}
