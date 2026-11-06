#!/usr/bin/env bash
# Bitta qurilma turining (apk/exe/dmg) faylini backend'ga yuklaydi, reliz
# sifatida e'lon qiladi (broadcast-update) va bot xabari ketganini
# tasdiqlaydi. android-build.yml'dagi broadcast-android/broadcast-windows
# ishlarida ishlatiladi — har biri FAQAT o'z qurilma turi uchun, bittasi
# muvaffaqiyatsiz bo'lsa ikkinchisiga tegmaydi.
#
# Kerakli env: DEPLOY_SECRET, BACKEND_URL, VERSION_INPUT, NOTES, KIND (apk|exe|dmg), FIELD (apkUrl|exeUrl|dmgUrl)
# Argument: $1 = yuklanadigan fayl yo'li
set -e

FILE_PATH="$1"

if [ -z "$DEPLOY_SECRET" ]; then
  echo "::warning::DEPLOY_BROADCAST_SECRET o'rnatilmagan (Settings > Secrets and variables > Actions) — build tayyor, lekin bildirishnoma YUBORILMAYDI."
  exit 0
fi

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  echo "::error::${KIND} fayli topilmadi — yuklanmadi."
  exit 1
fi

VERSION="$VERSION_INPUT"
if [ -z "$VERSION" ]; then
  VERSION="$(date -u +%Y.%m.%d)-${GITHUB_SHA::7}"
fi

# MUHIM: avval "curl -sf" ishlatilardi — xato holatida JIM (hech qanday
# sabab ko'rsatmasdan) muvaffaqiyatsiz bo'lardi. Endi status va javob
# tanasi ANIQ log'ga yoziladi.
resp=$(curl -s --max-time 120 -w '\n%{http_code}' -X POST "$BACKEND_URL/api/deploy/upload-artifact" \
  -H "X-Deploy-Secret: $DEPLOY_SECRET" \
  -F "file=@${FILE_PATH}" -F "kind=${KIND}")
status=$(echo "$resp" | tail -n1)
body=$(echo "$resp" | sed '$d')
if [ "$status" != "200" ]; then
  echo "::error::${KIND} yuklash muvaffaqiyatsiz (HTTP ${status}): ${body}"
  exit 1
fi
URL=$(echo "$body" | node -e "
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(d).url || ''); }
    catch (e) { console.error('JSON tahlil xatosi:', e.message, '| tana:', d); }
  });
")
echo "${KIND}: $URL"
if [ -z "$URL" ]; then
  echo "::error::${KIND} yuklandi, lekin URL qaytmadi — broadcast o'tkazib yuborildi."
  exit 1
fi

BODY=$(jq -n --arg version "$VERSION" --arg url "$URL" --arg field "$FIELD" --arg notes "$NOTES" \
  '{version: $version, notes: $notes} | .[$field] = $url')
RESULT=$(curl -sf -X POST "$BACKEND_URL/api/deploy/broadcast-update" \
  -H "X-Deploy-Secret: $DEPLOY_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY")
echo "Broadcast natijasi: $RESULT"

# Owner 2026-11-06: BU YERDA /api/deploy/latest'ni tekshirish NOTO'G'RI edi —
# routes/deploy.ts'dagi /broadcast-update ATAYLAB AppRelease('latest')ni
# YANGILAMAYDI (owner 2026-10-28, aniq talab: "yangi versiya chiqasa yuborma
# botga ozim yuboraman automatik yuborma faqat admin yani dasturchiga yubor
# boshqa hichkimga yuborma"). Build faqat "nomzod" (AppBuild) sifatida
# saqlanadi va FAQAT dasturchiga Telegram orqali xabar boradi — hammaga
# chiqarish qarori dasturchi panelidagi "Chiqarish" tugmasi bilan QO'LDA
# qilinadi (routes/appBuilds.ts). Shu sabab bu yerda "reliz chiqdimi"
# tekshiruvi HAR DOIM muvaffaqiyatsiz bo'lardi — buning o'rniga yuqoridagi
# broadcast-update javobi (`curl -sf`, xato bo'lsa `set -e` bilan to'xtaydi)
# yetarli: CI vazifasi shu yergacha — qolgani dasturchining qo'lida.
