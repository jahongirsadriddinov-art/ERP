import { useState } from "react";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Estimate from "@hugeicons/core-free-icons/Estimate01Icon";
import UserGroup from "@hugeicons/core-free-icons/UserGroupIcon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import ArrowRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { MorphIcon } from "morphicons/react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";

// Ro'yxatdan o'tgan ZAHOTI (RegisterWizard onDone) bir marta ko'rsatiladi —
// asosiy funksiyalarni qisqa tanishtiradi. Owner 2026-11-06: "yangi birinchi
// marta kirganlarga tips qosh". Hech qayerda saqlanmaydi — faqat shu
// render sikli davomida ko'rinadi, keyingi kirishlarda qayta chiqmaydi
// (chunki faqat ro'yxatdan o'tish oqimidan triggerlanadi).
const SLIDES = [
  { icon: Building2, titleKey: "s1Title", subKey: "s1Subtitle" },
  { icon: Estimate, titleKey: "s2Title", subKey: "s2Subtitle" },
  { icon: UserGroup, titleKey: "s3Title", subKey: "s3Subtitle" },
  { icon: Sparkles, titleKey: "s4Title", subKey: "s4Subtitle" },
] as const;

export default function OnboardingCarousel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const next = () => (last ? onDone() : setIndex((i) => i + 1));

  return (
    <div className="fixed inset-0 z-[999980] bg-background flex flex-col"
      style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
      <div className="flex justify-end px-5">
        <button onClick={onDone} className="text-sm font-semibold text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-full hover:bg-muted transition-colors">
          {t('onboarding.skip')}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <AnimatePresence mode="wait">
          <motion.div key={index} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-full flex items-center justify-center mb-8"
              style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 16%, transparent), color-mix(in srgb, var(--accent) 16%, transparent))" }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl shadow-primary/20"
                style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
                <MorphIcon icon={slide.icon} className="w-7 h-7 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-3 max-w-xs">{t(`onboarding.${slide.titleKey}`)}</h1>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">{t(`onboarding.${slide.subKey}`)}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-8 space-y-6">
        <div className="flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => setIndex(i)} aria-label={`${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-primary" : "w-1.5 bg-muted"}`} />
          ))}
        </div>
        <button onClick={next}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white shadow-lg shadow-primary/25"
          style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
          {last ? t('onboarding.startBtn') : t('onboarding.continueBtn')}
          <MorphIcon icon={ArrowRight} className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
