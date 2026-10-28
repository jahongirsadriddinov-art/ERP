import User from '../models/User';
import { LIMITS } from './config';
import { isObjectIdString } from './lib/ids';
import { getCompanyAiState } from './settings';

// Aktyorni (foydalanuvchi + firma + tarif) QAYTA o'qish — sessiya boshida qurilgan kontekstga
// ishonilmaydi (review B2). Kesh ≤10 s; bloklash/sessiyani bekor qilishda invalidateActor()
// chaqiriladi (aiEndSessionsForUser orqali), shunda kuch darhol kiradi.

export interface ActorState {
  userId: string;
  role: string;
  isOwner: boolean;
  isBlocked: boolean;
  companyId: string | null;
  name: string;
  /** Faqat ism — murojaat uchun (owner 2026-10-19: "ism-familiya emas, faqat ism"). */
  firstName?: string;
  companyActive: boolean;
  hasFeature: boolean;
  /** "Ochiq muloqot" shu odamga yoqilgan (dasturchi panelidan). */
  openChat: boolean;
}

export type ActorCheck =
  | { ok: true; actor: ActorState }
  | { ok: false; code: 'not_found' | 'blocked' | 'company_mismatch' | 'company_inactive' | 'feature' | 'developer' };

const cache = new Map<string, { at: number; data: ActorState | null }>();
let ttlMs = LIMITS.actorCacheMs;

export async function loadActor(userId: string): Promise<ActorState | null> {
  const c = cache.get(userId);
  if (c && Date.now() - c.at < ttlMs) return c.data;
  let data: ActorState | null = null;
  if (isObjectIdString(userId)) {
    const u: any = await User.findById(userId).select('role isOwner isBlocked companyId firstName lastName aiOpenChat').lean();
    if (u) {
      const companyId = u.companyId ? String(u.companyId) : null;
      const st = companyId ? await getCompanyAiState(companyId) : { exists: false, active: false, hasFeature: false };
      data = {
        userId: String(u._id),
        role: String(u.role),
        isOwner: !!u.isOwner,
        isBlocked: !!u.isBlocked,
        companyId,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
        firstName: String(u.firstName || '').trim() || undefined,
        companyActive: st.exists && st.active,
        hasFeature: st.hasFeature,
        openChat: !!u.aiOpenChat,
      };
    }
  }
  cache.set(userId, { at: Date.now(), data });
  return data;
}

/** Tool/sessiya uchun aktyor hali ham yaroqlimi (shu firmada, bloklanmagan, firma faol, tarifda AI bor). */
export async function checkActor(userId: string, companyId: string): Promise<ActorCheck> {
  const a = await loadActor(userId);
  if (!a) return { ok: false, code: 'not_found' };
  if (a.role === 'dasturchi') return { ok: false, code: 'developer' };
  if (a.isBlocked) return { ok: false, code: 'blocked' };
  if (!a.companyId || a.companyId !== String(companyId)) return { ok: false, code: 'company_mismatch' };
  if (!a.companyActive) return { ok: false, code: 'company_inactive' };
  if (!a.hasFeature) return { ok: false, code: 'feature' };
  return { ok: true, actor: a };
}

export function invalidateActor(userId?: string) {
  if (userId) cache.delete(String(userId)); else cache.clear();
}

/** Faqat testlar uchun. */
export function __setActorCacheTtlForTests(ms: number) { ttlMs = ms; }
