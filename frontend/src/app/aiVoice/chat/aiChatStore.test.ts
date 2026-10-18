import { describe, it, expect, beforeEach, vi } from "vitest";

// "Menga qo'ng'iroq qil" (requestCallback) — chat do'koni ovozli ildizga xabar beradi va belgi qo'yadi.

vi.mock("./api", async (orig) => {
  const real = await orig<typeof import("./api")>();
  return {
    ...real,
    loadAiChatHistory: vi.fn(async () => ({ aiActive: true, items: [] })),
    sendAiChatMessage: vi.fn(async (text: string) => {
      if (text.includes("qo'ng'iroq")) return { reply: "Hozir ilova ichida qo'ng'iroq qilaman.", pendingActions: [], toolCalls: [{ name: "requestCallback", status: "ok" }] };
      if (text.includes("rahbarga")) {
        return { reply: "Tasdiqlaysizmi?", pendingActions: [{ pendingActionId: "a".repeat(24), summary: "Rahbarga xabar", expiresAt: new Date(Date.now() + 60_000).toISOString(), tool: "notifyManager" }], toolCalls: [{ name: "notifyManager", status: "needs_confirmation" }] };
      }
      if (text === "ha") return { reply: "✅ Xabar yuborildi.", pendingActions: [], toolCalls: [{ name: "confirm", status: "ok" }] };
      return { reply: "Salom", pendingActions: [], toolCalls: [] };
    }),
    confirmAiChatAction: vi.fn(async () => ({ status: "ok", message: "Yuborildi." })),
  };
});

import {
  __resetAiChat, answerAiChatConfirm, bindAiChatUser, replyResolvedConfirm, clearAiCallExpected, getAiChatState, onAiCallRequested, replyRequestedCall, sendAiChat, setAiChatNotice,
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

describe("aiChatStore — tasdiq SHU chatda (owner 2026-10-17 #4)", () => {
  it("pending amal — chatda tasdiq kartasi; tugma bosilsa natija kartada", async () => {
    await sendAiChat("rahbarga xabar yubor", "uz");
    const card = getAiChatState().items.find((i) => i.kind === "confirm");
    expect(card?.confirm?.state).toBe("idle");
    expect(card?.confirm?.summary).toBe("Rahbarga xabar");
    await answerAiChatConfirm(card!.id, true, "uz");
    const done = getAiChatState().items.find((i) => i.id === card!.id);
    expect(done?.confirm?.state).toBe("done");
    expect(done?.confirm?.result).toBe("Yuborildi.");
  });

  it("'ha' deb yozilsa — server tasdiqladi, ochiq karta yopiladi", async () => {
    await sendAiChat("rahbarga xabar yubor", "uz");
    await sendAiChat("ha", "uz");
    const card = getAiChatState().items.find((i) => i.kind === "confirm");
    expect(card?.confirm?.state).toBe("done");
    expect(card?.confirm?.result).toMatch(/yuborildi/);
    expect(replyResolvedConfirm({ toolCalls: [{ name: "confirm", status: "ok" }] })).toBe(true);
    expect(replyResolvedConfirm({ toolCalls: [{ name: "getMyTasks", status: "ok" }] })).toBe(false);
  });
});
