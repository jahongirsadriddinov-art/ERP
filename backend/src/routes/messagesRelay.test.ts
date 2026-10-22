// Sinov (xavfsizlik audit 2026-10-22): chat xabari Telegram'ga HTML rejimida uzatilganda foydalanuvchi matni va
// ismi escape qilinadi — aks holda xodim rasmiy bot nomidan soxta havola (<a href=...>) yubora olardi.
import { describe, it, expect, vi } from 'vitest';

const sendMessage = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../services/bot', () => ({ bot: { sendMessage: (...a: any[]) => sendMessage(...a), sendLocation: vi.fn(async () => undefined) } }));

import { relayMessageToTelegram } from './messages';

describe('relayMessageToTelegram', () => {
  it('matn va ism HTML sifatida talqin qilinmaydi', async () => {
    await relayMessageToTelegram('1', 'Ali <i>', { text: '<a href="https://evil.example">Parolni yangilang</a> & x' });
    const text = String(sendMessage.mock.calls[0][1]);
    expect(text).not.toContain('<a href');
    expect(text).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
    expect(text).toContain('Ali &lt;i&gt;');
    expect(text).toContain('&amp; x');
  });
});
