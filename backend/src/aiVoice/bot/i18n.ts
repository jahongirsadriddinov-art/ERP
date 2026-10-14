import { transliterateDict } from '../../utils/transliterate';

// AI bot matnlari (uz manba; ru qo'lda; uz-cyrl — uz'dan avtomatik transliteratsiya, i18n/bot.ts bilan bir xil usul).
// Faqat oddiy matn (parse_mode yo'q) — foydalanuvchi/firma matni Markdown'ni buzmasin.

export type AiBotLang = 'uz' | 'uz-cyrl' | 'ru';

const uz = {
  // ── Davomat (ai:a) ──
  attAsk: "🌅 Xayrli tong! Bugun ishga kelasizmi?",
  attBtnConfirm: '✅ Ishga kelganimni tasdiqlayman',
  attBtnLate: '⏰ Kechikaman',
  attBtnDecline: '❌ Bugun kelmayman',
  attSavedConfirm: "✅ Qabul qilindi: ishga kelasiz. Kelganingizda pastdagi tugma orqali belgilang.",
  attSavedLate: "⏰ Qabul qilindi: kechikasiz. Kelganingizda pastdagi tugma orqali belgilang.",
  attSavedDecline: "Qabul qilindi: bugun kelmaysiz. Rahbaringizga xabar beriladi.",
  attCheckInHint: "Ishga kelganingizda bosing (jonli joylashuv orqali tasdiqlanadi):",
  attChosen: (p: { answer: string }) => `Javobingiz: ${p.answer}`,
  // ── Umumiy ──
  already: '✔️ Allaqachon qayd etilgan.',
  expired: "⌛ Tugma eskirgan yoki sizga tegishli emas.",
  aiOff: "AI yordamchi hozircha o'chirilgan.",
  error: "Xatolik yuz berdi. Keyinroq urinib ko'ring.",
  // ── Eslatma (ai:r) ──
  remBtnDone: '✅ Bajarildi',
  remBtnSnooze: '⏰ 10 daqiqa',
  remDone: '✅ Bajarildi deb belgilandi.',
  remSnoozed: '⏰ 10 daqiqadan keyin yana eslatiladi.',
  remTitle: (p: { text: string }) => `🔔 Eslatma: ${p.text}`,
  // ── Rozilik (ai:o) ──
  consentAsk: "🤖 AI yordamchi qo'ng'iroq qilishiga rozimisiz?\n\nAI yordamchi ertalab davomat va eslatmalar uchun sizga Telegram orqali qo'ng'iroq qilishi mumkin. Istalgan vaqtda rad etishingiz mumkin.",
  consentYes: '✅ Ha',
  consentNo: "❌ Yo'q",
  consentGranted: "✅ Rozilik qayd etildi.",
  consentBind: (p: { code: string; account: string }) =>
    `Qo'ng'iroqlar ishlashi uchun ${p.account} Telegram akkauntiga quyidagi kodni yuboring:\n\n${p.code}\n\nKod 48 soat amal qiladi.`,
  consentBindNoAccount: (p: { code: string }) =>
    `AI Telegram akkaunti hali ulanmagan. Ulanganda unga ushbu kodni yuboring:\n\n${p.code}\n\nKod 48 soat amal qiladi.`,
  consentOpenAccount: "💬 AI akkauntini ochish",
  consentDenied: "Qabul qilindi. AI yordamchi sizga qo'ng'iroq qilmaydi.",
  consentTgConflict: "Bu Telegram akkaunt boshqa xodimga bog'langan. Rahbaringizga murojaat qiling.",
  // ── Amal tasdig'i (ai:x) ──
  pendingAsk: (p: { summary: string }) => `❓ Tasdiqlaysizmi?\n${p.summary}`,
  pendingYes: '✅ Tasdiqlash',
  pendingNo: '✖️ Bekor qilish',
  pendingGone: "Amal topilmadi, muddati o'tgan yoki allaqachon ko'rib chiqilgan.",
  // ── /ai rejimi ──
  aiWelcome: "🤖 AI yordamchi rejimi. Savolingizni matn yoki ovozli xabar bilan yuboring.\nChiqish uchun pastdagi tugmani bosing.",
  aiExitBtn: '🚪 AI rejimidan chiqish',
  aiExited: "AI rejimi yakunlandi. Menyudan kerakli bo'limni tanlang.",
  aiThinking: '⏳ …',
  aiUnsupported: "Faqat matn yoki ovozli xabar yuboring.",
  aiVoiceFail: "Ovozli xabarni tushunib bo'lmadi. Matn bilan yozing.",
  aiRate: "Juda ko'p so'rov — biroz kuting.",
  aiNoAccess: "AI yordamchidan foydalanishga ruxsat yo'q.",
  aiScheduleBtn: '📅 Ish jadvali',
  // ── Ish jadvali menyusi (ai:s, /jadval) ──
  schNoAccess: "📅 Ish jadvalini faqat firma rahbari (direktor, egasi yoki ruxsat berilgan o'rinbosar) o'zgartira oladi.",
  schNoFeature: "Tarifingizda AI yordamchi yo'q yoki firma faol emas.",
  schTitle: (p: { name: string }) => `📅 Ish jadvali — ${p.name}`,
  schStart: (p: { start: string; call: string }) => `⏰ Ish boshlanishi: ${p.start} (AI so'rovi: ${p.call})`,
  schDays: (p: { days: string }) => `📆 Ish kunlari: ${p.days}`,
  schNoDays: "yo'q",
  schNeedDay: "Kamida bitta ish kuni qolishi kerak.",
  schSkip: (p: { n: number }) => `🚫 Ishlanmaydigan sanalar: ${p.n} ta`,
  schExtra: (p: { n: number }) => `➕ Qo'shimcha ish kunlari: ${p.n} ta`,
  schAi: (p: { on: boolean }) => `🤖 AI yordamchi: ${p.on ? 'yoqilgan' : "o'chirilgan"}`,
  schDirty: "✏️ Saqlanmagan o'zgarishlar bor — «Saqlash»ni bosing.",
  schBtnTime: '⏰ Ish vaqti',
  schBtnDays: '📆 Hafta kunlari',
  schBtnSkip: '🚫 Dam olish sanalari',
  schBtnExtra: "➕ Qo'shimcha ish kunlari",
  schBtnAiOn: '🤖 AI ni yoqish',
  schBtnAiOff: "🤖 AI ni o'chirish",
  schAtt: (p: { on: boolean }) => `🌅 Ertalabki davomat so'rovi: ${p.on ? 'yoqilgan' : "o'chirilgan"}`,
  schBtnAttOn: "🌅 Ertalabki so'rovni yoqish",
  schBtnAttOff: "🌅 Ertalabki so'rovni o'chirish",
  schBtnShift: (p: { name: string }) => `🔁 Smena: ${p.name}`,
  schBtnSave: '💾 Saqlash',
  schBtnClose: '✖️ Yopish',
  schBtnBack: '⬅️ Orqaga',
  schBtnCustomTime: '✏️ Boshqa vaqt',
  schBtnAddDate: "➕ Sana qo'shish",
  schPickTime: "⏰ Ish boshlanish vaqtini tanlang:",
  schPickDays: "📆 Ish kunlarini belgilang (bosib yoqing/o'chiring):",
  schSkipList: "🚫 Ishlanmaydigan sanalar (bayramlar va h.k.). O'chirish uchun ❌ ni bosing:",
  schExtraList: "➕ Odatda dam olish kuni bo'lsa ham ishlanadigan sanalar. O'chirish uchun ❌ ni bosing:",
  schEmptyList: "Ro'yxat bo'sh.",
  schAskTime: "Vaqtni HH:MM ko'rinishida yozing (masalan 07:45):",
  schAskDate: "Sanani DD.MM yoki DD.MM.YYYY ko'rinishida yozing (bir nechtasini vergul bilan):",
  schBadTime: "Noto'g'ri vaqt. HH:MM ko'rinishida yozing (masalan 07:45).",
  schTimeAfterCutoff: (p: { cutoff: string }) => `Ish boshlanishi ${p.cutoff} dan oldin bo'lishi kerak.`,
  schBadDate: (p: { input: string }) => `Noto'g'ri yoki o'tgan sana: ${p.input}. DD.MM yoki DD.MM.YYYY ko'rinishida yozing.`,
  schSaved: '✅ Ish jadvali saqlandi.',
  schNothing: "O'zgarish yo'q.",
  schConflict: "Sozlamalar boshqa joyda o'zgartirildi — menyuni qayta oching (/jadval).",
  schInvalid: (p: { errors: string }) => `Saqlanmadi: ${p.errors}`,
  schClosed: 'Menyu yopildi.',
  schExpired: 'Menyu eskirgan — /jadval buyrug\'ini qayta yuboring.',
  weekdays: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
};

