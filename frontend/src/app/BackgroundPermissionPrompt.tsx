// Android: "Telegram kabi fonda ishlasin" (owner 2026-10-19). Ilova batareya tejash cheklovida bo'lsa tizim uni
// fonda uxlatadi — AI qo'ng'irog'i, xabar va bildirishnomalar kelmaydi. Kirgandan keyin bir marta (rad etilsa —
// 3 kundan keyin yana) muloyim oyna: ruxsat berish → bildirishnoma + batareya cheklovidan chiqarish.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { backgroundPermission, openAppSettings, requestBackgroundPermission } from "./lib/background";

const SNOOZE_KEY = "erp_bgPermSnoozeUntil";
const SNOOZE_MS = 3 * 24 * 3600_000;
const STRICT_OEMS = ["xiaomi", "redmi", "poco", "huawei", "honor", "oppo", "vivo", "realme", "oneplus", "tecno", "infinix"];

const TXT = {
  uz: {
    title: "Fonda ishlashga ruxsat bering",
    body: "Telegram kabi: ilova yopiq bo'lsa ham AI qo'ng'irog'i, xabarlar va bildirishnomalar o'z vaqtida kelishi uchun.",
    steps: ["Bildirishnomalarga ruxsat bering", "\"Batareya cheklovisiz\" (Не ограничивать) ni tanlang"],
    oem: "Telefoningizda yana \"Avtomatik ishga tushirish\" (Автозапуск) ni yoqing: Ilova sozlamalari → Batareya / Avtozapusk.",
    allow: "Ruxsat berish",
    settings: "Ilova sozlamalari",
    later: "Keyinroq",
  },
  ru: {
    title: "Разрешите работу в фоне",
    body: "Как в Telegram: чтобы звонки AI, сообщения и уведомления приходили, даже когда приложение закрыто.",
    steps: ["Разрешите уведомления", "Выберите «Без ограничений» для батареи"],
    oem: "Также включите «Автозапуск»: Настройки приложения → Батарея / Автозапуск.",
    allow: "Разрешить",
    settings: "Настройки приложения",
    later: "Позже",
  },
};

export default function BackgroundPermissionPrompt({ userId }: { userId?: string }) {
  const { i18n } = useTranslation();
  const tx = i18n.language?.startsWith("ru") ? TXT.ru : TXT.uz;
  const [show, setShow] = useState(false);
  const [oem, setOem] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const check = async () => {
      let until = 0;
      try { until = Number(localStorage.getItem(SNOOZE_KEY)) || 0; } catch { /* */ }
      const st = await backgroundPermission();
      if (!alive || !st) return;
      if (st.ignoring) { setShow(false); return; }
      setOem(STRICT_OEMS.some((m) => st.manufacturer.includes(m)));
      if (Date.now() >= until) setShow(true);
    };
    const t = setTimeout(check, 4000);                       // kirish animatsiyasidan keyin
    const onVis = () => { if (document.visibilityState === "visible") void check(); };   // sozlamalardan qaytganda
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [userId]);

  if (!show) return null;
  const later = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* */ }
    setShow(false);
  };
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={later}>
      <div role="dialog" aria-modal="true" data-testid="bg-permission"
        className="glass-modal w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-5 animate-slide-up-fade"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center text-3xl" aria-hidden>🔔</div>
        <h3 className="text-center font-bold text-base">{tx.title}</h3>
        <p className="text-center text-sm text-muted-foreground mt-1.5">{tx.body}</p>
        <ol className="mt-4 space-y-2">
          {tx.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {oem && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">{tx.oem}</p>}
        <div className="mt-5 grid gap-2">
          <button type="button" className="btn-primary h-11 rounded-xl font-semibold" onClick={() => { void requestBackgroundPermission(); }}>{tx.allow}</button>
          {oem && <button type="button" className="h-11 rounded-xl border border-border font-semibold text-sm" onClick={() => { void openAppSettings(); }}>{tx.settings}</button>}
          <button type="button" className="h-10 rounded-xl text-sm text-muted-foreground" onClick={later}>{tx.later}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
