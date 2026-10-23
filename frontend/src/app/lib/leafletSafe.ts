// Leaflet xaritasini xavfsiz boshqarish (xato tuzatildi — error tracker: "undefined is not an object (evaluating
// 't._leaflet_pos')" `_getMapPanePos` ichida, "Xabarlar" bosilgandan keyin). Sabab: xarita komponenti yopilganda
// (`map.remove()` — `_mapPane` o'chiriladi) unga keyinroq kelgan chaqiriqlar — kechiktirilgan `setTimeout`
// (fitBounds/invalidateSize), ResizeObserver, GPS javobi (flyTo), socket yangilanishi — o'chirilgan xaritada
// ishlab, `_mapPane._leaflet_pos` ni o'qishga urinardi. Endi har bir chaqiriq oldidan xarita "tirikligi"
// tekshiriladi va yo'q qilish bitta joyda — animatsiya to'xtatiladi, hodisalar uziladi, taymerlar tozalanadi.

/** Leaflet xaritasining biz tekshiradigan ichki maydonlari (L.Map'ning ommaviy bo'lmagan qismi). */
interface MapLike {
  _loaded?: boolean;
  _mapPane?: unknown;
  _container?: { isConnected?: boolean } | null;
  __disposed?: boolean;
  getContainer?: () => { isConnected?: boolean } | null;
  stop?: () => unknown;
  off?: () => unknown;
  remove?: () => unknown;
}

/** Xarita hali sahifada va chizishga tayyormi (yo'q qilinmagan, panel bor, konteyner DOM'da). */
export function isMapAlive(map: unknown): boolean {
  const m = map as MapLike | null | undefined;
  if (!m || m.__disposed) return false;
  if (!m._loaded || !m._mapPane) return false;
  const c = m._container ?? (typeof m.getContainer === 'function' ? m.getContainer() : null);
  if (!c) return false;
  // isConnected eski brauzerlarda bo'lmasligi mumkin — u holda tekshiruvsiz o'tkazamiz
  return c.isConnected !== false;
}

/**
 * Xaritaga chaqiriq — faqat xarita tirik bo'lsa; ichida Leaflet xato bersa (masalan animatsiya o'rtasida konteyner
 * yashirilgan bo'lsa) ilova yiqilmaydi. Natija yoki `undefined` qaytaradi.
 */
export function withMap<M, R>(map: M | null | undefined, fn: (m: M) => R): R | undefined {
  if (!map || !isMapAlive(map)) return undefined;
  try { return fn(map); } catch { return undefined; }
}

/**
 * Xaritani to'liq yo'q qilish: animatsiya (flyTo/zoom) to'xtatiladi, barcha hodisalar uziladi, so'ng remove().
 * Qayta chaqirilsa ham xavfsiz. `cleanup` — komponentning taymerlari/ResizeObserver'i (oldin tozalanadi).
 */
export function disposeMap(map: unknown, ...cleanup: Array<(() => void) | null | undefined>): void {
  for (const fn of cleanup) { try { fn?.(); } catch { /* */ } }
  const m = map as MapLike | null | undefined;
  if (!m || m.__disposed) return;
  m.__disposed = true;
  try { m.stop?.(); } catch { /* */ }
  try { m.off?.(); } catch { /* */ }
  try { m.remove?.(); } catch { /* */ }
}

/** Komponent yopilganda avtomatik bekor bo'ladigan taymerlar to'plami. */
export function timerBag() {
  const ids = new Set<ReturnType<typeof setTimeout>>();
  return {
    set(fn: () => void, ms: number) {
      const id = setTimeout(() => { ids.delete(id); fn(); }, ms);
      ids.add(id);
      return id;
    },
    clear() { ids.forEach(clearTimeout); ids.clear(); },
  };
}
