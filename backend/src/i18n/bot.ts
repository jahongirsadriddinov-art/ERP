// Bot xabarlari uchun 3 tilli lug'at. Manba — o'zbekcha (lotin), shundan:
//  - 'uz-cyrl' AVTOMATIK hosil qilinadi (transliteratsiya, tarjima emas — bir til,
//    ikki yozuv), shu fayl pastida.
//  - 'ru' qo'lda tarjima qilingan (haqiqiy boshqa til).
// Yangi kalit qo'shsangiz — faqat 'uz' va 'ru'ni to'ldiring, 'uz-cyrl' o'zi hosil bo'ladi.
import { transliterateDict } from '../utils/transliterate';

export type BotLang = 'uz' | 'uz-cyrl' | 'ru';

interface BotDict {
  kb_openSite: string;
  kb_openSiteUrl: (p: { url: string }) => string;
  kb_chat: string;
  kb_pendingApprovals: string;
  kb_financeStatus: string;
  kb_objects: string;
  kb_staffList: string;
  kb_report: string;
  kb_subscriptionStatus: string;
  kb_incomingTransfers: string;
  kb_sentTransfers: string;
  kb_incomingPayments: string;
  kb_firmsList: string;
  kb_allUsers: string;
  kb_allSubscriptions: string;
  kb_generalStats: string;
  kb_language: string;
  exitChat: string;

  startWelcomeBack: (p: { name: string }) => string;
  startWelcomeNew: string;
  sharePhoneBtn: string;
  contactMismatch: string;
  contactNotFound: string;
  contactConfirmed: (p: { name: string; role: string }) => string;
  genericError: string;
  notRegistered: string;
  chooseFromMenu: string;

  chatNoContacts: string;
  chatWhoTo: string;
  chatGroupNotFound: string;
  chatUserNotFound: string;
  chatSessionStart: (p: { name: string }) => string;
  chatSessionEnd: (p: { name: string }) => string;
  chatUnsupportedType: string;
  chatSendError: string;
  chatLoginFirst: string;

  subOnlyBoss: string;
  subNotFound: string;
  subPending: string;
  subActiveDays: (p: { days: number }) => string;
  subActive: string;
  subExpired: string;
  subRejected: string;
  subStatusMsg: (p: { status: string; end: string }) => string;
  subApprovedNotify: (p: { planLabel: string; expStr: string; siteUrl: string }) => string;
  subRejectedNotify: string;
  subApprovedShort: (p: { planLabel: string }) => string;
  subRejectedShort: string;

  transferIncoming: (p: { amount: string; unit: string; name: string }) => string;
  transferNewFull: (p: { name: string; qty: string; unit: string; sender: string; date: string }) => string;
  paymentNew: (p: { amount: string; reason: string; date: string }) => string;
  confirmBtn: string;
  acceptBtn: string;
  acceptedByMeBtn: string;
  rejectBtn: string;
  txConfirmedResult: string;
  txRejectedResult: string;
  txConfirmedEdit: (p: { label: string }) => string;
  txRejectedEdit: (p: { label: string }) => string;
  notifyConfirmedToSender: (p: { name: string; label: string }) => string;
  notifyRejectedToSender: (p: { name: string; label: string }) => string;
  simpleConfirmedNotify: (p: { label: string }) => string;
  simpleRejectedNotify: (p: { label: string }) => string;
  notFoundGeneric: string;
  alreadyProcessed: string;
  notYoursOnlyRecipient: string;

  langPrompt: string;
  langSaved: (p: { lang: string }) => string;

  devNoFirms: string;
  devFirmsHeader: string;
  devUsersHeader: string;
  devNoSubs: string;
  devSubsHeader: string;
  devStatsBody: (p: { firmCount: number; userCount: number; activeSubs: number; pendingSubs: number }) => string;

  admNoPending: string;
  admTransferLabel: (p: { materialName: string; quantity: number | string; unit: string; sender: string }) => string;
  admPaymentLabel: (p: { description: string; amount: string; date: string }) => string;
  admFinanceStatusBody: (p: { total: string; pendTotal: string; diff: string }) => string;
  admNoObjects: string;
  admObjectsHeader: string;
  admStaffHeader: string;
  admReportBody: (p: { transfersCount: number; confExp: string; pendCount: number }) => string;

  statusConfirmed: string;
  statusPending: string;
  currencySuffix: string;

