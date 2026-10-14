import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  subscribe, openAiVoiceCall, isAiCallActive, setAiCallActive,
  decideCallOffer, decideAiIncoming, __resetAiVoiceBus,
} from "./bus";

beforeEach(() => __resetAiVoiceBus());

describe("decideCallOffer (App.tsx onCallOffer)", () => {
  const base = { from: "peer1", selfId: "me", webrtcActive: false, aiActive: false };

  it("rings when nothing else is going on", () => {
    expect(decideCallOffer(base)).toBe("ring");
  });

  it("auto-rejects with busy while an AI call is active", () => {
    expect(decideCallOffer({ ...base, aiActive: true })).toBe("busy");
  });

  it("ignores own offers and offers without a sender", () => {
    expect(decideCallOffer({ ...base, from: "me" })).toBe("ignore");
    expect(decideCallOffer({ ...base, from: "me", aiActive: true })).toBe("ignore");
    expect(decideCallOffer({ ...base, from: undefined })).toBe("ignore");
    expect(decideCallOffer({ ...base, from: "" })).toBe("ignore");
  });

  it("leaves offers to CallOverlay during an existing WebRTC call (mesh), even if AI is flagged", () => {
    expect(decideCallOffer({ ...base, webrtcActive: true })).toBe("ignore");
    expect(decideCallOffer({ ...base, webrtcActive: true, aiActive: true })).toBe("ignore");
  });

  it("follows the live bus state", () => {
    const decide = () => decideCallOffer({ ...base, aiActive: isAiCallActive() });
    expect(decide()).toBe("ring");
    setAiCallActive(true);
    expect(decide()).toBe("busy");
    setAiCallActive(false);
    expect(decide()).toBe("ring");
  });
});

describe("decideAiIncoming (AiVoiceRoot)", () => {
  it("declines with busy during a WebRTC call, before anything else", () => {
    expect(decideAiIncoming({ busy: true, supported: true })).toBe("busy");
    expect(decideAiIncoming({ busy: true, supported: false })).toBe("busy");
  });
  it("declines as unsupported when the client cannot take the call", () => {
    expect(decideAiIncoming({ busy: false, supported: false })).toBe("unsupported");
  });
  it("rings otherwise", () => {
    expect(decideAiIncoming({ busy: false, supported: true })).toBe("ring");
  });
});

describe("bus", () => {
  it("openAiVoiceCall returns false with no listener and notifies listeners otherwise", () => {
    expect(openAiVoiceCall()).toBe(false);
    const fn = vi.fn();
    const off = subscribe(fn);
    expect(openAiVoiceCall("assistant")).toBe(true);
    expect(fn).toHaveBeenCalledWith({ type: "open", source: "assistant" });
    off();
    expect(openAiVoiceCall()).toBe(false);
  });

  it("emits active changes once per transition", () => {
    const fn = vi.fn();
    subscribe(fn);
    setAiCallActive(true);
    setAiCallActive(true);
    setAiCallActive(false);
    expect(fn.mock.calls.map(c => c[0])).toEqual([{ type: "active", active: true }, { type: "active", active: false }]);
  });

  it("a throwing listener does not break the others", () => {
    const good = vi.fn();
    subscribe(() => { throw new Error("x"); });
    subscribe(good);
    expect(openAiVoiceCall()).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
