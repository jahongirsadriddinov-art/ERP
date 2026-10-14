import { describe, it, expect } from "vitest";
import * as fe from "./protocol";
// Backend shartnomasi (MUZLATILGAN) — frontend nusxasi undan farq qilmasligi kerak.
import * as be from "../../../../backend/src/aiVoice/contracts";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("protocol parity with backend contracts.ts", () => {
  it("socket event names match", () => {
    expect(fe.AIV_CLIENT_EVENTS).toEqual(be.AIV_CLIENT_EVENTS);
    expect(fe.AIV_SERVER_EVENTS).toEqual(be.AIV_SERVER_EVENTS);
  });
  it("frame constants and channel names match", () => {
    expect(fe.AUDIO_FRAME_HEADER_BYTES).toBe(be.AUDIO_FRAME_HEADER_BYTES);
    expect(fe.AUDIO_FRAME_MAX_BYTES).toBe(be.AUDIO_FRAME_MAX_BYTES);
    expect(fe.AUDIO_FRAMES_PER_SEC_MAX).toBe(be.AUDIO_FRAMES_PER_SEC_MAX);
    expect(fe.AUDIO_IN_SAMPLE_RATE).toBe(be.AUDIO_IN_SAMPLE_RATE);
    expect(fe.AUDIO_OUT_SAMPLE_RATE).toBe(be.AUDIO_OUT_SAMPLE_RATE);
    expect(fe.CHANNEL_NAMES).toEqual(be.CHANNEL_NAMES);
  });
  it("frames are byte-identical in both directions", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
    const bytes = new Uint8Array(pcm.buffer);
    const a = fe.encodeAudioFrame(UUID, 0xfffffffe, pcm);
    const b = be.encodeAudioFrame(UUID, 0xfffffffe, bytes);
    expect(Array.from(a)).toEqual(Array.from(b));
    const fromBe = fe.decodeAudioFrame(new Uint8Array(b));
    expect(fromBe?.correlationId).toBe(UUID);
    expect(fromBe?.seq).toBe(0xfffffffe);
    expect(Array.from(new Int16Array(fromBe!.pcm.slice().buffer))).toEqual(Array.from(pcm));
    const fromFe = be.decodeAudioFrame(a);
    expect(fromFe?.correlationId).toBe(UUID);
    expect(fromFe?.seq).toBe(0xfffffffe);
  });
});

describe("decodeAudioFrame", () => {
  it("accepts an ArrayBuffer (socket.io binary) and a sub-view", () => {
    const f = fe.encodeAudioFrame(UUID, 7, new Uint8Array([1, 2, 3, 4]));
    expect(fe.decodeAudioFrame(f.slice().buffer)?.seq).toBe(7);
    const padded = new Uint8Array(f.length + 3);
    padded.set(f, 3);
    const d = fe.decodeAudioFrame(padded.subarray(3));
    expect(d?.seq).toBe(7);
    expect(Array.from(d!.pcm)).toEqual([1, 2, 3, 4]);
  });
  it("rejects bad frames", () => {
    expect(fe.decodeAudioFrame(new Uint8Array(21))).toBeNull();                                   // PCM < 2 bayt
    expect(fe.decodeAudioFrame(new Uint8Array(23))).toBeNull();                                   // toq PCM
    expect(fe.decodeAudioFrame(new Uint8Array(fe.AUDIO_FRAME_MAX_BYTES + 2))).toBeNull();         // juda katta
  });
  it("encode rejects odd PCM and bad UUIDs", () => {
    expect(() => fe.encodeAudioFrame(UUID, 1, new Uint8Array(3))).toThrow("ODD_PCM_LENGTH");
    expect(() => fe.encodeAudioFrame("not-a-uuid", 1, new Uint8Array(2))).toThrow("BAD_UUID");
  });
});
