---
name: tekshir
description: QurilishERP'ning hamma qo'shilgan funksiyasini HAQIQATAN tekshiradi — kod yig'iladimi, testlar o'tadimi, jonli server va sayt ishlayaptimi, tashqi manbalar (OLX, Telegram, ob-havo) tirikmi. "tekshir", "hammasini chek qil", "ishlayaptimi", "nima buzilgan", "progres ko'rsat" degan so'rovlarda ishlatiladi. Hech narsani o'zgartirmaydi, deploy va push qilmaydi.
---

# QurilishERP — o'z-o'zini tekshiruv

Bu skill bitta narsani qiladi: **haqiqiy tekshiruvni ishga tushiradi va natijani
tushunarli hisobot qilib beradi**. Taxmin qilmaydi, "ishlayapti shekilli" demaydi.

## Qanday ishga tushiriladi

Loyiha ildizidan:

```
node scripts/selfcheck.mjs
```

Variantlar:

| Buyruq | Nima qiladi | Qancha vaqt |
|---|---|---|
| `node scripts/selfcheck.mjs` | hammasi: yig'ish + testlar + jonli + manbalar | ~3–6 daqiqa |
| `node scripts/selfcheck.mjs --quick` | yig'ish va testlarsiz, faqat jonli tekshiruv | ~10 soniya |
| `node scripts/selfcheck.mjs --local` | faqat kod va qoidalar, tarmoqqa chiqmaydi | ~2–5 daqiqa |

Boshqa manzilni tekshirish kerak bo'lsa:
`SELFCHECK_API=... SELFCHECK_SITE=... node scripts/selfcheck.mjs`

## Nimani tekshiradi

**1. Kod** — backend TypeScript xatosiz yig'iladimi; frontend `vite build` o'tadimi;
har bir yangi funksiyaning testi alohida (brigada reytingi xizmati, brigada
integratsion testi, narx indeksi, Telegram manbasi, OLX tahlilchisi, ob-havo
xavflari); frontend testlarining hammasi.

**2. Xavfsizlik va loyiha qoidalari** — bu yerda *kod matni* o'qiladi, chunki bu
qoidalar buzilganda test yiqilmasligi mumkin, lekin zarari katta bo'ladi:
- brigada ma'lumotnomasi `scoped()` bilan cheklanmagan (aks holda reyting foydasi yo'qoladi), baho yozish/tasdiqlash esa qat'iy firma doirasida;
- baho faqat tasdiqlangandan keyin reytingga qo'shiladi;
- manba havolasi majburiy va tekshiriladigan ko'rinishda;
- kelishuv summasi **serverda** hisoblanadi, klientdan olinmaydi;
- `window.confirm/alert/prompt` ishlatilmaydi (Tauri'da ishlamaydi);
- narx indeksining maxfiylik chegaralari joyida (bitta firma narxi oshkor bo'lmasin).

**3. Jonli tizim** — backend javob beradimi va bazaga ulanganmi; `/api/brigades`
va `/api/market-price` ulanganmi va token talab qiladimi (404 bo'lsa — yo'l
ulanmagan, 200 bo'lsa — himoya yo'q, ikkisi ham xato); saytdagi bundle oxirgi
funksiyalarni o'z ichiga oladimi; APK/EXE relizi joyidami.

**4. Tashqi manbalar** — OLX ro'yxati javob beradimi va narx maydoni joyidami;
`t.me/s/` sahifasi akkauntsiz o'qiladimi; ob-havo prognozi ertangi kunni beradimi.

## Natijani qanday o'qish

- `OK` — o'tdi.
- `XATO` — **bizning tomondagi** muammo, tuzatish kerak. Skript 1 kod bilan tugaydi.
- `OGOH` — tashqi sabab bo'lishi mumkin (sayt bloklagan, tarmoq). Tizim buzilmaydi,
  lekin o'sha funksiya hozir ishlamayotgan bo'lishi mumkin.
- `O'TK` — o'tkazib yuborilgan (`--quick`/`--local` tufayli).

Oxirida har bo'lim uchun progres chizig'i va "Tuzatish kerak" ro'yxati chiqadi.

## Muhim qoida

Agar biror manba (masalan OLX) bizni bloklagan bo'lsa — **brauzer niqobi ostida
o'tishga urinilmaydi**. Bu saytning bot tekshiruvini chetlab o'tish bo'ladi.
Bunday holat ogohlantirish sifatida ko'rsatiladi va shunday deb aytiladi.

## Natija bilan nima qilish kerak

1. `XATO` larni avval tuzat — har birining izohida aniq sabab bor.
2. `jonli` bo'limida "deploy kerak" chiqsa: `cd frontend && npx vite build && npx wrangler deploy`.
3. Tuzatgandan keyin shu skriptni qayta ishga tushir va natijani hisobotda ko'rsat.
4. Hisobotda **haqiqiy natijani** yoz: o'tgan tekshiruvlar soni, yiqilganlari va
   sababi. Tekshirilmagan narsani "ishlayapti" deb aytma.
