// ─── Rol bo'yicha qo'llanmalar (owner 2026-10-26) ───────────────────────────────────────────────────────────
// Har bir xodim botda "/qollanma" deb yozsa — AYNAN O'Z ROLI uchun qadam-baqadam yo'riqnoma oladi.
// Rahbar (yoki dasturchi) "/qollanma_yubor" bilan butun jamoaga bir yo'la tarqatadi — har kim o'z rolidagisini oladi.
// Matnlar shu yerda yagona manba: botda ham, ilovadagi yordam bo'limida ham shu ishlatiladi.

export type GuideRole = 'direktor' | 'orinbosar' | 'prorab' | 'brigadir' | 'ishchi' | 'dasturchi';
export type GuideLang = 'uz' | 'ru';

interface Guide { title: string; intro: string; steps: string[]; tips: string[] }

const UZ: Record<GuideRole, Guide> = {
  direktor: {
    title: '👔 Direktor uchun qo‘llanma',
    intro: 'Siz firmaning barcha obyektlari, puli va xodimlarini ko‘rasiz. Kunlik ish 5 daqiqada.',
    steps: [
      '<b>Kirish:</b> erp-firma.uz saytiga yoki ilovaga telefon raqamingiz bilan kiring. Birinchi kirishda PIN-kod o‘ylab toping — keyin har safar shu so‘raladi.',
      '<b>Xodim qo‘shish:</b> «Boshqaruv» → «Xodim qo‘shish». Ism, telefon, rol va asosiy oylikni kiriting. Xodim shu raqam bilan kiradi va botga /start yozadi.',
      '<b>Obyekt ochish:</b> «Obyektlar» → «+». Nom, manzil, byudjet va <b>prorab</b>ni tanlang. Prorab faqat o‘ziga biriktirilgan obyektni ko‘radi.',
      '<b>Smeta yuklash:</b> obyekt ichida ⋯ → «Smeta yuklash». Excel (oferta), PDF yoki Word bo‘lishi mumkin — material ro‘yxati va byudjet o‘zi chiqadi.',
      '<b>Chiqimni tasdiqlash:</b> «Moliya» bo‘limida tasdiq kutayotganlar tepada turadi. Ustiga bosib «Tasdiqlash» yoki «Rad etish».',
      '<b>Hisobot:</b> «Hisobotlar» → davrni tanlang. Kirim, chiqim, foyda va obyektlar bo‘yicha taqsimot. «Excel» tugmasi bilan yuklab olasiz.',
      '<b>Oylik:</b> «Boshqaruv» → «Oylik». Davomatdan kelib chiqib hisoblanadi; bonus/ushlanma qo‘shib «To‘landi» deb belgilaysiz.',
    ],
    tips: [
      'Har qanday narx maydonida so‘m yoki dollar tanlash mumkin — kurs avtomatik qo‘llanadi.',
      'Botda ovozli xabar yuborib ham chiqim kiritish mumkin: «Bugun 3 tonna sement 12 million».',
      'Ma’lumotlar har kuni shifrlanib tashqi zaxiraga ketadi — server o‘chsa ham yo‘qolmaydi.',
    ],
  },
  orinbosar: {
    title: '🤝 O‘rinbosar uchun qo‘llanma',
    intro: 'Sizda direktor bilan deyarli bir xil huquq bor: barcha obyekt, xodim va pul harakati.',
    steps: [
      '<b>Kirish:</b> telefon raqamingiz bilan kiring, PIN-kod o‘rnating.',
      '<b>Kunlik nazorat:</b> bosh sahifada faol obyektlar, bugungi davomat va kutilayotgan o‘tkazmalar ko‘rinadi.',
      '<b>Tasdiqlash:</b> «Moliya» — prorablar kiritgan chiqimlarni tekshirib tasdiqlaysiz. Chek rasmi har bir chiqimga biriktirilgan.',
      '<b>Material o‘tkazmasi:</b> «Materiallar» → obyektdan obyektga yuborish; qabul qilgan odam botda tasdiqlaydi.',
      '<b>Xodimlar:</b> «Boshqaruv» → xodimni tahrirlash, obyektga biriktirish, oyligini o‘zgartirish.',
      '<b>Hisobot:</b> direktor bilan bir xil — davr, obyekt va tur bo‘yicha filtr, Excelga yuklash.',
    ],
    tips: [
      'Obyektga odam biriktirmasangiz, u obyektni umuman ko‘rmaydi.',
      'Tasdiqlanmagan chiqim hisobotga kirmaydi — kechiktirmang.',
    ],
  },
  prorab: {
    title: '🏗 Prorab uchun qo‘llanma',
    intro: 'Siz faqat o‘zingizga biriktirilgan obyektlarni ko‘rasiz va ularning kundalik ishini yuritasiz.',
    steps: [
      '<b>Kirish:</b> raqamingiz bilan kiring, PIN o‘rnating. Botga /start yozishni unutmang — xabarlar shu yerga keladi.',
      '<b>Davomat:</b> ertalab «Davomat» → ishchilarni belgilang. Ishchi o‘zi ham botdan «Ishni boshlash» bilan belgilanadi (GPS tekshiriladi).',
      '<b>Chiqim kiritish:</b> «Moliya» → «+». Turi (material, oylik, transport…), summa va izoh. <b>Chekni suratga oling</b> — summa va sana o‘zi o‘qiladi.',
      '<b>Material so‘rash:</b> obyekt → «Kerakli materiallar» → «+». Rahbar ko‘radi va yuboradi.',
      '<b>Material qabul qilish:</b> botga kelgan xabarda «Qabul qildim» tugmasini bosasiz — ombor hisobi avtomatik yangilanadi.',
      '<b>Ish hajmi:</b> obyekt → «Reja/Fakt» yoki «Ishbay» — qilingan ish foizini kiritasiz.',
      '<b>Surat/hisobot:</b> obyekt → «Media» — kunlik suratlarni yuklang, rahbar masofadan ko‘radi.',
    ],
    tips: [
      'Internet bo‘lmasa ham ilova ishlaydi — kiritganingiz qurilmada saqlanadi va aloqa paydo bo‘lishi bilan yuboriladi.',
      'Chiqimni botdan ovoz bilan ham kiritasiz — eng tez yo‘li.',
    ],
  },
  brigadir: {
    title: '👷 Brigadir uchun qo‘llanma',
    intro: 'Siz o‘z brigadangizning davomati, materiali va kundalik ishini yuritasiz.',
    steps: [
      '<b>Kirish:</b> raqamingiz bilan kiring, PIN o‘rnating, botga /start yozing.',
      '<b>Davomat:</b> «Davomat» → brigadangizni belgilang. Kechikkan yoki kelmaganni izohi bilan belgilang.',
      '<b>Material:</b> kelgan materialni botdagi «Qabul qildim» tugmasi bilan tasdiqlang — aks holda ombor hisobi to‘g‘ri bo‘lmaydi.',
      '<b>Chiqim:</b> kichik xarajatlarni (transport, ovqat) chek surati bilan kiriting — prorab tasdiqlaydi.',
      '<b>Ishbay:</b> «Ishbay» bo‘limida brigada bajargan hajmni kiriting — oylik shunga qarab hisoblanadi.',
    ],
    tips: [
      'Har kuni kechqurun davomatni yopish odat bo‘lsin — oylik aynan shundan hisoblanadi.',
      'Chek yo‘qolgan bo‘lsa, izohga nima uchun ketganini yozing.',
    ],
  },
  ishchi: {
    title: '🔧 Ishchi uchun qo‘llanma',
    intro: 'Sizga kerak bo‘lgani — kelganingizni belgilash va vazifalarni ko‘rish. Hammasi 3 ta tugma.',
    steps: [
      '<b>Botni ulash:</b> Telegramda botimizni oching va /start yozing. Raqamingizni yuboring.',
      '<b>Ishni boshlash:</b> obyektga kelganingizda botda «Ishni boshlash» tugmasini bosing. Joylashuv so‘raydi — ruxsat bering (obyekt hududida ekanligingiz tekshiriladi).',
      '<b>Ishni tugatish:</b> ketishdan oldin «Ishni tugatish». Ish vaqtingiz shundan hisoblanadi.',
      '<b>Material qabul qilish:</b> sizga material yuborilsa, botga xabar keladi — «Qabul qildim» tugmasini bosing.',
      '<b>Oyligingiz:</b> ilovada «Profil» → oylik va davomat tarixingiz ko‘rinadi.',
    ],
    tips: [
      'Joylashuvga ruxsat bermasangiz davomat belgilanmaydi.',
      'Telefoningiz internetsiz bo‘lsa ham tugmani bosing — aloqa paydo bo‘lgach o‘zi yuboriladi.',
    ],
  },
  dasturchi: {
    title: '🛠 Dasturchi paneli',
    intro: 'Barcha firmalar, obuna, bot dizayni, AI va zaxira sozlamalari shu panelda.',
    steps: [
      '<b>Firmalar:</b> ro‘yxat, obuna holati, to‘lovlar va bloklash.',
      '<b>Bot dizayni:</b> har bir tugma matni, emoji va rangi — o‘zgartirsangiz darhol botda ko‘rinadi.',
      '<b>AI:</b> qo‘ng‘iroqlar, agentlar va SMM sozlamalari.',
      '<b>Zaxira:</b> holat, «Hoziroq bajarish», arxivlar ro‘yxati va tiklash (avval dry-run).',
      '<b>Yangilanishlar:</b> APK/EXE versiyalari va chiqarish.',
    ],
    tips: ['JWT_SECRET ni o‘zgartirmang — eski zaxiralar ochilmay qoladi.'],
  },
};

