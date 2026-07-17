# QurilishERP — Deploy qo'llanmasi

## ⚠️ Muhim: arxitektura

| Qism | Texnologiya | Qayerga |
|------|-------------|---------|
| **Frontend** | React + Vite (statik) | **Vercel** ✅ |
| **Backend** | Express + **Telegram bot (long-polling)** + **Socket.io** | **Render / Railway** (Vercel EMAS ❌) |
| **Ma'lumotlar bazasi** | MongoDB | **MongoDB Atlas** (bulut) |

**Nega backend Vercel'da emas?** Vercel *serverless* — funksiyalar qisqa muddat ishlaydi, doimiy jarayon yo'q.
Bizning bot Telegram'ni **doimiy so'rab turadi (polling)** va Socket.io **doimiy WebSocket** ushlab turadi.
Bularга doimiy ishlaydigan server kerak — **Render** (bepul reja bor) buni qo'llaydi.

---

## 0. Sirlaringizni himoya qiling (BAJARILDI)
`.gitignore` yaratildi — `.env` (bot token, JWT secret, Gemini kalitlar, dasturchi paroli) **commit qilinmaydi**.
Push qilishdan oldin tekshiring: `git status` da `.env` **ko'rinmasligi** kerak.

---

## 1. MongoDB Atlas (ma'lumotlar bazasi)
1. https://www.mongodb.com/atlas → ro'yxatdan o'ting → **bepul M0 cluster** yarating.
2. **Database Access** → yangi user (login/parol) yarating.
3. **Network Access** → `0.0.0.0/0` qo'shing (hamma joydan ulanish; keyin cheklash mumkin).
4. **Connect → Drivers** → ulanish satrini oling:
   `mongodb+srv://<user>:<parol>@cluster0.xxxx.mongodb.net/erp_firma?retryWrites=true&w=majority`
   (oxiriga `/erp_firma` — baza nomi — qo'shing).
5. **Mavjud lokal ma'lumotni ko'chirish** (ixtiyoriy):
   ```
   mongodump --uri="mongodb://127.0.0.1:27017/erp_firma" --out=./dump
   mongorestore --uri="<ATLAS_URI>" ./dump/erp_firma --nsFrom="erp_firma.*" --nsTo="erp_firma.*"
   ```

---

## 2. GitHub'ga push
> Interaktiv login uchun terminalда `! ` bilan yozing (masalan `! gh auth login`).

```
cd "C:/Users/jahon/Documents/NEW ERP"
git init
git add .
git status                     # .env KO'RINMASLIGINI tekshiring!
git commit -m "QurilishERP v1.2 — multi-tenant"
gh auth login                  # yoki GitHub'da qo'lda repo yarating
gh repo create qurilisherp --private --source=. --push
```
Repo **private** bo'lsin (biznes kodi). Push tugagach GitHub'da tekshiring — `.env` bo'lmasligi kerak.

---

## 3. Backend → Render
1. https://render.com → GitHub bilan kiring.
2. **New → Blueprint** → repo'ni tanlang (`render.yaml` avtomatik o'qiladi).
   yoki **New → Web Service** → qo'lda: Root Directory=`backend`,
   Build=`npm install --include=dev && npm run build`, Start=`npm run start:prod`.
3. **Environment** bo'limida qiymatlarni kiriting:
   - `MONGODB_URI` = Atlas satri (1-qadam)
   - `TELEGRAM_BOT_TOKEN` = @BotFather tokeni
   - `GEMINI_API_KEY`, `GEMINI_API_KEYS`
   - `SITE_URL` = (hozircha bo'sh qoldiring, 4-qadamдан keyin Vercel URL qo'yasiz)
   - `DEVELOPER_PHONE` = `+998770160054`
   - `DEVELOPER_PASSWORD` = `1212` (yoki kuchliroq)
   - `JWT_SECRET` = Render o'zi yaratadi
4. Deploy tugagach backend URL'ini oling: `https://qurilisherp-backend.onrender.com`

> ⚠️ **Bepul Render eslatmalari:** (a) 15 daq faoliyatsizlikdан keyin "uxlaydi" (birinchi so'rov sekin). (b) Yuklangan fayllar (chat media, logo) **vaqtinchalik** — redeploy'da o'chadi; doimiy saqlash uchun keyinroq Cloudinary/S3 ulash kerak.

---

## 4. Frontend → Vercel
1. https://vercel.com → GitHub bilan kiring → **Add New → Project** → repo'ni tanlang.
2. **Root Directory** = `frontend` (muhim!). Framework: Vite (avtomatik).
3. **Environment Variables**:
   - `VITE_API_URL` = Render backend URL (3-qadam), masalan `https://qurilisherp-backend.onrender.com`
4. **Deploy**. Tugagach frontend URL'ini oling: `https://qurilisherp.vercel.app`

---

## 5. Bog'lash (oxirgi qadam)
1. **Render** → backend → Environment → `SITE_URL` = Vercel URL (`https://qurilisherp.vercel.app`) → saqlang (backend qayta deploy bo'ladi).
   - Bu bilan bot "Saytga o'tish" tugmasi (https) to'g'ri ishlaydi.
2. **@BotFather** → `/setdomain` (yoki bot sozlamalari) → Vercel domenini qo'shing (web_app tugmalari uchun).
3. Tayyor! `https://qurilisherp.vercel.app` ga kiring, ro'yxatdan o'ting yoki dasturchi (`+998770160054` / `1212`) bilan test qiling.

---

## Konsol xatolari haqida
- `:5000/api/auth/send-code 404` — frontend backendni topa olmadi. Lokalда: backend ishlamayotgan bo'lsa `cd backend && npm run dev`. Deploy'дан keyin: Vercel'да `VITE_API_URL` to'g'ri (Render URL) ekanini tekshiring.
- `AbortError: play() interrupted by pause()` — zararsiz (qo'ng'iroq/media audio elementi). E'tibor bermang.
