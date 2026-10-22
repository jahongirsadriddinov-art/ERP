// Bot dizayni uchun Telegram Bot API'ga to'g'ridan-to'g'ri HTTPS so'rovlar (getStickerSet, getFile,
// setMyCommands). node-telegram-bot-api 0.66 da getStickerSet bor, lekin bu modul services/bot.ts'ni
// import qilmasligi kerak (u tokensiz xato tashlaydi, testlarda ham og'ir) — shu sabab xom so'rov.
const API = 'https://api.telegram.org';

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN sozlanmagan');
  return t;
}

export async function tgCall<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${API}/bot${token()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(j?.description || `Telegram ${method} HTTP ${r.status}`);
  return j.result as T;
}

/** Fayl (stiker rasmi) baytlari — getFile + yuklab olish. */
export async function tgDownloadFile(fileId: string): Promise<{ buf: Buffer; path: string }> {
  const f = await tgCall<{ file_path?: string }>('getFile', { file_id: fileId });
  if (!f?.file_path) throw new Error('file_path yo\'q');
  const r = await fetch(`${API}/file/bot${token()}/${f.file_path}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), path: f.file_path };
}

/** "t.me/addemoji/NAME", "https://t.me/addstickers/NAME" yoki shunchaki "NAME" → NAME */
export function parsePackName(input: string): string | null {
  const s = String(input || '').trim();
  const m = /(?:t\.me|telegram\.me)\/(?:addemoji|addstickers)\/([A-Za-z0-9_]{1,64})/i.exec(s);
  const name = m ? m[1] : s;
  return /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : null;
}