const RU: Record<GuideRole, Guide> = {
  direktor: {
    title: '👔 Руководство для директора',
    intro: 'Вам видны все объекты, деньги и сотрудники фирмы. Ежедневная работа — 5 минут.',
    steps: [
      '<b>Вход:</b> зайдите на erp-firma.uz или в приложение по номеру телефона, задайте PIN-код.',
      '<b>Сотрудники:</b> «Управление» → «Добавить сотрудника»: имя, телефон, роль, оклад.',
      '<b>Объект:</b> «Объекты» → «+»: название, адрес, бюджет и <b>прораб</b>. Прораб видит только свой объект.',
      '<b>Смета:</b> внутри объекта ⋯ → «Загрузить смету» (Excel/оферта, PDF, Word) — материалы и бюджет подтянутся сами.',
      '<b>Подтверждение расходов:</b> раздел «Финансы», ожидающие — сверху.',
      '<b>Отчёты:</b> период, фильтры, выгрузка в Excel.',
      '<b>Зарплата:</b> «Управление» → «Зарплата»: считается по посещаемости, добавьте премию/удержание.',
    ],
    tips: ['В любом поле цены можно выбрать сум или доллар — курс применяется автоматически.', 'Расход можно внести голосовым сообщением в бот.'],
  },
  orinbosar: {
    title: '🤝 Руководство для заместителя',
    intro: 'Права почти как у директора: все объекты, сотрудники и движение денег.',
    steps: ['<b>Вход:</b> по номеру телефона, задайте PIN.', '<b>Контроль:</b> на главной — объекты, посещаемость, ожидающие передачи.', '<b>Подтверждение:</b> «Финансы» — проверяйте расходы с фото чека.', '<b>Материалы:</b> передача между объектами, получатель подтверждает в боте.', '<b>Отчёты:</b> как у директора.'],
    tips: ['Не прикрепите сотрудника к объекту — он его не увидит.'],
  },
  prorab: {
    title: '🏗 Руководство для прораба',
    intro: 'Вам видны только закреплённые за вами объекты.',
    steps: ['<b>Вход:</b> по номеру, задайте PIN, напишите боту /start.', '<b>Посещаемость:</b> утром отметьте рабочих.', '<b>Расход:</b> «Финансы» → «+», <b>сфотографируйте чек</b> — сумма и дата распознаются.', '<b>Заявка на материал:</b> объект → «Нужные материалы» → «+».', '<b>Приём материала:</b> кнопка «Принял» в боте.', '<b>Объём работ:</b> «План/Факт» или «Сдельно».'],
    tips: ['Приложение работает и без интернета — данные уйдут при появлении связи.'],
  },
  brigadir: {
    title: '👷 Руководство для бригадира',
    intro: 'Посещаемость, материалы и ежедневная работа вашей бригады.',
    steps: ['<b>Вход:</b> по номеру, PIN, /start в боте.', '<b>Посещаемость:</b> отмечайте бригаду ежедневно.', '<b>Материал:</b> подтверждайте приём кнопкой «Принял».', '<b>Расход:</b> мелкие траты с фото чека.', '<b>Сдельно:</b> вносите выполненный объём.'],
    tips: ['Зарплата считается именно по посещаемости — закрывайте день.'],
  },
  ishchi: {
    title: '🔧 Руководство для рабочего',
    intro: 'Всего три кнопки: начать работу, закончить, принять материал.',
    steps: ['<b>Бот:</b> откройте бот, нажмите /start, отправьте номер.', '<b>Начало работы:</b> на объекте нажмите «Начать работу», разрешите геолокацию.', '<b>Конец работы:</b> «Закончить работу».', '<b>Материал:</b> «Принял» в пришедшем сообщении.', '<b>Зарплата:</b> в приложении «Профиль».'],
    tips: ['Без разрешения геолокации посещаемость не отметится.'],
  },
  dasturchi: {
    title: '🛠 Панель разработчика',
    intro: 'Фирмы, подписки, дизайн бота, AI и резервные копии.',
    steps: ['<b>Фирмы:</b> список, подписка, блокировка.', '<b>Дизайн бота:</b> тексты, эмодзи, цвета кнопок.', '<b>AI:</b> звонки, агенты, SMM.', '<b>Резерв:</b> статус, «Сделать сейчас», восстановление (сначала dry-run).', '<b>Обновления:</b> версии APK/EXE.'],
    tips: ['Не меняйте JWT_SECRET — старые копии не откроются.'],
  },
};

export const guideRoleOf = (role: string | undefined): GuideRole =>
  (['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi', 'dasturchi'].includes(String(role)) ? String(role) : 'ishchi') as GuideRole;

/** Botga yuboriladigan HTML matn (Telegram parse_mode: 'HTML'). */
export function guideText(role: string | undefined, lang: GuideLang = 'uz'): string {
  const g = (lang === 'ru' ? RU : UZ)[guideRoleOf(role)];
  const numbered = g.steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n');
  const tips = g.tips.map((t) => `💡 ${t}`).join('\n');
  const help = lang === 'ru' ? 'Вопрос? Напишите боту — ответит AI-помощник.' : 'Savol bo‘lsa — shu yerga yozing, AI yordamchi javob beradi.';
  return `<b>${g.title}</b>\n\n${g.intro}\n\n${numbered}\n\n${tips}\n\n<i>${help}</i>`;
}

/** Qo'llanma mavjud rollar (tarqatish uchun). */
export const GUIDE_ROLES: GuideRole[] = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'];
