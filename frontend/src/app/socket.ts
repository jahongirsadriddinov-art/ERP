import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";

let socket: Socket | null = null;

export function connectSocket(userId: string, companyId?: string): Socket {
  if (socket) {
    if ((socket as any).io?.opts?.query?.userId === userId) return socket;
    socket.disconnect();
  }
  // XAVFSIZLIK: server endi userId/companyId'ni mijoz aytgan qiymatdan EMAS,
  // shu JWT'dan (backend/services/socket.ts, "trust proxy" izohiga yaqin
  // joydagi kabi izohga qarang) o'qiydi — mijoz "men boshqa odamman" deb
  // da'vo qilolmasin. userId/companyId parametrlari shu sabab endi faqat
  // qulaylik/moslik uchun qoldirilgan (masalan qayta ulanishni aniqlashda),
  // real avtorizatsiya vazifasini bajarmaydi.
  const token = localStorage.getItem('token') || '';
  socket = io(API_BASE, {
    query: companyId ? { userId, companyId } : { userId },
    auth: { token },
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
  // XATO TUZATILDI ("qo'ng'iroq Ulanmoqda'da qolib ketadi"): chaqiruvchi offer'dan DARHOL keyin ICE
  // nomzodlarini yuboradi — qabul qiluvchida qo'ng'iroq oynasi (CallOverlay) hali ochilmagan bo'ladi va
  // ular yo'qolib ketardi. Endi har bir call:ice shu yerda 60 soniya saqlanadi, oyna ochilganda olinadi.
  socket.on('call:ice', (d: any) => {
    if (!d?.from || !d.candidate) return;
    const now = Date.now();
    earlyIce.push({ from: String(d.from), candidate: d.candidate, at: now });
    while (earlyIce.length && now - earlyIce[0].at > 60_000) earlyIce.shift();
    if (earlyIce.length > 400) earlyIce.splice(0, earlyIce.length - 400);
  });
  return socket;
}

const earlyIce: { from: string; candidate: RTCIceCandidateInit; at: number }[] = [];
/** Berilgan odamdan oxirgi 60 soniyada kelgan (hali ishlatilmagan) ICE nomzodlarini qaytaradi va o'chiradi. */
export function takeEarlyIce(from: string): RTCIceCandidateInit[] {
  const now = Date.now(), out: RTCIceCandidateInit[] = [];
  for (let i = earlyIce.length - 1; i >= 0; i--) {
    const e = earlyIce[i];
    if (e.from === from && now - e.at <= 60_000) { out.unshift(e.candidate); earlyIce.splice(i, 1); }
  }
  return out;
}
export function clearEarlyIce() { earlyIce.length = 0; }

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
