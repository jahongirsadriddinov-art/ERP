import type { AiToolCatalogEntry, AiLang, ToolDeclaration } from '../contracts';
import type { AiToolDef } from './types';

// Tool reestri. P1'da ERP tool'lari YO'Q — P2 ularni tools/erp/index.ts orqali ro'yxatga oladi.
// Ro'yxatga olishda kod chegaralari tekshiriladi (defaultRoles ⊆ maxRoles, BLOCKING va h.k.).

const tools = new Map<string, AiToolDef>();
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{1,63}$/;
/** O'z qarori (ownDecision) bo'la oladigan tool nomlari — boshqa "approve*" nomlar taqiqlangan (B3). */
const OWN_DECISION_NAMES = new Set(['approveTransaction', 'rejectTransaction']);
/** Ovozli tasdiq tool'i — yagona nom, faqat ovozli kanallar (owner 2026-10-17 #4). */
const SPOKEN_CONFIRM_NAMES = new Set(['answerPendingAction']);
const VOICE_CHANNELS = new Set(['inapp_call', 'telegram_call']);

export function registerTool(def: AiToolDef): void {
  if (!NAME_RE.test(def.name)) throw new Error(`[aiVoice] tool nomi noto'g'ri: ${def.name}`);
  if (tools.has(def.name)) throw new Error(`[aiVoice] tool takrorlangan: ${def.name}`);
  if (def.behavior !== 'BLOCKING') throw new Error(`[aiVoice] ${def.name}: behavior BLOCKING bo'lishi shart`);
  if (!def.maxRoles?.length) throw new Error(`[aiVoice] ${def.name}: maxRoles bo'sh`);
  if (!def.channels?.length) throw new Error(`[aiVoice] ${def.name}: channels bo'sh`);
  if (!def.purposes?.length) throw new Error(`[aiVoice] ${def.name}: purposes bo'sh`);
  const outside = (def.defaultRoles || []).filter((r) => !def.maxRoles.includes(r));
  if (outside.length) throw new Error(`[aiVoice] ${def.name}: defaultRoles maxRoles'dan tashqarida: ${outside.join(',')}`);
  if (def.parameters?.type !== 'object') throw new Error(`[aiVoice] ${def.name}: parameters.type 'object' bo'lishi shart`);
  if (def.kind === 'read' && def.confirm !== 'never') throw new Error(`[aiVoice] ${def.name}: o'qish tool'i tasdiq talab qilmaydi`);
  // B3: tasdiq FAQAT UI/bot tugmasidan — model chaqira oladigan "confirm/approve" tool bo'lmaydi
  // Istisno: ownDecision — ERP yozuvi bo'yicha foydalanuvchining o'z qarori (AI pending amali EMAS);
  // faqat aniq ro'yxatdagi nomlar (pending/AiAction tasdiqlovchi tool baribir taqiqlangan).
  if (/^(confirm|approve|accept)/i.test(def.name) && !(def.ownDecision && OWN_DECISION_NAMES.has(def.name))) {
    throw new Error(`[aiVoice] ${def.name}: tasdiqlovchi tool taqiqlangan`);
  }
  if (def.ownDecision && (!OWN_DECISION_NAMES.has(def.name) || def.kind !== 'write' || def.confirm !== 'never' || def.targetUserArg)) {
    throw new Error(`[aiVoice] ${def.name}: ownDecision faqat write + confirm:'never' + targetUserArg'siz`);
  }
  if (def.spokenConfirm && (!SPOKEN_CONFIRM_NAMES.has(def.name) || def.kind !== 'write' || def.confirm !== 'never'
    || def.targetUserArg || def.channels.some((c) => !VOICE_CHANNELS.has(c)))) {
    throw new Error(`[aiVoice] ${def.name}: spokenConfirm faqat answerPendingAction + ovozli kanallar`);
  }
  if (SPOKEN_CONFIRM_NAMES.has(def.name) && !def.spokenConfirm) throw new Error(`[aiVoice] ${def.name}: spokenConfirm bayrog'i majburiy`);
  // B4: boshqa foydalanuvchiga ta'sir qiladigan yozuv kimga ta'sir qilishini e'lon qilishi shart
  if (def.kind === 'write' && def.confirm === 'when_other_user' && !def.targetUserArg) {
    throw new Error(`[aiVoice] ${def.name}: when_other_user uchun targetUserArg majburiy`);
  }
  if (def.targetUserArg && def.refs?.[def.targetUserArg] !== 'User') {
    throw new Error(`[aiVoice] ${def.name}: targetUserArg refs'da 'User' sifatida e'lon qilinishi shart`);
  }
  tools.set(def.name, def);
}

export function getTool(name: string): AiToolDef | undefined {
  return typeof name === 'string' ? tools.get(name) : undefined;
}

export function listTools(): AiToolDef[] {
  return [...tools.values()];
}

export function hasTool(name: string): boolean { return tools.has(name); }

/** Faqat testlar uchun. */
export function unregisterTool(name: string): void { tools.delete(name); }

export function toolCatalog(): AiToolCatalogEntry[] {
  return listTools().map((t) => ({
    name: t.name, kind: t.kind, description: t.description,
    maxRoles: [...t.maxRoles], defaultRoles: [...t.defaultRoles], channels: [...t.channels], purposes: [...t.purposes],
  }));
}

/** Modelga beriladigan e'lonlar (faqat ruxsat etilgan nomlar uchun). */
export function toolDeclarations(names: string[], lang: AiLang): ToolDeclaration[] {
  const out: ToolDeclaration[] = [];
  for (const n of names) {
    const t = tools.get(n);
    if (!t) continue;
    out.push({ name: t.name, description: t.description[lang] || t.description.uz, parameters: t.parameters, behavior: 'BLOCKING' });
  }
  return out;
}
