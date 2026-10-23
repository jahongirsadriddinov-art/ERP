// Bot xabarlari uchun premium emoji (owner 2026-10-23: "hamma gapda, hichqaysi gap qolmasin, gapga moslab qo'ysin").
//  • Emojisiz xabar — mazmuniga qarab turi aniqlanadi va boshiga shu turga mos premium emoji qo'yiladi.
//  • Eski Markdown rejimidagi xabarlar HTML'ga o'giriladi — premium emoji faqat HTML/entities bilan ishlaydi.

export interface MessageKind { key: string; emoji: string; meaning: string; re: RegExp }

// Tartib muhim: birinchi mos kelgan tur olinadi (xato/rad → muvaffaqiyat → mavzular → umumiy)
export const MESSAGE_KINDS: MessageKind[] = [
  { key: 'error', emoji: '⚠', meaning: 'error / not allowed / not found', re: /xato|xatolik|topilmadi|mumkin emas|ruxsat yo'q|ruxsat berilmagan|noto'g'ri|muvaffaqiyatsiz|ошибк|не найден|нельзя|нет доступа|неверн|не удалось/i },
  { key: 'cancel', emoji: '❌', meaning: 'cancelled / rejected / deleted', re: /bekor qilindi|rad etildi|o'chirildi|отменен|отклонен|удален/i },
  { key: 'success', emoji: '✅', meaning: 'done / saved / confirmed', re: /saqlandi|tasdiqlandi|qabul qilindi|bajarildi|qo'shildi|yuborildi|tayyor|muvaffaqiyatli|сохранен|подтвержден|принят|выполнен|добавлен|отправлен|готово|успешно/i },
  { key: 'wait', emoji: '⏳', meaning: 'please wait / pending / in progress', re: /kuting|kutilmoqda|yuklanmoqda|tayyorlanmoqda|загруж|готовлю|tekshirilmoqda|jarayonda|подождите|ожида|обрабатыва/i },
  { key: 'money', emoji: '💰', meaning: 'money: expense, income, payment, balance', re: /so'm|сум|chiqim|kirim|to'lov|pul|balans|summa|xarajat|расход|приход|оплат|баланс|сумм|деньг/i },
  { key: 'report', emoji: '📊', meaning: 'report / statistics', re: /hisobot|statistika|jami|отчёт|отчет|статистик|итого/i },
  { key: 'object', emoji: '🏗', meaning: 'construction object / site / material', re: /obyekt|qurilish|material|smeta|объект|стройк|материал|смет/i },
  { key: 'people', emoji: '👥', meaning: 'employees / workers / users', re: /xodim|ishchi|brigad|foydalanuvchi|сотрудник|рабоч|бригад|пользовател/i },
  { key: 'time', emoji: '📅', meaning: 'date / time / schedule / attendance', re: /\bsana\b|vaqt|kun\b|jadval|davomat|ishga keldi|дата|время|график|посещаем/i },
  { key: 'location', emoji: '📍', meaning: 'location / GPS', re: /joylashuv|lokatsiya|gps|manzil|геолокац|местополож|адрес/i },
  { key: 'greeting', emoji: '👋', meaning: 'greeting / welcome', re: /assalomu|salom|xush kelibsiz|привет|здравствуйте|добро пожаловать/i },
  { key: 'input', emoji: '✏', meaning: 'asks the user to type or send something', re: /kiriting|yozing|yuboring|tanlang|введите|напишите|отправьте|выберите/i },
  { key: 'notify', emoji: '🔔', meaning: 'notification / reminder / new item', re: /eslatma|yangi|bildirishnoma|напоминан|новый|новая|уведомлен/i },
  { key: 'ai', emoji: '🤖', meaning: 'AI assistant', re: /\bai\b|sun'iy intellekt|ии\b|ассистент/i },
  { key: 'info', emoji: 'ℹ', meaning: 'any other message (general info)', re: /[\s\S]/ },
];
export const MESSAGE_KIND_KEYS = new Set(MESSAGE_KINDS.map(k => k.key));

export function classifyMessage(text: string): MessageKind | null {
  const t = String(text || '').trim();
  if (t.length < 3 || t.startsWith('/')) return null;
  return MESSAGE_KINDS.find(k => k.re.test(t)) || null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Telegram eski Markdown (parse_mode "Markdown") → HTML: *qalin*, _kursiv_, `kod`, ```blok```, [matn](havola), \\ qochirish.
 * Juftsiz belgi — oddiy matn bo'lib qoladi.
 */
export function markdownToHtml(md: string): string {
  let out = '';
  let i = 0;
  const n = md.length;
  while (i < n) {
    const c = md[i];
    if (c === '\\' && i + 1 < n && '_*`['.includes(md[i + 1])) { out += esc(md[i + 1]); i += 2; continue; }
    if (md.startsWith('```', i)) {
      const end = md.indexOf('```', i + 3);
      if (end > 0) { out += `<pre>${esc(md.slice(i + 3, end).replace(/^[a-z0-9_+-]*\n/i, ''))}</pre>`; i = end + 3; continue; }
    }
    if (c === '`') {
      const end = md.indexOf('`', i + 1);
      if (end > 0) { out += `<code>${esc(md.slice(i + 1, end))}</code>`; i = end + 1; continue; }
    }
    if (c === '*' || c === '_') {
      const end = md.indexOf(c, i + 1);
      if (end > i + 1) {
        const tag = c === '*' ? 'b' : 'i';
        out += `<${tag}>${esc(md.slice(i + 1, end).replace(/\\([_*`[])/g, '$1'))}</${tag}>`; i = end + 1; continue;
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(md.slice(i));
      if (m) { out += `<a href="${esc(m[2]).replace(/"/g, '&quot;')}">${esc(m[1])}</a>`; i += m[0].length; continue; }
    }
    out += esc(c); i++;
  }
  return out;
}
