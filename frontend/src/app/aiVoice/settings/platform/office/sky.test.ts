import { describe, it, expect } from "vitest";
import { skyDir, skyLook, sunPosition, tashkentTime } from "./sky";

const deg = (r: number) => (r * 180) / Math.PI;

describe("Toshkent vaqti va quyosh", () => {
  it("UTC+5 mahalliy soat", () => {
    expect(tashkentTime(new Date("2026-06-21T07:30:00Z")).hour).toBeCloseTo(12.5, 3);
    expect(tashkentTime(new Date("2026-12-31T20:00:00Z")).hour).toBeCloseTo(1, 3);
    expect(tashkentTime(new Date("2026-01-01T00:00:00Z")).doy).toBe(1);
  });
  it("yoz tushida quyosh baland (~72°) janubda, yarim tunda ufq ostida", () => {
    const noon = sunPosition(12.4, 172);
    expect(deg(noon.elevation)).toBeGreaterThan(68);
    expect(deg(noon.elevation)).toBeLessThan(75);
    expect(deg(noon.azimuth)).toBeGreaterThan(150);
    expect(deg(noon.azimuth)).toBeLessThan(210);
    expect(sunPosition(0, 172).elevation).toBeLessThan(0);
    // Qish tushida past (~25°)
    expect(deg(sunPosition(12.4, 355).elevation)).toBeLessThan(30);
  });
  it("ertalab sharqda, kechqurun g'arbda", () => {
    expect(skyDir(sunPosition(8, 172).elevation, sunPosition(8, 172).azimuth)[0]).toBeGreaterThan(0);
    expect(skyDir(sunPosition(18, 172).elevation, sunPosition(18, 172).azimuth)[0]).toBeLessThan(0);
  });
  it("tun — qorong'i, quyosh nuri yo'q; bulutli kunda quyosh kuchsizroq", () => {
    const n = skyLook(-0.5, "sunny");
    expect(n.night).toBe(1);
    expect(n.sunIntensity).toBe(0);
    expect(skyLook(0.8, "cloudy").sunIntensity).toBeLessThan(skyLook(0.8, "sunny").sunIntensity);
  });
});
