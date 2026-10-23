import AiCallSession from '../../models/AiCallSession';
import User from '../../models/User';
import type { CallFailureNotifier } from './callBridge';

// AI Telegram qo'ng'irog'i ulanmadi ("Ошибка соединения" — jiringladi/javob berildi, lekin media ulanmadi;
// worker o'zi bir marta qayta tergan) — xodimga bot orqali qisqa matnli xabar, u nima bo'lganini bilsin va
// AI bilan yozishma orqali davom eta olsin. Davomat (attendance) qo'ng'iroqlari bundan mustasno: ularning o'z
// kanal zanjiri bor (attendanceRunner — keyingi kanal), ikki marta yozilmasin.

type Send = (chatId: string, text: string) => Promise<unknown>;

export function callFailedText(lang: string | undefined, reason: string): string {
  const net = reason === 'network';
  if (lang === 'ru') {
    return `📞 AI-помощник пытался вам позвонить в Telegram, но соединение не установилось${net ? ' (ошибка связи)' : ''}.\n` +
      'Напишите сюда, что нужно, — помощник ответит здесь, или откройте приложение.';
  }
  return `📞 AI yordamchi sizga Telegram orqali qo'ng'iroq qildi, lekin ulanish o'rnatilmadi${net ? ' (aloqa xatosi)' : ''}.\n` +
    "Kerakli narsani shu yerga yozing — yordamchi shu yerda javob beradi, yoki ilovani oching.";
}

export function makeCallFailureNotifier(send?: Send): CallFailureNotifier {
  return async ({ sessionId, employeeId }) => {
    const s: any = await AiCallSession.findById(sessionId).select('purpose answeredAt').lean().catch(() => null);
    if (!s || s.purpose === 'attendance' || s.answeredAt) return;
    if (!/^[0-9a-fA-F]{24}$/.test(String(employeeId))) return;
    const u: any = await User.findById(employeeId).select('telegramChatId language').lean().catch(() => null);
    if (!u?.telegramChatId) return;
    const text = callFailedText(u.language, 'network');
    if (send) { await send(String(u.telegramChatId), text); return; }
    const { bot } = await import('../../services/bot');
    await bot.sendMessage(String(u.telegramChatId), text);
  };
}
