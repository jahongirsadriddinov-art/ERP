import { describe, it, expect } from "vitest";
import { docLayout } from "../docTemplates";

describe("docLayout", () => {
  it("shartnoma: imzolar oxirida, izoh imzodan oldin, tahrir qo'llanadi", () => {
    const l = docLayout({ type: "shartnoma", number: "SH-1", title: "x", data: { customerName: "Ali", texts: { title: "MENING SARLAVHAM", "s5.h": "5. Javob" } } });
    expect(l[l.length - 1].kind).toBe("sigs");
    expect((l[l.length - 2] as any).id).toBe("note");
    const title = l.find(i => i.kind === "text" && i.id === "title") as any;
    expect(title.value).toBe("MENING SARLAVHAM");
    expect(title.def).toContain("SH-1");
    const intro = l.find(i => i.kind === "text" && i.id === "intro") as any;
    expect(intro.value).toContain("Ali");
  });
  it("akt: jadval bor", () => {
    const l = docLayout({ type: "akt", number: "A-1", title: "x", data: { rows: [{ name: "Beton", unit: "m3", qty: "2", price: "100" }] } });
    expect(l.some(i => i.kind === "table")).toBe(true);
  });
});
