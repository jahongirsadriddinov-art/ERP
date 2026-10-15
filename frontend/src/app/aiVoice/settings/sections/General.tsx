import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Power from "@hugeicons/core-free-icons/AiPhone01Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import Voice from "@hugeicons/core-free-icons/AiVoiceIcon";
import Clock from "@hugeicons/core-free-icons/Time04Icon";
import type { SectionProps } from "../sectionProps";
import { Card, Field, More, SelectField, Toggle } from "../ui";

// Umumiy: katta "Yoqish" kartasi, ertalabki davomat, qanday gapiradi (til, ovoz). Kam ishlatiladiganlari
// (ogohlantirish matni, eski eslatma, o'rinbosar huquqi) — "Qo'shimcha" ichida. Vaqt zonasi o'zgarmaydi.
const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

export default function General({ view, draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.general.${s}`);
  const u = (s: string) => t(`aiVoice.ui.general.${s}`);
  const voices = VOICES.includes(draft.voiceName) ? VOICES : [draft.voiceName, ...VOICES];
  const on = draft.enabled;
  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-4 liquid-transition ${on ? "border-emerald-500/35 bg-emerald-500/[0.06]" : "border-border surface no-lift"}`}>
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-muted/50 text-muted-foreground"}`}>
            <MorphIcon icon={Power} className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <Toggle testId="ai-enabled" checked={on}
              label={<span className="text-[15px] font-bold">{on ? u("onTitle") : u("offTitle")}</span>}
              hint={on ? u("onHint") : u("offHint")}
              onChange={(v) => update((d) => ({ ...d, enabled: v }))} />
          </div>
        </div>
      </section>

      <Card icon={Calendar} title={k("attendance")} hint={k("attendanceHint")}>
        <div className="rounded-xl border border-border bg-card/60 px-3">
          <Toggle testId="ai-attendance" checked={draft.attendance.enabled} label={<span className="font-semibold">{k("attendance")}</span>}
            onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, enabled: v } }))} />
        </div>
      </Card>

      <Card icon={Voice} title={u("talk")} hint={u("talkHint")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label={k("language")} value={draft.language}
            options={(["uz", "ru", "auto"] as const).map((v) => ({ value: v, label: t(`aiVoice.admin.general.languages.${v}`) }))}
            onChange={(v) => update((d) => ({ ...d, language: v }))} />
          <SelectField label={k("voice")} value={draft.voiceName} options={voices.map((v) => ({ value: v, label: v }))}
            onChange={(v) => update((d) => ({ ...d, voiceName: v }))} />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground inline-flex items-center gap-1.5" data-testid="ai-timezone">
          <MorphIcon icon={Clock} className="w-3.5 h-3.5" />{u("tz")}
        </p>
      </Card>

      <More title={t("aiVoice.ui.more")} hint={t("aiVoice.ui.moreHint")} testId="ai-general-more">
        <div className="space-y-3">
          <Field label={k("disclosure")} hint={k("disclosureHint")}>
            <textarea value={draft.disclosureText || ""} maxLength={300} rows={2}
              onChange={(e) => update((d) => ({ ...d, disclosureText: e.target.value }))}
              className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
          </Field>
          <div className="divide-y divide-border/60">
            <Toggle checked={draft.attendance.suppressLegacyMorningReminder} label={k("suppressLegacy")} hint={k("suppressLegacyHint")}
              onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, suppressLegacyMorningReminder: v } }))} />
            <Toggle checked={draft.attendance.orinbosarCanEditSchedule} label={k("orinbosarEdit")} hint={k("orinbosarEditHint")}
              disabled={!view.editor.canEditBossRows}
              onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, orinbosarCanEditSchedule: v } }))} />
          </div>
        </div>
      </More>
    </div>
  );
}
