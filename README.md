# QurilishERP

Qurilish kompaniyalari uchun ishlab chiqilgan korporativ boshqaruv tizimi (ERP).

## Texnologiyalar

**Backend**: Node.js 20 + Express 5 + TypeScript + MongoDB (Mongoose)  
**Frontend**: React 18 + Vite 6 + TailwindCSS v4 + i18next (uz / uz-cyrl / ru)  
**Real-time**: Socket.io  
**Auth**: Telegram OTP 4 xonali kod + JWT (7 kun) / Eskiz.uz SMS OTP  
**Deploy**: Backend → Render, Frontend → Vercel  

## Xususiyatlar

- Ko'p firma (multi-tenant): companyId asosida ma'lumotlar izolyatsiyasi
- 6 rol: `direktor`, `orinbosar`, `prorab`, `brigadir`, `ishchi`, `dasturchi`
- Real-time chat (1-1 va guruh), fayl/media yuborish
- Smeta yuklash: PDF, Excel (.xlsx/.xls), Word (.docx), CSV, TXT
- Material transferlari + tasdiqlash oqimi
- Chiqim va daromad boshqaruvi, valyuta konversiyasi (UZS/USD/EUR)
- Davomatni kuzatish (GPS tekshiruv bilan)
- QR kod generatsiya va skanerlash
- Push bildirishnomalar (Web Push VAPID)
- Offline rejim + IndexedDB kesh + fon sinxronizatsiyasi (Service Worker v4)
- Audit log (barcha muhim amallar)
- Dashboard statistikasi (real vaqt API dan)
- Ma'lumotlarni zaxiralash (JSON export)
- AI yordamchi (Groq/Gemini)

## Lokal ishga tushirish

### Talablar

- Node.js ≥ 20
- MongoDB (lokal yoki Atlas)
- Telegram bot (`@BotFather` dan token)

### O'rnatish

```bash
# Repozitoriyani klonlash
git clone <repo-url>
cd "NEW ERP"

# Backend
cd backend
cp .env.example .env        # .env ni tahrirlang, haqiqiy qiymatlarni to'ldiring
npm install
npm run dev                  # http://localhost:5000

# Frontend (boshqa terminal)
cd ../frontend
npm install
npm run dev                  # http://localhost:5173
```

### .env sozlamalari

`backend/.env.example` faylida barcha kerakli muhit o'zgaruvchilari izohlari bilan keltirilgan. Asosiy majburiy sozlamalar:

| Kalit | Tavsif |
|-------|--------|
| `MONGODB_URI` | MongoDB ulanish satri |
| `JWT_SECRET` | JWT imzolash kaliti (32+ belgi) |
| `TELEGRAM_BOT_TOKEN` | `@BotFather` dan olingan token |
| `ESKIZ_EMAIL` + `ESKIZ_PASSWORD` | Eskiz.uz SMS OTP uchun |
| `DEVELOPER_PASSWORD` | Super-admin (dasturchi) paroli |

## Testlar

```bash
cd backend
npm test           # barcha testlarni bir marta ishga tushirish
npm run test:watch # o'zgarishlarni kuzatib, qayta ishga tushirish
```

## Deploy

### Backend → Render

1. Render.com da yangi **Web Service** yarating
2. Build command: `npm install && npm run build`
3. Start command: `node dist/index.js`
4. Muhit o'zgaruvchilarini Render dashboard'idan o'rnating (`.env.example` ga qarang)

### Frontend → Vercel

1. Vercel.com da loyihani import qiling (`frontend/` papkasini root sifatida)
2. `VITE_API_BASE` = backend Render URL (`https://qurilisherp-backend.onrender.com`)
3. Deploy

## API qisqacha hujjati

| Endpoint | Tavsif |
|----------|--------|
| `POST /api/auth/login` | Telefon → OTP yuborish |
| `POST /api/auth/verify` | OTP → JWT token |
| `GET /api/users` | Kompaniya xodimlari ro'yxati |
| `GET /api/objects` | Qurilish obyektlari |
| `GET /api/transactions` | Barcha tranzaksiyalar (transfer + chiqim + daromad) |
| `POST /api/smeta` | Smeta faylini yuklash va tahlil (PDF/Excel/Word) |
| `GET /api/dashboard/stats` | Dashboard real statistikasi |
| `GET /api/admin/backup` | Kompaniya ma'lumotlarini JSON eksport (direktor/orinbosar) |
| `POST /api/errors/log` | Frontend xato hisoboti |
| `GET /api/audit-logs` | Audit log (admin) |
| `POST /api/push/subscribe` | Push bildirishnomaga obuna |

## Rollarga ruxsatlar

| Funksiya | direktor | orinbosar | prorab | brigadir | ishchi | dasturchi |
|----------|----------|-----------|--------|----------|--------|-----------|
| Barcha statistika | ✅ | ✅ | — | — | — | — |
| Foydalanuvchi qo'shish | ✅ | ✅ | ✅¹ | ✅² | — | — |
| Transfer yuborish | ✅ | ✅ | ✅ | — | — | — |
| Transfer tasdiqlash | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Chiqim yaratish | ✅ | ✅ | ✅ | — | — | — |
| Smeta yuklash | ✅ | ✅ | ✅ | — | — | — |
| Zaxira yuklab olish | ✅ | ✅ | — | — | — | — |
| Barcha firmalar | — | — | — | — | — | ✅ |

¹ Prorab faqat o'z brigadasiga ishchi qo'sha oladi  
² Brigadir faqat o'z brigadasiga ishchi qo'sha oladi

## Loyiha tuzilmasi

```
NEW ERP/
├── backend/
│   ├── src/
│   │   ├── models/          # Mongoose schemalar
│   │   ├── routes/          # Express router'lar
│   │   ├── middleware/       # auth, scope, tenantContext
│   │   ├── services/        # bot, socket, email, push, audit
│   │   ├── smeta/           # Deterministik smeta parser
│   │   └── utils/           # rateLimit, clientIp
│   ├── .env.example
│   ├── vitest.config.ts
│   └── tsconfig.json
└── frontend/
    ├── public/
    │   ├── sw.js            # Service Worker v4 (offline + push)
    │   └── manifest.json
    └── src/
        └── app/
            ├── App.tsx       # Asosiy ilova (3900+ qator)
            ├── i18n/         # Tarjimalar (uz / uz-cyrl / ru)
            └── ErrorBoundary.tsx
```
