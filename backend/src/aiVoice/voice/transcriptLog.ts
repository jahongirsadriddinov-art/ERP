import AiConversation from '../../models/AiConversation';
import type { AiLang, Purpose } from '../contracts';
import { redactText } from '../lib/redact';

// Qo'ng'iroq transkripti → AiConversation (source + sessionId). Owner talabi (2026-10-15): har bir
// suhbat yoziladi, DB'da 7 kun turadi, keyin arxiv fayliga ko'chiriladi (retention — boshqa paket).
// Yozuvlar to'planib, har ~10 s va yakunda bitta $push bilan yoziladi (har jumla uchun so'rov emas).
// Matn redactText'dan o'tadi (telefonlar maskalanadi). Xato qo'ng'iroqni HECH QACHON to'xtatmaydi.

export type TranscriptSource = 'voice_inapp' | 'telegram_call';

const MAX_MESSAGES = 400;
const MAX_TEXT = 2000;
const FLUSH_MS = 10_000;

const TITLE: Record<Purpose, { uz: string; ru: string }> = {
  assistant: { uz: "AI bilan qo'ng'iroq", ru: 'Звонок с ИИ' },
  attendance: { uz: "AI davomat qo'ng'irog'i", ru: 'ИИ-звонок по посещаемости' },
  reminder: { uz: "AI eslatma qo'ng'irog'i", ru: 'ИИ-звонок-напоминание' },
  test: { uz: "AI sinov qo'ng'irog'i", ru: 'Тестовый ИИ-звонок' },
};

export interface TranscriptLogOpts {
  companyId: string;
  userId: string;
  sessionId: string;
  correlationId: string;
  source: TranscriptSource;
  purpose: Purpose;
  lang: AiLang;
  flushMs?: number;
}

export class TranscriptLog {
  private buf: { role: 'user' | 'assistant'; content: string }[] = [];
  private total = 0;
  private docId: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private o: TranscriptLogOpts) {}

  get count(): number { return this.total; }

  add(role: 'user' | 'assistant', text: string): void {
    if (this.closed || this.total >= MAX_MESSAGES) return;
    const content = redactText(String(text || '').trim()).slice(0, MAX_TEXT);
    if (!content) return;
    this.buf.push({ role, content });
    this.total++;
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.o.flushMs ?? FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Navbatdagi yozuvlarni DB'ga yozadi (ketma-ket — poyga yo'q). */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.write()).catch((e) => {
      console.error('[aiVoice] transkript yozilmadi:', (e as Error).message);
    });
    return this.chain;
  }

  /** Yakun: qolganini yozadi, keyin qabul qilmaydi. */
  async close(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.flush();
    this.closed = true;
  }

  private async write(): Promise<void> {
    if (!this.buf.length) return;
    const batch = this.buf;
    this.buf = [];
    if (!this.docId) {
      const lang = this.o.lang === 'ru' ? 'ru' : 'uz';
      const doc: any = await AiConversation.create({
        userId: this.o.userId, companyId: this.o.companyId, title: TITLE[this.o.purpose]?.[lang] || TITLE.assistant[lang],
        messages: batch, source: this.o.source, sessionId: this.o.sessionId, correlationId: this.o.correlationId,
      });
      this.docId = String(doc._id);
      return;
    }
    await AiConversation.updateOne({ _id: this.docId }, { $push: { messages: { $each: batch } } });
  }
}
