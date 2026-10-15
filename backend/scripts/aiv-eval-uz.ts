/* eslint-disable no-console */
// O'zbekcha ovoz baholash (review P9: Gemini Live'ni asosiy qilish uchun go/no-go). HAQIQIY Gemini
// kalitlari kerak — bu skript avtomatik testlarda ISHGA TUSHMAYDI; natija ishga tushirilmaguncha "NOT RUN".
//
// Ishga tushirish (backend papkasida, .env'da GEMINI_API_KEY bo'lsin):
//   npx ts-node -T scripts/aiv-eval-uz.ts [--audio-dir <papka>] [--out report.json] [--only a1,a2]
// --audio-dir: haqiqiy ishchilar ovozi yozuvlari (<id>.wav, PCM16 mono, istalgan chastota) — TAVSIYA
//   etiladi; bo'lmasa ibora Gemini TTS bilan sintez qilinadi (faqat "quvur" tekshiruvi, sifat bahosi EMAS).
// Har ibora uchun: audio Live sessiyasiga real vaqt tezligida (40 ms kadrlar) yuboriladi; kirish
// transkripti, tool chaqiruvlari va javob yoziladi. Mezon: kutilgan tool/argument + transkript o'xshashligi.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { aiConfig } from '../src/aiVoice/config';
import type { ToolDeclaration, ToolResult } from '../src/aiVoice/contracts';
import { geminiConfigured } from '../src/aiVoice/lib/geminiKeys';
import { IN_RATE, OUT_RATE, resamplePcm16, wavToPcm16, silence } from '../src/aiVoice/voice/audio';
import { GeminiLiveProvider } from '../src/aiVoice/voice/geminiLive';
import { GeminiTts } from '../src/aiVoice/voice/geminiSpeech';
import { buildVoiceSystemPrompt } from '../src/aiVoice/voice/prompts';
import { attendanceToolDeclaration } from '../src/aiVoice/voice/sessionTools';

interface Case {
  id: string;
  purpose: 'attendance' | 'assistant';
  text: string;
  expectTool?: string;
  expectArgs?: Record<string, unknown>;
}

// Qurilish ishchilarining odatiy iboralari (og'zaki, shevali, qisqa).
const CASES: Case[] = [
  { id: 'a1', purpose: 'attendance', text: 'Assalomu alaykum, ha, bugun ishga boraman.', expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'coming' } },
  { id: 'a2', purpose: 'attendance', text: 'Yarim soatga kechikaman, avtobus kelmadi.', expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'late' } },
  { id: 'a3', purpose: 'attendance', text: 'Bugun kasalman, kela olmayman.', expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'not_coming' } },
  { id: 'a4', purpose: 'attendance', text: "Boraman, sakkizda o'sha yerda bo'laman.", expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'coming' } },
  { id: 'a5', purpose: 'attendance', text: 'Bir soatlarga kechroq boraman, aka.', expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'late' } },
  { id: 'a6', purpose: 'attendance', text: "Bugun bormayman, to'yga ketyapman.", expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'not_coming' } },
  { id: 'a7', purpose: 'attendance', text: 'Hmm, keyin aytaman, hozir bilmayman.', expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'unclear' } },
  { id: 'a8', purpose: 'attendance', text: 'Да, приду сегодня вовремя.', expectTool: 'recordAttendanceAnswer', expectArgs: { answer: 'coming' } },
  { id: 's1', purpose: 'assistant', text: 'Bugungi vazifalarim qanaqa?', expectTool: 'getMyTasks' },
  { id: 's2', purpose: 'assistant', text: "Shu haftalik jadvalimni aytib bering.", expectTool: 'getMySchedule' },
  { id: 's3', purpose: 'assistant', text: "Ertaga soat yettida eslatib qo'ying, beton keladi.", expectTool: 'createReminder' },
  { id: 's4', purpose: 'assistant', text: 'Omborda sement qancha qoldi?', expectTool: 'getInventoryBalance' },
  { id: 's5', purpose: 'assistant', text: "Prorabga ayting, armatura tugadi.", expectTool: 'notifyManager' },
  { id: 's6', purpose: 'assistant', text: "Eslatmalarimni ko'rsating.", expectTool: 'listReminders' },
];

