// Ikkinchi manzil: shifrlangan arxiv dasturchining Telegram chatiga HUJJAT sifatida yuboriladi — hech qanday
// sozlashsiz (TELEGRAM_BOT_TOKEN va dasturchining Telegram'i allaqachon bor) har doim tashqarida nusxa turadi.
// Bot API yuklash chegarasi 50 MB, lekin bot o'zi qayta YUKLAB OLA OLADIGANI (getFile) — 20 MB. Shu sabab
// arxiv 19 MB'lik bo'laklarga bo'linadi: server tiklashda bo'laklarni o'zi qayta yuklab oladi.
export const TG_PART_BYTES = 19 * 1024 * 1024;
const API = 'https://api.telegram.org';

export interface TgPart { index: number; total: number; fileId: string; fileUniqueId?: string; messageId: number; size: number; fileName: string }

export function splitParts(buf: Buffer, partBytes = TG_PART_BYTES): Buffer[] {
  if (buf.length <= partBytes) return [buf];
  const out: Buffer[] = [];
  for (let i = 0; i < buf.length; i += partBytes) out.push(buf.subarray(i, i + partBytes));
  return out;
}

export const partFileName = (base: string, i: number, total: number) =>
  total === 1 ? base : `${base}.part${String(i + 1).padStart(2, '0')}of${String(total).padStart(2, '0')}`;

/** Yuklangan bo'lak fayllarini to'g'ri tartibda birlashtiradi ("…partNNofMM" nomlari bo'yicha). */
export function joinParts(files: { name: string; data: Buffer }[]): Buffer {
  const parsed = files.map((f) => {
    const m = /\.part(\d+)of(\d+)$/i.exec(f.name);
    return { ...f, i: m ? Number(m[1]) : 1, n: m ? Number(m[2]) : 1 };
  });
  parsed.sort((a, b) => a.i - b.i);
  const total = parsed[0]?.n || 1;
  if (parsed.length !== total || parsed.some((p, idx) => p.i !== idx + 1 || p.n !== total)) {
    throw new Error(`Bo'laklar to'liq emas: ${parsed.length}/${total} ta (barcha .partNNofMM fayllarni birga tanlang)`);
  }
  return Buffer.concat(parsed.map((p) => p.data));
}

type FetchFn = typeof fetch;

export async function sendArchiveToTelegram(o: { token: string; chatId: string; fileName: string; file: Buffer; caption: string; fetchImpl?: FetchFn; partBytes?: number }): Promise<TgPart[]> {
  const f = o.fetchImpl || fetch;
  const parts = splitParts(o.file, o.partBytes);
  const out: TgPart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const name = partFileName(o.fileName, i, parts.length);
    const form = new FormData();
    form.append('chat_id', o.chatId);
    form.append('caption', (parts.length > 1 ? `[${i + 1}/${parts.length}] ` : '') + o.caption.slice(0, 900));
    form.append('disable_notification', 'true');
    form.append('document', new Blob([new Uint8Array(parts[i])], { type: 'application/octet-stream' }), name);
    const res = await f(`${API}/bot${o.token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(5 * 60_000) } as RequestInit);
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(`Telegram sendDocument: ${j?.description || 'HTTP ' + res.status}`);
    const doc = j.result?.document || {};
    out.push({ index: i, total: parts.length, fileId: String(doc.file_id || ''), fileUniqueId: doc.file_unique_id, messageId: Number(j.result?.message_id || 0), size: parts[i].length, fileName: name });
  }
  return out;
}

export async function downloadTelegramFile(token: string, fileId: string, fetchImpl?: FetchFn): Promise<Buffer> {
  const f = fetchImpl || fetch;
  const r = await f(`${API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(60_000) } as RequestInit);
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !j.result?.file_path) throw new Error(`Telegram getFile: ${j?.description || 'HTTP ' + r.status}`);
  const d = await f(`${API}/file/bot${token}/${j.result.file_path}`, { signal: AbortSignal.timeout(5 * 60_000) } as RequestInit);
  if (!d.ok) throw new Error(`Telegram fayl yuklab olinmadi: HTTP ${d.status}`);
  return Buffer.from(await d.arrayBuffer());
}

export async function downloadTelegramParts(token: string, parts: Pick<TgPart, 'index' | 'fileId'>[], fetchImpl?: FetchFn): Promise<Buffer> {
  const sorted = [...parts].sort((a, b) => a.index - b.index);
  const bufs: Buffer[] = [];
  for (const p of sorted) bufs.push(await downloadTelegramFile(token, p.fileId, fetchImpl));
  return Buffer.concat(bufs);
}

export async function sendTelegramText(token: string, chatId: string, text: string, fetchImpl?: FetchFn): Promise<void> {
  const f = fetchImpl || fetch;
  await f(`${API}/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30_000),
  } as RequestInit).catch(() => undefined);
}
