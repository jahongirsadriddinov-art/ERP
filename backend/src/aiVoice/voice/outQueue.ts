// Chiqish navbati (A10): Socket.IO'da backpressure yo'q — sekin mijozda bufer cheksiz o'sadi.
// Ikki qatlam:
//  1) PACER — model ovozni real vaqtdan tezroq (portlab) beradi; kadrlar ijro tezligida, mijoz
//     buferida ~leadMs dan ortiq bo'lmasligi uchun chiqariladi. Kutayotgan "kelajak" audio serverda
//     turadi (barge-in'da bitta clear() bilan bekor bo'ladi — mijozda eskirgan ovoz qolmaydi).
//  2) CAP (~500 ms) — transport (socket write buffer) shuncha baytdan ko'p yuborilmagan audio
//     ushlab tursa, navbatdagi ENG ESKI kadr tashlanadi: sekin tarmoqda ham real vaqtga yaqin qolamiz.
// Kutayotgan audio ham cheklangan (pendingMaxBytes) — oshsa eng eskisi tashlanadi.

export interface OutQueueOptions {
  /** Transportda yuborilmay turgan baytlar chegarasi (~500 ms @24 kHz = 24 000). */
  maxBytes: number;
  /** Transportda hozir yuborilmay turgan baytlar (bilinmasa 0). */
  backlogBytes?: () => number;
  send: (frame: Buffer) => void;
  /** Bayt → ms (24 kHz PCM16: 48 bayt/ms). */
  bytesPerMs?: number;
  /** Mijoz buferida oldinda turadigan audio (ms). */
  leadMs?: number;
  /** Serverda kutib turadigan audio chegarasi (bayt). */
  pendingMaxBytes?: number;
  tickMs?: number;
  now?: () => number;
}

export class OutQueue {
  private q: Buffer[] = [];
  private bytes = 0;
  private playEnd = 0;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  droppedBytes = 0;
  droppedFrames = 0;
  sentBytes = 0;
  private readonly bpm: number;
  private readonly lead: number;
  private readonly pendingMax: number;
  private readonly now: () => number;

  constructor(private o: OutQueueOptions) {
    this.bpm = o.bytesPerMs ?? 48;
    this.lead = o.leadMs ?? 400;
    this.pendingMax = o.pendingMaxBytes ?? 48 * 60_000;   // 60 s
    this.now = o.now ?? Date.now;
  }

  get queuedBytes(): number { return this.bytes; }

  /** Mijoz tomonida hali ijro etilmagan (taxminiy) audio, ms. */
  get aheadMs(): number { return Math.max(0, this.playEnd - this.now()); }

  push(frame: Buffer): void {
    if (this.closed || !frame?.length) return;
    this.q.push(frame);
    this.bytes += frame.length;
    while (this.bytes > this.pendingMax && this.q.length > 1) this.dropOldest();
    this.pump();
  }

  /** Vaqti kelgan kadrlarni chiqaradi; qolgan bo'lsa taymer qo'yadi. */
  pump(): void {
    if (this.closed) return;
    const now = this.now();
    if (this.playEnd < now) this.playEnd = now;
    while (this.q.length && this.playEnd - now < this.lead) {
      const f = this.q.shift()!;
      this.bytes -= f.length;
      const backlog = this.o.backlogBytes ? this.o.backlogBytes() : 0;
      if (backlog + f.length > this.o.maxBytes) {
        // Sekin iste'molchi: transportda allaqachon ~500 ms turibdi — bu (eng eski) kadr tashlanadi
        this.droppedBytes += f.length;
        this.droppedFrames++;
      } else {
        this.sentBytes += f.length;
        try { this.o.send(f); } catch { /* transport xatosi — sessiya o'zi hal qiladi */ }
      }
      this.playEnd += f.length / this.bpm;
    }
    this.schedule();
  }

  /** Barge-in: kutayotgan audio bekor, ijro soati hozirga. */
  clear(): void {
    this.q = [];
    this.bytes = 0;
    this.playEnd = this.now();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  close(): void {
    this.clear();
    this.closed = true;
  }

  private dropOldest() {
    const old = this.q.shift()!;
    this.bytes -= old.length;
    this.droppedBytes += old.length;
    this.droppedFrames++;
  }

  private schedule() {
    if (this.timer || !this.q.length || this.closed) return;
    const wait = Math.max(5, Math.min(this.o.tickMs ?? 20, this.playEnd - this.now() - this.lead + 1));
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait);
    this.timer.unref?.();
  }
}