const ASSISTANT_TOOLS: ToolDeclaration[] = [
  { name: 'getMyTasks', description: 'Foydalanuvchining bugungi/joriy vazifalari', behavior: 'BLOCKING', parameters: { type: 'object', properties: {} } },
  { name: 'getMySchedule', description: 'Foydalanuvchining ish jadvali', behavior: 'BLOCKING', parameters: { type: 'object', properties: {} } },
  { name: 'createReminder', description: 'Eslatma yaratish', behavior: 'BLOCKING', parameters: { type: 'object', properties: { text: { type: 'string' }, dueAt: { type: 'string', format: 'date-time' } }, required: ['text', 'dueAt'] } },
  { name: 'listReminders', description: "Faol eslatmalar ro'yxati", behavior: 'BLOCKING', parameters: { type: 'object', properties: {} } },
  { name: 'getInventoryBalance', description: 'Ombordagi material qoldig\'i', behavior: 'BLOCKING', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'notifyManager', description: 'Rahbarga xabar yuborish', behavior: 'BLOCKING', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** So'z darajasidagi o'xshashlik (1 − WER, oddiy Levenshtein). */
function wordSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ`']/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter(Boolean);
  const x = norm(a); const y = norm(b);
  if (!x.length) return y.length ? 0 : 1;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  }
  return Math.max(0, 1 - d[x.length][y.length] / x.length);
}

async function audioFor(c: Case, dir: string | undefined, tts: GeminiTts): Promise<{ pcm: Buffer; source: 'recording' | 'tts' }> {
  if (dir) {
    const f = path.join(dir, `${c.id}.wav`);
    if (fs.existsSync(f)) {
      const w = wavToPcm16(fs.readFileSync(f));
      if (!w) throw new Error(`${f}: PCM16 mono WAV emas`);
      return { pcm: resamplePcm16(w.pcm, w.rate, IN_RATE), source: 'recording' };
    }
  }
  const pcm24 = await tts.synth(c.text, { voiceName: 'Kore', lang: 'uz', model: aiConfig.models.tts });
  return { pcm: resamplePcm16(pcm24, OUT_RATE, IN_RATE), source: 'tts' };
}

async function runCase(c: Case, pcm: Buffer) {
  const p = new GeminiLiveProvider({ setupTimeoutMs: 10_000 });
  const tools = c.purpose === 'attendance' ? [attendanceToolDeclaration('uz')] : ASSISTANT_TOOLS;
  const t0 = Date.now();
  const s = await p.open({
    model: aiConfig.models.live, tools, lang: 'uz', voiceName: 'Kore', ptt: false,
    systemInstruction: buildVoiceSystemPrompt({ lang: 'uz', purpose: c.purpose, channel: 'inapp_call', companyName: 'Sinov', userName: 'Ishchi', role: 'ishchi', today: new Date().toISOString().slice(0, 10) }),
  });
  const setupMs = Date.now() - t0;
  let heard = '';
  let said = '';
  let firstAudioMs = -1;
  let speechEndAt = 0;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  s.on('transcript', (t) => { if (t.final) { if (t.role === 'user') heard += ` ${t.text}`; else said += ` ${t.text}`; } });
  s.on('audioOut', () => { if (firstAudioMs < 0 && speechEndAt) firstAudioMs = Date.now() - speechEndAt; });
  s.on('toolCall', (tc) => {
    calls.push({ name: tc.name, args: tc.args });
    const result: ToolResult = { status: 'ok', message: 'Bajarildi (sinov).', retryable: false };
    s.toolResponse([{ id: tc.id, name: tc.name, result }]);
  });
  // Real vaqt tezligida 40 ms kadrlar, oxirida 1 s jimlik (server VAD navbatni yopsin)
  const all = Buffer.concat([pcm, silence(1_000, IN_RATE)]);
  for (let off = 0; off < all.length; off += 1280) {
    s.pushAudio(all.subarray(off, Math.min(all.length, off + 1280)));
    await new Promise((r) => setTimeout(r, 40));
  }
  speechEndAt = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !(calls.length && said)) await new Promise((r) => setTimeout(r, 200));
  await s.close('eval_done');
  const toolOk = !c.expectTool || calls.some((x) => x.name === c.expectTool
    && Object.entries(c.expectArgs || {}).every(([k, v]) => x.args?.[k] === v));
  return { setupMs, firstAudioMs, heard: heard.trim(), said: said.trim(), calls, toolOk, similarity: wordSimilarity(c.text, heard) };
}

async function main() {
  if (!geminiConfigured()) {
    console.log('NOT RUN: GEMINI_API_KEY (yoki GEMINI_API_KEYS) sozlanmagan.');
    process.exit(2);
  }
  const only = (arg('--only') || '').split(',').filter(Boolean);
  const dir = arg('--audio-dir');
  const out = arg('--out') || 'aiv-eval-uz.report.json';
  const tts = new GeminiTts();
  const rows: any[] = [];
  for (const c of CASES.filter((x) => !only.length || only.includes(x.id))) {
    try {
      const a = await audioFor(c, dir, tts);
      const r = await runCase(c, a.pcm);
      rows.push({ id: c.id, source: a.source, text: c.text, ...r });
      console.log(`${r.toolOk ? 'OK  ' : 'FAIL'} ${c.id} [${a.source}] sim=${r.similarity.toFixed(2)} setup=${r.setupMs}ms first=${r.firstAudioMs}ms heard="${r.heard}" tools=${r.calls.map((x) => x.name).join(',')}`);
    } catch (e) {
      rows.push({ id: c.id, error: (e as Error).message });
      console.log(`ERR  ${c.id}: ${(e as Error).message}`);
    }
  }
  const done = rows.filter((r) => !r.error);
  const pass = done.filter((r) => r.toolOk).length;
  const summary = {
    model: aiConfig.models.live, at: new Date().toISOString(), cases: rows.length, errors: rows.length - done.length,
    toolAccuracy: done.length ? pass / done.length : 0,
    meanSimilarity: done.length ? done.reduce((a, r) => a + r.similarity, 0) / done.length : 0,
    recordingsUsed: done.filter((r) => r.source === 'recording').length,
    // Go/no-go (taklif): haqiqiy yozuvlarda tool aniqligi ≥ 85% va o'xshashlik ≥ 0.7
    verdict: done.some((r) => r.source === 'recording')
      ? (pass / Math.max(1, done.length) >= 0.85 ? 'GO (tasdiqlash uchun egasi ko\'rib chiqsin)' : 'NO-GO')
      : 'INCONCLUSIVE (faqat TTS — haqiqiy yozuvlar bilan qayta ishga tushiring)',
  };
  fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
