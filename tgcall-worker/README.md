# tgcall-worker — AI'ning Telegram qo'ng'iroqlari

Bu kichik dastur AI yordamchiga **Telegram orqali ovozli qo'ng'iroq** qilish imkonini beradi.
U sizning kompyuteringizda (Windows) ishlaydi va faqat **chiquvchi** ulanishlar ochadi:

- backendga (Render) — `wss://.../aiv-worker` (faqat websocket);
- Telegram serverlariga — AI uchun ajratilgan Telegram akkaunti nomidan.

Uydagi router (NAT) ortida ham ishlaydi — port ochish shart emas.

> **Muhim:** bu BETA. Haqiqiy Telegram qo'ng'irog'i hali sinovdan o'tmagan — birinchi sinovni o'zingizga
> qiling (pastdagi 6-qadam). Kompyuter o'chsa yoki uxlasa, AI Telegram orqali qo'ng'iroq qila olmaydi
> (bot xabarlari va ilova ichidagi qo'ng'iroqlar ishlayveradi).

---

## Xavfsizlik — avval o'qing

| Fayl / qiymat | Nima | Kimga beriladi |
|---|---|---|
| `data/worker_ed25519.pem` | worker'ning **maxfiy** kaliti | **Hech kimga.** Faqat shu kompyuterda |
| `.env` ichidagi `TG_SESSION_KEY` | Telegram sessiyasini shifrlovchi kalit | **Hech kimga** |
| `data/session.enc` | shifrlangan Telegram sessiyasi | **Hech kimga** |
| `.env` ichidagi `TG_API_HASH` | Telegram API kaliti | **Hech kimga** |
| ekranda chiqadigan **ochiq kalit** | worker'ni tanish uchun | Render → `AIV_WORKER_PUBKEY` (sir emas) |

- `.env` va `data/` papkasi git'ga **qo'shilmaydi** (`.gitignore`).
- Telegram sessiyasi **backendga hech qachon yuborilmaydi** — u faqat shu diskda, shifrlangan holda.
- Telefon raqami, SMS kod va 2FA parol login paytida backend orqali worker'ga o'tadi, lekin hech qayerda
  saqlanmaydi va log qilinmaydi.
- **Worker'ni bir vaqtda ikki kompyuterda ishga tushirmang.** Backend "lease" bilan buni to'sadi, lekin
  bitta `data/` papkani ikki joyga nusxalash Telegram sessiyasini butunlay bekor qildirishi mumkin.

---

## Bir martalik sozlash (egasi uchun aniq qadamlar)

