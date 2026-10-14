// ERP tool int testlari uchun umumiy sozlash: AI yoqilgan, ikki firma, tool'lar ro'yxatda, aktyor keshi 0.
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { __setActorCacheTtlForTests, invalidateActor } from '../../../actor';
import { LIMITS } from '../../../config';
import type { ToolCtx } from '../../../contracts';
import { newCorrelationId } from '../../../lib/ids';
import { invalidateSettings } from '../../../settings';
import { invalidateBudget } from '../../../usage';
import { executeTool } from '../../executor';
import { registerErpTools } from '..';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from '../../../__tests__/helpers';

export interface Env { mongo: MongoMemoryServer; A: SeedCompany; B: SeedCompany; savedEnv?: string }

export async function setupErp(): Promise<Env> {
  const savedEnv = process.env.AI_VOICE_ENABLED;
  process.env.AI_VOICE_ENABLED = '1';
  const mongo = await startMongo();
  const A = await seedCompany('Alfa');
  const B = await seedCompany('Beta');
  registerErpTools();
  __setActorCacheTtlForTests(0);
  return { mongo, A, B, savedEnv };
}

export async function teardownErp(env: Env): Promise<void> {
  __setActorCacheTtlForTests(LIMITS.actorCacheMs);
  if (env.savedEnv === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = env.savedEnv;
  await stopMongo(env.mongo);
}

export function resetCaches(): void {
  invalidateSettings(); invalidateActor(); invalidateBudget();
}

export const ctxFor = (userId: string, companyId: string, extra: Partial<ToolCtx> = {}): ToolCtx => ({
  companyId, userId, role: 'ishchi', isOwner: false, lang: 'uz', tz: 'Asia/Tashkent', channel: 'web',
  purpose: 'assistant', sessionId: 'sess-' + newCorrelationId(), correlationId: newCorrelationId(), ...extra,
});

/** Tool'ni to'liq executor yo'lidan chaqirish (RBAC, redaksiya, untrusted o'rash, audit). */
export async function call(userId: string, companyId: string, name: string, args: unknown = {}, extra: Partial<ToolCtx> = {}) {
  return executeTool(ctxFor(userId, companyId, extra), name, args);
}
