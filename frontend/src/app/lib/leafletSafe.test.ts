import { describe, it, expect, vi } from 'vitest';
import { isMapAlive, withMap, disposeMap, timerBag } from './leafletSafe';

const aliveMap = () => ({ _loaded: true, _mapPane: {}, _container: { isConnected: true }, stop: vi.fn(), off: vi.fn(), remove: vi.fn(), flyTo: vi.fn() });

describe('leafletSafe', () => {
  it('isMapAlive — only a loaded map with a pane in a connected container', () => {
    expect(isMapAlive(aliveMap())).toBe(true);
    expect(isMapAlive(null)).toBe(false);
    expect(isMapAlive({ ...aliveMap(), _loaded: false })).toBe(false);
    expect(isMapAlive({ ...aliveMap(), _mapPane: undefined })).toBe(false); // after map.remove()
    expect(isMapAlive({ ...aliveMap(), _container: { isConnected: false } })).toBe(false);
  });

  it('withMap skips calls on a removed map and swallows Leaflet errors', () => {
    const m = aliveMap();
    withMap(m, (x) => x.flyTo([1, 2], 10));
    expect(m.flyTo).toHaveBeenCalledTimes(1);
    delete (m as any)._mapPane; // Leaflet remove() deletes _mapPane — `_getMapPanePos` would crash
    withMap(m, (x) => x.flyTo([1, 2], 10));
    expect(m.flyTo).toHaveBeenCalledTimes(1);
    const boom = aliveMap();
    expect(withMap(boom, () => { throw new TypeError("undefined is not an object (evaluating 't._leaflet_pos')"); })).toBeUndefined();
  });

  it('disposeMap stops animation, removes listeners, runs cleanup once and is idempotent', () => {
    const m = aliveMap();
    const cleanup = vi.fn();
    disposeMap(m, cleanup, null);
    disposeMap(m);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(m.stop).toHaveBeenCalledTimes(1);
    expect(m.off).toHaveBeenCalledTimes(1);
    expect(m.remove).toHaveBeenCalledTimes(1);
    expect(isMapAlive(m)).toBe(false);
  });

  it('timerBag.clear cancels pending map timers', () => {
    vi.useFakeTimers();
    const bag = timerBag();
    const fn = vi.fn();
    bag.set(fn, 350);
    bag.clear();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