  usrNoIncomingTransfers: string;
  usrIncomingTransferMsg: (p: { name: string; qty: number | string; unit: string; status: string; sender: string; date: string }) => string;
  usrNoSentTransfers: string;
  usrSentTransfersHeader: string;
  usrSentTransferRow: (p: { icon: string; name: string; qty: number | string; unit: string; date: string }) => string;
  usrNoIncomingPayments: string;
  usrIncomingPaymentMsg: (p: { amount: string; reason: string; status: string; date: string }) => string;
}

const uz: BotDict = {
  kb_openSite: '🌐 Saytga kirish',
  kb_openSiteUrl: (p: { url: string }) => `🌐 Saytga kirish: ${p.url}`,
  kb_chat: '💬 Chat',
  kb_pendingApprovals: '📋 Kutilayotgan tasdiqlar',
  kb_financeStatus: '💰 Moliyaviy holat',
  kb_objects: '🏗 Obyektlar',
  kb_staffList: "👥 Xodimlar ro'yxati",
  kb_report: '📊 Hisobot',
  kb_subscriptionStatus: '💳 Obuna holati',
  kb_incomingTransfers: '📦 Menga kelgan yukxatlar',
  kb_sentTransfers: '📤 Yuborgan yukxatlarim',
  kb_incomingPayments: "📬 Menga kelgan to'lovlar",
  kb_firmsList: "🏢 Firmalar ro'yxati",
  kb_allUsers: '👥 Barcha foydalanuvchilar',
  kb_allSubscriptions: '💳 Barcha obunalar',
  kb_generalStats: '📊 Umumiy statistika',
  kb_language: '🌐 Til / Язык',
  exitChat: '🔚 Chatni tugatish',

  startWelcomeBack: (p: { name: string }) => `✅ Xush kelibsiz, ${p.name}!\n\nSiz tizimga ulanganmiz. Quyidagi menyudan foydalaning:`,
  startWelcomeNew: '👋 Assalomu alaykum! *QurilishERP* botiga xush kelibsiz.\n\nTizimga kirish uchun telefon raqamingizni yuboring:',
  sharePhoneBtn: '📱 Telefon raqamni yuborish',
  contactMismatch: "❗ Iltimos, o'z raqamingizni yuboring.",
  contactNotFound: "❌ Raqamingiz tizimda topilmadi. Administrator bilan bog'laning.",
  contactConfirmed: (p: { name: string; role: string }) => `✅ Raqamingiz tasdiqlandi!\n\n👤 *${p.name}*\n🏷 Lavozim: ${p.role}\n\nEndi saytga qaytib, raqamingizni kiritgan holda "Kodni olish" tugmasini bosing.`,
  genericError: "⚠️ Tizimda xatolik. Keyinroq qayta urinib ko'ring.",
  notRegistered: "❗ Avval ro'yxatdan o'ting: /start",
  chooseFromMenu: 'Menyudan birini tanlang:',

  chatNoContacts: "Hozircha yozadigan kontakt yoki guruh yo'q.",
  chatWhoTo: 'Kimga yozmoqchisiz?',
  chatGroupNotFound: 'Guruh topilmadi.',
  chatUserNotFound: 'Foydalanuvchi topilmadi.',
  chatSessionStart: (p: { name: string }) => `💬 Endi *${p.name}* bilan suhbatdasiz.\nMatn, rasm, video, ovozli xabar, fayl yoki lokatsiya yuborishingiz mumkin.\n\nChiqish uchun pastdagi tugmani bosing.`,
  chatSessionEnd: (p: { name: string }) => `Chat tugatildi (${p.name}).`,
  chatUnsupportedType: "Bu turdagi xabar hali qo'llab-quvvatlanmaydi.",
  chatSendError: '⚠️ Yuborishda xatolik yuz berdi.',
  chatLoginFirst: "Avval ro'yxatdan o'ting.",

  subOnlyBoss: "Bu bo'lim faqat rahbar va o'rinbosar uchun.",
  subNotFound: "📭 Obuna ma'lumoti topilmadi.",
  subPending: '⏳ Admin tasdiqini kutmoqda',
  subActiveDays: (p: { days: number }) => `✅ Faol (${p.days} kun qoldi)`,
  subActive: '✅ Faol',
  subExpired: '🔴 Muddati tugagan',
  subRejected: '❌ Rad etilgan',
  subStatusMsg: (p: { status: string; end: string }) => `💳 <b>Obuna holati</b>\n\nHolat: ${p.status}\nTugash: <b>${p.end}</b>\n\nSavollar uchun: <a href="https://t.me/Sadriddinov_Jahongir">@Sadriddinov_Jahongir</a>`,
  subApprovedNotify: (p: { planLabel: string; expStr: string; siteUrl: string }) => `✅ <b>Tabriklaymiz!</b>\n\nSizning obunangiz tasdiqlandi!\n\n📦 Tarif: <b>${p.planLabel}</b>\n📅 Muddat: <b>${p.expStr}</b> gacha\n\nEndi tizimga kirishingiz mumkin:\n${p.siteUrl}`,
  subRejectedNotify: "❌ <b>Obuna rad etildi</b>\n\nTo'lov va savollar uchun: <a href=\"https://t.me/Sadriddinov_Jahongir\">@Sadriddinov_Jahongir</a>",
  subApprovedShort: (p: { planLabel: string }) => `✅ Obuna tasdiqlandi (${p.planLabel})`,
  subRejectedShort: '❌ Obuna rad etildi',

  transferIncoming: (p: { amount: string; unit: string; name: string }) => `📦 Sizga *${p.amount} ${p.unit} ${p.name}* yuborildi. Qabul qildingizmi?`,
  transferNewFull: (p: { name: string; qty: string; unit: string; sender: string; date: string }) => `📦 *Yangi yukxat keldi!*\n\n📌 Material: *${p.name}*\nMiqdor: *${p.qty} ${p.unit}*\nYuboruvchi: ${p.sender}\nSana: ${p.date}\n\nQabul qilasizmi?`,
  paymentNew: (p: { amount: string; reason: string; date: string }) => `💰 *Sizga to'lov yuborildi*\n\nSumma: *${p.amount}*\nSabab: ${p.reason}\nSana: ${p.date}\n\nQabul qildingizmi?`,
  confirmBtn: '✅ Tasdiqlash',
  acceptBtn: '✅ Qabul qilish',
  acceptedByMeBtn: '✅ Qabul qilganman',
  rejectBtn: '❌ Rad etish',
  txConfirmedResult: '✅ Tasdiqlandi!',
  txRejectedResult: '❌ Rad etildi!',
  txConfirmedEdit: (p: { label: string }) => `✅ *Tasdiqlandi*: ${p.label}`,
  txRejectedEdit: (p: { label: string }) => `❌ *Rad etildi*: ${p.label}`,
  notifyConfirmedToSender: (p: { name: string; label: string }) => `✅ ${p.name} sizning "${p.label}" ni qabul qildi!`,
  notifyRejectedToSender: (p: { name: string; label: string }) => `❌ ${p.name} "${p.label}" ni rad etdi.`,
  simpleConfirmedNotify: (p: { label: string }) => `✅ Tasdiqlandi: ${p.label}`,
  simpleRejectedNotify: (p: { label: string }) => `❌ Rad etildi: ${p.label}`,
  notFoundGeneric: 'Topilmadi!',
  alreadyProcessed: 'Bu allaqachon qayta ishlangan.',
  notYoursOnlyRecipient: 'Bu sizga tegishli emas — faqat qabul qiluvchi tasdiqlashi mumkin!',

  langPrompt: 'Qaysi tilda ishlashni istaysiz?\nНа каком языке вам удобнее?',
  langSaved: (p: { lang: string }) => `✅ Til o'zgartirildi: ${p.lang}`,

  devNoFirms: "Firma yo'q.",
  devFirmsHeader: '🏢 *Firmalar:*',
  devUsersHeader: '👥 *Foydalanuvchilar:*',
  devNoSubs: "Obuna yo'q.",
  devSubsHeader: '💳 *Obunalar:*',
  devStatsBody: (p: { firmCount: number; userCount: number; activeSubs: number; pendingSubs: number }) =>
    `📊 *Umumiy statistika*\n\n🏢 Firmalar: *${p.firmCount}*\n👥 Foydalanuvchilar: *${p.userCount}*\n✅ Faol obunalar: *${p.activeSubs}*\n⏳ Kutilayotgan: *${p.pendingSubs}*`,

  admNoPending: "✅ Hozircha barcha tasdiqlar tugagan. Yangi tasdiq yo'q.",
  admTransferLabel: (p: { materialName: string; quantity: number | string; unit: string; sender: string }) =>
    `📦 *Material yukxat*\n${p.materialName} — ${p.quantity} ${p.unit}\nYuboruvchi: ${p.sender}`,
  admPaymentLabel: (p: { description: string; amount: string; date: string }) =>
    `💰 *To'lov*\n${p.description}\nSumma: ${p.amount}\nSana: ${p.date}`,
  admFinanceStatusBody: (p: { total: string; pendTotal: string; diff: string }) =>
    `📊 *Moliyaviy holat*\n\n✅ Tasdiqlangan chiqimlar: *${p.total}*\n⏳ Kutilayotgan: *${p.pendTotal}*\n\nFarq: *${p.diff}*`,
  admNoObjects: "Hozircha obyekt yo'q.",
  admObjectsHeader: "🏗 *Obyektlar ro'yxati:*",
  admStaffHeader: '👥 *Xodimlar:*',
  admReportBody: (p: { transfersCount: number; confExp: string; pendCount: number }) =>
    `📊 *Umumiy hisobot*\n\n📦 Jami yukxatlar: *${p.transfersCount}*\n💰 Jami chiqimlar: *${p.confExp}*\n⏳ Kutilayotgan tasdiqlar: *${p.pendCount}*`,

  statusConfirmed: '✅ Tasdiqlangan',
  statusPending: '⏳ Kutilmoqda',
  currencySuffix: "so'm",

  usrNoIncomingTransfers: "Hozircha siz uchun yukxat yo'q.",
  usrIncomingTransferMsg: (p: { name: string; qty: number | string; unit: string; status: string; sender: string; date: string }) =>
    `📦 *${p.name}*\nMiqdor: ${p.qty} ${p.unit}\nHolat: ${p.status}\nYuboruvchi: ${p.sender}\nSana: ${p.date}`,
  usrNoSentTransfers: 'Siz hali hech narsa yubormadingiz.',
  usrSentTransfersHeader: '📤 *Yuborgan yukxatlarim:*',
  usrSentTransferRow: (p: { icon: string; name: string; qty: number | string; unit: string; date: string }) =>
    `${p.icon} *${p.name}* — ${p.qty} ${p.unit}\nSana: ${p.date}`,
  usrNoIncomingPayments: "Sizga hali to'lov yuborilmagan.",
  usrIncomingPaymentMsg: (p: { amount: string; reason: string; status: string; date: string }) =>
    `💰 *To'lov: ${p.amount}*\nSabab: ${p.reason}\nHolat: ${p.status}\nSana: ${p.date}`,
};

