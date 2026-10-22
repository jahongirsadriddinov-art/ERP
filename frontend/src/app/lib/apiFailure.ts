import { reportError } from "./monitoring";

// Muvaffaqiyatsiz API so'rovlari ham dasturchiga (owner 2026-10-22): server 5xx (har qanday so'rov) va
// tarmoq uzilishi — faqat o'zgartiruvchi so'rovlarda (POST/PUT/PATCH/DELETE: foydalanuvchi biror amalni
// bajarolmadi). So'rov TANASI (forma qiymatlari) hech qachon yuborilmaydi — faqat metod, yo'l shabloni, status.
// Takrorlar/limitlar reportError ichida (bir sessiyada bir xil xato bir marta, jami ≤15).

/** /api/objects/65ab…/items/42?x=1 → /api/objects/:id/items/:n (ID/token/so'rov qatorisiz). */
export function apiPathTemplate(url: string): string {
  let p = url;
  try { p = new URL(url, "http://x").pathname; } catch { /* */ }
  return p.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{24}$/i.test(seg)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":uuid";
    if (/^\d+$/.test(seg)) return ":n";
    if (seg.length >= 20 && /^[A-Za-z0-9_.~-]+$/.test(seg)) return ":token";
    return seg;
  }).join("/").slice(0, 200);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Xabar beriladimi va qanday matn bilan; null — xabar berilmaydi. status 0 = tarmoq xatosi (javob yo'q). */
export function describeApiFailure(method: string, url: string, status: number, opts: { maintenance?: boolean; offline?: boolean } = {}):
  { message: string; api: { method: string; path: string; status: number } } | null {
  const m = (method || "GET").toUpperCase();
  const path = apiPathTemplate(url);
  if (!path.includes("/api/") || path.startsWith("/api/errors")) return null; // o'zini-o'zi xabar qilmasin
  if (status === 0) {
    if (!MUTATING.has(m) || opts.offline) return null; // oflayn — oddiy holat (navbatga olinadi)
    return { message: `API javob bermadi (tarmoq): ${m} ${path}`, api: { method: m, path, status: 0 } };
  }
  if (status < 500) return null;
  if (status === 503 && opts.maintenance) return null; // texnik ishlar rejimi — xato emas
  return { message: `API ${status}: ${m} ${path}`, api: { method: m, path, status } };
}

export function reportApiFailure(method: string, url: string, status: number, opts: { maintenance?: boolean; offline?: boolean; serverError?: string } = {}) {
  try {
    const d = describeApiFailure(method, url, status, opts);
    if (!d) return;
    const detail = opts.serverError ? ` — ${String(opts.serverError).slice(0, 150)}` : "";
    reportError(d.message + detail, undefined, { kind: "api", api: d.api });
  } catch { /* monitoring ilovani buzmasin */ }
}
