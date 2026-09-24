// Metered.ca TURN xizmati — video/ovozli qo'ng'iroqda "qora ekran/ovoz
// kelmaydi" muammosining sababi bo'lgan bepul, ishonchsiz TURN relay'ni
// (openrelay.metered.ca, CallOverlay.tsx'ga qarang) almashtiradi.
//
// MUHIM (Metered hujjatiga ko'ra): yangi yaratilgan credential GLOBAL TURN
// tarmog'ida tarqalishi uchun 2 daqiqagacha vaqt ketishi mumkin — shu sabab
// qo'ng'iroq BOSHLANAYOTGAN paytda yangi credential so'ralmaydi. Buning
// o'rniga OLDINDAN, davriy tarzda (har 12 soatda, 24 soatlik amal qilish
// muddati bilan) yangi credential olinib xotirada keshlanadi; so'rovlar
// doim shu (allaqachon tarqalgan, ishlaydigan) keshdan xizmat qiladi.
const APP_NAME = process.env.METERED_APP_NAME;
const SECRET_KEY = process.env.METERED_SECRET_KEY;
const configured = !!(APP_NAME && SECRET_KEY);

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60; // 24 soat
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // muddati tugashidan 12 soat oldin yangilanadi

type IceServer = { urls: string | string[]; username?: string; credential?: string };

let cachedIceServers: IceServer[] | null = null;
let cachedUsername: string | null = null;
let refreshPromise: Promise<void> | null = null;

function baseUrl() {
  return `https://${APP_NAME}.metered.live/api/v1/turn`;
}

async function mintAndCache(): Promise<void> {
  if (!configured) return;
  const createRes = await fetch(`${baseUrl()}/credential?secretKey=${encodeURIComponent(SECRET_KEY!)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expiryInSeconds: CREDENTIAL_TTL_SECONDS,
      label: `qurilisherp-${new Date().toISOString().slice(0, 10)}`,
    }),
  });
  if (!createRes.ok) throw new Error(`Metered credential yaratish muvaffaqiyatsiz: ${createRes.status}`);
  const cred = await createRes.json() as { username: string; password: string; apiKey: string };

  const listRes = await fetch(`${baseUrl()}/credentials?apiKey=${encodeURIComponent(cred.apiKey)}`);
  if (!listRes.ok) throw new Error(`Metered ICE server ro'yxatini olish muvaffaqiyatsiz: ${listRes.status}`);
  const iceServers = await listRes.json() as IceServer[];

  cachedIceServers = iceServers;
  cachedUsername = cred.username;
  console.log('[meteredTurn] Yangi TURN credential keshlandi:', cred.username);
}

export function isMeteredConfigured(): boolean {
  return configured;
}

// Frontend uchun tayyor ICE server ro'yxati. Sozlanmagan bo'lsa yoki
// so'rov muvaffaqiyatsiz bo'lsa `null` qaytaradi — chaqiruvchi (frontend)
// bunday holda eski (statik, bepul) TURN konfiguratsiyasiga qaytishi kerak.
export async function getIceServers(): Promise<IceServer[] | null> {
  if (!configured) return null;
  if (!cachedIceServers) {
    if (!refreshPromise) {
      refreshPromise = mintAndCache().finally(() => { refreshPromise = null; });
    }
    try { await refreshPromise; } catch (err) { console.error('[meteredTurn]', err); return null; }
  }
  return cachedIceServers;
}

// Joriy credential qancha trafik (GB) sarflaganini ko'rsatadi — admin
// panelda "TURN sarfi" kabi kuzatuv uchun.
export async function getTurnUsageGB(): Promise<number | null> {
  if (!configured || !cachedUsername) return null;
  try {
    const res = await fetch(`${baseUrl()}/current_usage_for_user?secretKey=${encodeURIComponent(SECRET_KEY!)}&username=${encodeURIComponent(cachedUsername)}`);
    if (!res.ok) return null;
    const data = await res.json() as { usageInGB: number };
    return data.usageInGB;
  } catch (err) {
    console.error('[meteredTurn] usage', err);
    return null;
  }
}

// Server ishga tushganda + har 12 soatda bir marta chaqiriladi (index.ts).
export function startMeteredTurnRefreshLoop(): void {
  if (!configured) {
    console.log('[meteredTurn] METERED_APP_NAME/METERED_SECRET_KEY sozlanmagan — eski bepul TURN ishlatiladi.');
    return;
  }
  mintAndCache().catch(err => console.error("[meteredTurn] boshlang'ich credential olishda xato:", err));
  setInterval(() => {
    mintAndCache().catch(err => console.error('[meteredTurn] credential yangilashda xato:', err));
  }, REFRESH_INTERVAL_MS);
}
