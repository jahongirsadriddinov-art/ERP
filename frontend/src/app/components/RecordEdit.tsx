import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import More from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import { MorphIcon } from "morphicons/react";
import { ActionSheet, type RowAction } from "./SwipeRow";
import { confirmDialog } from "../lib/confirmDialog";

// Yozuvni o'zgartirish/o'chirish (owner 2026-10-22: "hamma o'zi qo'shgan narsani o'zgartira olsin, rahbar hammasini"):
// qator yonidagi "⋯" → O'zgartirish / O'chirish; o'zgartirish — maydonlar oynasi (PATCH). Ruxsatni server tekshiradi.

const isRu = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("ru");
const T = () => isRu()
  ? { edit: "Изменить", del: "Удалить", save: "Сохранить", cancel: "Отмена", saved: "Сохранено", deleted: "Удалено", err: "Ошибка", more: "Действия", ask: "Удалить запись?" }
  : { edit: "O'zgartirish", del: "O'chirish", save: "Saqlash", cancel: "Bekor qilish", saved: "Saqlandi", deleted: "O'chirildi", err: "Xatolik", more: "Amallar", ask: "Yozuv o'chirilsinmi?" };

export type EditField = { key: string; label: string; type?: "text" | "number" | "date" | "textarea" | "select"; options?: { value: string; label: string }[] };

/** JSON so'rov; xato bo'lsa server matnini toast qiladi. true — muvaffaqiyatli. */
export async function sendJson(url: string, method: "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
  const r = await fetch(url, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }).catch(() => null);
  if (r?.ok) return true;
  const d = await r?.json().catch(() => null);
  toast.error(d?.error || T().err);
  return false;
}

export function RecordMenu({ onEdit, onDelete, deleteAsk, testId, title }: {
  onEdit?: () => void; onDelete?: () => Promise<boolean>; deleteAsk?: string; testId?: string; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const L = T();
  const actions: RowAction[] = [];
  if (onEdit) actions.push({ key: "edit", label: L.edit, icon: Edit, onClick: onEdit });
  if (onDelete) actions.push({
    key: "del", label: L.del, icon: Trash, tone: "danger",
    onClick: async () => { if (await confirmDialog(deleteAsk || L.ask, { danger: true }) && await onDelete()) toast.success(L.deleted); },
  });
  if (!actions.length) return null;
  return (
    <>
      <button type="button" aria-label={L.more} title={L.more} data-testid={testId} onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="w-9 h-9 -my-1 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-95 flex-shrink-0">
        <MorphIcon icon={More} className="w-5 h-5" />
      </button>
      {open && <ActionSheet actions={actions} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

export function EditRecordModal({ title, fields, initial, onSave, onClose }: {
  title: string; fields: EditField[]; initial: Record<string, any>; onSave: (v: Record<string, string>) => Promise<boolean>; onClose: () => void;
}) {
  const L = T();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] == null ? "" : String(initial[f.key])])));
  const [busy, setBusy] = useState(false);
  const cls = "w-full h-11 rounded-xl border border-border bg-input-background px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const submit = async () => {
    setBusy(true);
    const ok = await onSave(v).catch(() => false);
    setBusy(false);
    if (ok) { toast.success(L.saved); onClose(); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" data-testid="record-edit">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card text-foreground rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh] supports-[height:1dvh]:max-h-[90dvh]">
        <p className="px-5 pt-4 pb-2 text-base font-bold">{title}</p>
        <div className="px-5 pb-3 space-y-3 overflow-y-auto overscroll-contain min-h-0">
          {fields.map((f) => (
            <label key={f.key} className="block text-xs font-semibold text-muted-foreground">
              {f.label}
              <div className="mt-1">
                {f.type === "textarea" ? (
                  <textarea rows={4} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className={`${cls} h-auto py-2 resize-none`} />
                ) : f.type === "select" ? (
                  <select value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className={cls}>
                    {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type={f.type || "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className={cls} />
                )}
              </div>
            </label>
          ))}
        </div>
        <div className="flex gap-2 px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border/60">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-border text-sm font-semibold">{L.cancel}</button>
          <button type="button" disabled={busy} onClick={submit} data-testid="record-edit-save" className="flex-1 h-11 rounded-xl btn btn-primary text-sm font-semibold disabled:opacity-50">{L.save}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
