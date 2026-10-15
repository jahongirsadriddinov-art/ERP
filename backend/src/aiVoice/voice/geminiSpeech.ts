import { GoogleGenAI } from '@google/genai';
import type { AiLang } from '../contracts';
import { withGeminiKey } from '../lib/geminiKeys';
import { OUT_RATE, pcm16ToWav, resamplePcm16, wavToPcm16 } from './audio';

// Gemini nutq yordamchilari (kaskad va disclosure klipi uchun): TTS (matn → 24 kHz PCM16) va
// transkripsiya (16 kHz PCM16 → matn, generateContent + inline WAV). Kalitlar — lib/geminiKeys.
// ESLATMA: haqiqiy kalitsiz bu yerda sinab bo'lmaydi (testlar soxta TtsSynth/Transcriber ishlatadi).
// TTS javobi formati (audio/L16;rate=24000 yoki WAV) — ikkalasi ham qo'llab-quvvatlanadi.

export interface TtsSynth {
  /** 24 kHz PCM16LE qaytaradi; xato bo'lsa throw. */
  synth(text: string, o: { voiceName: string; lang: AiLang; model: string; signal?: AbortSignal }): Promise<Buffer>;
}

export interface Transcriber {
  transcribe(pcm16k: Buffer, o: { lang: AiLang; model: string; signal?: AbortSignal }): Promise<{ text: string; tokensIn?: number; tokensOut?: number }>;
}

interface GenaiLike { models: { generateContent(req: any): Promise<any> } }
export type GenaiFactory = (apiKey: string) => GenaiLike;

const clients = new Map<string, GenaiLike>();
const defaultFactory: GenaiFactory = (apiKey) => {
  let c = clients.get(apiKey);
  if (!c) {
    c = new GoogleGenAI({ apiKey }) as unknown as GenaiLike;
    if (clients.size > 20) clients.clear();
    clients.set(apiKey, c);
  }
  return c;
};

/** inlineData (base64) → 24 kHz PCM16. mimeType: audio/L16;rate=N | audio/pcm;rate=N | audio/wav. */
export function decodeTtsAudio(data: string, mimeType: string): Buffer {
  const raw = Buffer.from(data, 'base64');
  const wav = wavToPcm16(raw);
  if (wav) return resamplePcm16(wav.pcm, wav.rate, OUT_RATE);
  const m = /rate=(\d+)/i.exec(mimeType || '');
  const rate = m ? Number(m[1]) : OUT_RATE;
  const pcm = raw.subarray(0, raw.length - (raw.length % 2));
  return resamplePcm16(pcm, rate, OUT_RATE);
}

export class GeminiTts implements TtsSynth {
  constructor(private factory: GenaiFactory = defaultFactory, private timeoutMs = 15_000) {}

  async synth(text: string, o: { voiceName: string; lang: AiLang; model: string; signal?: AbortSignal }): Promise<Buffer> {
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const resp: any = await withGeminiKey((key) => this.factory(key).models.generateContent({
      model: o.model,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voiceName } } },
        abortSignal: signal,
      },
    }));
    const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
    const audio = parts.find((p) => p?.inlineData?.data);
    if (!audio) throw new Error('TTS_NO_AUDIO');
    const pcm = decodeTtsAudio(String(audio.inlineData.data), String(audio.inlineData.mimeType || ''));
    if (pcm.length < 2) throw new Error('TTS_EMPTY');
    return pcm;
  }
}

const TRANSCRIBE_PROMPT = {
  uz: "Ushbu audioni so'zma-so'z yozib bering. Til o'zbek (lotin yozuvida) yoki rus bo'lishi mumkin. Faqat aytilgan matnni qaytaring — izoh, tarjima yoki tirnoqsiz. Nutq bo'lmasa — bo'sh javob.",
  ru: 'Дословно расшифруйте аудио. Язык — узбекский (латиница) или русский. Верните только сказанный текст, без комментариев. Если речи нет — пустой ответ.',
};

export class GeminiTranscriber implements Transcriber {
  constructor(private factory: GenaiFactory = defaultFactory, private timeoutMs = 15_000) {}

  async transcribe(pcm16k: Buffer, o: { lang: AiLang; model: string; signal?: AbortSignal }) {
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const wav = pcm16ToWav(pcm16k, 16_000).toString('base64');
    const resp: any = await withGeminiKey((key) => this.factory(key).models.generateContent({
      model: o.model,
      contents: [{ role: 'user', parts: [{ text: TRANSCRIBE_PROMPT[o.lang === 'ru' ? 'ru' : 'uz'] }, { inlineData: { mimeType: 'audio/wav', data: wav } }] }],
      config: { maxOutputTokens: 512, temperature: 0, abortSignal: signal },
    }));
    const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
    const um = resp?.usageMetadata || {};
    return { text, tokensIn: Number(um.promptTokenCount) || 0, tokensOut: Number(um.candidatesTokenCount) || 0 };
  }
}
