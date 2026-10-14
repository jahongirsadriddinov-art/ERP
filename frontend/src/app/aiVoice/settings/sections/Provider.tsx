import { useTranslation } from "react-i18next";
import Brain from "@hugeicons/core-free-icons/AiBrain01Icon";
import Voice from "@hugeicons/core-free-icons/AiVoiceIcon";
import type { SectionProps } from "../sectionProps";
import type { AiSettingsData } from "../api";
import { Badge, Card, Notice, SelectField, TextField } from "../ui";

// AI miyasi: matn provayderi (gemini|claude) va zaxira (openrouter|none), javob chuqurligi; ovoz provayderi.
// Kalitlar FAQAT serverda — bu yerda faqat "sozlangan / sozlanmagan" holati ko'rinadi, qiymat hech qachon.
type Opt<T extends string> = { value: T; title: string; hint: string; keyOk?: boolean };

function Radio<T extends string>({ name, value, options, onChange, t }: {
  name: string; value: T; options: Opt<T>[]; onChange: (v: T) => void; t: (k: string) => string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} data-testid={`ai-${name}-${o.value}`} onClick={() => onChange(o.value)}
            className={`text-left rounded-xl border px-3 py-2.5 liquid-transition ${on ? "border-primary bg-primary/[0.07] ring-2 ring-primary/20" : "border-border bg-card/60 hover:border-primary/40"}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold">{o.title}</span>
              {o.keyOk !== undefined && <Badge tone={o.keyOk ? "green" : "gray"}>{o.keyOk ? t("aiVoice.common.configured") : t("aiVoice.common.notConfigured")}</Badge>}
            </span>
            <span className="block text-xs text-muted-foreground mt-0.5">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Provider({ view, draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.provider.${s}`);
  const p = view.providers;
  const setBrain = (b: Partial<AiSettingsData["brain"]>) => update((d) => ({ ...d, brain: { ...d.brain, ...b } }));
  const setProv = (b: Partial<AiSettingsData["provider"]>) => update((d) => ({ ...d, provider: { ...d.provider, ...b } }));
  return (
    <div className="space-y-4">
      <Notice tone="lock">{k("keysNote")}</Notice>
      <Card icon={Brain} title={k("brain")} hint={k("brainHint")} testId="ai-provider">
        <div className="space-y-3">
          <Radio name="brain" value={draft.brain.provider} t={t} onChange={(v) => setBrain({ provider: v })} options={[
            { value: "gemini", title: k("gemini"), hint: k("geminiHint"), keyOk: p.gemini },
            { value: "claude", title: k("claude"), hint: k("claudeHint"), keyOk: p.claude },
          ]} />
          <p className="text-xs font-semibold text-muted-foreground pt-1">{k("fallback")}</p>
          <Radio name="fallback" value={draft.brain.fallback} t={t} onChange={(v) => setBrain({ fallback: v })} options={[
            { value: "openrouter", title: k("openrouter"), hint: k("openrouterHint"), keyOk: p.openrouter },
            { value: "none", title: k("none"), hint: "—" },
          ]} />
          <div className="max-w-xs">
            <SelectField label={k("effort")} value={draft.brain.effort} onChange={(v) => setBrain({ effort: v })}
              options={(["low", "medium", "high"] as const).map((v) => ({ value: v, label: t(`aiVoice.admin.provider.efforts.${v}`) }))} />
          </div>
        </div>
      </Card>
      <Card icon={Voice} title={k("voice")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label={k("primary")} value={draft.provider.primary} onChange={(v) => setProv({ primary: v })}
            options={[{ value: "gemini_live", label: k("live") }, { value: "gemini_cascade", label: k("cascade") }]} />
          <SelectField label={k("fallback")} value={draft.provider.fallback} onChange={(v) => setProv({ fallback: v })}
            options={[{ value: "gemini_cascade", label: k("cascade") }, { value: "none", label: k("none") }]} />
        </div>
        <p className="text-xs font-semibold text-muted-foreground mt-4">{k("models")}</p>
        <p className="text-[11px] text-muted-foreground mb-2">{k("modelsHint")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["liveModel", "textModel", "ttsModel", "transcribeModel"] as const).map((m) => (
            <TextField key={m} label={m} value={draft.provider[m] || ""} maxLength={64} placeholder="—"
              onChange={(v) => setProv({ [m]: v.replace(/[^A-Za-z0-9._-]/g, "") })} />
          ))}
        </div>
      </Card>
    </div>
  );
}
