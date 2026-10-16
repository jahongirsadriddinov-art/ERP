import { describe, it, expect, beforeEach, vi } from "vitest";

// "Menga qo'ng'iroq qil" (requestCallback) — chat do'koni ovozli ildizga xabar beradi va belgi qo'yadi.

vi.mock("./api", async (orig) => {
  const real = await orig<typeof import("./api")>();
  return {
    ...real,
    loadAiChatHistory: vi.fn(async () => ({ aiActive: true, items: [] })),
    sendAiChatMessage: vi.fn(async (text: string) => (text.includes("qo'ng'iroq")
      ? { reply: "Hozir ilova ichida qo'ng'iroq qilaman.", pendingActions: [], toolCalls: [{ name: "requestCallback", status: "ok" }] }
      : { reply: "Salom", pendingActions: [], toolCalls: [] })),
  };
});

import {
  __resetAiChat, bindAiChatUser, clearAiCallExpected, getAiChatState, onAiCallRequested, replyRequestedCall, sendAiChat, setAiChatNotice,
} from "./aiChatStore";

beforeEach(() => { __resetAiChat(); bindAiChatUser("u1"); });

describe("aiChatStore — AI qo'ng'irog'i so'rovi", () => {
  it("replyRequestedCall: faqat requestCallback ok", () => {
    expect(replyRequestedCall({ toolCalls: [{ name: "requestCallback", status: "ok" }] })).toBe(true);
    expect(replyRequestedCall({ toolCalls: [{ name: "requestCallback", status: "error" }] })).toBe(false);
    expect(replyRequestedCall({ toolCalls: [{ name: "getMyTasks", status: "ok" }] })).toBe(false);
    expect(replyRequestedCall({})).toBe(false);
    expect(replyRequestedCall(null)).toBe(false);
  });

  it("javobda requestCallback — tinglovchiga xabar va 'qo'ng'iroq qilmoqda' belgisi; oddiy javobda — yo'q", async () => {
    const got: number[] = [];
    const off = onAiCallRequested((ms) => got.push(ms));
    await sendAiChat("salom", "uz");
    expect(got).toEqual([]);
    expect(getAiChatState().callExpectedUntil).toBe(0);
    await sendAiChat("menga qo'ng'iroq qil", "uz");
    expect(got).toHaveLength(1);
    expect(got[0]).toBeGreaterThan(30_000);
    expect(getAiChatState().callExpectedUntil).toBeGreaterThan(Date.now());
    clearAiCallExpected();
    expect(getAiChatState().callExpectedUntil).toBe(0);
    off();
  });

  it("matnga o'tish izohi o'rnatiladi va olib tashlanadi", () => {
    setAiChatNotice("aiVoiceCall.textFallbackLimit");
    expect(getAiChatState().notice).toBe("aiVoiceCall.textFallbackLimit");
    setAiChatNotice(null);
    expect(getAiChatState().notice).toBeNull();
  });
});
