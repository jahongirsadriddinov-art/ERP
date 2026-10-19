import crypto from 'crypto';
import mongoose, { Schema } from 'mongoose';
import type { Request, Response, NextFunction } from 'express';

// Oflayn navbat (owner 2026-10-19: "oflayn rejimda hamma funksiya ishlasin"): ilova internetsiz qilingan amalni
// keyin qayta yuboradi. Javob yo'lda yo'qolsa (tarmoq uzildi) — xuddi shu so'rov yana keladi. X-Idempotency-Key
// bo'lsa, birinchi muvaffaqiyatli javob saqlanadi va takroriy so'rovga O'SHA javob qaytadi (yozuv ikki marta
// yaratilmaydi). Kalit foydalanuvchi tokeniga bog'lanadi — boshqa odam birovning kalitidan javob ololmaydi.

interface IIdem { key: string; status: number; body: string; state: 'pending' | 'done'; createdAt: Date }
const IdemSchema = new Schema<IIdem>({
  key: { type: String, required: true, unique: true },
  status: { type: Number, default: 0 },
  body: { type: String, default: '' },
  state: { type: String, enum: ['pending', 'done'], default: 'pending' },
  createdAt: { type: Date, default: () => new Date(), expires: 3 * 24 * 3600 },   // 3 kun
});
const Idem = (mongoose.models.IdempotencyRecord as mongoose.Model<IIdem>) || mongoose.model<IIdem>('IdempotencyRecord', IdemSchema);

const KEY_RE = /^[A-Za-z0-9_.:-]{8,120}$/;
const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_BODY = 256 * 1024;

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw = String(req.headers['x-idempotency-key'] || '').trim();
    if (!raw || !METHODS.has(req.method) || !KEY_RE.test(raw)) return next();
    const auth = String(req.headers.authorization || '');
    if (!auth) return next();
    const scope = crypto.createHash('sha256').update(auth).digest('hex').slice(0, 24);
    const key = `${scope}:${req.method}:${req.originalUrl.split('?')[0]}:${raw}`;
    try {
      await Idem.create({ key });
    } catch (e: any) {
      if (e?.code !== 11000) return next();                        // baza xatosi — himoyasiz davom (ishni to'xtatmaymiz)
      const prev = await Idem.findOne({ key }).lean().catch(() => null);
      if (prev?.state === 'done') {
        res.setHeader('X-Idempotent-Replay', '1');
        res.status(prev.status || 200);
        try { return res.json(JSON.parse(prev.body)); } catch { return res.send(prev.body); }
      }
      return res.status(409).json({ error: "Bu amal hozir bajarilmoqda — biroz kuting", idempotencyInProgress: true });
    }
    // Javobni ushlab saqlaymiz (faqat muvaffaqiyatli 2xx; xato bo'lsa kalit bo'shatiladi — qayta urinish mumkin)
    const origJson = res.json.bind(res);
    res.json = (body: any) => {
      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        let text = '';
        try { text = JSON.stringify(body ?? null); } catch { text = 'null'; }
        if (text.length <= MAX_BODY) void Idem.updateOne({ key }, { $set: { state: 'done', status, body: text } }).catch(() => undefined);
        else void Idem.deleteOne({ key }).catch(() => undefined);
      } else {
        void Idem.deleteOne({ key }).catch(() => undefined);
      }
      return origJson(body);
    };
    res.on('close', () => {
      // Javob json orqali yuborilmagan (send/redirect) yoki ulanish uzildi — kalitni qoldirmaymiz
      if (!res.writableFinished || res.statusCode >= 400) void Idem.deleteOne({ key, state: 'pending' }).catch(() => undefined);
    });
    return next();
  };
}
