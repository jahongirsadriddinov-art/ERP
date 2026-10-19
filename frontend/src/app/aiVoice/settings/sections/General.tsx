import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Clock from "@hugeicons/core-free-icons/Time04Icon";
import type { SectionProps } from "../sectionProps";
import type { AvatarLook, PersonaStyle } from "../api";
import { Chip, Field, SelectField, TextField, Toggle } from "../ui";
import { useRef, useState } from "react";
import { API_BASE } from "../../../api";

// "Til, ovoz va xarakter" (Qo'shimcha sozlamalar ichida): til, ovoz, AI xarakteri (uslub, ism, ko'rsatma),
// video qo'ng'iroqdagi avatar, ogohlantirish matni, eski eslatma, o'rinbosar huquqi.
// AI'ni yoqish va ertalabki so'rov — asosiy ekranda. Vaqt zonasi o'zgarmaydi (Toshkent).
const VOICES: [string, "female" | "male"][] = [
  ["Kore", "female"], ["Aoede", "female"], ["Leda", "female"], ["Zephyr", "female"], ["Despina", "female"], ["Sulafat", "female"],
  ["Puck", "male"], ["Charon", "male"], ["Fenrir", "male"], ["Orus", "male"], ["Iapetus", "male"], ["Achird", "male"],
];
const GENDER = new Map(VOICES);
const STYLES: PersonaStyle[] = ["friendly", "formal", "cheerful", "calm", "strict"];
const LOOKS: AvatarLook[] = ["auto", "female", "male", "orb"];

export default function General({ view, draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.general.${s}`);
  const voices = GENDER.has(draft.voiceName) ? VOICES : [[draft.voiceName, "female"] as [string, "female" | "male"], ...VOICES];
  const persona = draft.persona || { style: "friendly" as PersonaStyle };
  const look = draft.avatar?.look || "auto";
  const autoLook = GENDER.get(draft.voiceName) === "male" ? "male" : "female";
  const setPersona = (p: Partial<typeof persona>) => update((d) => ({ ...d, persona: { ...(d.persona || { style: "friendly" }), ...p } }));
  return (
    <div className="space-y-4" data-testid="ai-talk">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField label={k("language")} value={draft.language}
          options={(["uz", "ru", "auto"] as const).map((v) => ({ value: v, label: t(`aiVoice.admin.general.languages.${v}`) }))}
          onChange={(v) => update((d) => ({ ...d, language: v }))} />
        <div>
          <SelectField label={k("voice")} value={draft.voiceName}
            options={voices.map(([v, g]) => ({ value: v, label: `${v} (${k(g)})` }))}
            onChange={(v) => update((d) => ({ ...d, voiceName: v }))} />
          <VoicePreview voice={draft.voiceName} lang={draft.language === "ru" ? "ru" : "uz"} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5" data-testid="ai-timezone">
        <MorphIcon icon={Clock} className="w-3.5 h-3.5" />{t("aiVoice.ui.general.tz")}
      </p>

      <Field label={k("persona")} hint={k("personaHint")}>
        <div className="flex flex-wrap gap-2" data-testid="ai-persona-style">
          {STYLES.map((s) => (
            <Chip key={s} active={persona.style === s} onClick={() => setPersona({ style: s })}>{t(`aiVoice.admin.general.styles.${s}`)}</Chip>
          ))}
        </div>
      </Field>
      <TextField label={k("aiName")} hint={k("aiNameHint")} value={persona.name || ""} maxLength={30} testId="ai-persona-name"
        onChange={(v) => setPersona({ name: v })} />
      <Field label={k("custom")} hint={k("customHint")}>
        <textarea value={persona.custom || ""} maxLength={400} rows={2} data-testid="ai-persona-custom"
          onChange={(e) => setPersona({ custom: e.target.value })}
          className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
      </Field>

      <Field label={k("avatar")} hint={k("avatarHint")}>
        <div className="grid grid-cols-4 gap-2" data-testid="ai-avatar-look" role="radiogroup">
          {LOOKS.map((l) => {
            const img = l === "auto" ? autoLook : l;
            const on = look === l;
            return (
              <button key={l} type="button" role="radio" aria-checked={on} onClick={() => update((d) => ({ ...d, avatar: { look: l } }))}
                className={`rounded-2xl border p-1.5 text-center liquid-transition ${on ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border bg-card/60 hover:border-primary/50"}`}>
                <img src={`/ai-avatars/${img}.webp?v=5`} alt="" loading="lazy" width={96} height={96}
                  className="w-full aspect-square rounded-xl object-cover" />
                <span className="block mt-1 text-[11px] font-semibold leading-tight">{t(`aiVoice.admin.general.looks.${l}`)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={k("disclosure")} hint={k("disclosureHint")}>
        <textarea value={draft.disclosureText || ""} maxLength={300} rows={2}
          onChange={(e) => update((d) => ({ ...d, disclosureText: e.target.value }))}
          className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
      </Field>
      <div className="rounded-xl border border-border bg-card/60 px-3 divide-y divide-border/60">
        <Toggle checked={draft.attendance.suppressLegacyMorningReminder} label={k("suppressLegacy")} hint={k("suppressLegacyHint")}
          onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, suppressLegacyMorningReminder: v } }))} />
        <Toggle checked={draft.attendance.orinbosarCanEditSchedule} label={k("orinbosarEdit")} hint={k("orinbosarEditHint")}
          disabled={!view.editor.canEditBossRows}
          onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, orinbosarCanEditSchedule: v } }))} />
      </div>
    </div>
  );
}

/** Ovozni saqlashdan oldin tinglab ko'rish (owner 2026-10-19): tanlangan ovoz bilan qisqa namuna. */
function VoicePreview({ voice, lang }: { voice: string; lang: "uz" | "ru" }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sample = lang === "ru"
    ? "Здравствуйте! Я ваш AI-помощник. Чем могу помочь?"
    : "Assalomu alaykum! Men sizning sun'iy intellekt yordamchingizman. Bugun qurilishda nima ishlar qilamiz?";
  const play = async () => {
    if (state === "playing") { audioRef.current?.pause(); setState("idle"); return; }
    setState("loading");
    try {
      const token = localStorage.getItem("token");
      const r = await fetch(`${API_BASE}/api/ai-voice/me/chat/tts`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: sample, lang, voiceName: voice }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      audioRef.current?.pause();
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => { setState("idle"); URL.revokeObjectURL(url); };
      await a.play();
      setState("playing");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };
  return (
    <button type="button" onClick={play} disabled={state === "loading"} data-testid="ai-voice-preview"
      className="mt-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-60">
      {state === "loading" ? t("aiVoice.admin.general.previewLoading") : state === "playing" ? `⏹ ${t("aiVoice.admin.general.previewStop")}`
        : state === "error" ? t("aiVoice.admin.general.previewError") : `▶ ${t("aiVoice.admin.general.preview")}`}
    </button>
  );
}
