import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import registerRoutes from './routes/register';
import objectRoutes from './routes/objects';
import usersRoutes from './routes/users';
import transactionRoutes from './routes/transactions';
import messageRoutes from './routes/messages';
import groupRoutes from './routes/groups';
import materialRoutes from './routes/materials';
import companyRoutes from './routes/companies';
import subscriptionRoutes from './routes/subscriptions';
import smetaRoutes from './routes/smeta';
import aiRoutes from './routes/ai';
import attendanceRoutes from './routes/attendance';
import gpsRoutes from './routes/gps';
import pushRoutes from './routes/push';
import auditRoutes from './routes/audit';
import searchRoutes from './routes/search';
import qrRoutes from './routes/qr';
import notificationRoutes from './routes/notifications';
import currencyRoutes from './routes/currency';
import dashboardRoutes from './routes/dashboard';
import clientErrorRoutes from './routes/clientErrors';
import backupRoutes from './routes/backup';
import { initSocket } from './services/socket';
import { optionalAuth, blockDeveloper } from './middleware/auth';
// Import bot to start it + get bot instance for webhook route
import { bot } from './services/bot';

dotenv.config();

// Himoya to'ri: catch qilinmagan Promise xatolari (masalan Telegram API 400/bloklangan
// foydalanuvchi) SERVERNI O'LDIRMASIN — faqat log qilamiz.
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ Unhandled Rejection (server tirik qoldi):', reason?.message || reason);
});

const app = express();

app.use(helmet({
  crossOriginEmbedderPolicy: false,  // WebRTC + socket.io uchun kerak
  contentSecurityPolicy: false,       // Frontend Vercel'da serve bo'lgani uchun backend CSP kerak emas
}));
app.use(cors({
  origin: process.env.SITE_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));
app.use(express.json({ limit: '60mb' }));
// Yuklangan fayllar (chat media, smeta, va h.k.) doim noyob nom bilan saqlanadi
// (vaqt tamg'asi + tasodifiy raqam) — demak bir xil URL hech qachon boshqa
// mazmunga o'zgarmaydi. Shuning uchun uzoq muddatli "immutable" keshni xavfsiz
// yoqish mumkin: brauzer buni QAYTA SO'RAMASDAN to'g'ridan-to'g'ri qurilma
// xotirasidan (disk keshidan) o'qib beradi — chat qayta ochilganda rasm/video/
// ovoz darhol, tarmoqqa chiqmasdan ko'rinadi.
app.use('/uploads', express.static('uploads', { maxAge: '365d', immutable: true }));

// Health-check (bazaga bog'liq emas) — Render/uptime darhol 200 oladi
app.get('/health', (_req, res) => res.json({ ok: true, service: 'quriliserp-backend' }));

// optionalAuth: token bo'lsa o'qib tenant kontekstini o'rnatadi, bo'lmasa ham
// so'rovni o'tkazadi — shu tufayli eski klientlar sinmaydi (bosqichma-bosqich izolyatsiya).
app.use('/api/auth', optionalAuth, authRoutes);
app.use('/api/register', registerRoutes); // v1.2 self-signup (pre-auth, ochiq)
// Firma ichki ma'lumotlari — dasturchi kira olmaydi (blockDeveloper).
// Dasturchi faqat: companies, subscriptions, messages/groups (support chat).
app.use('/api/objects',      optionalAuth, blockDeveloper, objectRoutes);
app.use('/api/users',        optionalAuth, usersRoutes);        // dasturchi: read-only via DeveloperPanel
app.use('/api/transactions', optionalAuth, blockDeveloper, transactionRoutes);
app.use('/api/messages',     optionalAuth, messageRoutes);      // dasturchi: support chat
app.use('/api/groups',       optionalAuth, groupRoutes);        // dasturchi: support chat
app.use('/api/materials',    optionalAuth, blockDeveloper, materialRoutes);
app.use('/api/companies',    optionalAuth, companyRoutes);      // dasturchi (super-admin) only
app.use('/api/admin/subscriptions', optionalAuth, subscriptionRoutes); // obunalar boshqaruvi
app.use('/api/smeta',        optionalAuth, blockDeveloper, smetaRoutes);
app.use('/api/ai',           optionalAuth, blockDeveloper, aiRoutes);
app.use('/api/attendance',      optionalAuth, attendanceRoutes);
app.use('/api/gps',             optionalAuth, gpsRoutes);
app.use('/api/push',            optionalAuth, pushRoutes);
app.use('/api/audit-logs',      optionalAuth, auditRoutes);
app.use('/api/search',          optionalAuth, searchRoutes);
app.use('/api/qr',              optionalAuth, qrRoutes);
app.use('/api/notifications',   optionalAuth, notificationRoutes);
app.use('/api/currency',        optionalAuth, currencyRoutes);
app.use('/api/dashboard',       optionalAuth, blockDeveloper, dashboardRoutes);
app.use('/api/errors',          optionalAuth, clientErrorRoutes);
app.use('/api/admin',           optionalAuth, backupRoutes);

// Telegram bot webhook — faqat TELEGRAM_WEBHOOK_URL o'rnatilgan bo'lsa faol bo'ladi.
// Polling rejimida bu route hech qachon chaqirilmaydi.
if (process.env.TELEGRAM_WEBHOOK_URL) {
  app.post('/api/bot/webhook', express.json(), (req, res) => {
    try {
      bot.processUpdate(req.body);
    } catch {
      // Noto'g'ri payload — jim o'tkazib yuboramiz (bot handlerlari o'z xatolarini loglar)
    }
    res.sendStatus(200);
  });
}

// 404 handler — tanilmagan route lar uchun
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route topilmadi" });
});

// Global error handler — catch qilinmagan Express xatolar
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[Global Error]', err?.message || err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: status === 500 ? 'Server xatoligi' : (err?.message || 'Xatolik yuz berdi'),
  });
});

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/erp_firma';

const httpServer = http.createServer(app);
initSocket(httpServer); // Socket.io (real-time chat, bildirishnoma, qo'ng'iroq signaling)

// MUHIM: avval portni ochamiz — Render (va boshqa bulut) health-check darhol javob
// olsin va deploy "jim osilib" qolmasin. Bazaga ulanish keyin, alohida amalga oshadi;
// muvaffaqiyatsiz bo'lsa ham server tirik qoladi va xato log'da ko'rinadi.
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (HTTP + Socket.io)`);
});

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err?.message || err));
