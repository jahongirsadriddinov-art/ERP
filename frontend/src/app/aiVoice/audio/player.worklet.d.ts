// player.worklet.js turlari (asosiy oqimdan import qilinganda: ScriptProcessor zaxira yo'li va testlar).
export declare class PcmRing {
  constructor(capacity: number, prebuffer: number);
  readonly cap: number;
  size: number;
  playing: boolean;
  prebuffer: number;
  idle: number;
  underruns: number;
  dropped: number;
  push(x: Float32Array): void;
  flush(): void;
  read(out: Float32Array): number;
}
