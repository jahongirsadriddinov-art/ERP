import { describe, it, expect } from "vitest";
import { canvasesToPdf } from "./pdf";

const fakeCanvas = (w: number, h: number) => ({
  width: w, height: h,
  // kichik "JPEG" baytlar (tuzilma testi uchun mazmun muhim emas)
  toDataURL: () => "data:image/jpeg;base64," + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9)),
}) as unknown as HTMLCanvasElement;

describe("canvasesToPdf", () => {
  it("produces a structurally valid PDF with correct xref offsets", async () => {
    const blob = canvasesToPdf([fakeCanvas(1240, 1754), fakeCanvas(1240, 1754)]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = text.slice(startxref).split("\n").slice(3).filter(l => /^\d{10} 00000 n $/.test(l));
    expect(entries.length).toBe(1 + 2 + 2 * 3 - 1); // 8 obyekt (1..8)
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });
});
