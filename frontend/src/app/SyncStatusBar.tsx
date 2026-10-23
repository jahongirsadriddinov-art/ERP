import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import WifiOff from "@hugeicons/core-free-icons/WifiOff01Icon";
import { offlineQueueState, listOfflineQueue, discardQueued, retryFailedQueue } from "./api";
import { queueItemLabel, syncView, type SyncView } from "./lib/syncQueue";
import { confirmDialog } from "./lib/confirmDialog";
import type { QueuedItem } from "./lib/offlineStore";

// Aloqa / sinxronlash holati — sarlavha ostidagi bitta to'liq enli qator (owner 2026-10-23: suzuvchi "pill"
// kontentni yopib, g'alati fonda ko'rinardi — design-v5 `.sync-pill`ga var(--card) !important bergani uchun
// rangi yo'qolardi). "Jami chiqimlar" qatori kabi: yaxlit rang, xiralashtirishsiz, chegarasiz, burchaksiz.
//   oflayn → qizil; xato (yuborilmagan) → qizil + "Qayta urinish" / "Batafsil"; sinxronlanmoqda → asosiy rang;
//   kutmoqda → sariq + "Batafsil"; yuborildi → yashil (3 s).

const BAR_BG: Record<Exclude<SyncView, 'hidden'>, string> = {
  offline: 'bg-red-600 text-white',
  error: 'bg-red-700 text-white',
  syncing: 'bg-primary text-primary-foreground',
  pending: 'bg-amber-500 text-black',
  synced: 'bg-emerald-600 text-white',
};

export default function SyncStatusBar({ isOffline, sw }: { isOffline: boolean; sw: { count: number; status: string } }) {
  const { t } = useTranslation();
  const [app, setApp] = useState(() => offlineQueueState());
  const [showSynced, setShowSynced] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setApp({ count: Number(d.count) || 0, failed: Number(d.failed) || 0, status: d.status || 'idle' });
    };
    window.addEventListener('erp:offline-queue', on);
    return () => window.removeEventListener('erp:offline-queue', on);
  }, []);

  const { view: rawView, pending, failed } = syncView({ offline: isOffline, app, sw });
  // "Hammasi yuborildi" — 3 soniya ko'rinib, o'zi yo'qoladi
  useEffect(() => {
    if (rawView !== 'synced') { setShowSynced(false); return; }
    setShowSynced(true);
    const id = setTimeout(() => setShowSynced(false), 3000);
    return () => clearTimeout(id);
  }, [rawView]);
  const view: SyncView = rawView === 'synced' && !showSynced ? 'hidden' : rawView;

  if (view === 'hidden') return details ? <SyncDetails onClose={() => setDetails(false)} /> : null;

  const text =
    view === 'offline' ? `${t('sync.offlineSaving', "Internet yo'q — o'zgarishlar saqlanmoqda")}${pending ? ` · ${t('sync.pending', { count: pending })}` : ''}` :
    view === 'error' ? t('sync.failed', { count: failed, defaultValue: "{{count}} ta o'zgarish yuborilmadi" }) :
    view === 'syncing' ? t('sync.syncing') :
    view === 'synced' ? t('sync.synced') :
    t('sync.pending', { count: pending });
  const icon = view === 'offline' ? WifiOff : view === 'syncing' ? Loader2 : view === 'synced' ? CheckCheck : AlertCircle;

  return (
    <>
      <div role="status" aria-live="polite" data-testid="sync-bar" data-state={view}
        className={`sync-bar flex-shrink-0 w-full flex items-center gap-2 px-4 py-2 text-[13px] font-semibold ${BAR_BG[view]}`}>
        <MorphIcon icon={icon} className={`w-4 h-4 flex-shrink-0 ${view === 'syncing' ? 'animate-spin' : ''}`} />
        <span className="flex-1 min-w-0 truncate">{text}</span>
        {view === 'error' && (
          <button type="button" data-testid="sync-retry" onClick={() => { void retryFailedQueue(); }}
            className="flex-shrink-0 underline underline-offset-2 font-bold px-1">{t('sync.retry', 'Qayta urinish')}</button>
        )}
        {(view === 'error' || view === 'pending' || (view === 'offline' && pending > 0)) && (
          <button type="button" data-testid="sync-details" onClick={() => setDetails(true)}
            className="flex-shrink-0 underline underline-offset-2 font-bold px-1">{t('sync.details', 'Batafsil')}</button>
        )}
      </div>
      {details && <SyncDetails onClose={() => setDetails(false)} />}
    </>
  );
}

function SyncDetails({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<QueuedItem[] | null>(null);
  const reload = () => { listOfflineQueue().then(setItems); };
  useEffect(() => {
    reload();
    const on = () => reload();
    window.addEventListener('erp:offline-queue', on);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('erp:offline-queue', on); window.removeEventListener('keydown', esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fmtTime = (ts: number) => { try { return new Date(ts).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sync-details-title" data-testid="sync-details-sheet"
        className="w-full sm:max-w-md bg-card text-foreground rounded-t-3xl sm:rounded-3xl p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 id="sync-details-title" className="text-base font-bold">{t('sync.detailsTitle', "Yuborilmagan o'zgarishlar")}</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-muted-foreground px-2 py-1">{t('sync.close', 'Yopish')}</button>
        </div>
        {items === null ? <p className="text-sm text-muted-foreground">…</p> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('sync.empty', "Navbat bo'sh — hammasi yuborilgan")}</p>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li key={it.id} data-testid="sync-item" className="border border-border rounded-2xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{queueItemLabel(it)}</p>
                    <p className="text-xs text-muted-foreground">{fmtTime(it.ts)}{it.attempts ? ` · ${t('sync.attempts', { count: it.attempts, defaultValue: '{{count}} marta urinildi' })}` : ''}</p>
                    <p className={`text-xs mt-1 ${it.failed ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                      {it.failed ? (it.lastError || t('sync.failed', { count: 1 })) : t('sync.waiting', 'Yuborilishi kutilmoqda')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  {it.failed && (
                    <button type="button" data-testid="sync-item-retry" onClick={() => { void retryFailedQueue([it.id]).then(reload); }}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-primary text-primary-foreground">{t('sync.retry', 'Qayta urinish')}</button>
                  )}
                  <button type="button" data-testid="sync-item-discard" onClick={async () => {
                    if (!(await confirmDialog(t('sync.discardConfirm', "Bu o'zgarish serverga yuborilmaydi va o'chiriladi. Davom etasizmi?"), { danger: true }))) return;
                    await discardQueued(it.id); reload();
                  }} className="text-xs font-bold px-3 py-1.5 rounded-xl border border-border">{t('sync.discard', 'Bekor qilish')}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
