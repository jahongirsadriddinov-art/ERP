import type { AiMePrefs, AiSettingsView, ChannelName } from "./api";

// AI ekranlari uchun sof yordamchilar (owner 2026-10-15): rolga mos izohlar, AI holatining ROST sababi
// (server kaliti / tarif / obuna / firma kaliti) va shaxsiy sozlamalarda tugma nega o'chiqligi.

/** Izoh guruhi: direktor (yoki firma egasi), o'rinbosar, prorab/brigadir, ishchi, dasturchi. */
export type RoleGroup = "boss" | "deputy" | "foreman" | "worker" | "developer";

export function roleGroup(role?: string | null, isOwner?: boolean): RoleGroup {
  if (role === "dasturchi") return "developer";
  if (isOwner || role === "direktor") return "boss";
  if (role === "orinbosar") return "deputy";
  if (role === "prorab" || role === "brigadir") return "foreman";
  return "worker";
}

/** Joriy foydalanuvchi (ilova localStorage'ga yozadi). Xato bo'lsa — bo'sh. */
export function readCurrentUser(): { role?: string; isOwner?: boolean } {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null");
    return u && typeof u === "object" ? { role: typeof u.role === "string" ? u.role : undefined, isOwner: !!u.isOwner } : {};
  } catch {
    return {};
  }
}

/**
 * Firma uchun AI nega ishlamayapti — barcha sabablar tartib bilan (bo'sh — ishlayapti).
 * plan: tarifda AI yo'q · inactive: obuna faol emas · server: platformada (serverda) AI o'chiq · company: firma kaliti o'chiq.
 */
export type CompanyBlock = "plan" | "inactive" | "server" | "company";

export function companyBlocks(view: Pick<AiSettingsView, "status"> & { settings: { enabled: boolean } }): CompanyBlock[] {
  const out: CompanyBlock[] = [];
  if (view.status.planHasFeature === false) out.push("plan");
  if (view.status.companyActive === false) out.push("inactive");
  if (view.status.aiVoiceEnabled === false) out.push("server");
  if (!view.settings.enabled) out.push("company");
  return out;
}

/** Holat yorlig'i: ishlayapti / firmada yoqilgan, lekin boshqa sabab bilan to'xtagan / o'chiq. */
export type CompanyAiLabel = "on" | "blocked" | "off";
export function companyAiLabel(blocks: readonly CompanyBlock[]): CompanyAiLabel {
  if (!blocks.length) return "on";
  return blocks.includes("company") ? "off" : "blocked";
}

// ───────────── Shaxsiy sozlamalar: nega o'zgartirib bo'lmaydi ─────────────
/** busy: saqlanmoqda · plan: tarifda yo'q · aiOff: firmada AI ishlamayapti · optOutAll: "Hammasidan" voz kechilgan. */
export type PrefsLock = "busy" | "plan" | "aiOff" | "optOutAll";
export type PrefsArea = "consent" | "channels" | "quiet" | "optOut" | "optOutAll" | "reminders";

export function prefsLock(prefs: Pick<AiMePrefs, "optOut" | "status">, area: PrefsArea, busy = false): PrefsLock | null {
  if (prefs.status?.aiActive === false) return prefs.status.planHasFeature === false ? "plan" : "aiOff";
  if (busy && area !== "reminders") return "busy";
  // "Hammasidan" yoqilgan — kanallar, tinch soat va alohida voz kechishlarning ma'nosi yo'q
  if (prefs.optOut.all && (area === "channels" || area === "quiet" || area === "optOut")) return "optOutAll";
  return null;
}

/** Telegram qo'ng'irog'i kanali nega ishlamasligi mumkin (o'chirilmaydi — faqat ogohlantirish). */
export function telegramCallNote(prefs: Pick<AiMePrefs, "callConsent" | "status" | "disabledChannels">): "notLinked" | "noConsent" | null {
  const ch: ChannelName = "telegram_call";
  if (prefs.disabledChannels.includes(ch)) return null;
  if (prefs.status && prefs.status.telegramLinked === false) return "notLinked";
  if (prefs.callConsent !== "granted") return "noConsent";
  return null;
}
