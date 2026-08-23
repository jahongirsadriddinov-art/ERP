import AuditLog, { AuditAction } from '../models/AuditLog';
import { Request } from 'express';

interface AuditParams {
  userId: string;
  userName: string;
  userRole: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  description: string;
  oldValue?: any;
  newValue?: any;
  companyId?: string;
  req?: Request;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    // XAVFSIZLIK: avval mijoz o'zi qalbakilashtira oladigan X-Forwarded-For
    // sarlavhasini to'g'ridan-to'g'ri yozardi — audit jurnali "kim, qayerdan"
    // ma'lumoti soxtalashtirilishi mumkin edi (index.ts'dagi "trust proxy"
    // izohiga qarang). Endi Express'ning ishonchli req.ip'i.
    const ip = params.req ? (params.req.ip || '').trim() : undefined;
    const userAgent = params.req?.headers['user-agent'];

    // Strip sensitive fields before saving
    const sanitize = (v: any) => {
      if (!v || typeof v !== 'object') return v;
      const copy = { ...v };
      for (const k of ['password', 'token', 'secret', 'key', 'auth', 'p256dh']) {
        delete copy[k];
      }
      return copy;
    };

    await AuditLog.create({
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      description: params.description,
      oldValue: sanitize(params.oldValue),
      newValue: sanitize(params.newValue),
      ip,
      userAgent,
      companyId: params.companyId,
    });
  } catch (err) {
    // Audit log failure should never crash the main operation
    console.error('Audit log error:', (err as Error).message);
  }
}
