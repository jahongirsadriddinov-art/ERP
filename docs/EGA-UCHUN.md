# Ega uchun: nimalarni o'zingiz qilasiz

Yangilangan: 2026-10-27

Bu yerda **faqat men qila olmaydigan** ishlar — ro'yxatdan o'tish, kalit olish, tasdiqlash, to'lov.
Kodga tegishli hamma narsa tayyor va ishlayapti.

> **Qoida:** kalit, parol va kodlarni hech qachon chatga yozmang. Ularni faqat tegishli saytning
> o'z sahifasiga (Render, Cloudflare, Google, Meta) kiriting.

---

## 1. Hozir shart (tizim ishlashi uchun)

### 1.1 Cloudflare — domen va hosting ✅ BAJARILDI (2026-10-27)

Sayt endi Cloudflare'da (Workers Assets), backend esa avvalgidek Render'da.

- Worker nomi: `qurilish-erp`, sozlamasi: `frontend/wrangler.jsonc`
- Domenlar: `erp-firma.uz`, `www.erp-firma.uz`, `cf.erp-firma.uz` (sinov) — hammasi ishlayapti
- Vercel'ning DNS yozuvlari o'chirildi; CAA, SPF, DMARC, DKIM joyida qoldi
- Xavfsizlik sarlavhalari va kesh qoidalari: `frontend/public/_headers`
- `/qollanma/` statik sayt sifatida beriladi, qolgan yo'llar SPA'ga tushadi
- `.well-known/security.txt` qo'shildi

**Qo'lda chiqarish:** `cd frontend && npx wrangler deploy` (avval `npm run build`).

**Avtomatik chiqarish:** Cloudflare Builds yoqilgan (2026-10-27) — repo Worker'ga ulangan,
har push'da `cd frontend && npm ci && npm run build` → `cd frontend && npx wrangler deploy` bajariladi.
GitHub Actions varianti o'chirildi (bitta push ikki marta chiqmasligi uchun).