type Dict = typeof uz;

const ru: Dict = {
  attAsk: '🌅 Доброе утро! Вы сегодня выйдете на работу?',
  attBtnConfirm: '✅ Подтверждаю, что приду',
  attBtnLate: '⏰ Опоздаю',
  attBtnDecline: '❌ Сегодня не приду',
  attSavedConfirm: '✅ Принято: вы придёте. Когда придёте, отметьтесь кнопкой ниже.',
  attSavedLate: '⏰ Принято: вы опоздаете. Когда придёте, отметьтесь кнопкой ниже.',
  attSavedDecline: 'Принято: сегодня вы не придёте. Руководитель будет уведомлён.',
  attCheckInHint: 'Нажмите, когда придёте на работу (подтверждается живой геолокацией):',
  attChosen: (p) => `Ваш ответ: ${p.answer}`,
  already: '✔️ Уже записано.',
  expired: '⌛ Кнопка устарела или предназначена не вам.',
  aiOff: 'AI-помощник сейчас отключён.',
  error: 'Произошла ошибка. Попробуйте позже.',
  remBtnDone: '✅ Выполнено',
  remBtnSnooze: '⏰ Через 10 минут',
  remDone: '✅ Отмечено как выполненное.',
  remSnoozed: '⏰ Напомню ещё раз через 10 минут.',
  remTitle: (p) => `🔔 Напоминание: ${p.text}`,
  consentAsk: '🤖 Вы согласны, чтобы AI-помощник вам звонил?\n\nAI-помощник может звонить вам в Telegram утром для отметки посещаемости и напоминаний. Вы можете отказаться в любое время.',
  consentYes: '✅ Да',
  consentNo: '❌ Нет',
  consentGranted: '✅ Согласие записано.',
  consentBind: (p) => `Чтобы звонки работали, отправьте этот код Telegram-аккаунту ${p.account}:\n\n${p.code}\n\nКод действует 48 часов.`,
  consentBindNoAccount: (p) => `Telegram-аккаунт AI ещё не подключён. Когда подключат, отправьте ему этот код:\n\n${p.code}\n\nКод действует 48 часов.`,
  consentOpenAccount: '💬 Открыть аккаунт AI',
  consentDenied: 'Принято. AI-помощник не будет вам звонить.',
  consentTgConflict: 'Этот Telegram-аккаунт привязан к другому сотруднику. Обратитесь к руководителю.',
  pendingAsk: (p) => `❓ Подтверждаете?\n${p.summary}`,
  pendingYes: '✅ Подтвердить',
  pendingNo: '✖️ Отменить',
  pendingGone: 'Действие не найдено, истекло или уже обработано.',
  aiWelcome: '🤖 Режим AI-помощника. Отправьте вопрос текстом или голосовым сообщением.\nЧтобы выйти, нажмите кнопку ниже.',
  aiExitBtn: '🚪 Выйти из режима AI',
  aiExited: 'Режим AI завершён. Выберите раздел в меню.',
  aiThinking: '⏳ …',
  aiUnsupported: 'Отправьте только текст или голосовое сообщение.',
  aiVoiceFail: 'Не удалось распознать голосовое сообщение. Напишите текстом.',
  aiRate: 'Слишком много запросов — подождите немного.',
  aiNoAccess: 'Нет доступа к AI-помощнику.',
  aiScheduleBtn: '📅 График работы',
  schNoAccess: '📅 График работы может менять только руководитель фирмы (директор, владелец или заместитель с разрешением).',
  schNoFeature: 'В вашем тарифе нет AI-помощника или фирма неактивна.',
  schTitle: (p) => `📅 График работы — ${p.name}`,
  schStart: (p) => `⏰ Начало работы: ${p.start} (запрос AI: ${p.call})`,
  schDays: (p) => `📆 Рабочие дни: ${p.days}`,
  schNoDays: 'нет',
  schNeedDay: 'Должен остаться хотя бы один рабочий день.',
  schSkip: (p) => `🚫 Нерабочие даты: ${p.n}`,
  schExtra: (p) => `➕ Дополнительные рабочие дни: ${p.n}`,
  schAi: (p) => `🤖 AI-помощник: ${p.on ? 'включён' : 'выключен'}`,
  schDirty: '✏️ Есть несохранённые изменения — нажмите «Сохранить».',
  schBtnTime: '⏰ Время работы',
  schBtnDays: '📆 Дни недели',
  schBtnSkip: '🚫 Нерабочие даты',
  schBtnExtra: '➕ Доп. рабочие дни',
  schBtnAiOn: '🤖 Включить AI',
  schBtnAiOff: '🤖 Выключить AI',
  schAtt: (p) => `🌅 Утренний опрос посещаемости: ${p.on ? 'включён' : 'выключен'}`,
  schBtnAttOn: '🌅 Включить утренний опрос',
  schBtnAttOff: '🌅 Выключить утренний опрос',
  schBtnShift: (p) => `🔁 Смена: ${p.name}`,
  schBtnSave: '💾 Сохранить',
  schBtnClose: '✖️ Закрыть',
  schBtnBack: '⬅️ Назад',
  schBtnCustomTime: '✏️ Другое время',
  schBtnAddDate: '➕ Добавить дату',
  schPickTime: '⏰ Выберите время начала работы:',
  schPickDays: '📆 Отметьте рабочие дни (нажмите, чтобы включить/выключить):',
  schSkipList: '🚫 Нерабочие даты (праздники и т.п.). Нажмите ❌, чтобы удалить:',
  schExtraList: '➕ Даты, когда работаем даже в обычный выходной. Нажмите ❌, чтобы удалить:',
  schEmptyList: 'Список пуст.',
  schAskTime: 'Напишите время в формате ЧЧ:ММ (например 07:45):',
  schAskDate: 'Напишите дату в формате ДД.ММ или ДД.ММ.ГГГГ (несколько — через запятую):',
  schBadTime: 'Неверное время. Формат ЧЧ:ММ (например 07:45).',
  schTimeAfterCutoff: (p) => `Начало работы должно быть раньше ${p.cutoff}.`,
  schBadDate: (p) => `Неверная или прошедшая дата: ${p.input}. Формат ДД.ММ или ДД.ММ.ГГГГ.`,
  schSaved: '✅ График работы сохранён.',
  schNothing: 'Изменений нет.',
  schConflict: 'Настройки изменены в другом месте — откройте меню заново (/jadval).',
  schInvalid: (p) => `Не сохранено: ${p.errors}`,
  schClosed: 'Меню закрыто.',
  schExpired: 'Меню устарело — отправьте /jadval ещё раз.',
  weekdays: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
};

