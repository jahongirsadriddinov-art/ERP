// Yarim dupleks "barge-in" darvozasi (review A12). Ko'p Android telefonlarda brauzer AEC Web Audio
// ijrosini to'liq o'chirmaydi — model o'z ovozini eshitib, o'zini to'xtatib qo'yadi. Shu sabab:
//  - AI gapirayotganda (va undan keyin qisqa "aks-sado dumi" davomida) mikrofon kadrlari YUBORILMAYDI;
//  - faqat mikrofon RMS'i chegaradan (mutlaq qiymat va AI ovozi darajasiga nisbatan) bir necha kadr
//    ketma-ket baland bo'lsa — foydalanuvchi gapni bo'lyapti (barge-in): darvoza ochiladi va oxirgi
//    bir necha kadr (pre-roll) ham yuboriladi, so'z boshi yo'qolmasin;
//  - jimlikdan keyin `holdMs` o'tgach darvoza yana yopiladi.
// Sof sinf — vaqt `now` parametri orqali beriladi (test qilinadi).

export interface DuplexGateOpts {
  /** Mutlaq barge-in chegarasi (RMS, 0..1). */
  bargeInRms: number;
  /** Chegara AI ijro darajasidan kamida shuncha marta baland bo'lsin. */
  echoRatio: number;
  /** Ketma-ket baland kadrlar soni (40 ms kadr). */
  attackFrames: number;
  /** Barge-in'dan keyin jimlikda darvoza ochiq turish vaqti. */
  holdMs: number;
  /** AI ijrosi tugagach ham shuncha vaqt yopiq (xona aks-sadosi / AEC kechikishi). */
  tailMs: number;
  /** Ochilganda yuboriladigan oldingi kadrlar soni. */
  preRollFrames: number;
}

export const DEFAULT_GATE_OPTS: DuplexGateOpts = {
  bargeInRms: 0.06,
  echoRatio: 1.5,
  attackFrames: 3,
  holdMs: 800,
  tailMs: 300,
  preRollFrames: 3,
};

export interface AiOutputState { playing: boolean; level: number }

export class DuplexGate {
  readonly opts: DuplexGateOpts;
  private lastAiAt = -Infinity;
  private lastLoudAt = -Infinity;
  private loudRun = 0;
  private open = false;
  private preRoll: Int16Array[] = [];

  constructor(opts: Partial<DuplexGateOpts> = {}) {
    this.opts = { ...DEFAULT_GATE_OPTS, ...opts };
  }

  /** Hozir foydalanuvchi AI'ni bo'lyaptimi (darvoza AI ijrosi paytida ochiq). */
  get bargedIn(): boolean { return this.open; }

  reset(): void {
    this.lastAiAt = -Infinity;
    this.lastLoudAt = -Infinity;
    this.loudRun = 0;
    this.open = false;
    this.preRoll = [];
  }

  /** Bitta mikrofon kadri → yuborilishi kerak bo'lgan kadrlar (0, 1 yoki pre-roll bilan bir nechta). */
  process(frame: Int16Array, micRms: number, ai: AiOutputState, now: number): Int16Array[] {
    const o = this.opts;
    if (ai.playing) this.lastAiAt = now;
    const aiActive = ai.playing || now - this.lastAiAt < o.tailMs;
    if (!aiActive) {
      // AI jim — to'liq dupleks
      this.open = false;
      this.loudRun = 0;
      this.preRoll = [];
      return [frame];
    }
    const threshold = Math.max(o.bargeInRms, (ai.playing ? ai.level : 0) * o.echoRatio);
    const loud = micRms >= threshold;
    if (loud) { this.loudRun++; this.lastLoudAt = now; } else this.loudRun = 0;

    if (this.open) {
      if (loud || now - this.lastLoudAt <= o.holdMs) return [frame];
      this.open = false;
    }
    if (this.loudRun >= o.attackFrames) {
      this.open = true;
      const out = [...this.preRoll, frame];
      this.preRoll = [];
      return out;
    }
    this.preRoll.push(frame);
    if (this.preRoll.length > o.preRollFrames) this.preRoll.shift();
    return [];
  }
}
