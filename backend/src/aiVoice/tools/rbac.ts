import { AI_ROLES, type AiRole, type AiSettingsData, type Purpose, type ToolChannel } from '../contracts';
import { getTool, listTools } from './registry';
import type { AiToolDef } from './types';

// Tool ruxsatlari. Samarali to'plam = sozlama (byRole[role] yoki registry defaultRoles) ∩ kod
// shifti (AiToolDef.maxRoles). Sozlama admin tomonidan tahrirlanadi, shift esa yo'q — shuning
// uchun o'rinbosar ishchiga moliya tool'ini "bera olmaydi" (review B1).

export const BOSS_ROLES: AiRole[] = ['direktor', 'orinbosar'];

export function isAiRole(r: unknown): r is AiRole {
  return typeof r === 'string' && (AI_ROLES as string[]).includes(r);
}

/** Tool hisoblash uchun rol: firma egasi direktor to'plamini oladi. dasturchi — AI tool'lari yo'q. */
export function toolRole(role: string, isOwner: boolean): AiRole | null {
  if (isOwner) return 'direktor';
  return isAiRole(role) ? role : null;
}

function configuredFor(settings: Pick<AiSettingsData, 'tools'> | null | undefined, role: AiRole): string[] | undefined {
  const row = settings?.tools?.byRole?.[role];
  return Array.isArray(row) ? row : undefined;
}

export function toolAllowedForRole(def: AiToolDef, settings: Pick<AiSettingsData, 'tools'> | null | undefined, role: AiRole): boolean {
  if (!def.maxRoles.includes(role)) return false;           // kod shifti — hech qachon oshmaydi
  if (def.general || def.spokenConfirm) return true;        // umumiy/ovozli tasdiq tool'lari — doim yoqiq
  const row = configuredFor(settings, role);
  return row ? row.includes(def.name) : def.defaultRoles.includes(role);
}

/** Firmasiz dasturchi (platforma) uchun: faqat umumiy tool'lar (firma ma'lumoti yo'q). */
export function generalToolNames(opts: { channel?: ToolChannel; purpose?: Purpose } = {}): string[] {
  return listTools()
    .filter((t) => t.general)
    .filter((t) => !opts.channel || t.channels.includes(opts.channel))
    .filter((t) => !opts.purpose || t.purposes.includes(opts.purpose))
    .map((t) => t.name);
}

/** Rol uchun samarali tool nomlari (kanal/maqsad bo'yicha ham filtrlanishi mumkin). */
export function effectiveToolNames(
  settings: Pick<AiSettingsData, 'tools'> | null | undefined,
  role: string,
  isOwner: boolean,
  opts: { channel?: ToolChannel; purpose?: Purpose } = {},
): string[] {
  const r = toolRole(role, isOwner);
  if (!r) return [];
  return listTools()
    .filter((t) => toolAllowedForRole(t, settings, r))
    .filter((t) => !opts.channel || t.channels.includes(opts.channel))
    .filter((t) => !opts.purpose || t.purposes.includes(opts.purpose))
    .map((t) => t.name);
}

export type AccessCheck = { ok: true } | { ok: false; code: 'unknown_tool' | 'role' | 'channel' | 'purpose' };

export function checkToolAccess(
  name: string,
  actor: { role: string; isOwner: boolean },
  ctx: { channel: ToolChannel; purpose: Purpose },
  settings: Pick<AiSettingsData, 'tools'> | null | undefined,
): AccessCheck {
  const def = getTool(name);
  if (!def) return { ok: false, code: 'unknown_tool' };
  if (!def.channels.includes(ctx.channel)) return { ok: false, code: 'channel' };
  if (!def.purposes.includes(ctx.purpose)) return { ok: false, code: 'purpose' };
  const r = toolRole(actor.role, actor.isOwner);
  if (!r || !toolAllowedForRole(def, settings, r)) return { ok: false, code: 'role' };
  return { ok: true };
}

/**
 * Sozlamadagi tools.byRole matritsasini tekshiradi (PUT validatori, P8):
 *  • noma'lum tool nomi yoki shiftdan tashqari ruxsat — xato (400);
 *  • direktor/o'rinbosar qatorlarini faqat direktor yoki firma egasi o'zgartira oladi.
 */
export function validateToolsMatrix(
  next: Partial<Record<string, unknown>> | undefined,
  current: Partial<Record<AiRole, string[]>> | undefined,
  editor: { role: string; isOwner: boolean },
): string[] {
  const errors: string[] = [];
  if (next === undefined) return errors;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return ["tools.byRole: object bo'lishi kerak"];
  const topBoss = editor.isOwner || editor.role === 'direktor';
  for (const [role, list] of Object.entries(next)) {
    if (!isAiRole(role)) { errors.push(`tools.byRole.${role}: noma'lum lavozim`); continue; }
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) { errors.push(`tools.byRole.${role}: satrlar massivi kerak`); continue; }
    if (new Set(list).size !== list.length) errors.push(`tools.byRole.${role}: takroriy tool`);
    for (const name of list as string[]) {
      const def = getTool(name);
      if (!def) errors.push(`tools.byRole.${role}: noma'lum tool ${name}`);
      else if (!def.maxRoles.includes(role)) errors.push(`tools.byRole.${role}: ${name} bu lavozim uchun ruxsat etilmagan (kod chegarasi)`);
    }
    if (BOSS_ROLES.includes(role) && !topBoss) {
      const cur = current?.[role] ?? listTools().filter((t) => t.defaultRoles.includes(role)).map((t) => t.name);
      const before = [...cur].sort().join(',');
      const after = [...(list as string[])].sort().join(',');
      if (before !== after) errors.push(`tools.byRole.${role}: bu qatorni faqat direktor yoki firma egasi o'zgartira oladi`);
    }
  }
  return errors;
}
