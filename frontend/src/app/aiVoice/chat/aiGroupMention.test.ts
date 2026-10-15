import { describe, it, expect } from "vitest";
import { AI_SENDER_ID, aiGroupTrigger, isAiMention } from "./aiGroupMention";

describe("guruhdagi AI'ga murojaat (backend groupChatRoutes bilan bir xil qoida)", () => {
  it("@AI, 'AI,' 'AI:' 'AI yordamchi,' va kirillcha — ha", () => {
    for (const t of ["@AI bugun kim keldi?", "AI, salom", "ai: qalaysan", "AI yordamchi, yordam ber", "salom @ai nima gap", "ИИ, привет", "(@AI) tekshir"]) {
      expect(isAiMention(t)).toBe(true);
    }
  });

  it("so'z ichidagi yoki tinish belgisisiz 'ai' — yo'q", () => {
    for (const t of ["aiyam keldi", "mail@ai.uz", "Kaif", "AI haqida gaplashdik", "@aibek salom"]) expect(isAiMention(t)).toBe(false);
  });

  it("trigger: faqat matnli xabar; AI xabariga reply — mention'siz ham", () => {
    expect(aiGroupTrigger({ text: "yana tushuntir" }, { fromUserId: AI_SENDER_ID })).toBe(true);
    expect(aiGroupTrigger({ text: "yana tushuntir" }, { fromUserId: "u1" })).toBe(false);
    expect(aiGroupTrigger({ text: "@AI rasm", type: "image" })).toBe(false);
    expect(aiGroupTrigger({ text: "   " }, { fromUserId: AI_SENDER_ID })).toBe(false);
    expect(aiGroupTrigger({ text: "AI, salom", type: "text" })).toBe(true);
  });
});
