import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";

let socket: Socket | null = null;

export function connectSocket(userId: string, companyId?: string): Socket {
  if (socket) {
    if ((socket as any).io?.opts?.query?.userId === userId) return socket;
    socket.disconnect();
  }
  socket = io(API_BASE, {
    // companyId — serverda GPS kabi "broadcast" hodisalarni faqat SHU
    // firma foydalanuvchilariga yetkazish uchun (xavfsizlik: avval BUTUN
    // ulangan foydalanuvchilarga — boshqa firmalarga ham — global
    // broadcast qilinardi, GPS koordinatalari kabi maxfiy ma'lumot
    // boshqa firmaga oqib chiqishi mumkin edi).
    query: companyId ? { userId, companyId } : { userId },
    // MUHIM: "websocket" birinchi bo'lsa, socket.io boshlang'ich polling
    // handshake'ni butunlay o'tkazib yuborib, to'g'ridan-to'g'ri WS upgrade
    // so'rovi yuboradi — Render kabi proksi/load-balancer ortidagi platformalar
    // (va ular oldidagi Cloudflare) buni ba'zan yaxshi qo'llab-quvvatlamaydi,
    // ayniqsa backend hali "uyg'onayotgan" (free-tier spin-down'dan keyingi
    // birinchi so'rov) paytda — natijada "WebSocket connection ... failed"
    // ko'rinadi. "polling" birinchi bo'lsa (socket.io'ning standart va eng
    // ishonchli tartibi) — avval oddiy HTTP polling bilan ulanadi, keyin
    // imkon bo'lsa websocket'ga o'zi yangilaydi.
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    // Render bepul tarif "uxlab qolgan" xizmatni uyg'otishga 50s gacha vaqt
    // ketishi mumkinligini ochiq aytadi — standart 20s ulanish timeout'i bu
    // holatda ulanishni muddatidan oldin muvaffaqiyatsiz deb belgilab qo'yardi.
    timeout: 60000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
