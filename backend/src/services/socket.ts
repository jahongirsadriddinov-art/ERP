import { Server, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JwtPayload, loadFreshUser } from '../middleware/auth';
import Group from '../models/Group';

let io: Server | null = null;

// userId -> set of socket ids (bir user bir nechta qurilma/tab'da bo'lishi mumkin)
const userSockets = new Map<string, Set<string>>();

function addUserSocket(userId: string, socketId: string) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId)!.add(socketId);
}
function removeUserSocket(userId: string, socketId: string) {
  const set = userSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userSockets.delete(userId);
}
function broadcastPresence() {
  io?.emit('presence', { online: Array.from(userSockets.keys()) });
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e8, // 100MB (media)
  });

  // XAVFSIZLIK — JIDDIY TOPILMA (audit): avval ulanish uchun userId/companyId
  // mijozning O'ZI yuborgan oddiy so'rov parametrlaridan (handshake query)
  // olinardi — HECH QANDAY token tekshiruvisiz! Istalgan kishi
  // `?userId=<boshqa-odam-ID>&companyId=<boshqa-firma-ID>` bilan ulanib,
  // o'sha odamning HAMMA real-vaqt hodisalarini (yangi chat xabarlari,
  // bildirishnomalar, moliyaviy tranzaksiyalar, hatto WebRTC qo'ng'iroq
  // signalizatsiyasi) yoki BUTUN FIRMANING jonli GPS joylashuvini —
  // avtorizatsiyasiz, sezilmasdan "tinglashi" mumkin edi. MongoDB ID'lari
  // maxfiy emas (vaqt+hisoblagichga asoslangan, taxmin qilish oson).
  // Endi HAR bir ulanish HTTP so'rovlar bilan bir xil JWT'ni talab qiladi —
  // userId/companyId endi token'dan (bazadan qayta tekshirilgan holda)
  // olinadi, mijoz aytgan qiymatlarga umuman ishonilmaydi.
  io.use(async (socket: Socket, next) => {
    try {
      const token = (socket.handshake.auth?.token || socket.handshake.query?.token || '') as string;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const fresh = await loadFreshUser(payload);
      if (!fresh) return next(new Error('unauthorized'));
      socket.data.userId = fresh.userId;
      socket.data.companyId = fresh.companyId;
      socket.data.role = fresh.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId: string = socket.data.userId;
    const companyId: string | undefined = socket.data.companyId;
    socket.join(`user:${userId}`);
    addUserSocket(userId, socket.id);
    broadcastPresence();
    // Firma xonasi — GPS kabi haqiqiy-vaqt hodisalarni FAQAT shu firma
    // foydalanuvchilariga yetkazish uchun (emitToCompany quyida). Endi
    // tekshirilgan (token'dan olingan) companyId — mijoz o'zi tanlagan
    // ixtiyoriy qiymat emas.
    if (companyId) socket.join(`company:${companyId}`);

    // Guruh room'lariga qo'shilish — FAQAT haqiqatan ham o'sha guruh
    // a'zosi bo'lsa (aks holda istalgan kishi istalgan guruh ID'sini
    // taxmin qilib, o'sha guruh xabarlarini real-vaqtda tinglashi mumkin
    // edi).
    socket.on('join:group', async (groupId: string) => {
      if (!groupId) return;
      const group = await Group.findById(groupId).select('memberIds').lean().catch(() => null);
      if (group && (group.memberIds || []).includes(userId)) socket.join(`group:${groupId}`);
    });
    socket.on('leave:group', (groupId: string) => { if (groupId) socket.leave(`group:${groupId}`); });

    // Yozmoqda... — fromUserId endi tekshirilgan identifikatordan (mijoz
    // o'zi "men boshqa odamman" deb da'vo qila olmaydi).
    socket.on('typing', (data: { toUserId?: string; groupId?: string; fromName?: string }) => {
      const payload = { ...data, fromUserId: userId };
      if (data.groupId) socket.to(`group:${data.groupId}`).emit('typing', payload);
      else if (data.toUserId) socket.to(`user:${data.toUserId}`).emit('typing', payload);
    });

    // ── WebRTC signaling (1:1 va guruh qo'ng'iroqlari) ──────────────────────
    const relay = (event: string) => (data: any) => {
      if (!data) return;
      if (Array.isArray(data.to)) data.to.forEach((uid: string) => io?.to(`user:${uid}`).emit(event, data));
      else if (data.to) io?.to(`user:${data.to}`).emit(event, data);
      else if (data.groupId) socket.to(`group:${data.groupId}`).emit(event, data);
    };
    socket.on('call:offer', relay('call:offer'));
    socket.on('call:answer', relay('call:answer'));
    socket.on('call:ice', relay('call:ice'));
    socket.on('call:end', relay('call:end'));
    socket.on('call:reject', relay('call:reject'));
    socket.on('call:join', relay('call:join'));

    socket.on('disconnect', () => {
      if (userId) { removeUserSocket(userId, socket.id); broadcastPresence(); }
    });
  });

  return io;
}

export const emitToUser = (userId: string, event: string, payload: any) =>
  io?.to(`user:${userId}`).emit(event, payload);
export const emitToGroup = (groupId: string, event: string, payload: any) =>
  io?.to(`group:${groupId}`).emit(event, payload);
export const broadcast = (event: string, payload: any) =>
  io?.emit(event, payload);
// companyId berilmasa (masalan eski/companyId'siz yozuv) — xavfsiz tomonga
// og'ish uchun HECH KIMGA yubormaymiz (global broadcast'ga qaytish o'rniga),
// aks holda aynan tuzatilayotgan sızish yana paydo bo'lardi.
export const emitToCompany = (companyId: string | undefined, event: string, payload: any) => {
  if (!companyId) return;
  io?.to(`company:${companyId}`).emit(event, payload);
};
export const getIO = () => io;
export const isOnline = (userId: string) => userSockets.has(userId);
