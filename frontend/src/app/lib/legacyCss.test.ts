import { describe, it, expect } from "vitest";
import { parseColor, oklchToRgb } from "./legacyCss";

describe("legacyCss", () => {
  it("oklch → rgb (oq/qora)", () => {
    expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });
  it("parseColor: hex, rgb, oklch, alfa", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#00000080")?.[3]).toBeCloseTo(0.5, 2);
    expect(parseColor("rgba(10, 20, 30, 0.4)")).toEqual([10, 20, 30, 0.4]);
    expect(parseColor("oklch(100% 0 0 / 50%)")).toEqual([255, 255, 255, 0.5]);
    expect(parseColor("var(--x)")).toBeNull();
  });
});
