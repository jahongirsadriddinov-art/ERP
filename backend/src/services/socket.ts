import { Server, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { JWT_SECRET, JwtPayload, loadFreshUser } from '../middleware/auth';
import Group from '../models/Group';
import User from '../models/User';
import Message from '../models/Message';
import Session from '../models/Session';
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
// XAVFSIZLIK (audit): avval io.emit('presence') HAMMA firmaning HAMMA
// socket'iga butun platformadagi onlayn userId'larni yuborardi (firmalararo
// sizish + har ulanishda O(N) tarqatish). Endi: firma a'zolari faqat o'z
// firmasi (+ dasturchi — support chat uchun) holatini oladi; dasturchi
// socket'lari (DEV_ROOM) avvalgidek hammaning holatini oladi.
const companyOnline = new Map<string, Map<string, number>>(); // companyId -> userId -> socketlar soni
const devOnline = new Map<string, number>(); // dasturchi userId -> socketlar soni
const DEV_ROOM = 'presence:dev';
function inc(m: Map<string, number>, k: string) { m.set(k, (m.get(k) || 0) + 1); }
function dec(m: Map<string, number>, k: string) { const n = (m.get(k) || 0) - 1; if (n > 0) m.set(k, n); else m.delete(k); }
function trackPresence(companyId: string | undefined, userId: string, isDev: boolean, delta: 1 | -1) {
  if (isDev) (delta > 0 ? inc : dec)(devOnline, userId);
  if (!companyId) return;
  let m = companyOnline.get(companyId);
  if (!m) { if (delta < 0) return; m = new Map(); companyOnline.set(companyId, m); }
  (delta > 0 ? inc : dec)(m, userId);
  if (m.size === 0) companyOnline.delete(companyId);
}
function companyPresence(companyId: string): string[] {
  const ids = new Set(companyOnline.get(companyId)?.keys() || []);
  devOnline.forEach((_, id) => ids.add(id));
  return Array.from(ids);
}
// companyId — holati o'zgargan foydalanuvchining firmasi; isDev — dasturchi
// har firmaning support chatida bor, shu sabab uning holati hamma onlayn firmaga.
function broadcastPresence(companyId: string | undefined, isDev: boolean) {
  if (!io) return;
  const targets = isDev ? Array.from(companyOnline.keys()) : companyId ? [companyId] : [];
  for (const cid of targets) io.to(`company:${cid}`).emit('presence', { online: companyPresence(cid) });
  io.to(DEV_ROOM).emit('presence', { online: Array.from(userSockets.keys()) });
}

// Qo'ng'iroq push'i (call:offer) — bir (from,to) juftligi uchun 60 s ichida
// faqat BIR marta: ICE-restart qayta offer'lari qayta "sizga qo'ng'iroq" push
// chiqarmasligi kerak (CallOverlay ularni alohida belgilamaydi).
const CALL_PUSH_DEDUPE_MS = 60_000;
const callPushAt = new Map<string, number>();
function shouldPushCall(from: string, to: string): boolean {
  const now = Date.now();
  if (callPushAt.size > 5000) callPushAt.forEach((t, k) => { if (now - t >= CALL_PUSH_DEDUPE_MS) callPushAt.delete(k); });
  const key = `${from}>${to}`;
  const last = callPushAt.get(key);
  if (last && now - last < CALL_PUSH_DEDUPE_MS) return false;
  callPushAt.set(key, now);
  return true;
}

// Bekor qilingan sessiya (middleware/auth.ts'dagi checkSessionNotRevoked
// bilan bir xil qoida): jti'siz eski tokenlar o'tadi; jti bor-u, yozuv
// yo'q yoki revoked — rad.
async function sessionActive(jti: string | undefined): Promise<boolean> {
  if (!jti) return true;
  const s = await Session.findOne({ jti }).select('revoked').lean();
  return !!s && !s.revoked;
}

// Signal (call:*) kimga yuborilishi mumkin: o'ziga, bir firma a'zosiga,
// dasturchi bilan (har ikki tomondan) yoki umumiy devSupport guruhi a'zosiga.
async function canReachUser(me: { userId: string; companyId?: string; role?: string }, target: string): Promise<boolean> {
  if (!target || !mongoose.isValidObjectId(target)) return false;
  if (target === me.userId) return true;
  const t = await User.findById(target).select('companyId role').lean();
  if (!t) return false;
  if (me.role === 'dasturchi' || t.role === 'dasturchi') return true;
  if (me.companyId && t.companyId && String(me.companyId) === String(t.companyId)) return true;
  return !!(await Group.exists({ devSupport: true, memberIds: { $all: [me.userId, target] } }));
}


function fmtDuration(sec: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Guruhga tizim xabari (Telegram'dagi "video chat boshlandi / tugadi · davomiyligi")
async function postVideoChatEvent(group: any, byUserId: string, text: string, videoEvent: { kind: 'started' | 'ended'; durationSec?: number; by?: string }) {
  try {
    const msg = await Message.create({
      fromUserId: byUserId, toUserId: '', groupId: String(group._id), text,
      timestamp: new Date().toISOString(), read: false, type: 'video_event', videoEvent,
      ...(group.companyId ? { companyId: group.companyId } : {}),
    });
    io?.to(`group:${String(group._id)}`).emit('message:new', { ...msg.toObject(), id: msg._id });
  } catch (e) { console.error('[videochat event]', (e as Error).message); }
}

// Faol video chatni yakunlaydi: oxirgi holatni saqlaydi, hammaga 'ended' yuboradi va
// guruhga davomiylik bilan "tugadi" xabarini tashlaydi. silent — arvoh (server qayta
// ishga tushgandan qolgan) holatni tozalashda xabar chiqarmaslik uchun.
async function finishVideoChat(group: any, silent = false) {
  const avc = group.activeVideoChat;
  if (!avc) return;
  const endedAt = new Date();
  const durationSec = Math.max(0, Math.round((+endedAt - +new Date(avc.startedAt)) / 1000));
  const startedBy = avc.startedBy;
  const startedByName = avc.startedByName;
  group.lastVideoChat = { startedAt: avc.startedAt, endedAt, startedByName, durationSec };
  group.activeVideoChat = undefined;
  await group.save();
  io?.to(`group:${String(group._id)}`).emit('videochat:ended', { groupId: String(group._id), endedAt, durationSec });
  if (!silent) await postVideoChatEvent(group, startedBy, `📹 Video chat tugadi · ${fmtDuration(durationSec)}`, { kind: 'ended', durationSec, by: startedByName });
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
      // requireAuth bilan bir xil: bloklangan foydalanuvchi va "Ulangan
      // qurilmalar"dan chiqarilgan sessiya real-vaqt kanalini ham ocholmaydi.
      if (fresh.isBlocked) return next(new Error('unauthorized'));
      if (!(await sessionActive(payload.jti))) return next(new Error('unauthorized'));
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
    // Firma xonasi — GPS kabi haqiqiy-vaqt hodisalarni FAQAT shu firma
    // foydalanuvchilariga yetkazish uchun (emitToCompany quyida). Endi
    // tekshirilgan (token'dan olingan) companyId — mijoz o'zi tanlagan
    // ixtiyoriy qiymat emas. Presence'dan OLDIN — yangi ulangan o'zi ham olsin.
    const cid = companyId ? String(companyId) : undefined;
    const isDev = socket.data.role === 'dasturchi';
    if (cid) socket.join(`company:${cid}`);
    if (isDev) socket.join(DEV_ROOM);
    addUserSocket(userId, socket.id);
    trackPresence(cid, userId, isDev, 1);
    broadcastPresence(cid, isDev);
    const me = { userId, companyId: cid, role: socket.data.role as string | undefined };

    // Ruxsat tekshiruvlari kesh'i (ICE nomzodlari o'nlab marta keladi — har
    // biriga DB so'rovi bo'lmasin). 30 s — a'zolikdan chiqarish tez kuchga kirsin.
    const CHECK_TTL_MS = 30_000;
    const checks = new Map<string, { at: number; p: Promise<boolean> }>();
    const cachedCheck = (key: string, fn: () => Promise<boolean>): Promise<boolean> => {
      const now = Date.now();
      const c = checks.get(key);
      if (c && now - c.at < CHECK_TTL_MS) return c.p;
      if (checks.size > 500) checks.clear();
      const p = fn().catch(() => false);
      checks.set(key, { at: now, p });
      return p;
    };
    const canReach = (target: string) => cachedCheck(`u:${target}`, () => canReachUser(me, target));
    const isMember = (groupId: string) => cachedCheck(`g:${groupId}`, async () =>
      mongoose.isValidObjectId(groupId) && !!(await Group.exists({ _id: groupId, memberIds: userId })));
    // fromName — mijoz aytganidan emas, bazadan (frontend bilan bir xil format).
    let myNameP: Promise<string> | null = null;
    const myName = () => (myNameP ||= User.findById(userId).select('firstName lastName').lean()
      .then((u: any) => (u ? `${u.firstName || ''}${u.lastName ? ' ' + u.lastName : ''}`.trim() : '') || 'Xodim')
      .catch(() => 'Xodim'));
    // Hodisalar tartibi saqlansin (offer → ice) — tekshiruvlar asinxron, shu sabab navbat.
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = (fn: () => Promise<unknown>) => {
      queue = queue.then(fn).catch((e) => console.error('[socket relay]', (e as Error)?.message));
    };

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
    // Qabul qiluvchi — signal bilan bir xil qoida (a'zolik / ruxsat etilgan odam).
    socket.on('typing', (data: { toUserId?: string; groupId?: string; fromName?: string }) => {
      if (!data || typeof data !== 'object') return;
      enqueue(async () => {
        const payload = { ...data, fromUserId: userId, fromName: await myName() };
        if (data.groupId) {
          if (await isMember(String(data.groupId))) socket.to(`group:${data.groupId}`).emit('typing', payload);
        } else if (data.toUserId && await canReach(String(data.toUserId))) {
          socket.to(`user:${data.toUserId}`).emit('typing', payload);
        }
      });
    });

    // ── WebRTC signaling (1:1 va guruh qo'ng'iroqlari) ──────────────────────
    // XAVFSIZLIK (audit): avval mijoz yuborgan payload O'ZGARISHSIZ istalgan
    // userId'ga uzatilardi — `from`/`fromName` soxtalashtirilishi va boshqa
    // firma odamiga qo'ng'iroq/push yuborilishi mumkin edi. Endi: from/fromName
    // serverdan; `to` faqat ruxsat etilgan odam (canReachUser); groupId bo'lsa
    // yuboruvchi o'sha guruh a'zosi bo'lishi shart. Payload shakli o'zgarmagan.
    // Qaytaradi: haqiqatan yuborilgan userId'lar (push uchun).
    const MAX_TARGETS = 64;
    const relay = async (event: string, data: any): Promise<string[]> => {
      if (!data || typeof data !== 'object') return [];
      if (data.groupId && !(await isMember(String(data.groupId)))) return []; // bo'sh groupId — 1:1 (avvalgidek)
      const out = { ...data, from: userId, fromName: await myName() };
      if (data.to) {
        const raw: unknown[] = Array.isArray(data.to) ? data.to : [data.to];
        const list = Array.from(new Set(raw.map(String))).slice(0, MAX_TARGETS);
        const ok = await Promise.all(list.map(canReach));
        const allowed = list.filter((_, k) => ok[k]);
        allowed.forEach((uid) => io?.to(`user:${uid}`).emit(event, out));
        return allowed;
      }
      if (data.groupId) socket.to(`group:${data.groupId}`).emit(event, out);
      return [];
    };
    const relayOn = (event: string) => socket.on(event, (data: any) => enqueue(() => relay(event, data)));
    // XATO TUZATILDI ("qo'ng'iroq qilganda qabul qiluvchida hech qanday
    // ogohlantirish/ovoz chiqmayapti"): call:offer FAQAT socket.io orqali
    // ulangan (ilova ochiq, tab faol) tomonga yetib borardi — agar
    // qabul qiluvchining ilovasi fon rejimida yoki yopiq bo'lsa (juda
    // oddiy holat), u qo'ng'iroq haqida UMUMAN bilib qolmasdi (na tovush,
    // na chiqib turuvchi bildirishnoma). Endi transactions.ts'dagi bilan
    // bir xil Web Push (sendPushToUser — bu chinakam qurilma
    // bildirishnomasi, ilova yopiq bo'lsa ham keladi) qo'shildi.
    // Push faqat ruxsat etilgan qabul qiluvchiga va (from,to) bo'yicha 60 s'da bir marta.
    socket.on('call:offer', (data: any) => enqueue(async () => {
      const allowed = await relay('call:offer', data);
      const to = typeof data?.to === 'string' ? data.to : '';
      if (!to || to === userId || !allowed.includes(to) || !shouldPushCall(userId, to)) return;
      const isVideo = data.mode === 'video';
      sendPushToUser(to, {
        title: isVideo ? "📹 Video qo'ng'iroq" : "📞 Qo'ng'iroq",
        body: `${await myName()} sizga qo'ng'iroq qilmoqda`,
        tag: 'call',
      }).catch(() => {});
    }));
    relayOn('call:answer');
    relayOn('call:ice');
    relayOn('call:end');
    relayOn('call:reject');
    relayOn('call:join');
    // Kamera/mikrofon holati (Telegram'dagi kabi plitkada avatar/ovoz belgisi uchun)
    relayOn('call:state');

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
        if (alive.length === 0) await finishVideoChat(group, true);
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
        postVideoChatEvent(group, userId, `📹 ${avc.startedByName} video chat boshladi`, { kind: 'started', by: avc.startedByName });
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
        await finishVideoChat(group);
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
      await finishVideoChat(group);
    });

    // Eski "Qo'shilish" havolasi bosilganda — hozir faolmi yoki tugaganmi (va qachon).
    socket.on('videochat:check', async (data: { groupId?: string }, ack?: (r: any) => void) => {
      if (!data?.groupId || typeof ack !== 'function') return;
      const group = await requireMembership(data.groupId);
      if (!group) return ack({ active: false, notFound: true });
      const avc = group.activeVideoChat;
      const last = group.lastVideoChat;
      ack({
        active: !!avc,
        mode: avc?.mode,
        lastEndedAt: last?.endedAt || null,
        lastDurationSec: last?.durationSec ?? null,
      });
    });

    socket.on('disconnect', () => {
      if (userId) {
        removeUserSocket(userId, socket.id);
        trackPresence(cid, userId, isDev, -1);
        broadcastPresence(cid, isDev);
      }
      // Video chatda turgan foydalanuvchining BARCHA ulanishi uzilsa (tab yopildi,
      // internet ketdi) — "arvoh" ishtirokchi bo'lib qolmasligi uchun chiqariladi.
      if (userId && !userSockets.has(userId)) {
        Group.find({ 'activeVideoChat.participantIds': userId }).then(async (gs: any[]) => {
          for (const g of gs) {
            g.activeVideoChat.participantIds = g.activeVideoChat.participantIds.filter((id: string) => id !== userId);
            if (g.activeVideoChat.participantIds.length === 0) {
              await finishVideoChat(g);
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