**Qolgan 2 ta xavfsizlik tavsiyasi (dashboard'dan, 2 bosish):** Security → Settings → **Bot Fight Mode**;
xohlasangiz **AI Labyrinth**.

### 1.2 Cloudflare R2 — zaxira nusxalar uchun ✅ BAJARILDI (2026-10-27)

Bucket `qurilisherp-backups`, Account API token (Object Read & Write), Render'da 4 ta o'zgaruvchi qo'yilgan.
Birinchi zaxira muvaffaqiyatli yuklandi. Quyidagi qadamlar — tarix uchun.

1. Cloudflare → *R2* → *Create bucket* → nomi: `qurilisherp-backups`.
2. *Manage R2 API Tokens* → *Create API token* → ruxsat: **Object Read & Write** → yarating.
3. Render → `qurilisherp-backend` → *Environment* ga 4 ta qiymat qo'shing:
   - `BACKUP_S3_ENDPOINT` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `BACKUP_S3_BUCKET` = `qurilisherp-backups`
   - `BACKUP_S3_ACCESS_KEY_ID` = (tokendagi Access Key ID)
   - `BACKUP_S3_SECRET_ACCESS_KEY` = (tokendagi Secret)
4. Dasturchi paneli → **Zaxira** → *Hoziroq bajarish* → yashil bo'lishini tekshiring.

Qo'ymasangiz ham zaxira ishlaydi — har kuni shifrlangan nusxa sizning Telegramingizga keladi.

### 1.3 Gemini kalitlari ✅ BAJARILDI (2026-10-27)

Hozir serverda nechta borligini bilmayman; mahalliy faylda **3 ta** turibdi va uchalasi ham ishlayapti.
Barcha 12 tasini bitta qatorga vergul bilan yozing:

- Render → *Environment* → `GEMINI_API_KEYS` = `kalit1,kalit2,...,kalit12`

Nima beradi: AI qo'ng'iroqlar, chek o'qish, ovozli chiqim, matn tahlili navbat bilan taqsimlanadi —
bitta kalit limitga urilsa, keyingisi ishlaydi (hozir limitga urilib, ovoz yozish to'xtab qolgandi).

### 1.4 Telegram bot — guruh va kanallar ✅ BAJARILDI (2026-10-27)

1. Har bir firma uchun guruh oching, botni (`@qurilish_erp_bot`) qo'shing va **admin** qiling.
2. Guruhda **direktor yoki o'rinbosar** `/ulash` deb yozsin → guruh shu firmaga bog'lanadi.
3. Shundan keyin guruhda: `/bugun` (davomat), `/obyektlar`, `/chiqim`, `/hisobot`.
4. Umumiy guruh va kanallarda botni admin qilsangiz: `/narx`, `/obhavo`, `/yangilik`, `/qollanma`, `/sayt`.

Hech qanday kalit kerak emas.

---

## 2. Keyinroq (foydali, lekin shoshilinch emas)

### 2.1 Instagram — avtomatik nashr qilish

Bu yagona narsa **Meta ruxsatisiz ishlamaydi**:

1. Instagram akkauntini **Professional (Business)** ga o'tkazing.
2. Facebook sahifa yarating va Instagram akkauntini o'sha sahifaga ulang.
3. `developers.facebook.com` → *My Apps* → *Create App* → *Business*.
4. *Instagram Graph API* mahsulotini qo'shing, *Graph API Explorer* orqali token oling
   (`instagram_basic`, `instagram_content_publish`, `pages_show_list` ruxsatlari bilan).
5. Tokenni **uzoq muddatli** (60 kunlik) qilib almashtiring.
6. Render → *Environment*:
   - `INSTAGRAM_ACCESS_TOKEN` = (uzoq muddatli token)
   - `INSTAGRAM_USER_ID` = (Instagram Business Account ID)

Tokenni men avtomatik yangilab turaman. Bu qilinmaguncha SMM bo'limi postni **tayyorlaydi**, lekin
nashrni o'zingiz qo'lda qilasiz (video/rasm va matn tayyor holda beriladi).

### 2.2 AI Telegram akkauntlari (qo'ng'iroqlar uchun)

1. `my.telegram.org` → *API development tools* → `api_id` va `api_hash` oling.
2. Railway (tgcall-worker) → *Variables*: `TG_API_ID`, `TG_API_HASH`.
3. Har bir AI akkaunt uchun **haqiqiy O'zbekiston raqami** (virtual raqam = blok).
4. Proksi: akkaunt raqami qaysi davlatniki bo'lsa, o'sha davlat mobil proksisi (Railway IP = blok sababi).

### 2.3 Claude token (kod yozadigan AI agentlar)

`CLAUDE_CODE_OAUTH_TOKEN` — sizning Claude obunangiz orqali, alohida to'lovsiz:
kompyuterda `claude setup-token` buyrug'ini bering, chiqqan tokenni Render → *Environment* ga qo'ying.

### 2.4 SMS (Eskiz) va pochta

`ESKIZ_EMAIL` / `ESKIZ_PASSWORD` allaqachon qo'yilgan. Agar SMS kelmasa — Eskiz kabinetida
balans va *sender name* (`ESKIZ_FROM`) tasdiqlanganini tekshiring.

---

## 3. Kalit kerak bo'lmaydigan narsalar (allaqachon ishlayapti)

| Narsa | Holat |
|---|---|
| Dollar kursi (Kapitalbank) | kalitsiz, har 30 daqiqada yangilanadi |
| Ob-havo (Open-Meteo) | kalitsiz |
| Yangiliklar (kun.uz / gazeta.uz) | kalitsiz |
| Xarita (OpenStreetMap / Esri) | kalitsiz |
| Qo'llanma sayti | erp-firma.uz/qollanma/ |
| Zaxira (Telegram nusxasi) | ishlayapti |
| Android APK / Windows EXE | har push'dan keyin avtomatik chiqadi |

---

## 4. Siz qiladigan operativ ishlar

- [x] Cloudflare hosting + domen (1.1)
- [x] R2 bucket + 4 ta kalit (1.2)
- [x] Gemini kalitlari `GEMINI_API_KEYS` da (1.3)
- [x] Firma guruhlari: bot admin + `/ulash` (1.4)
- [x] Xodimlarga qo'llanma yuborildi (`/qollanma_yubor`)
- [ ] Ixtiyoriy: Speed → Smart Shield, AI Labyrinth, kunlik tezlik sinovi
- [ ] Instagram uchun Meta ilovasini ochish (2.1) — xohlasangiz
- [ ] `JWT_SECRET` ni **o'zgartirmaslik** (zaxiralar shu kalit bilan shifrlangan)

---

## 5. Diqqat

- `Documents\QurilishERP-release-key` papkasini **yo'qotmang** — ilovani yangilash shu kalit bilan
  imzolanadi. Yo'qolsa, foydalanuvchilar ilovani o'chirib, qaytadan o'rnatishi kerak bo'ladi.
- Render'dagi `JWT_SECRET`, `AI_SECRETS_KEY` va `BACKUP_*` qiymatlarini o'zgartirmang.
- Telefon raqamini almashtirsangiz — yangi Telegram akkauntdan botga bir marta `/start` yozing.
