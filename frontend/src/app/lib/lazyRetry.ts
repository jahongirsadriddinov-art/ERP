import { lazy, type ComponentType } from "react";
import { isChunkError, reloadForNewVersion } from "./chunkReload";

// Ilova fonda (yashirin) turganda — masalan Telegram Mini App pastga surib kichraytirilganda (iOS) yoki telefon
// qulflanganda — tarmoq to'xtatiladi va o'sha paytda boshlangan bo'lak (lazy chunk) yuklanishi "Importing a module
// script failed" bilan yiqiladi. Avval bu darhol butun ilovani ErrorBoundary'ga tushirib, YASHIRIN sahifani qayta
// yuklardi — iOS'da qaytganda oq ekran. Endi: ko'rinadigan bo'lishini kutib, bir necha marta qayta uriniladi;
// faqat shundan keyin ham yuklanmasa (haqiqatan yangi versiya chiqqan) — ko'rinib turgan holda yangilanadi.

type Doc = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/** Sahifa ko'rinadigan bo'lguncha kutadi (allaqachon ko'rinib tursa — darhol). */
export function whenVisible(doc: Doc | undefined = typeof document !== "undefined" ? document : undefined): Promise<void> {
  if (!doc || doc.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => { if (doc.visibilityState !== "hidden") { doc.removeEventListener("visibilitychange", on); resolve(); } };
    doc.addEventListener("visibilitychange", on);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function importWithRetry<T>(factory: () => Promise<T>, opts: { retries?: number; delayMs?: number; doc?: Doc } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 700;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await factory(); }
    catch (e) {
      lastErr = e;
      const netLike = isChunkError(e) || /fetch|network|load failed/i.test(String((e as any)?.message || ""));
      if (!netLike || i === retries) break;
      await whenVisible(opts.doc);
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

/** React.lazy o'rniga — xuddi shu imzo, lekin qayta urinish bilan. */
export function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => importWithRetry(factory));
}

/** Yashirin paytda qayta yuklamaslik: ko'rinadigan bo'lgach yangilaydi (iOS — fonda reload = oq ekran). */
export function reloadWhenVisible(doc?: Doc): void {
  whenVisible(doc).then(() => { reloadForNewVersion(); });
}
