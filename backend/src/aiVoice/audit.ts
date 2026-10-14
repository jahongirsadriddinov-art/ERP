import AiActionAudit, { type AiAuditStatus } from '../models/AiActionAudit';
import type { AuditAction } from '../models/AuditLog';
import { logAudit } from '../services/audit';
import { redact } from './lib/redact';
import { getSettings } from './settings';

// AI tool chaqiruvlari izi. Har bir chaqiruv AiActionAudit'ga yoziladi (argumentlar redact()'dan
// o'tib); muvaffaqiyatli YOZUVLAR mavjud logAudit()'ga ham ko'chiriladi — joriy audit UI'da ko'rinadi.

export interface ToolAuditInput {
  companyId: string;
  actorUserId: string;
  actorRole: string;
  actorName?: string;
  targetUserId?: string;
  channel: string;
  purpose?: string;
  sessionId?: string;
  correlationId: string;
  tool: string;
  kind: 'read' | 'write';
  args?: unknown;
  status: AiAuditStatus;
  resultSummary?: string;
  errorCode?: string;
  idempotencyKey?: string;
  latencyMs?: number;
  pending?: { token?: string; expiresAt: Date; args: unknown; channel: string; confirmVia: 'ui' | 'bot'; summary?: string };
}

export async function auditExpiresAt(companyId: string, from: Date = new Date()): Promise<Date> {
  const s = await getSettings(companyId);
  return new Date(from.getTime() + s.privacy.auditRetentionDays * 86_400_000);
}

/** Audit yozuvini yaratadi va _id'ni qaytaradi. idempotencyKey to'qnashuvi — mavjud yozuv. */
export async function writeToolAudit(input: ToolAuditInput): Promise<string> {
  const expiresAt = await auditExpiresAt(input.companyId);
  try {
    const doc = await AiActionAudit.create({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetUserId: input.targetUserId,
      channel: input.channel,
      purpose: input.purpose,
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      tool: input.tool,
      kind: input.kind,
      argsRedacted: redact(input.args),
      status: input.status,
      resultSummary: input.resultSummary ? String(input.resultSummary).slice(0, 500) : undefined,
      errorCode: input.errorCode,
      idempotencyKey: input.idempotencyKey,
      pending: input.pending,
      latencyMs: input.latencyMs,
      expiresAt,
    });
    return String(doc._id);
  } catch (e: any) {
    if (e?.code === 11000 && input.idempotencyKey) {
      const ex: any = await AiActionAudit.findOne({ companyId: input.companyId, idempotencyKey: input.idempotencyKey }).select('_id').lean();
      if (ex) return String(ex._id);
    }
    throw e;
  }
}

/** Muvaffaqiyatli AI yozuvini umumiy audit jurnaliga ko'chirish. */
export async function mirrorWriteToLegacyAudit(p: {
  companyId: string; actorUserId: string; actorName?: string; actorRole: string; tool: string; channel: string;
  entity?: string; entityId?: string; action?: AuditAction; summary?: string; args?: unknown;
}): Promise<void> {
  await logAudit({
    userId: p.actorUserId,
    userName: p.actorName || 'AI',
    userRole: p.actorRole,
    action: p.action || 'update',
    entity: p.entity || 'ai_tool',
    entityId: p.entityId,
    description: `AI (${p.channel}): ${p.tool}${p.summary ? ' — ' + String(p.summary).slice(0, 200) : ''}`,
    newValue: redact(p.args),
    companyId: p.companyId,
  });
}
