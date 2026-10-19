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
// METERED_APP_NAME'ga ko'pincha to'liq manzil yoziladi ("erp-firma.metered.live" yoki "https://.../") — kod
// oxiriga yana ".metered.live" qo'shib, "erp-firma.metered.live.metered.live" degan yo'q manzil hosil bo'lardi.
// Shuning uchun faqat ilova nomini ajratib olamiz.
export function normalizeMeteredAppName(raw: string | undefined): string | undefined {
  const v = (raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.metered\.live$/i, '');
  return v || undefined;
}
const APP_NAME = normalizeMeteredAppName(process.env.METERED_APP_NAME);
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

// Metered javob bermasa so'rov abadiy osilib qolmasin (qo'ng'iroq shu javobni kutadi)
const withTimeout = (ms: number): AbortSignal => { const c = new AbortController(); setTimeout(() => c.abort(), ms).unref?.(); return c.signal; };

const LABEL_PREFIX = 'qurilisherp-';
type MeteredCred = { username?: string; label?: string; createdAt?: string; created?: string; expiryAt?: string };

/** Akkauntdagi credential'lar (javob shakli: massiv yoki { data: [...] }). Xato bo'lsa — bo'sh ro'yxat. */
async function listCredentials(): Promise<MeteredCred[]> {
  try {
    const r = await fetch(`${baseUrl()}/credentials?secretKey=${encodeURIComponent(SECRET_KEY!)}`, { signal: withTimeout(8000) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
    return arr.filter((c: any) => c && typeof c.username === 'string');
  } catch { return []; }
}

async function deleteCredential(username: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl()}/credential?secretKey=${encodeURIComponent(SECRET_KEY!)}&username=${encodeURIComponent(username)}`, { method: 'DELETE', signal: withTimeout(8000) });
    return r.ok;
  } catch { return false; }
}

/**
 * Owner 2026-10-19: "Metered 403" — har qayta ishga tushishda yangi credential yaratilib, eskilari o'chirilmasdi;
 * sinov tarifidagi credential chegarasi (10 ta) to'lgach Metered yaratishni 403 bilan rad etdi. Endi o'zimiz
 * yaratgan (label "qurilisherp-…") eski credential'lar o'chiriladi, eng yangi `keep` tasi qoldiriladi.
 */
async function pruneOwnCredentials(keep: number): Promise<number> {
  const own = (await listCredentials()).filter((c) => String(c.label || '').startsWith(LABEL_PREFIX));
  const ts = (c: MeteredCred) => Date.parse(String(c.createdAt || c.created || c.expiryAt || '')) || 0;
  own.sort((a, b) => ts(b) - ts(a));
  let removed = 0;
  for (const c of own.slice(Math.max(0, keep))) {
    if (c.username && c.username !== cachedUsername && (await deleteCredential(c.username))) removed++;
  }
  if (removed) console.log(`[meteredTurn] ${removed} ta eski TURN credential o'chirildi`);
  return removed;
}

async function createCredential(): Promise<Response> {
  return fetch(`${baseUrl()}/credential?secretKey=${encodeURIComponent(SECRET_KEY!)}`, {
    method: 'POST',
    signal: withTimeout(8000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expiryInSeconds: CREDENTIAL_TTL_SECONDS,
      label: `${LABEL_PREFIX}${new Date().toISOString().slice(0, 10)}`,
    }),
  });
}

async function mintAndCache(): Promise<void> {
  if (!configured) return;
  // Avval eskilarni tozalaymiz (joriy ishlatilayotgani + 1 ta zaxira qoladi)
  await pruneOwnCredentials(1);
  let createRes = await createCredential();
  if (createRes.status === 403 || createRes.status === 429) {
    // Chegara to'lgan bo'lishi mumkin — hammasini (joriydan tashqari) o'chirib bir marta qayta urinamiz
    if (await pruneOwnCredentials(0)) createRes = await createCredential();
  }
  if (!createRes.ok) throw new Error(`Metered credential yaratish muvaffaqiyatsiz: ${createRes.status}`);
  const cred = await createRes.json() as { username: string; password: string; apiKey: string };

  const listRes = await fetch(`${baseUrl()}/credentials?apiKey=${encodeURIComponent(cred.apiKey)}`, { signal: withTimeout(8000) });
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
