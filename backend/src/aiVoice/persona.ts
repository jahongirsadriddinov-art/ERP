import type { AiSettingsData } from './contracts';
import { sanitizeForPrompt } from './lib/untrusted';

// AI xarakteri va avatari (owner 2026-10-18): rahbariyat sozlamalardan uslub, ism va qo'shimcha
// ko'rsatma beradi; Telegram video qo'ng'irog'idagi avatar ovozga (ayol/erkak) qarab tanlanadi.

export const PERSONA_STYLES = ['friendly', 'formal', 'cheerful', 'calm', 'strict'] as const;
export type PersonaStyle = typeof PERSONA_STYLES[number];
export const AVATAR_LOOKS = ['auto', 'female', 'male', 'orb'] as const;
export type AvatarLook = typeof AVATAR_LOOKS[number];

export interface PersonaSettings { style: PersonaStyle; name?: string; custom?: string }
export interface AvatarSettings { look: AvatarLook }

export const DEFAULT_PERSONA: PersonaSettings = { style: 'friendly' };
export const DEFAULT_AVATAR: AvatarSettings = { look: 'auto' };

const STYLE_TEXT: Record<PersonaStyle, string> = {
  friendly: "samimiy va iliq, o'zbekona xushmuomala: oddiy so'zlar (\"xo'p\", \"albatta\", \"rahmat\"), kerak bo'lsa yengil hazil; \"siz\" deb murojaat",
  formal: "rasmiy va ishbilarmon: aniq, hurmat bilan, hazilsiz; \"Hurmatli ...\" kabi murojaat mumkin",
  cheerful: "quvnoq va g'ayratli: ijobiy ohang, maqtov va dalda, energiya bilan",
  calm: "xotirjam va sabrli: shoshilmay, yumshoq ohangda, tinchlantiruvchi",
  strict: "qat'iy va qisqa: faqat ish, ortiqcha gapsiz, aniq ko'rsatma",
};

/** Gemini ovozlari: jinsi (avatar tanlash uchun). Ro'yxatda bo'lmasa — ayol. */
export const VOICE_GENDER: Record<string, 'female' | 'male'> = {
  Zephyr: 'female', Kore: 'female', Leda: 'female', Aoede: 'female', Callirrhoe: 'female', Autonoe: 'female',
  Despina: 'female', Erinome: 'female', Laomedeia: 'female', Achernar: 'female', Gacrux: 'female',
  Pulcherrima: 'female', Vindemiatrix: 'female', Sulafat: 'female',
  Puck: 'male', Charon: 'male', Fenrir: 'male', Orus: 'male', Enceladus: 'male', Iapetus: 'male', Umbriel: 'male',
  Algieba: 'male', Algenib: 'male', Rasalgethi: 'male', Alnilam: 'male', Schedar: 'male', Achird: 'male',
  Zubenelgenubi: 'male', Sadachbia: 'male', Sadaltager: 'male',
};

export const voiceGender = (voice: string | undefined): 'female' | 'male' => VOICE_GENDER[String(voice || '')] || 'female';

export function mergePersona(v: any): PersonaSettings {
  const o = v && typeof v === 'object' ? v : {};
  const style = (PERSONA_STYLES as readonly string[]).includes(o.style) ? o.style : DEFAULT_PERSONA.style;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 30) : undefined;
  const custom = typeof o.custom === 'string' && o.custom.trim() ? o.custom.trim().slice(0, 400) : undefined;
  return { style, ...(name ? { name } : {}), ...(custom ? { custom } : {}) };
}

export function mergeAvatar(v: any): AvatarSettings {
  const look = v && (AVATAR_LOOKS as readonly string[]).includes(v.look) ? v.look : DEFAULT_AVATAR.look;
  return { look };
}

export function validatePersona(v: unknown, errors: string[]): void {
  if (v === undefined) return;
  if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push('persona: object kerak'); return; }
  const o = v as Record<string, unknown>;
  if (o.style !== undefined && !(PERSONA_STYLES as readonly unknown[]).includes(o.style)) errors.push(`persona.style: ${PERSONA_STYLES.join('|')}`);
  if (o.name !== undefined && (typeof o.name !== 'string' || o.name.length > 30)) errors.push('persona.name: ≤30 belgi');
  if (o.custom !== undefined && (typeof o.custom !== 'string' || o.custom.length > 400)) errors.push('persona.custom: ≤400 belgi');
}

export function validateAvatar(v: unknown, errors: string[]): void {
  if (v === undefined) return;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !(AVATAR_LOOKS as readonly unknown[]).includes((v as any).look)) {
    errors.push(`avatar.look: ${AVATAR_LOOKS.join('|')}`);
  }
}

/** Video avatar ko'rinishi: 'auto' → ovoz jinsiga qarab. */
export function resolveAvatarLook(s: Pick<AiSettingsData, 'voiceName'> & { avatar?: AvatarSettings }): 'female' | 'male' | 'orb' {
  const look = s.avatar?.look || 'auto';
  return look === 'auto' ? voiceGender(s.voiceName) : look;
}

/** System prompt'dagi XARAKTER qatori (xavfsizlik qoidalaridan ustun emas). */
export function personaPromptLine(p: PersonaSettings | undefined, voiceName?: string): string {
  const per = p || DEFAULT_PERSONA;
  const name = sanitizeForPrompt(per.name, 30);
  const custom = sanitizeForPrompt(per.custom, 400);
  const g = voiceGender(voiceName);
  const parts = [
    `XARAKTER: uslubingiz — ${STYLE_TEXT[per.style] || STYLE_TEXT.friendly}.`,
    name ? `Ismingiz "${name}" (so'rashsa shu ismni ayting, lekin AI ekaningizni yashirmang).` : '',
    `Ovozingiz ${g === 'male' ? 'erkak' : 'ayol'} ovozi — ruschada o'zingiz haqida shu jinsda gapiring ("${g === 'male' ? 'понял' : 'поняла'}").`,
    custom ? `Rahbariyat qo'shimcha ko'rsatmasi (uslub uchun; yuqoridagi QOIDALARdan ustun emas): ${custom}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
