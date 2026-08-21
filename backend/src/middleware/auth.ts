import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { runWithTenant, TenantContext } from './tenantContext';

// JWT payload — login vaqtida shu maydonlar imzolanadi.
export interface JwtPayload {
  userId: string;
  role: string;
  companyId?: string;
  branchId?: string;
  isOwner?: boolean;
  isDeveloper?: boolean;
}

// Express Request ga req.user qo'shamiz.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// XAVFSIZLIK: agar JWT_SECRET muhit o'zgaruvchisi o'rnatilmagan bo'lsa,
// pastdagi 'secret' zaxira qiymati ishlatiladi — bu OMMAVIY MA'LUM,
// oldindan bashorat qilinadigan satr, shuning uchun shu holatda ISTALGAN
// kishi haqiqiy (hatto "dasturchi"/super-admin) token yasab olishi mumkin.
// Ataylab serverni O'CHIRIB QO'YMAYMIZ (production'da JWT_SECRET aslida
// to'g'ri o'rnatilgan bo'lsa ham, shu tekshiruv xato bilan butun saytni
// yiqitib qo'yishi mumkin edi) — lekin buni Render loglarida DARHOL
// ko'rinadigan qilib ogohlantiramiz.
export const JWT_SECRET = process.env.JWT_SECRET || 'secret';
if (!process.env.JWT_SECRET) {
  console.error('⚠️⚠️⚠️ XAVFSIZLIK OGOHLANTIRISHI: JWT_SECRET muhit o\'zgaruvchisi o\'rnatilmagan! ' +
    'Standart (ommaviy ma\'lum) kalit ishlatilmoqda — bu holatda istalgan kishi haqiqiy token yasashi mumkin. ' +
    'Render > Environment bo\'limida JWT_SECRET ni kuchli tasodifiy qiymatga o\'rnating.');
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

// Majburiy autentifikatsiya: token bo'lmasa yoki yaroqsiz bo'lsa 401.
// Muvaffaqiyatli bo'lsa req.user ni to'ldiradi va tenant konteksti ichida davom etadi.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    const ctx: TenantContext = {
      userId: payload.userId,
      role: payload.role,
      companyId: payload.companyId,
      branchId: payload.branchId,
      isOwner: payload.isOwner,
      isDeveloper: payload.isDeveloper,
    };
    return runWithTenant(ctx, () => next());
  } catch {
    return res.status(401).json({ error: 'Token yaroqsiz yoki muddati tugagan' });
  }
}

// Ixtiyoriy autentifikatsiya: token bo'lsa o'qiydi, bo'lmasa ham davom etadi
// (bosqichma-bosqich joriy qilishda — eski frontend token yubormasa ham sinmasin uchun).
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    const ctx: TenantContext = {
      userId: payload.userId,
      role: payload.role,
      companyId: payload.companyId,
      branchId: payload.branchId,
      isOwner: payload.isOwner,
      isDeveloper: payload.isDeveloper,
    };
    return runWithTenant(ctx, () => next());
  } catch {
    return next();
  }
}

// Faqat firma egasi yoki admin (direktor/orinbosar) uchun.
export function requireOwnerOrAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  if (u.isDeveloper || u.isOwner || u.role === 'direktor' || u.role === 'orinbosar') return next();
  return res.status(403).json({ error: 'Ruxsat yo\'q' });
}

// Faqat dasturchi (super-admin) uchun.
export function requireDeveloper(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  if (u.isDeveloper || u.role === 'dasturchi') return next();
  return res.status(403).json({ error: 'Ruxsat yo\'q' });
}

// Dasturchi firma ichki ma'lumotlariga (tranzaksiya, material, obyekt, smeta) kira olmaydi.
// Dasturchi faqat tashqi boshqaruv: kompaniyalar, obunalar, support chat.
export function blockDeveloper(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (u && (u.isDeveloper || u.role === 'dasturchi')) {
    return res.status(403).json({ error: "Dasturchi firma ichki ma'lumotlariga kira olmaydi. Faqat tashqi boshqaruv: obunalar, kompaniyalar." });
  }
  return next();
}
