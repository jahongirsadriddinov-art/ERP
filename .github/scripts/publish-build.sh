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

# TEKSHIRUV (owner 2026-10-30): build YASHIL tugadi, lekin serverdagi reliz
# eski qoldi — broadcast-update yozgandan keyin GET /latest ba'zan birrov
# eski qiymatni qaytaradi (bir necha soniyalik yozish-o'qish kechikishi).
# Shuning uchun BIR MARTA emas, bir necha marta (kichik kutish bilan)
# tekshiriladi — faqat haqiqatan ham yozilmagan bo'lsa QIZIL bo'ladi.
for i in 1 2 3 4 5; do
  LIVE=$(curl -s --max-time 60 "$BACKEND_URL/api/deploy/latest" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try { const j = JSON.parse(d); console.log((j['${KIND}' === 'apk' ? 'android' : '${KIND}' === 'exe' ? 'windows' : 'macos']||{}).version || j.version || ''); }
      catch(e) { console.log(''); }
    });
  ")
  echo "Urinish ${i}: serverdagi ${KIND} versiyasi: $LIVE (kutilgan: $VERSION)"
  if [ "$LIVE" = "$VERSION" ]; then
    echo "Reliz chiqdi."
    exit 0
  fi
  sleep 4
done

echo "::error::Server hali ham eski versiyani ko'rsatyapti (${KIND}) — reliz yozilmadi."
exit 1
