import { useSyncExternalStore } from "react";
import { officeApi, type OfficeMedia } from "./officeApi";
import { localMedia, localUrl, type LocalItem } from "./localMedia";
import { isMediaFileUrl, parseVideoLink, parseYandexMusic, type VideoLink } from "./media";
import { player, setTrackResolver, type Track } from "./sound";

// AI ofis — musiqa va kino holati (owner 2026-10-23): Dasturchi paneli ildizidagi MediaHost bitta marta o'rnatiladi va
// tab/rejim almashganda ham yashaydi (Yandex iframe qayta yaratilmaydi, <audio> to'xtamaydi). Ofis, kompyuter, panel —
// faqat shu storeni boshqaradi.
export type WinState = "closed" | "full" | "mini";
export interface MState {
  media: OfficeMedia | null;
  local: LocalItem[];
  music: WinState;
  tab: "music" | "cinema";
  /** Yandex vidjeti yuklangan (bir marta ochilgach — yopilmaguncha yashaydi). */
  yandexOn: boolean;
  cinema: WinState;
  /** Kinozalda: shu kompyuterdagi video (IndexedDB id) — serverdagi havoladan ustun. */
  cinemaLocal: string | null;
  cinemaLocalUrl: string | null;
}
const CL = "aiOffice.cinemaLocal";
let st: MState = {
  media: null, local: [], music: "closed", tab: "music", yandexOn: false, cinema: "closed",
  cinemaLocal: (() => { try { return localStorage.getItem(CL); } catch { return null; } })(), cinemaLocalUrl: null,
};
const ls = new Set<() => void>();
const set = (p: Partial<MState>) => { st = { ...st, ...p }; ls.forEach((l) => l()); };

setTrackResolver(async (t: Track) => (t.local ? localUrl(t.local) : t.url || null));
const syncTracks = () => {
  const m = st.media;
  const server: Track[] = (m?.tracks || []).map((x) => ({ id: x.id, name: x.name, url: x.url }));
  const local: Track[] = st.local.filter((x) => x.kind === "audio").map((x) => ({ id: `local:${x.id}`, name: x.name, local: x.id, size: x.size }));
  player.setTracks([...server, ...local]);
};
let loading: Promise<void> | null = null;

export const mediaStore = {
  get state() { return st; },
  subscribe(l: () => void) { ls.add(l); return () => { ls.delete(l); }; },
  load(force = false) {
    if (loading && !force) return loading;
    loading = (async () => {
      const [r, local] = await Promise.all([officeApi.media(), localMedia.list()]);
      set({ media: r.ok && r.data ? r.data : st.media || { yandex: "", tracks: [], cinema: "" }, local });
      syncTracks();
      if (st.cinemaLocal) set({ cinemaLocalUrl: await localUrl(st.cinemaLocal) });
    })();
    return loading;
  },
  async save(b: Partial<OfficeMedia>): Promise<boolean> {
    const r = await officeApi.saveMedia(b);
    if (!r.ok || !r.data) return false;
    set({ media: r.data.media });
    syncTracks();
    if ("cinema" in b && b.cinema) mediaStore.setCinemaLocal(null);
    return true;
  },
  async addLocal(file: File, kind: "audio" | "video", keep: boolean): Promise<LocalItem> {
    const it = await localMedia.add(file, kind, keep);
    set({ local: await localMedia.list() });
    syncTracks();
    return it;
  },
  async removeLocal(id: string) {
    await localMedia.remove(id);
    if (st.cinemaLocal === id) mediaStore.setCinemaLocal(null);
    set({ local: await localMedia.list() });
    syncTracks();
  },
  async setCinemaLocal(id: string | null) {
    try { if (id) localStorage.setItem(CL, id); else localStorage.removeItem(CL); } catch { /* */ }
    set({ cinemaLocal: id, cinemaLocalUrl: id ? await localUrl(id) : null });
  },
  setTab(tab: "music" | "cinema") { set({ tab }); },
  openMusic(tab: "music" | "cinema" = "music") { set({ music: "full", tab, yandexOn: st.yandexOn || (tab === "music" && !!st.media?.yandex) }); },
  /** X / "–": musiqa to'xtamaydi — kichik pleyerga aylanadi. */
  minimizeMusic() { set({ music: st.yandexOn || player.state.playing ? "mini" : "closed" }); },
  stopMusic() { player.stop(); set({ yandexOn: false, music: "closed" }); },
  playYandex() { set({ yandexOn: true }); },
  watch(mode: WinState = "full") { set({ cinema: mode }); },
  minimizeCinema() { if (st.cinema !== "closed") set({ cinema: "mini" }); },
  stopCinema() { set({ cinema: "closed" }); },
};
export const useMedia = () => useSyncExternalStore(mediaStore.subscribe, () => st, () => st);

/** Hozirgi kino: shu kompyuterdagi fayl (ustun) yoki serverdagi havola. */
export function currentMovie(s: MState): VideoLink | null {
  if (s.cinemaLocal && s.cinemaLocalUrl) return { kind: "file", src: s.cinemaLocalUrl };
  const c = s.media?.cinema;
  if (!c) return null;
  return parseVideoLink(c) || (isMediaFileUrl(c, "video") ? { kind: "file", src: c } : null);
}
export const yandexEmbed = (s: MState) => (s.media?.yandex ? parseYandexMusic(s.media.yandex) : null);
/** YouTube muqovasi (kinozal ekrani uchun). */
export function youtubeThumb(v: VideoLink | null): string | null {
  if (!v || v.kind !== "youtube") return null;
  const id = v.embed.split("/embed/")[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
