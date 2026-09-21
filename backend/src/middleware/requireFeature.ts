import { Request, Response, NextFunction } from 'express';
import Subscription from '../models/Subscription';
import { getPlanInfo } from '../config/plans';
import { getTenant } from './tenantContext';

// XAVFSIZLIK/BIZNES — TOPILMA (audit): tarif bo'yicha funksiyalar (AI
// yordamchi, GPS, backup, valyuta konvertori, QR, audit jurnali) FAQAT
// frontendda (`hasFeature('...')`) tekshirilardi — backend hech qanday
// qayta tekshiruv qilmasdi. Eng jiddiy oqibati: /api/ai/chat va /api/ai/execute
// har chaqiruvda HAQIQIY pul sarflaydigan Groq API so'rovi yuboradi — AI
// tarifga kirmagan (yoki hech qanday tarifga ega bo'lmagan) firma to'g'ridan-
// to'g'ri API orqali (masalan o'z haqiqiy tokeni bilan curl/Postman) buni
// CHEKSIZ chaqirib, tarifni butunlay chetlab o'tib, xarajat keltirishi mumkin
// edi. Boshqa funksiyalar (GPS, backup, valyuta, QR) o'z ma'lumotiga
// kirishni cheklaydi — bu ham muhim, lekin real pul yo'qotish xavfi yo'q.
//
// Bu middleware har bir himoyalangan yo'lda firmaning JORIY faol obunasini
// (eng oxirgi Subscription yozuvi) qayta tekshiradi va tarif shu funksiyani
// o'z ichiga OLMASA — 403 bilan rad etadi (frontend allaqachon tugmani
// yashiradi, lekin bu ENDI haqiqiy himoya, faqat "yaxshi niyat" emas).
export function requireFeature(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const t = getTenant();
    // Dasturchi (super-admin) — tarif tushunchasi unga tegishli emas.
    if (t?.isDeveloper) return next();
    // companyId'siz (eski/legacy) foydalanuvchi — eski xatti-harakat saqlanadi,
    // bosqichma-bosqich joriy qilish qoidasi (middleware/scope.ts'dagi kabi).
    if (!t?.companyId) return next();
    try {
      const sub = await Subscription.findOne({ companyId: t.companyId }).sort({ createdAt: -1 }).lean();
      const planInfo = sub?.selectedPlan ? getPlanInfo(sub.selectedPlan) : undefined;
      const features = planInfo?.features;
      // Tarif/obuna topilmasa — nima uchun ekanini bilolmaymiz (masalan hali
      // migratsiya qilinmagan eski firma) — xavfsiz tomonga xato qilmasdan
      // BLOKLAMASLIKNI tanladik (frontendda funksiya ko'rinmasa ham baribir
      // ishlab turgan mavjud mijozlarni to'satdan uzib qo'ymaslik uchun) —
      // faqat ANIQ tarif topilib, u ro'yxatda YO'Q bo'lsa rad etamiz.
      if (!features) return next();
      if (!features.includes(featureKey)) {
        return res.status(403).json({ error: "Bu funksiya sizning joriy tarifingizga kirmaydi", featureRequired: featureKey });
      }
      return next();
    } catch (err) {
      console.error('[requireFeature]', featureKey, err);
      return next(); // xato holatida bloklamaymiz — mavjud ishlashni buzmaslik ustuvor
    }
  };
}
