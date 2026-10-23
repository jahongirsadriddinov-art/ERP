// AI ofis — musiqa va kino havolalari (owner 2026-10-23): faqat rasmiy embed manzillari, xost QAT'IY tekshiriladi.
// Frontend'da xuddi shu fayl (frontend/src/app/aiVoice/settings/platform/office/media.ts) — ikkalasi bir xil testlanadi.

export type MusicLink = { kind: "yandex"; embed: string; label: string };
export type VideoLink =
  | { kind: "youtube" | "vk" | "rutube"; embed: string }
  | { kind: "file"; src: string }
  | { kind: "kinopoisk"; open: string };

const YANDEX_HOSTS = new Set(["music.yandex.ru", "music.yandex.com", "music.yandex.uz", "music.yandex.kz", "music.yandex.by"]);
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"]);
const VK_HOSTS = new Set(["vk.com", "m.vk.com", "www.vk.com", "vkvideo.ru", "www.vkvideo.ru", "m.vkvideo.ru", "vk.ru"]);
const RUTUBE_HOSTS = new Set(["rutube.ru", "www.rutube.ru", "m.rutube.ru"]);
const KP_HOSTS = new Set(["kinopoisk.ru", "www.kinopoisk.ru", "hd.kinopoisk.ru", "m.kinopoisk.ru"]);

function url(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.port) return null;
    return u;
  } catch {
    return null;
  }
}
const ID = /^[A-Za-z0-9_-]+$/;
const NUM = /^\d+$/;

/** Yandex Musiqa ulashish havolasi → rasmiy iframe vidjeti (music.yandex.ru/iframe/#...). */
export function parseYandexMusic(raw: unknown): MusicLink | null {
  const u = url(raw);
  if (!u || !YANDEX_HOSTS.has(u.hostname.toLowerCase())) return null;
  const p = u.pathname.split("/").filter(Boolean);
  // /album/{id}/track/{id}
  if (p[0] === "album" && NUM.test(p[1] || "") && p[2] === "track" && NUM.test(p[3] || "")) return { kind: "yandex", embed: `https://music.yandex.ru/iframe/#track/${p[3]}/${p[1]}`, label: `track ${p[3]}` };
  if (p[0] === "album" && NUM.test(p[1] || "") && p.length === 2) return { kind: "yandex", embed: `https://music.yandex.ru/iframe/#album/${p[1]}`, label: `album ${p[1]}` };
  // /users/{login}/playlists/{kind}
  if (p[0] === "users" && /^[A-Za-z0-9._-]{1,64}$/.test(p[1] || "") && p[2] === "playlists" && NUM.test(p[3] || "")) {
    return { kind: "yandex", embed: `https://music.yandex.ru/iframe/#playlist/${encodeURIComponent(p[1])}/${p[3]}`, label: `playlist ${p[1]}/${p[3]}` };
  }
  // /track/{id} (yangi format)
  if (p[0] === "track" && NUM.test(p[1] || "")) return { kind: "yandex", embed: `https://music.yandex.ru/iframe/#track/${p[1]}`, label: `track ${p[1]}` };
  return null;
}

/** Kino havolasi: YouTube / VK Video / Rutube → rasmiy embed; to'g'ridan-to'g'ri mp4/webm; Kinopoisk — faqat "ochish". */
export function parseVideoLink(raw: unknown): VideoLink | null {
  const u = url(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const p = u.pathname.split("/").filter(Boolean);
  if (YT_HOSTS.has(host)) {
    let id = "";
    if (host === "youtu.be") id = p[0] || "";
    else if (p[0] === "watch") id = u.searchParams.get("v") || "";
    else if (p[0] === "shorts" || p[0] === "embed" || p[0] === "live") id = p[1] || "";
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return { kind: "youtube", embed: `https://www.youtube.com/embed/${id}` };
  }
  if (VK_HOSTS.has(host)) {
    if (p[0] === "video_ext.php") {
      const oid = u.searchParams.get("oid") || "", id = u.searchParams.get("id") || "", hash = u.searchParams.get("hash") || "";
      if (!/^-?\d+$/.test(oid) || !NUM.test(id) || (hash && !ID.test(hash))) return null;
      return { kind: "vk", embed: `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash ? `&hash=${hash}` : ""}` };
    }
    const m = /^(?:video|clip)(-?\d+)_(\d+)$/.exec(p[p.length - 1] || "") || /(?:^|[?&])z=video(-?\d+)_(\d+)/.exec(u.search);
    if (!m) return null;
    return { kind: "vk", embed: `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}` };
  }
  if (RUTUBE_HOSTS.has(host)) {
    const id = p[0] === "video" || p[0] === "shorts" ? p[1] : p[0] === "play" && p[1] === "embed" ? p[2] : "";
    if (!id || !/^[a-f0-9]{32}$/i.test(id)) return null;
    return { kind: "rutube", embed: `https://rutube.ru/play/embed/${id}` };
  }
  if (KP_HOSTS.has(host)) return { kind: "kinopoisk", open: u.toString() };
  if (u.protocol === "https:" && /\.(mp4|webm|ogv|ogg|m4v)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };
  return null;
}

/** Yuklangan (o'zimizning) fayl havolasi: https va audio/video kengaytmasi. */
export function isMediaFileUrl(raw: unknown, kind: "audio" | "video"): boolean {
  const u = url(raw);
  if (!u || u.protocol !== "https:") return false;
  return kind === "audio" ? /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(u.pathname) : /\.(mp4|webm|ogv|ogg|m4v|mov)$/i.test(u.pathname);
}
