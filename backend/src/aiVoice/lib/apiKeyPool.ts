// Bitta provayderning BIR NECHTA API kaliti — limitga urilgani jim turib chetga suriladi va
// keyingisi ishlatiladi (owner 2026-10-28: "qaysidir API kalitning limiti tugasa, o'sha zahoti
// bilintirmasdan keyingisiga o'tsin"). Gemini'da bu allaqachon bor (lib/geminiKeys.ts) — bu esa
// qolgan provayderlar (OpenRouter, Groq va h.k.) uchun o'sha qoidaning soddalashtirilgan ko'rinishi.
//
// Kalit qiymatlari HECH QACHON log qilinmaydi — faqat indeks (#0, #1 ...).
// Env'dagi qiymat vergul bilan bir nechta kalit bo'lishi mumkin; bitta bo'lsa ham xuddi shunday ishlaydi.
// Env o'zgarsa (owner yangi kalit qo'shsa) ro'yxat o'zi yangilanadi — qayta ishga tushirish shart emas.

const QUOTA_COOLDOWN_MS = 60_000;      // 429 / limit — bir daqiqa chetda
const AUTH_COOLDOWN_MS = 10 * 60_000;  // noto'g'ri/bloklangan kalit — 10 daqiqa

export interface PooledKey { index: number; key: string; label: string }

const pools = new Map<string, { raw: string; keys: string[]; cursor: number; cooldown: Map<number, number> }>();

function pool(envName: string) {
  const raw = (process.env[envName] || '').trim();
  let p = pools.get(envName);
  if (!p || p.raw !== raw) {
    p = { raw, keys: [...new Set(raw.split(',').map((k) => k.trim()).filter(Boolean))], cursor: 0, cooldown: new Map() };
    pools.set(envName, p);
  }
  return p;
}

/** Ro'yxatdagi kalitlar soni (0 — sozlanmagan). */
export function keyCount(envName: string): number { return pool(envName).keys.length; }

/** Dasturchi paneli uchun holat: nechta kalit bor va nechtasi hozir sovushda.
 *  Kalit QIYMATLARI hech qachon qaytarilmaydi — faqat sanoq. */
export function poolStatus(envName: string, now = Date.now()): { keys: number; cooling: number } {
  const p = pool(envName);
  let cooling = 0;
  for (const [, until] of p.cooldown) if (until > now) cooling++;
  return { keys: p.keys.length, cooling: Math.min(cooling, p.keys.length) };
}

/** Sovushda bo'lmagan keyingi kalit; hammasi sovushda bo'lsa — eng tez tiklanadigani. */
export function pickKey(envName: string, now = Date.now()): PooledKey | null {
  const p = pool(envName);
  if (!p.keys.length) return null;
  let best = -1, bestUntil = Infinity;
  for (let i = 0; i < p.keys.length; i++) {
    const idx = (p.cursor + i) % p.keys.length;
    const until = p.cooldown.get(idx) || 0;
    if (until <= now) { best = idx; break; }
    if (until < bestUntil) { bestUntil = until; best = idx; }
  }
  return { index: best, key: p.keys[best], label: `#${best}` };
}

/** Limit/ruxsat xatosi — shu kalitni vaqtincha chetga surib, keyingisiga o'tamiz. */
export function markKeyFailed(envName: string, index: number, status?: number, now = Date.now()): void {
  const p = pool(envName);
  if (!p.keys.length) return;
  const ms = status === 401 || status === 403 ? AUTH_COOLDOWN_MS : QUOTA_COOLDOWN_MS;
  p.cooldown.set(index, now + ms);
  if (index === p.cursor) p.cursor = (p.cursor + 1) % p.keys.length;
  if (p.keys.length > 1) console.warn(`[apiKeyPool] ${envName} ${`#${index}`} chetga surildi (${status || 'xato'}) — keyingi kalitga o'tildi`);
}

/** Ishlagan kalitda qolamiz. */
export function markKeyOk(envName: string, index: number): void {
  pool(envName).cooldown.delete(index);
}
