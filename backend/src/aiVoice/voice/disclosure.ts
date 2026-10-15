import crypto from 'crypto';
import type { AiLang } from '../contracts';
import { geminiConfigured } from '../lib/geminiKeys';
import type { TtsSynth } from './geminiSpeech';

// Disclosure klipi (A8): "men AI yordamchiman" — modelga bog'liq EMAS. Firma + til + ovoz + matn
// bo'yicha bir marta TTS bilan render qilinadi va xotirada keshlanadi (bepul tarifda Mongo'ga
// yozilmaydi — ~3 s klip ≈ 150 KB; jarayon qayta ishga tushsa birinchi qo'ng'iroqda qayta render).
// Sessiya ringing paytida isitadi (warm), ulanishda klip DETERMINISTIK birinchi ijro etiladi.
// TTS ishlamasa null — sessiya menejeri zaxira sifatida qat'iy birinchi matnli navbat yuboradi.

export interface ClipRequest { text: string; lang: AiLang; voiceName: string; model: string }

export interface DisclosureService {
  getClip(req: ClipRequest, timeoutMs?: number): Promise<Buffer | null>;
}

const NEG_TTL_MS = 60_000;

export class DisclosureCache implements DisclosureService {
  private clips = new Map<string, Buffer>();
  private inflight = new Map<string, Promise<Buffer | null>>();
  private failedAt = new Map<string, number>();

  constructor(private tts: TtsSynth | null, private maxEntries = 32, private enabled: () => boolean = () => true) {}

  static keyOf(r: ClipRequest): string {
    return crypto.createHash('sha256').update(`${r.model}\n${r.voiceName}\n${r.lang}\n${r.text}`).digest('hex').slice(0, 32);
  }

  peek(r: ClipRequest): Buffer | undefined { return this.clips.get(DisclosureCache.keyOf(r)); }

  async getClip(r: ClipRequest, timeoutMs = 4_000): Promise<Buffer | null> {
    if (!this.tts || !this.enabled() || !r.text) return null;
    const key = DisclosureCache.keyOf(r);
    const hit = this.clips.get(key);
    if (hit) { this.clips.delete(key); this.clips.set(key, hit); return hit; }      // LRU
    const failed = this.failedAt.get(key);
    if (failed && Date.now() - failed < NEG_TTL_MS) return null;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.render(key, r);
      this.inflight.set(key, p);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([p, new Promise<null>((res) => { timer = setTimeout(() => res(null), timeoutMs); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async render(key: string, r: ClipRequest): Promise<Buffer | null> {
    try {
      const pcm = await this.tts!.synth(r.text, { voiceName: r.voiceName, lang: r.lang, model: r.model });
      this.clips.set(key, pcm);
      while (this.clips.size > this.maxEntries) this.clips.delete(this.clips.keys().next().value as string);
      this.failedAt.delete(key);
      return pcm;
    } catch (e) {
      this.failedAt.set(key, Date.now());
      console.warn('[aiVoice] disclosure TTS ishlamadi — matnli zaxira ishlatiladi:', (e as Error).message);
      return null;
    } finally {
      this.inflight.delete(key);
    }
  }
}

/** Standart: Gemini TTS (kalit bo'lsa). Lazy — @google/genai faqat kerak bo'lganda. */
export function createDefaultDisclosure(): DisclosureCache {
  let tts: TtsSynth | null = null;
  const lazy: TtsSynth = {
    synth: async (text, o) => {
      if (!tts) { const { GeminiTts } = await import('./geminiSpeech'); tts = new GeminiTts(); }
      return tts.synth(text, o);
    },
  };
  return new DisclosureCache(lazy, 32, geminiConfigured);
}
