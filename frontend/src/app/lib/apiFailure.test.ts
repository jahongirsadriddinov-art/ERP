import { describe, it, expect, vi, beforeEach } from "vitest";

const reportError = vi.fn();
vi.mock("./monitoring", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { apiPathTemplate, describeApiFailure, reportApiFailure } from "./apiFailure";

beforeEach(() => reportError.mockReset());

describe("apiPathTemplate", () => {
  it("ID, raqam, token va so'rov qatori olib tashlanadi", () => {
    expect(apiPathTemplate("https://api.uz/api/objects/65a1b2c3d4e5f6a7b8c9d0e1/items/42?token=secret#x")).toBe("/api/objects/:id/items/:n");
    expect(apiPathTemplate("/api/public/sign/abcdefghijklmnopqrstuvwxyz012345")).toBe("/api/public/sign/:token");
  });
});

describe("describeApiFailure", () => {
  it("5xx — har qanday metod", () => {
    expect(describeApiFailure("GET", "https://api.uz/api/dashboard", 500)).toEqual({ message: "API 500: GET /api/dashboard", api: { method: "GET", path: "/api/dashboard", status: 500 } });
    expect(describeApiFailure("post", "/api/transactions", 502)?.api).toEqual({ method: "POST", path: "/api/transactions", status: 502 });
  });
  it("4xx, texnik ishlar 503 va xato jurnalining o'zi — xabar berilmaydi", () => {
    expect(describeApiFailure("POST", "/api/transactions", 400)).toBeNull();
    expect(describeApiFailure("GET", "/api/objects", 401)).toBeNull();
    expect(describeApiFailure("GET", "/api/objects", 503, { maintenance: true })).toBeNull();
    expect(describeApiFailure("POST", "/api/errors/log", 500)).toBeNull();
    expect(describeApiFailure("GET", "https://cdn.example.com/x.js", 500)).toBeNull();
  });
  it("tarmoq xatosi — faqat o'zgartiruvchi so'rovlarda va onlayn bo'lsa", () => {
    expect(describeApiFailure("PUT", "/api/objects/65a1b2c3d4e5f6a7b8c9d0e1", 0)?.message).toBe("API javob bermadi (tarmoq): PUT /api/objects/:id");
    expect(describeApiFailure("GET", "/api/objects", 0)).toBeNull();
    expect(describeApiFailure("POST", "/api/transactions", 0, { offline: true })).toBeNull();
  });
});

describe("reportApiFailure", () => {
  it("reportError'ga kind=api va so'rov ma'lumoti bilan uzatadi (tanasiz)", () => {
    reportApiFailure("DELETE", "https://api.uz/api/materials/65a1b2c3d4e5f6a7b8c9d0e1?x=1", 500, { serverError: "Server xatoligi" });
    expect(reportError).toHaveBeenCalledTimes(1);
    const [msg, stack, extra] = reportError.mock.calls[0];
    expect(msg).toBe("API 500: DELETE /api/materials/:id — Server xatoligi");
    expect(stack).toBeUndefined();
    expect(extra).toEqual({ kind: "api", api: { method: "DELETE", path: "/api/materials/:id", status: 500 } });
  });
  it("e'tiborsiz holatlarda chaqirilmaydi", () => {
    reportApiFailure("GET", "/api/objects", 404);
    reportApiFailure("GET", "/api/objects", 0);
    expect(reportError).not.toHaveBeenCalled();
  });
});
