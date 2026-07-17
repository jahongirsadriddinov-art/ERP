import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import cors from 'cors';
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
import { initSocket } from './services/socket';
import { optionalAuth } from './middleware/auth';
// Import bot to start it
import './services/bot';

dotenv.config();

// Himoya to'ri: catch qilinmagan Promise xatolari (masalan Telegram API 400/bloklangan
// foydalanuvchi) SERVERNI O'LDIRMASIN — faqat log qilamiz.
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ Unhandled Rejection (server tirik qoldi):', reason?.message || reason);
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use('/uploads', express.static('uploads'));

// optionalAuth: token bo'lsa o'qib tenant kontekstini o'rnatadi, bo'lmasa ham
// so'rovni o'tkazadi — shu tufayli eski klientlar sinmaydi (bosqichma-bosqich izolyatsiya).
app.use('/api/auth', authRoutes);
app.use('/api/register', registerRoutes); // v1.2 self-signup (pre-auth, ochiq)
app.use('/api/objects', optionalAuth, objectRoutes);
app.use('/api/users', optionalAuth, usersRoutes);
app.use('/api/transactions', optionalAuth, transactionRoutes);
app.use('/api/messages', optionalAuth, messageRoutes);
app.use('/api/groups', optionalAuth, groupRoutes);
app.use('/api/materials', optionalAuth, materialRoutes);
app.use('/api/companies', optionalAuth, companyRoutes); // dasturchi (super-admin) only

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/erp_firma';

const httpServer = http.createServer(app);
initSocket(httpServer); // Socket.io (real-time chat, bildirishnoma, qo'ng'iroq signaling)

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT} (HTTP + Socket.io)`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