const ru: BotDict = {
  kb_openSite: '🌐 Открыть сайт',
  kb_openSiteUrl: (p) => `🌐 Открыть сайт: ${p.url}`,
  kb_chat: '💬 Чат',
  kb_pendingApprovals: '📋 Ожидающие подтверждения',
  kb_financeStatus: '💰 Финансовое состояние',
  kb_objects: '🏗 Объекты',
  kb_staffList: '👥 Список сотрудников',
  kb_report: '📊 Отчёт',
  kb_subscriptionStatus: '💳 Статус подписки',
  kb_incomingTransfers: '📦 Полученные накладные',
  kb_sentTransfers: '📤 Отправленные накладные',
  kb_incomingPayments: '📬 Полученные платежи',
  kb_firmsList: '🏢 Список компаний',
  kb_allUsers: '👥 Все пользователи',
  kb_allSubscriptions: '💳 Все подписки',
  kb_generalStats: '📊 Общая статистика',
  kb_language: '🌐 Til / Язык',
  exitChat: '🔚 Завершить чат',

  startWelcomeBack: (p) => `✅ Добро пожаловать, ${p.name}!\n\nВы подключены к системе. Используйте меню ниже:`,
  startWelcomeNew: '👋 Здравствуйте! Добро пожаловать в бот *QurilishERP*.\n\nЧтобы войти в систему, отправьте свой номер телефона:',
  sharePhoneBtn: '📱 Отправить номер телефона',
  contactMismatch: '❗ Пожалуйста, отправьте свой собственный номер.',
  contactNotFound: '❌ Ваш номер не найден в системе. Обратитесь к администратору.',
  contactConfirmed: (p) => `✅ Ваш номер подтверждён!\n\n👤 *${p.name}*\n🏷 Должность: ${p.role}\n\nТеперь вернитесь на сайт, введите номер и нажмите "Получить код".`,
  genericError: '⚠️ Ошибка в системе. Попробуйте позже.',
  notRegistered: '❗ Сначала зарегистрируйтесь: /start',
  chooseFromMenu: 'Выберите пункт меню:',

  chatNoContacts: 'Пока нет контактов или групп для переписки.',
  chatWhoTo: 'Кому хотите написать?',
  chatGroupNotFound: 'Группа не найдена.',
  chatUserNotFound: 'Пользователь не найден.',
  chatSessionStart: (p) => `💬 Теперь вы общаетесь с *${p.name}*.\nМожно отправлять текст, фото, видео, голосовое сообщение, файл или геолокацию.\n\nЧтобы выйти, нажмите кнопку ниже.`,
  chatSessionEnd: (p) => `Чат завершён (${p.name}).`,
  chatUnsupportedType: 'Этот тип сообщения пока не поддерживается.',
  chatSendError: '⚠️ Ошибка при отправке.',
  chatLoginFirst: 'Сначала зарегистрируйтесь.',

  subOnlyBoss: 'Этот раздел только для руководителя и заместителя.',
  subNotFound: '📭 Информация о подписке не найдена.',
  subPending: '⏳ Ожидает подтверждения администратора',
  subActiveDays: (p) => `✅ Активна (осталось ${p.days} дн.)`,
  subActive: '✅ Активна',
  subExpired: '🔴 Срок истёк',
  subRejected: '❌ Отклонена',
  subStatusMsg: (p) => `💳 <b>Статус подписки</b>\n\nСтатус: ${p.status}\nОкончание: <b>${p.end}</b>\n\nПо вопросам: <a href="https://t.me/Sadriddinov_Jahongir">@Sadriddinov_Jahongir</a>`,
  subApprovedNotify: (p) => `✅ <b>Поздравляем!</b>\n\nВаша подписка подтверждена!\n\n📦 Тариф: <b>${p.planLabel}</b>\n📅 Срок: до <b>${p.expStr}</b>\n\nТеперь вы можете войти в систему:\n${p.siteUrl}`,
  subRejectedNotify: '❌ <b>Подписка отклонена</b>\n\nПо вопросам оплаты: <a href="https://t.me/Sadriddinov_Jahongir">@Sadriddinov_Jahongir</a>',
  subApprovedShort: (p) => `✅ Подписка подтверждена (${p.planLabel})`,
  subRejectedShort: '❌ Подписка отклонена',

  transferIncoming: (p) => `📦 Вам отправлено *${p.amount} ${p.unit} ${p.name}*. Вы приняли?`,
  transferNewFull: (p) => `📦 *Новая накладная!*\n\n📌 Материал: *${p.name}*\nКоличество: *${p.qty} ${p.unit}*\nОтправитель: ${p.sender}\nДата: ${p.date}\n\nПринимаете?`,
  paymentNew: (p) => `💰 *Вам отправлен платёж*\n\nСумма: *${p.amount}*\nПричина: ${p.reason}\nДата: ${p.date}\n\nВы приняли?`,
  confirmBtn: '✅ Подтвердить',
  acceptBtn: '✅ Принять',
  acceptedByMeBtn: '✅ Я принял',
  rejectBtn: '❌ Отклонить',
  txConfirmedResult: '✅ Подтверждено!',
  txRejectedResult: '❌ Отклонено!',
  txConfirmedEdit: (p) => `✅ *Подтверждено*: ${p.label}`,
  txRejectedEdit: (p) => `❌ *Отклонено*: ${p.label}`,
  notifyConfirmedToSender: (p) => `✅ ${p.name} принял(а) "${p.label}"!`,
  notifyRejectedToSender: (p) => `❌ ${p.name} отклонил(а) "${p.label}".`,
  simpleConfirmedNotify: (p) => `✅ Подтверждено: ${p.label}`,
  simpleRejectedNotify: (p) => `❌ Отклонено: ${p.label}`,
  notFoundGeneric: 'Не найдено!',
  alreadyProcessed: 'Это уже обработано.',
  notYoursOnlyRecipient: 'Это не относится к вам — подтвердить может только получатель!',

  langPrompt: 'Qaysi tilda ishlashni istaysiz?\nНа каком языке вам удобнее?',
  langSaved: (p) => `✅ Язык изменён: ${p.lang}`,

  devNoFirms: 'Компаний нет.',
  devFirmsHeader: '🏢 *Компании:*',
  devUsersHeader: '👥 *Пользователи:*',
  devNoSubs: 'Подписок нет.',
  devSubsHeader: '💳 *Подписки:*',
  devStatsBody: (p) =>
    `📊 *Общая статистика*\n\n🏢 Компании: *${p.firmCount}*\n👥 Пользователи: *${p.userCount}*\n✅ Активные подписки: *${p.activeSubs}*\n⏳ Ожидают: *${p.pendingSubs}*`,

  admNoPending: '✅ Все подтверждения обработаны. Новых нет.',
  admTransferLabel: (p) =>
    `📦 *Накладная материала*\n${p.materialName} — ${p.quantity} ${p.unit}\nОтправитель: ${p.sender}`,
  admPaymentLabel: (p) =>
    `💰 *Платёж*\n${p.description}\nСумма: ${p.amount}\nДата: ${p.date}`,
  admFinanceStatusBody: (p) =>
    `📊 *Финансовое состояние*\n\n✅ Подтверждённые расходы: *${p.total}*\n⏳ Ожидающие: *${p.pendTotal}*\n\nРазница: *${p.diff}*`,
  admNoObjects: 'Пока нет объектов.',
  admObjectsHeader: '🏗 *Список объектов:*',
  admStaffHeader: '👥 *Сотрудники:*',
  admReportBody: (p) =>
    `📊 *Общий отчёт*\n\n📦 Всего накладных: *${p.transfersCount}*\n💰 Всего расходов: *${p.confExp}*\n⏳ Ожидающие подтверждения: *${p.pendCount}*`,

  statusConfirmed: '✅ Подтверждено',
  statusPending: '⏳ Ожидает',
  currencySuffix: 'сум',

  usrNoIncomingTransfers: 'Пока нет накладных для вас.',
  usrIncomingTransferMsg: (p) =>
    `📦 *${p.name}*\nКоличество: ${p.qty} ${p.unit}\nСтатус: ${p.status}\nОтправитель: ${p.sender}\nДата: ${p.date}`,
  usrNoSentTransfers: 'Вы ещё ничего не отправляли.',
  usrSentTransfersHeader: '📤 *Отправленные накладные:*',
  usrSentTransferRow: (p) =>
    `${p.icon} *${p.name}* — ${p.qty} ${p.unit}\nДата: ${p.date}`,
  usrNoIncomingPayments: 'Вам пока не отправлены платежи.',
  usrIncomingPaymentMsg: (p) =>
    `💰 *Платёж: ${p.amount}*\nПричина: ${p.reason}\nСтатус: ${p.status}\nДата: ${p.date}`,
};

