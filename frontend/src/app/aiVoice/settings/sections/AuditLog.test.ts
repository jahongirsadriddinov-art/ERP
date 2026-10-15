import { describe, it, expect } from "vitest";
import { humanizeAudit } from "./AuditLog";

describe("humanizeAudit", () => {
  it("jadval o'zgarishini oddiy tilda yozadi", () => {
    const h = humanizeAudit({ tool: "bot.schedule", channel: "bot", resultSummary: 'Ish jadvali (bot): {"shiftId":"main","patch":{"workStart":"02:03"},"attendance":false}' }, false);
    expect(h.title).toBe("Ish jadvali o'zgartirildi");
    expect(h.channel).toBe("Telegram bot");
    expect(h.detail).toBe("ish boshlanishi 02:03 · ertalabki so'rov o'chirildi");
  });
  it("eslatma sanasini o'qiladigan qiladi", () => {
    const h = humanizeAudit({ tool: "createReminder", channel: "bot", resultSummary: "Eslatma yaratildi: 2026-10-15, 12:00." }, false);
    expect(h.title).toBe("Eslatma yaratildi");
    expect(h.detail).toBe("15-oktabr, 12:00.");
  });
  it("ruscha", () => {
    expect(humanizeAudit({ tool: "createReminder", resultSummary: "2026-10-15" }, true).detail).toBe("15 октября");
  });
});
