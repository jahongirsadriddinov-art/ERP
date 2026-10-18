// "Chat sozlamalari" — jildlarni ko'rsatish/yashirish, saralash, ixcham ro'yxat (shu qurilmada saqlanadi).
// document.body'ga portal: sahifa animatsiyasi (will-change: transform) ichida fixed joylashuv buzilmasin.
import { createPortal } from "react-dom";
import { useState } from "react";
import { toast } from "sonner";
import { WALLPAPERS, clearCustomWallpaper, loadCustomWallpaper, saveCustomWallpaper, wallpaperStyle } from "./wallpaper";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import { EscClose } from "../App";
import { TOGGLEABLE_FOLDERS, type FolderId, type SortMode } from "./chatModel";
import type { ChatPrefs } from "./chatPrefs";

function Switch({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${on ? "bg-primary" : "bg-muted-foreground/35"}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

export function ChatSettingsSheet({ uid, prefs, update, onClose }: {
  uid: string; prefs: ChatPrefs; update: (fn: (p: ChatPrefs) => ChatPrefs) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const hasCustom = !!loadCustomWallpaper(uid);
  const pickImage = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      await saveCustomWallpaper(uid, f);
      update((p) => ({ ...p, wallpaper: "custom", wallpaperRev: Date.now() }));
    } catch {
      toast.error(t("chatUi.wallpaperError"));
    } finally { setBusy(false); }
  };
  const removeImage = () => { clearCustomWallpaper(uid); update((p) => ({ ...p, wallpaper: "dots", wallpaperRev: Date.now() })); };
  const toggleFolder = (f: FolderId, show: boolean) => update((p) => ({
    ...p, hiddenFolders: show ? p.hiddenFolders.filter((x) => x !== f) : [...p.hiddenFolders.filter((x) => x !== f), f],
  }));
  const setSort = (sort: SortMode) => update((p) => ({ ...p, sort }));

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={onClose}>
      <EscClose onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="chat-settings-title" data-testid="chat-settings-sheet"
        className="glass-modal w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl max-h-[85dvh] flex flex-col animate-slide-up-fade"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()}>
        <div className="sm:hidden mx-auto mt-2 w-10 h-1 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <h3 id="chat-settings-title" className="font-bold text-base">{t("chatUi.settings")}</h3>
          <button type="button" aria-label={t("common.close")} onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-4 space-y-5">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("chatUi.settingsFolders")}</p>
            <p className="text-xs text-muted-foreground mb-2">{t("chatUi.settingsFoldersHint")}</p>
            <div className="rounded-2xl bg-card/70 border border-border/60 divide-y divide-border/60">
              {TOGGLEABLE_FOLDERS.map((f) => (
                <label key={f} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm">{t(`chatUi.folders.${f}`)}</span>
                  <Switch on={!prefs.hiddenFolders.includes(f)} onChange={(v) => toggleFolder(f, v)} label={t(`chatUi.folders.${f}`)} testId={`chat-settings-folder-${f}`} />
                </label>
              ))}
            </div>
          </section>
          <section data-testid="chat-settings-wallpaper">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t("chatUi.wallpaper")}</p>
            <div role="radiogroup" aria-label={t("chatUi.wallpaper")} className="grid grid-cols-4 gap-2">
              {WALLPAPERS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={prefs.wallpaper === w} aria-label={t(`chatUi.wallpapers.${w}`)}
                  data-testid={`chat-wallpaper-${w}`} onClick={() => update((p) => ({ ...p, wallpaper: w }))}
                  className={`h-16 rounded-xl border-2 transition-all ${prefs.wallpaper === w ? "border-primary scale-[1.03] shadow-md" : "border-border/60"}`}
                  style={wallpaperStyle(w, null)} />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className={`flex-1 h-10 rounded-xl border border-dashed border-primary/50 text-primary text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer ${busy ? "opacity-60" : ""}`}>
                {busy ? "…" : t("chatUi.wallpaperUpload")}
                <input type="file" accept="image/*" className="hidden" disabled={busy} data-testid="chat-wallpaper-upload"
                  onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {hasCustom && (
                <button type="button" onClick={removeImage} className="h-10 px-3 rounded-xl border border-border text-sm">{t("chatUi.wallpaperRemove")}</button>
              )}
            </div>
            {prefs.wallpaper === "custom" && <p className="text-xs text-muted-foreground mt-1">{t("chatUi.wallpaperCustomOn")}</p>}
          </section>
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t("chatUi.sortBy")}</p>
            <div role="radiogroup" aria-label={t("chatUi.sortBy")} className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-muted/70">
              {(["recent", "unread"] as SortMode[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={prefs.sort === s} data-testid={`chat-settings-sort-${s}`} onClick={() => setSort(s)}
                  className={`px-2 py-2 rounded-xl text-xs font-medium leading-tight transition-colors ${prefs.sort === s ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  {t(s === "recent" ? "chatUi.sortRecent" : "chatUi.sortUnread")}
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-2xl bg-card/70 border border-border/60 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">{t("chatUi.compact")}</p>
              <p className="text-xs text-muted-foreground">{t("chatUi.compactHint")}</p>
            </div>
            <Switch on={prefs.compact} onChange={(v) => update((p) => ({ ...p, compact: v }))} label={t("chatUi.compact")} testId="chat-settings-compact" />
          </section>
          <p className="text-[11px] text-muted-foreground text-center">{t("chatUi.savedOnDevice")}</p>
          <button type="button" onClick={onClose} className="btn btn-primary w-full py-2.5">{t("chatUi.done")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