// uz-cyrl — funksiyalarni chaqirib string natijasini kirillga o'giradigan wrapper.
// transliterateDict faqat string qiymatlarni bilvosita o'giradi, shuning uchun
// funksiyalarni "funksiyani chaqirib natijasini transliteratsiya qiladigan yangi funksiya"ga o'raymiz.
function cyrillicizeEntry(v: any): any {
  if (typeof v === 'function') {
    return (...args: any[]) => transliterateDict(v(...args));
  }
  return transliterateDict(v);
}
const uzCyrl: BotDict = Object.fromEntries(
  Object.entries(uz).map(([k, v]) => [k, cyrillicizeEntry(v)])
) as BotDict;

const DICTS: Record<BotLang, BotDict> = { uz, 'uz-cyrl': uzCyrl, ru };

export function tb<K extends keyof BotDict>(lang: BotLang | undefined, key: K, params: BotDict[K] extends (p: infer P) => any ? P : never): BotDict[K] extends (...a: any[]) => any ? ReturnType<BotDict[K]> : BotDict[K];
export function tb<K extends keyof BotDict>(lang: BotLang | undefined, key: K): BotDict[K] extends (...a: any[]) => any ? ReturnType<BotDict[K]> : BotDict[K];
export function tb(lang: BotLang | undefined, key: keyof BotDict, params?: any): any {
  const dict = DICTS[lang || 'uz'] || uz;
  const entry = dict[key] ?? uz[key];
  return typeof entry === 'function' ? (entry as any)(params) : entry;
}

export function langLabel(lang: BotLang): string {
  return lang === 'ru' ? 'Русский' : lang === 'uz-cyrl' ? 'Ўзбек (кирилл)' : "O'zbek";
}
