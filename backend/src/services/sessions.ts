// JWT + Session yozuvini BIR JOYDA yaratish — auth.ts'dagi /login, /verify-otp,
// /dev-login va routes/qrlogin.ts (QR orqali kirish) BARCHASI shu bitta
// funksiyani chaqiradi, shu sabab "Ulangan qurilmalar" (ProfilePage)
// har qanday kirish usulida ham to'liq va izchil ko'rinadi.
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import Session from '../models/Session';
import { JWT_SECRET } from '../middleware/auth';

export interface SessionTokenPayload {
  userId: string;
  role: string;
  companyId?: string;
  branchId?: string;
  isOwner?: boolean;
  isDeveloper?: boolean;
}

// Juda oddiy, aniqlik darajasi past — faqat "Ulangan qurilmalar" ro'yxatida
// inson o'qiy oladigan yorliq ko'rsatish uchun (masalan "Chrome · Windows").
// Xavfsizlik qarori BUNGA tayanmaydi.
function deviceLabelFromUA(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari' : "Noma'lum brauzer";
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod|iOS/.test(ua) ? 'iOS'
    : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : "noma'lum";
  return `${browser} · ${os}`;
}

export async function issueTokenWithSession(
  payload: SessionTokenPayload,
  req: { headers: any; ip?: string },
  loginMethod: 'password' | 'qr' | 'dev',
  expiresIn: string = '7d'
): Promise<string> {
  const jti = randomBytes(16).toString('hex');
  const ua = (req.headers?.['user-agent'] || '').toString();
  await Session.create({
    userId: String(payload.userId),
    jti,
    deviceLabel: deviceLabelFromUA(ua),
    userAgent: ua,
    ip: (req.ip || '').trim(),
    loginMethod,
    lastSeenAt: new Date(),
  });
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}
