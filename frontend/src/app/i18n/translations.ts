// Sayt UI matnlari uchun 3 tilli manba. 'uz' — manba (lotin, kodning o'zidagi
// asl matn). 'uz-cyrl' shundan AVTOMATIK hosil qilinadi (index.ts'da,
// transliterateDict orqali) — qo'lda tarjima qilinmaydi. 'ru' qo'lda tarjima.
//
// Qamrov (bu bosqichda): Login ekrani, asosiy navigatsiya (header/bottom nav),
// Profil sahifasining sozlamalar ro'yxati + yangi Til bo'limi, ro'yxatdan
// o'tishning til tanlash qadami, va umumiy tugmalar. Ilovaning qolgan ichki
// sahifalari (Dashboard/Moliya/Obyektlar/Hisobotlar/Chat ichki matnlari)
// hozircha o'zbekcha qolmoqda — infratuzilma tayyor, keyingi bosqichlarda
// shu yerga kalitlar qo'shish orqali kengaytiriladi.
const uz = {
  login: {
    subtitle: "Tizimga kirish",
    botHintBefore: "Oldin Telegram botimizga kiring,",
    botHintAfter: "tugmasini bosib raqamingizni ulashing. Keyin shu yerga raqamingizni yozib kodni oling.",
    goToBot: "{{handle}} ga o'tish",
    phoneLabel: "Telefon raqamingiz",
    getCode: "Kodni olish",
    phoneInvalid: "Telefon raqamni to'g'ri kiriting",
    genericError: "Xatolik yuz berdi",
    serverError: "Server bilan ulanishda xatolik",
    subPendingTitle: "Obuna tasdiqini kutmoqda",
    subPendingDesc: "Adminningiz obunangizni hali tasdiqlamagan. Tasdiqlanganida Telegram orqali xabar olasiz.",
    subExpiredTitle: "Obuna muddati tugagan",
    subRejectedTitle: "Obuna rad etilgan",
    subBlockedDesc: "To'lovni yangilash va kirish huquqini qayta olish uchun admin bilan bog'laning.",
    contactAdmin: "{{handle}}'ga yozish",
    back: "Orqaga",
    devLoginTitle: "🛠 Dasturchi kirishi",
    passwordLabel: "Parol",
    signIn: "Kirish",
    changeNumber: "Raqamni o'zgartirish",
    codeLabel: "Telegram botga yuborilgan 4 xonali kod",
    enterSystem: "Tizimga kirish",
    resend: "Kodni qayta yuborish",
    resendCountdown: "Qayta yuborish ({{time}})",
    or: "yoki",
    newUser: "Yangi foydalanuvchimisiz? Firma ochish",
    chooseLanguage: "Tilni tanlang",
  },
  nav: {
    dashboard: "Bosh sahifa",
    finance: "Moliya",
    reports: "Hisobotlar",
    chat: "Xabarlar",
    profile: "Profil",
  },
  profile: {
    bgThemes: "Fon mavzular",
    appearanceMode: "Ko'rinish rejimi",
    colorTheme: "Rang mavzusi",
    permissions: "Ruxsatlar",
    myObjects: "Obyektlarim",
    language: "Til",
    logout: "Tizimdan chiqish",
    nameLabel: "Ism Familiya",
    phoneLabel: "Telefon raqam",
    save: "Saqlash",
    constructionCompany: "Qurilish kompaniyasi",
    languageSaved: "Til o'zgartirildi",
    languageHint: "Sayt va bot shu tilda ishlaydi",
  },
  register: {
    chooseLanguage: "Tilni tanlang",
    chooseLanguageDesc: "Sayt va bot shu tilda ishlaydi. Buni keyinchalik profildan yoki botdan istalgan vaqt o'zgartirishingiz mumkin.",
    continue: "Davom etish",
  },
  common: {
    cancel: "Bekor qilish",
    save: "Saqlash",
  },
};

export type TranslationShape = typeof uz;

const ru: TranslationShape = {
  login: {
    subtitle: "Вход в систему",
    botHintBefore: "Сначала зайдите в наш Telegram-бот, нажмите",
    botHintAfter: "и поделитесь своим номером. Затем введите номер здесь и получите код.",
    goToBot: "Перейти в {{handle}}",
    phoneLabel: "Ваш номер телефона",
    getCode: "Получить код",
    phoneInvalid: "Введите номер телефона правильно",
    genericError: "Произошла ошибка",
    serverError: "Ошибка соединения с сервером",
    subPendingTitle: "Ожидает подтверждения подписки",
    subPendingDesc: "Ваш администратор ещё не подтвердил подписку. Вы получите уведомление в Telegram, когда она будет подтверждена.",
    subExpiredTitle: "Срок подписки истёк",
    subRejectedTitle: "Подписка отклонена",
    subBlockedDesc: "Для продления оплаты и восстановления доступа свяжитесь с администратором.",
    contactAdmin: "Написать {{handle}}",
    back: "Назад",
    devLoginTitle: "🛠 Вход разработчика",
    passwordLabel: "Пароль",
    signIn: "Войти",
    changeNumber: "Изменить номер",
    codeLabel: "4-значный код, отправленный в Telegram-бот",
    enterSystem: "Войти в систему",
    resend: "Отправить код повторно",
    resendCountdown: "Отправить повторно ({{time}})",
    or: "или",
    newUser: "Вы новый пользователь? Открыть компанию",
    chooseLanguage: "Выберите язык",
  },
  nav: {
    dashboard: "Главная",
    finance: "Финансы",
    reports: "Отчёты",
    chat: "Сообщения",
    profile: "Профиль",
  },
  profile: {
    bgThemes: "Фоновые темы",
    appearanceMode: "Режим отображения",
    colorTheme: "Цветовая тема",
    permissions: "Разрешения",
    myObjects: "Мои объекты",
    language: "Язык",
    logout: "Выйти из системы",
    nameLabel: "Имя Фамилия",
    phoneLabel: "Номер телефона",
    save: "Сохранить",
    constructionCompany: "Строительная компания",
    languageSaved: "Язык изменён",
    languageHint: "Сайт и бот будут работать на этом языке",
  },
  register: {
    chooseLanguage: "Выберите язык",
    chooseLanguageDesc: "Сайт и бот будут работать на этом языке. Вы можете изменить его позже в профиле или в боте в любое время.",
    continue: "Продолжить",
  },
  common: {
    cancel: "Отмена",
    save: "Сохранить",
  },
};

export const RESOURCES = { uz, ru };
