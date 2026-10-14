import type { Socket } from 'socket.io';
import { aiConfig } from '../config';

// In-app ovozli qo'ng'iroq — asosiy "/" namespace'dagi aiv:* hodisalari (contracts.ts AIV_*).
// services/socket.ts har bir ulanishda registerAiVoiceSocket(socket) ni chaqiradi; socket.data
// (userId/companyId/role/jti) u yerda handshake'da allaqachon tekshirilgan (P0).
//
// STUB (P1): yakuniy imzolar. P5 to'ldiradi: faqat websocket transporti, kadr ≤8 KB va ≤60/s,
// juft uzunlik, socket id'ga bog'langan; userSessionsPerHour; smenadan tashqari rad etish.
// AI o'chiq bo'lsa — hech qanday tinglovchi qo'shilmaydi (mavjud socket xatti-harakati o'zgarmaydi).

export function registerAiVoiceSocket(_socket: Socket): void {
  if (!aiConfig.enabled) return;
  // P5 to'ldiradi
}

/** SIGTERM drain: shu instansiyadagi jonli in-app sessiyalarni 'interrupted' qilib yopadi (bootstrap chaqiradi). */
export async function shutdownAiVoiceSockets(_reason: 'shutdown'): Promise<void> {
  // P5 to'ldiradi
}