// Parametrlar (kod "AI-4821", @akkaunt, firma nomi, sana) transliteratsiya qilinmaydi — faqat shablon matni.
function cyr(v: any): any {
  if (typeof v !== 'function') return transliterateDict(v);
  return (p?: Record<string, unknown>) => {
    const vals: string[] = [];
    const ph: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(p || {})) {
      if (typeof x === 'string') { ph[k] = `\u0001${vals.length}\u0002`; vals.push(x); } else ph[k] = x;
    }
    return String(transliterateDict(v(ph))).replace(/\u0001(\d+)\u0002/g, (_m, i) => vals[Number(i)] ?? '');
  };
}
const uzCyrl = Object.fromEntries(Object.entries(uz).map(([k, v]) => [k, cyr(v)])) as Dict;

const DICTS: Record<AiBotLang, Dict> = { uz, 'uz-cyrl': uzCyrl, ru };

/** Foydalanuvchi tilini AI bot tiliga keltiradi (noma'lum → uz). */
export function botLangOf(lang: unknown): AiBotLang {
  return lang === 'ru' || lang === 'uz-cyrl' ? lang : 'uz';
}

/** ToolCtx/ChannelCtx uchun (uz-cyrl → uz). */
export function aiLangOf(lang: unknown): 'uz' | 'ru' {
  return lang === 'ru' ? 'ru' : 'uz';
}

type Params<K extends keyof Dict> = Dict[K] extends (p: infer P) => any ? P : never;
type Out<K extends keyof Dict> = Dict[K] extends (...a: any[]) => infer R ? R : Dict[K];

export function ta<K extends keyof Dict>(lang: unknown, key: K, params?: Params<K>): Out<K> {
  const d = DICTS[botLangOf(lang)];
  const v: any = d[key] ?? uz[key];
  return (typeof v === 'function' ? v(params) : v) as Out<K>;
}

/** Erkin matnni (masalan AI javobi) foydalanuvchi yozuviga moslash: uz-cyrl → kirill. */
export function localizeFree(lang: unknown, text: string): string {
  return botLangOf(lang) === 'uz-cyrl' ? transliterateDict(text) : text;
}
