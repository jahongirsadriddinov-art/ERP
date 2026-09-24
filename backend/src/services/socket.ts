import { Server, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JwtPayload, loadFreshUser } from '../middleware/auth';
import Group from '../models/Group';
import User from '../models/User';
import { sendPushToUser } from './push';

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
      socket.data.jti = payload.jti;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId: string = socket.data.userId;
    const companyId: string | undefined = socket.data.companyId;
    const jti: string | undefined = socket.data.jti;
    socket.join(`user:${userId}`);
    // "Ulangan qurilmalar"dan chiqarib yuborilganda (routes/sessions.ts)
    // shu qurilmaning FAQAT o'zini darhol uzish uchun — jti'ga xos xona
    // (eski, jti'siz tokenlarda bu xona yo'q, o'sha holatda faqat keyingi
    // HTTP so'rov rad etiladi — middleware/auth.ts'dagi izohga qarang).
    if (jti) socket.join(`session:${jti}`);
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
    // XATO TUZATILDI ("qo'ng'iroq qilganda qabul qiluvchida hech qanday
    // ogohlantirish/ovoz chiqmayapti"): call:offer FAQAT socket.io orqali
    // ulangan (ilova ochiq, tab faol) tomonga yetib borardi — agar
    // qabul qiluvchining ilovasi fon rejimida yoki yopiq bo'lsa (juda
    // oddiy holat), u qo'ng'iroq haqida UMUMAN bilib qolmasdi (na tovush,
    // na chiqib turuvchi bildirishnoma). Endi transactions.ts'dagi bilan
    // bir xil Web Push (sendPushToUser — bu chinakam qurilma
    // bildirishnomasi, ilova yopiq bo'lsa ham keladi) qo'shildi.
    socket.on('call:offer', (data: any) => {
      relay('call:offer')(data);
      if (data?.to) {
        const isVideo = data.mode === 'video';
        sendPushToUser(String(data.to), {
          title: isVideo ? "📹 Video qo'ng'iroq" : "📞 Qo'ng'iroq",
          body: `${data.fromName || 'Xodim'} sizga qo'ng'iroq qilmoqda`,
          tag: 'call',
        }).catch(() => {});
      }
    });
    socket.on('call:answer', relay('call:answer'));
    socket.on('call:ice', relay('call:ice'));
    socket.on('call:end', relay('call:end'));
    socket.on('call:reject', relay('call:reject'));
    socket.on('call:join', relay('call:join'));
    // Kamera/mikrofon holati (Telegram'dagi kabi plitkada avatar/ovoz belgisi uchun)
    socket.on('call:state', relay('call:state'));

    // ── Guruh video chat (Telegram-ga o'xshash) ─────────────────────────────
    // Yuqoridagi call:* WebRTC signalizatsiyasidan FARQLI — bu yerda hech
    // kim "chaqirilmaydi" (rings), shunchaki guruhda "video chat FAOL"
    // holati saqlanadi (Group.activeVideoChat), shu bilan boshqa a'zolar
    // guruhni keyinroq ochsa ham "Qo'shilish" tugmasini ko'radi. Haqiqiy
    // media ulanishi (offer/answer/ice) hamon call:* orqali, frontend
    // o'zi qo'shimcha ravishda call:join'ni ham chaqiradi.
    const requireMembership = async (groupId: string): Promise<any> => {
      const group = await Group.findById(groupId).catch(() => null);
      if (!group || !(group.memberIds || []).includes(userId)) return null;
      return group;
    };
    socket.on('videochat:start', async (data: { groupId?: string; mode?: 'voice' | 'video' }, ack?: (r: any) => void) => {
      if (!data?.groupId) return;
      const group = await requireMembership(data.groupId);
      if (!group) return;
      // Eski/"arvoh" holat: hamma ishtirokchi oflayn bo'lsa (masalan server qayta
      // ishga tushgan yoki xato bilan uzilgan) — eskisini tozalab, yangidan boshlaymiz.
      if (group.activeVideoChat) {
        const alive = (group.activeVideoChat.participantIds || []).filter((id: string) => userSockets.has(id));
        if (alive.length === 0) group.activeVideoChat = undefined;
        else if (alive.length !== group.activeVideoChat.participantIds.length) group.activeVideoChat.participantIds = alive;
      }
      if (!group.activeVideoChat) {
        const starter = await User.findById(userId).select('firstName lastName').lean().catch(() => null);
        group.activeVideoChat = {
          startedBy: userId,
          startedByName: starter ? `${starter.firstName || ''} ${starter.lastName || ''}`.trim() || 'Xodim' : 'Xodim',
          startedAt: new Date(),
          mode: data.mode === 'voice' ? 'voice' : 'video',
          participantIds: [userId],
        } as any;
        await group.save();
        const avc = group.activeVideoChat!;
        // Mongoose subdocument'ni to'g'ridan-to'g'ri yoyib (spread) bo'lmaydi —
        // ichki maydonlari ($__, _doc) chiqib, participantIds yo'qoladi va
        // frontend `.length` o'qiganda qulab tushardi. Aniq oddiy obyekt.
        io?.to(`group:${data.groupId}`).emit('videochat:active', {
          groupId: data.groupId, startedBy: avc.startedBy, startedByName: avc.startedByName,
          startedAt: avc.startedAt, mode: avc.mode, participantIds: [...(avc.participantIds || [])],
        });
        // Guruhdagi boshqa a'zolarga (ilova fon/yopiq bo'lsa ham) push —
        // call:offer'dagi bilan bir xil naqsh.
        (group.memberIds || []).forEach((mid: string) => {
          if (mid === userId) return;
          sendPushToUser(mid, {
            title: '📹 Guruh video chat',
            body: `${group.activeVideoChat!.startedByName} video chat boshladi — qo'shilish uchun bosing`,
            tag: 'videochat',
          }).catch(() => {});
        });
      } else {
        // Allaqachon faol — bu "boshlash" emas, "qo'shilish" bo'ladi.
        if (!group.activeVideoChat.participantIds.includes(userId)) {
          group.activeVideoChat.participantIds.push(userId);
          await group.save();
        }
        io?.to(`group:${data.groupId}`).emit('videochat:participants', { groupId: data.groupId, participantIds: group.activeVideoChat.participantIds });
      }
      // Qo'shilayotgan kishi (joiner) HAMMA mavjud ishtirokchiga o'zi offer
      // yuboradi — glare (ikki tomonlama offer) bo'lmasligi uchun aniq qoida.
      ack?.({ participantIds: [...(group.activeVideoChat?.participantIds || [])] });
    });
    socket.on('videochat:join', async (data: { groupId?: string }) => {
      if (!data?.groupId) return;
      const group = await requireMembership(data.groupId);
      if (!group?.activeVideoChat) return;
      if (!group.activeVideoChat.participantIds.includes(userId)) {
        group.activeVideoChat.participantIds.push(userId);
        await group.save();
      }
      io?.to(`group:${data.groupId}`).emit('videochat:participants', { groupId: data.groupId, participantIds: group.activeVideoChat.participantIds });
    });
    socket.on('videochat:leave', async (data: { groupId?: string }) => {
      if (!data?.groupId) return;
      const group = await requireMembership(data.groupId);
      if (!group?.activeVideoChat) return;
      group.activeVideoChat.participantIds = group.activeVideoChat.participantIds.filter((id: string) => id !== userId);
      if (group.activeVideoChat.participantIds.length === 0) {
        group.activeVideoChat = undefined;
        await group.save();
        io?.to(`group:${data.groupId}`).emit('videochat:ended', { groupId: data.groupId });
      } else {
        await group.save();
        io?.to(`group:${data.groupId}`).emit('videochat:participants', { groupId: data.groupId, participantIds: group.activeVideoChat.participantIds });
      }
    });
    // XAVFSIZLIK: "hammaga tugatish" FAQAT boshlagan odam uchun — bu
    // tekshiruv MAJBURIY ravishda SERVERDA, chunki mijoz kodini o'zgartirib
    // (masalan brauzer konsolidan) tekshiruvsiz shu hodisani yuborishi
    // mumkin edi.
    socket.on('videochat:end', async (data: { groupId?: string }) => {
      if (!data?.groupId) return;
      const group = await requireMembership(data.groupId);
      if (!group?.activeVideoChat || group.activeVideoChat.startedBy !== userId) return;
      group.activeVideoChat = undefined;
      await group.save();
      io?.to(`group:${data.groupId}`).emit('videochat:ended', { groupId: data.groupId });
    });

    socket.on('disconnect', () => {
      if (userId) { removeUserSocket(userId, socket.id); broadcastPresence(); }
      // Video chatda turgan foydalanuvchining BARCHA ulanishi uzilsa (tab yopildi,
      // internet ketdi) — "arvoh" ishtirokchi bo'lib qolmasligi uchun chiqariladi.
      if (userId && !userSockets.has(userId)) {
        Group.find({ 'activeVideoChat.participantIds': userId }).then(async (gs: any[]) => {
          for (const g of gs) {
            g.activeVideoChat.participantIds = g.activeVideoChat.participantIds.filter((id: string) => id !== userId);
            if (g.activeVideoChat.participantIds.length === 0) {
              g.activeVideoChat = undefined;
              await g.save();
              io?.to(`group:${String(g._id)}`).emit('videochat:ended', { groupId: String(g._id) });
            } else {
              await g.save();
              io?.to(`group:${String(g._id)}`).emit('videochat:participants', { groupId: String(g._id), participantIds: g.activeVideoChat.participantIds });
            }
          }
        }).catch(() => {});
      }
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

// "Ulangan qurilmalar" (routes/sessions.ts) — bitta sessiyani (jti) DARHOL
// uzish: avval xabar yuboriladi (frontend buni ko'rib o'zini toza chiqaradi
// — localStorage tozalash, login ekraniga qaytish), so'ng ulanish o'zi
// ham majburan yopiladi (agar foydalanuvchi biror sababdan xabarni
// e'tiborsiz qoldirsa ham, real-vaqt kanali darhol to'xtaydi).
export function kickSession(jti: string) {
  if (!io) return;
  io.to(`session:${jti}`).emit('session:revoked');
  io.in(`session:${jti}`).disconnectSockets(true);
}
