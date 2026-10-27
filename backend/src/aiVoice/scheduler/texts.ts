import type { AiLang, ChannelButton } from '../contracts';

// Scheduler yuboradigan matnlar (uz + ru). Bot tugmalari callback_data ≤ 64 bayt:
//  ai:a:<10 belgili token>:c|l|d  (davomat), ai:r:<24 hex id>:d|s (eslatma).

const T = {
  uz: {
    attTitle: 'Ishga kelasizmi?',
    attAsk: (name: string, start: string) => `Assalomu alaykum${name ? ', ' + name : ''}! Bugun ishga kelasizmi? Ish ${start} da boshlanadi.`,
    attAfterCall: "Qo'ng'iroq uchun rahmat! Iltimos, javobingizni tugma bilan tasdiqlang.",
    attPush: (start: string) => `Bugun ishga kelishingizni tasdiqlang (ish ${start} da boshlanadi).`,
    btnConfirm: '✅ Tasdiqlayman',
    btnLate: '⏰ Kechikaman',
    btnDecline: '❌ Kelmayman',
    mgrTitle: 'Davomat',
    mgrDeclined: (n: string) => `${n} bugun ishga kelmasligini bildirdi.`,
    mgrNoAnswer: (n: string) => `${n} bugun ishga kelishini tasdiqlamadi (javob yo'q).`,
    mgrCallFailed: (n: string) => `${n} bilan bog'lanib bo'lmadi (qo'ng'iroqlar amalga oshmadi).`,
    mgrBatchNoAnswer: (names: string[]) => `Javob yo'q (${names.length}): ${names.join(', ')}`,
    mgrBatchDeclined: (names: string[]) => `Kelmasligini bildirdi (${names.length}): ${names.join(', ')}`,
    mgrBatchFailed: (names: string[]) => `Bog'lanib bo'lmadi (${names.length}): ${names.join(', ')}`,
    sumTitle: (date: string) => `Davomat yakuni — ${date}`,
    sumAbsent: (names: string) => `Kelmadi: ${names}`,
    sumDeclined: (names: string) => `Kelmasligini bildirgan: ${names}`,
    remTitle: 'Eslatma',
    btnDone: '✅ Bajarildi',
    btnSnooze: '⏰ 10 daqiqa',
  },
  ru: {
    attTitle: 'Вы выйдете на работу?',
    attAsk: (name: string, start: string) => `Здравствуйте${name ? ', ' + name : ''}! Вы сегодня выйдете на работу? Начало в ${start}.`,
    attAfterCall: 'Спасибо за звонок! Пожалуйста, подтвердите ответ кнопкой.',
    attPush: (start: string) => `Подтвердите, что выйдете сегодня на работу (начало в ${start}).`,
    btnConfirm: '✅ Подтверждаю',
    btnLate: '⏰ Опоздаю',
    btnDecline: '❌ Не приду',
    mgrTitle: 'Посещаемость',
    mgrDeclined: (n: string) => `${n} сообщил(а), что сегодня не выйдет на работу.`,
    mgrNoAnswer: (n: string) => `${n} не подтвердил(а) выход на работу (нет ответа).`,
    mgrCallFailed: (n: string) => `Не удалось связаться с ${n} (звонки не прошли).`,
    mgrBatchNoAnswer: (names: string[]) => `Нет ответа (${names.length}): ${names.join(', ')}`,
    mgrBatchDeclined: (names: string[]) => `Сообщили, что не придут (${names.length}): ${names.join(', ')}`,
    mgrBatchFailed: (names: string[]) => `Не удалось связаться (${names.length}): ${names.join(', ')}`,
    sumTitle: (date: string) => `Итог посещаемости — ${date}`,
    sumAbsent: (names: string) => `Не пришли: ${names}`,
    sumDeclined: (names: string) => `Сообщили, что не придут: ${names}`,
    remTitle: 'Напоминание',
    btnDone: '✅ Выполнено',
    btnSnooze: '⏰ 10 минут',
  },
};

export type SchedulerTexts = typeof T.uz;
export function tx(lang: AiLang | string | undefined): SchedulerTexts {
  return lang === 'ru' ? T.ru : T.uz;
}

/** Foydalanuvchi tili → AiLang (uz-cyrl → uz; 'auto'/yo'q → firma tili yoki uz). */
export function pickLang(...cands: (string | null | undefined)[]): AiLang {
  for (const c of cands) {
    if (c === 'ru') return 'ru';
    if (c === 'uz' || c === 'uz-cyrl') return 'uz';
  }
  return 'uz';
}

export function attendanceButtons(lang: AiLang, token: string): ChannelButton[][] {
  const t = tx(lang);
  return [[
    { text: t.btnConfirm, data: `ai:a:${token}:c` },
    { text: t.btnLate, data: `ai:a:${token}:l` },
    { text: t.btnDecline, data: `ai:a:${token}:d` },
  ]];
}

export function reminderButtons(lang: AiLang, reminderId: string): ChannelButton[][] {
  const t = tx(lang);
  return [[
    { text: t.btnDone, data: `ai:r:${reminderId}:d` },
    { text: t.btnSnooze, data: `ai:r:${reminderId}:s` },
  ]];
}
