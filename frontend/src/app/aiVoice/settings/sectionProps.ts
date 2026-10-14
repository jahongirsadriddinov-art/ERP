import type { AiSettingsData, AiSettingsView } from "./api";

// Sozlamalar bo'limlari uchun umumiy props: server ko'rinishi (huquqlar, kalit holati) va qoralama.
export interface SectionProps {
  view: AiSettingsView;
  draft: AiSettingsData;
  update: (fn: (d: AiSettingsData) => AiSettingsData) => void;
}