### 0. Kerakli narsalar
- Windows 10/11, **Python 3.12** (o'rnatilgan: 3.12.10). Yangi kompyuterda: python.org → Python 3.12 →
  o'rnatishda **"Add python.exe to PATH"** belgisini qo'ying.
- AI uchun **alohida** Telegram akkaunti (alohida SIM-karta). Shaxsiy akkauntingizni ishlatmang.
- Backend Render'da ishlab turgan bo'lishi kerak.

### 1. Telegram API kalitlari
1. Brauzerda https://my.telegram.org oching va **AI akkaunti** telefon raqami bilan kiring.
2. **API development tools** → ilova yarating (nomi ixtiyoriy, masalan `QurilishERP AI`).
3. `App api_id` (raqam) va `App api_hash` (32 belgili) ni yozib oling.

### 2. Birinchi ishga tushirish
1. Papkani oching: `NEW ERP\tgcall-worker`.
2. **`run-windows.bat`** ni ikki marta bosing.
   - Birinchi marta virtual muhit (`.venv`) yaratiladi va kutubxonalar o'rnatiladi — bir necha daqiqa.
   - `.env` bo'lmasa, u yaratiladi va Bloknotda ochiladi.
3. `.env` ni to'ldiring va saqlang:
   ```
   BACKEND_URL=https://<sizning-backend>.onrender.com
   TG_API_ID=1234567
   TG_API_HASH=0123456789abcdef0123456789abcdef
   TG_SESSION_KEY=
   ```
   - `BACKEND_URL` oxirida `/` bo'lmasin. Faqat `KALIT=qiymat` qatorlari — ```` ``` ```` belgilarini qo'shmang.
   - `TG_SESSION_KEY` ni bo'sh qoldiring — u avtomatik yaratiladi.
4. `run-windows.bat` ni qayta ishga tushiring. Oynada shunday blok chiqadi:
   ```
   ================================================================
   YANGI worker kaliti yaratildi.
   Render -> Environment -> AIV_WORKER_PUBKEY qiymati (ochiq kalit, sir emas):

     AbCd...=            <- shu qatorni nusxalang

   ================================================================
   ```
   Ochiq kalitni keyin ham ko'rish mumkin: `.venv\Scripts\python -m app.keys`.

### 3. Render sozlamalari
Render → backend xizmati → **Environment**:

| O'zgaruvchi | Qiymat |
|---|---|
| `AIV_WORKER_PUBKEY` | 2-qadamdagi ochiq kalit |
| `AI_VOICE_ENABLED` | `true` (AI butunlay o'chiq bo'lsa worker ulanmaydi) |
| `AI_TG_MAX_CONCURRENT` | `1` (standart; bitta akkaunt — bitta qo'ng'iroq) |
| `AI_TG_DAILY_CAP` | ixtiyoriy, standart `150` (platforma bo'yicha kunlik qo'ng'iroqlar) |
| `AI_TG_COMPANY_DAILY_QUOTA` | ixtiyoriy, standart `50` (bitta firma uchun kunlik) |

Saqlang — Render qayta ishga tushadi. Worker oynasida quyidagilar chiqishi kerak:
```
backendga ulandi
autentifikatsiya o'tdi
lease olindi
Telegram sessiyasi yo'q — Dasturchi panelidan kiring (telefon -> kod)
```

### 4. AI akkauntini ulash (Dasturchi paneli)
1. Saytga **dasturchi** sifatida kiring → **Dasturchi paneli → AI → Telegram akkaunt**.
2. "Worker ulangan" yashil bo'lishi kerak.
3. AI akkaunt telefon raqamini kiriting → **Kod yuborish**.
4. Telegram'ga kelgan kodni kiriting. Akkauntda 2 bosqichli parol bo'lsa — uni ham kiriting.
5. Holat **"Ulangan"** bo'ladi. Worker oynasida `Telegram ulandi` chiqadi.

### 5. UDP tekshiruvi
Panelda **UDP tekshirish** tugmasini bosing. "OK" bo'lmasa — Telegram ovozi o'tmaydi: Windows Firewall
yoki antivirus `python.exe` ga chiquvchi UDP ulanishni ruxsat qilsin.

### 6. Sinov qo'ng'irog'i (o'zingizga)
1. O'z akkauntingiz bilan ERP botida AI qo'ng'iroqlariga **rozilik** bering (bot so'raydi).
2. Bot ko'rsatgan bir martalik kodni (masalan `AI-4821`) **AI akkauntiga** Telegram'da yozing — shu bilan
   AI sizni taniydi va qo'ng'iroq qila oladi.
3. Telegram → Sozlamalar → Maxfiylik → **Qo'ng'iroqlar**: AI akkaunti sizga qo'ng'iroq qila olsin.
4. Panelda **Sinov qo'ng'irog'i** → o'zingizni tanlang → qo'ng'iroq qiling. Soatiga 5 tadan ko'p emas.

---

## Kundalik ishlatish
- Kompyuter yoqilganda `run-windows.bat` ni ishga tushiring (avtomatik uchun: `Win+R` → `shell:startup`
  → shu faylga **yorliq** qo'ying).
- Kompyuter **uyqu rejimiga o'tmasin** (Sozlamalar → Tizim → Quvvat → Uyqu: "Hech qachon").
- Oynani yopsangiz worker to'xtaydi; faol qo'ng'iroq yopiladi. Kutilmagan to'xtashda 15 s'dan keyin
  o'zi qayta ishga tushadi.
- Internet uzilsa: 20 s ichida qaytmasa worker Telegram'dan o'zi uziladi (xavfsizlik), keyin qayta ulanadi.
- Kiruvchi qo'ng'iroqlar AI akkauntiga avtomatik rad etiladi; unga yozilgan xabarlar AI'ga uzatilmaydi
  (faqat bog'lash kodlari tekshiriladi).

## Zaxira nusxa
`data\` papkasi va `.env` faylini (shifrlangan USB/xavfsiz joyga) saqlab qo'ying. Ular yo'qolsa —
yangi kalit yaratiladi: Render'dagi `AIV_WORKER_PUBKEY` ni yangilash va Telegram'ga qayta kirish kerak.

## Muammolar
| Belgi | Sabab va yechim |
|---|---|
| `.env faylida to'ldirilmagan/noto'g'ri qiymatlar: ...` | Ko'rsatilgan nomlarni `.env` da to'g'rilang |
| `backend ulanishni rad etdi: not_configured` | Render'da `AIV_WORKER_PUBKEY` yo'q yoki noto'g'ri |
| `autentifikatsiya rad etildi: bad_signature` | `AIV_WORKER_PUBKEY` boshqa kalitga tegishli — 2-qadamdagi kalitni qayta qo'ying |
| `backendga ulanib bo'lmadi` | `BACKEND_URL` noto'g'ri, `AI_VOICE_ENABLED` o'chiq yoki Render uxlab yotibdi (bepul tarifda birinchi ulanish ~1 daqiqa) |
| `lease boshqa worker'da` | Boshqa kompyuterda ham worker ishlayapti — uni yoping; bo'lmasa ~40 s kuting |
| `sessiya fayli shu TG_SESSION_KEY bilan ochilmadi` | `.env` dagi kalit o'zgargan — panel orqali qayta kiring |
| `Telegram sessiyasi bekor qilingan` | Telegram'da "Faol seanslar"dan o'chirilgan — panel orqali qayta kiring |
| Panelda `flood_wait` | Telegram vaqtincha cheklagan — ko'rsatilgan vaqt o'tguncha kuting |

## Testlar
```
.venv\Scripts\python -m pytest
```
Jonli qo'ng'iroq testi standart holatda **o'tkazilmaydi** (NOT RUN). Uni faqat egasi, o'z telefoniga,
worker oynasini yopgandan keyin ishlatadi — `tests\test_live_call.py` boshidagi izohga qarang.

## Keyinchalik serverda
`Dockerfile` (python:3.12-slim-bookworm) va `railway.json` (1 nusxa, deploy overlap 0) tayyor.
Serverda `.env` o'rniga muhit o'zgaruvchilari, `data/` o'rniga doimiy disk (`/data`) ishlatiladi.
Uydagi kompyuterdagi worker'ni **to'xtatmasdan** serverdagisini ishga tushirmang.
