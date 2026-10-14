// AI ovozli yordamchi — sozlamalar (Profil, Dasturchi paneli). i18n/index.ts'da `aiVoice` kaliti ostida.
// P8 to'ldiradi; hozircha "tez orada" holati uchun matnlar.
export const uz = {
  soonBadge: "Tez orada",
  soonNote: "Bu bo'lim tayyorlanmoqda. Ishga tushganda shu yerda paydo bo'ladi — hozir hech narsa sozlash shart emas.",
  menu: {
    admin: "AI ovozli yordamchi",
    adminHint: "Tez orada",
    prefs: "AI qo'ng'iroqlarim",
    prefsHint: "Tez orada",
  },
  admin: {
    title: "AI ovozli yordamchi",
    subtitle: "AI har kuni ish boshlanishidan oldin xodimlarga qo'ng'iroq qilib, kelish-kelmasligini so'raydi va rahbarga xabar beradi.",
    features: {
      schedule: "Ish jadvali: boshlanish vaqti, ish kunlari, bayram va qo'shimcha ish kunlari",
      channels: "Kanallar tartibi: Telegram bot, ilova ichida qo'ng'iroq, push, rahbarga xabar",
      employees: "Xodimlar: Telegram bog'lanishi, rozilik va qo'ng'iroqdan voz kechish holati",
      tools: "Rollar bo'yicha AI imkoniyatlari va xarajat limitlari",
    },
  },
  prefs: {
    title: "AI qo'ng'iroqlarim",
    subtitle: "AI yordamchi sizga qanday murojaat qilishini o'zingiz tanlaysiz.",
    features: {
      consent: "Telegram orqali qo'ng'iroq qilishga rozilik berish yoki uni qaytarib olish",
      channels: "Qaysi kanal orqali bog'lanish: bot xabari, ilova ichida qo'ng'iroq, push",
      optOut: "Qo'ng'iroq va eslatmalardan istalgan vaqtda voz kechish",
    },
  },
  telegram: {
    tab: "AI Telegram",
    title: "AI Telegram hisobi",
    subtitle: "AI xodimlarga qo'ng'iroq qiladigan alohida Telegram hisobini ulash (telefon → kod → 2FA).",
    features: {
      login: "Kirish kodi va parol faqat serverdagi worker'ga uzatiladi, brauzerda saqlanmaydi",
      health: "Worker holati, UDP tekshiruvi va kunlik qo'ng'iroq limiti",
    },
  },
};

export const ru = {
  soonBadge: "Скоро",
  soonNote: "Раздел готовится. Он появится здесь после запуска — сейчас ничего настраивать не нужно.",
  menu: {
    admin: "AI голосовой ассистент",
    adminHint: "Скоро",
    prefs: "Мои AI-звонки",
    prefsHint: "Скоро",
  },
  admin: {
    title: "AI голосовой ассистент",
    subtitle: "Каждый день перед началом работы AI звонит сотрудникам, уточняет, придут ли они, и сообщает руководителю.",
    features: {
      schedule: "График: время начала, рабочие дни, праздники и дополнительные рабочие дни",
      channels: "Порядок каналов: Telegram-бот, звонок в приложении, push, сообщение руководителю",
      employees: "Сотрудники: привязка Telegram, согласие и отказ от звонков",
      tools: "Возможности AI по ролям и лимиты расходов",
    },
  },
  prefs: {
    title: "Мои AI-звонки",
    subtitle: "Вы сами выбираете, как AI-ассистент будет с вами связываться.",
    features: {
      consent: "Дать или отозвать согласие на звонки через Telegram",
      channels: "Канал связи: сообщение бота, звонок в приложении, push",
      optOut: "Отказаться от звонков и напоминаний в любой момент",
    },
  },
  telegram: {
    tab: "AI Telegram",
    title: "Telegram-аккаунт AI",
    subtitle: "Подключение отдельного Telegram-аккаунта, с которого AI звонит сотрудникам (телефон → код → 2FA).",
    features: {
      login: "Код входа и пароль передаются только воркеру на сервере и не сохраняются в браузере",
      health: "Состояние воркера, проверка UDP и дневной лимит звонков",
    },
  },
};
