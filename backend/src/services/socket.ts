import { Server, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';

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

  io.on('connection', (socket: Socket) => {
    const userId = String(socket.handshake.query.userId || '');
    if (userId) {
      socket.data.userId = userId;
      socket.join(`user:${userId}`);
      addUserSocket(userId, socket.id);
      broadcastPresence();
    }

    // Guruh room'lariga qo'shilish
    socket.on('join:group', (groupId: string) => { if (groupId) socket.join(`group:${groupId}`); });
    socket.on('leave:group', (groupId: string) => { if (groupId) socket.leave(`group:${groupId}`); });

    // Yozmoqda...
    socket.on('typing', (data: { toUserId?: string; groupId?: string; fromUserId: string; fromName?: string }) => {
      if (data.groupId) socket.to(`group:${data.groupId}`).emit('typing', data);
      else if (data.toUserId) socket.to(`user:${data.toUserId}`).emit('typing', data);
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
export const getIO = () => io;
export const isOnline = (userId: string) => userSockets.has(userId);
