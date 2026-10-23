import "../../../i18n/aiVoiceNs";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Sliders from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import Users from "@hugeicons/core-free-icons/UserGroupIcon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import Route from "@hugeicons/core-free-icons/Message01Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import Voice from "@hugeicons/core-free-icons/AiVoiceIcon";
import History from "@hugeicons/core-free-icons/File01Icon";
import Send from "@hugeicons/core-free-icons/SentIcon";
import Chevron from "@hugeicons/core-free-icons/ArrowDown01Icon";
import type { ShiftProps } from "../sectionProps";
import { Skeleton } from "../ui";

// "Qo'shimcha sozlamalar" (owner 2026-10-16): asosiy ekranda faqat 3 ta blok, qolgan hammasi shu yerda —
// bitta yig'iladigan joy, ichida oddiy tilda nomlangan qatorlar (bir vaqtda bittasi ochiq). Bo'limlar
// faqat ochilganda yuklanadi (alohida chunk, ortiqcha so'rov yo'q).
const Employees = lazy(() => import("./Employees"));
const ToolsMatrix = lazy(() => import("./ToolsMatrix"));
const Channels = lazy(() => import("./Channels"));
const Schedule = lazy(() => import("./Schedule"));
const General = lazy(() => import("./General"));
const HistorySection = lazy(() => import("./History"));
const TestCall = lazy(() => import("./TestCall"));

export type AdvKey = "employees" | "tools" | "order" | "schedule" | "talk" | "history" | "test";
const ITEMS: { key: AdvKey; icon: any }[] = [
  { key: "employees", icon: Users }, { key: "tools", icon: Shield }, { key: "order", icon: Route }, { key: "schedule", icon: Calendar },
  { key: "talk", icon: Voice }, { key: "history", icon: History }, { key: "test", icon: Send },
];

export default function Advanced(p: ShiftProps) {
  const { t } = useTranslation();
  const u = (s: string) => t(`aiVoice.ui.simple.${s}`);
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState<AdvKey | "">("");
  const id = useId();
  const rows = useRef<Partial<Record<AdvKey, HTMLButtonElement | null>>>({});

  // Yangi qator ochilganda (yuqoridagisi yopilib, sahifa siljigan bo'lsa) — sarlavhasi ko'rinib tursin
  useEffect(() => {
    if (!item) return;
    const el = rows.current[item];
    const raf = requestAnimationFrame(() => { if (el && el.getBoundingClientRect().top < 72) el.scrollIntoView({ block: "start", behavior: "smooth" }); });
    return () => cancelAnimationFrame(raf);
  }, [item]);

  const { view, draft } = p;
  const body = (k: AdvKey) => {
    switch (k) {
      case "employees": return <Employees canEditBoss={view.editor.canEditBossRows} canEditSchedule={view.editor.canEditSchedule} draft={draft} />;
      case "tools": return <ToolsMatrix {...p} />;
      case "order": return <Channels {...p} />;
      case "schedule": return <Schedule {...p} />;
      case "talk": return <div className="surface no-lift border border-border rounded-2xl p-4"><General {...p} /></div>;
      case "history": return <HistorySection canArchives={view.editor.canDownloadArchives ?? view.editor.canEditBossRows} />;
      case "test": return <TestCall view={view} draft={draft} />;
    }
  };

  return (
    <section data-testid="ai-advanced" className="space-y-2">
      <button type="button" aria-expanded={open} aria-controls={id} data-testid="ai-advanced-toggle"
        onClick={() => { setOpen((v) => !v); setItem(""); }}
        className="w-full surface no-lift border border-border rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left hover:border-primary/40 liquid-transition">
        <span className="icon-chip w-9 h-9 rounded-xl flex-shrink-0"><MorphIcon icon={Sliders} className="w-[18px] h-[18px]" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold">{u("advTitle")}</span>
          <span className="block text-xs text-muted-foreground mt-0.5">{u("advHint")}</span>
        </span>
        <MorphIcon icon={Chevron} className={`w-5 h-5 text-muted-foreground flex-shrink-0 liquid-transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={id} className="space-y-2 animate-fade-in">
          {ITEMS.map(({ key, icon }) => {
            const on = item === key;
            return (
              <div key={key} className="space-y-2">
                <button type="button" ref={(n) => { rows.current[key] = n; }} aria-expanded={on} data-testid={`ai-adv-${key}`}
                  onClick={() => setItem(on ? "" : key)}
                  className={`w-full rounded-2xl border px-3.5 py-3 flex items-center gap-3 text-left scroll-mt-24 liquid-transition
                    ${on ? "border-primary/35 bg-primary/[0.07]" : "border-border bg-card/50 hover:bg-muted/30"}`}>
                  <MorphIcon icon={icon} className={`w-[18px] h-[18px] flex-shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] font-semibold ${on ? "text-primary" : ""}`}>{u(`adv.${key}.title`)}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{u(`adv.${key}.hint`)}</span>
                  </span>
                  <MorphIcon icon={Chevron} className={`w-4 h-4 text-muted-foreground flex-shrink-0 liquid-transition ${on ? "rotate-180" : ""}`} />
                </button>
                {on && (
                  <div className="pl-0 sm:pl-3 sm:border-l-2 sm:border-primary/20 sm:ml-2" data-testid={`ai-adv-body-${key}`}>
                    <Suspense fallback={<Skeleton h="h-32" />}>{body(key)}</Suspense>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
