import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { runWithTenant, TenantContext } from './tenantContext';
import User from '../models/User';

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

// XAVFSIZLIK — MUHIM TUZATISH: avval bu yerda JWT imzosi to'g'ri bo'lsa
// KIFOYA edi — token ichidagi companyId/role/isOwner qiymatlari LOGIN
// PAYTIDAGI holatni "muhrlab" qo'yardi va keyin HECH QACHON qayta
// tekshirilmasdi. Natijada: (1) dasturchi biror firmani (yoki xodimni)
// o'chirsa, o'sha foydalanuvchining ESKI token'i muddati tugamaguncha
// (odatda kunlar/oylar) TO'LIQ ISHLASHDA DAVOM ETARDI — o'chirilgan
// hisob bilan saytga kirish davom etaverar edi; (2) birov boshqa firmaga
// ko'chirilsa/roli o'zgartirilsa, ESKI token hamon eski companyId/rol bilan
// ishlar edi (scoped() shu companyId bo'yicha filtrlaydi — demak
// o'zgargan firma ma'lumotlari EMAS, balki hali ham ESKI firma ma'lumotlari
// ko'rinishda davom etardi, chalkash/xavfli holat).
//
// Endi HAR so'rovda foydalanuvchi bazada HALI HAM MAVJUDligi va uning
// ENG YANGI (token'dagi emas) role/companyId/isOwner qiymatlari bilan
// tenant konteksti tuziladi — bitta yengil, indekslangan (_id bo'yicha)
// so'rov, sezilarli sekinlashuvsiz.
async function loadFreshUser(payload: JwtPayload) {
  const fresh = await User.findById(payload.userId).select('role companyId isOwner').lean();
  if (!fresh) return null;
  return {
    userId: payload.userId,
    role: fresh.role,
    companyId: fresh.companyId,
    branchId: payload.branchId, // faqat ko'rsatish uchun, scoped() bunga tayanmaydi
    isOwner: fresh.isOwner,
    // isDeveloper token'dagi bayroqdan EMAS, bazadagi ENG YANGI roldan
    // hisoblanadi — soxta/eskirgan da'voga ishonilmaydi.
    isDeveloper: fresh.role === 'dasturchi',
  } as JwtPayload;
}

// Majburiy autentifikatsiya: token bo'lmasa yoki yaroqsiz bo'lsa 401.
// Muvaffaqiyatli bo'lsa req.user ni to'ldiradi va tenant konteksti ichida davom etadi.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const fresh = await loadFreshUser(payload);
    if (!fresh) {
      return res.status(401).json({ error: 'Hisobingiz topilmadi — qayta kiring' });
    }
    req.user = fresh;
    const ctx: TenantContext = {
      userId: fresh.userId,
      role: fresh.role,
      companyId: fresh.companyId,
      branchId: fresh.branchId,
      isOwner: fresh.isOwner,
      isDeveloper: fresh.isDeveloper,
    };
    return runWithTenant(ctx, () => next());
  } catch {
    return res.status(401).json({ error: 'Token yaroqsiz yoki muddati tugagan' });
  }
}

// Ixtiyoriy autentifikatsiya: token bo'lsa o'qiydi, bo'lmasa ham davom etadi
// (bosqichma-bosqich joriy qilishda — eski frontend token yubormasa ham sinmasin uchun).
// MUHIM: token bor-u, lekin foydalanuvchi bazada topilmasa (o'chirilgan) —
// AVTORIZATSIYASIZ (mehmon) sifatida DAVOM ETAMIZ, xato qaytarmaymiz — bu
// yo'l ko'plab route'larda "auth bo'lsa shaxsiylashtirilgan, bo'lmasa ham
// ishlayveradi" mantig'i uchun ishlatiladi; requireAuth qo'llaniladigan
// himoyalangan yo'llar o'chirilgan hisobni yuqoridagidek qat'iy rad etadi.
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const fresh = await loadFreshUser(payload);
    if (!fresh) return next(); // o'chirilgan hisob — mehmon sifatida davom
    req.user = fresh;
    const ctx: TenantContext = {
      userId: fresh.userId,
      role: fresh.role,
      companyId: fresh.companyId,
      branchId: fresh.branchId,
      isOwner: fresh.isOwner,
      isDeveloper: fresh.isDeveloper,
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
