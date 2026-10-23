import { describe, it, expect } from "vitest";
import { isMediaFileUrl, parseVideoLink, parseYandexMusic } from "./media";

describe("Yandex Musiqa havolasi", () => {
  it("albom, trek, pleylist → rasmiy iframe", () => {
    expect(parseYandexMusic("https://music.yandex.ru/album/123/track/456")?.embed).toBe("https://music.yandex.ru/iframe/#track/456/123");
    expect(parseYandexMusic("https://music.yandex.uz/album/777")?.embed).toBe("https://music.yandex.ru/iframe/#album/777");
    expect(parseYandexMusic("https://music.yandex.ru/users/ivan.petrov/playlists/1003?utm_source=x")?.embed).toBe("https://music.yandex.ru/iframe/#playlist/ivan.petrov/1003");
    expect(parseYandexMusic("https://music.yandex.com/track/42")?.embed).toBe("https://music.yandex.ru/iframe/#track/42");
  });
  it("begona xost va noto'g'ri yo'llar rad etiladi", () => {
    for (const bad of [
      "https://music.yandex.ru.evil.com/album/1", "https://evil.com/music.yandex.ru/album/1", "https://user@music.yandex.ru/album/1",
      "javascript:alert(1)", "https://music.yandex.ru:8443/album/1", "https://music.yandex.ru/album/abc", "https://music.yandex.ru/", "", null, 42,
      "https://music.yandex.ru/users/a b/playlists/1",
    ]) expect(parseYandexMusic(bad), String(bad)).toBeNull();
  });
});

describe("Kino havolasi", () => {
  it("YouTube", () => {
    expect(parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toEqual({ kind: "youtube", embed: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
    expect(parseVideoLink("https://youtu.be/dQw4w9WgXcQ")).toEqual({ kind: "youtube", embed: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
    expect(parseVideoLink("https://youtube.com/shorts/abcdefghijk")?.kind).toBe("youtube");
    expect(parseVideoLink("https://www.youtube.com/watch?v=<script>")).toBeNull();
    expect(parseVideoLink("https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("VK Video", () => {
    expect(parseVideoLink("https://vk.com/video-12345_67890")).toEqual({ kind: "vk", embed: "https://vk.com/video_ext.php?oid=-12345&id=67890" });
    expect(parseVideoLink("https://vkvideo.ru/video-1_2")?.kind).toBe("vk");
    expect(parseVideoLink("https://vk.com/video_ext.php?oid=-1&id=2&hash=abc123")).toEqual({ kind: "vk", embed: "https://vk.com/video_ext.php?oid=-1&id=2&hash=abc123" });
    expect(parseVideoLink("https://vk.com/video_ext.php?oid=-1&id=2&hash=a\"b")).toBeNull();
    expect(parseVideoLink("https://vk.com/id1")).toBeNull();
  });
  it("Rutube", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(parseVideoLink(`https://rutube.ru/video/${id}/`)).toEqual({ kind: "rutube", embed: `https://rutube.ru/play/embed/${id}` });
    expect(parseVideoLink("https://rutube.ru/video/short/")).toBeNull();
  });
  it("Kinopoisk — faqat ochish (DRM / X-Frame-Options)", () => {
    expect(parseVideoLink("https://hd.kinopoisk.ru/film/abc")).toEqual({ kind: "kinopoisk", open: "https://hd.kinopoisk.ru/film/abc" });
    expect(parseVideoLink("https://www.kinopoisk.ru/film/326/")?.kind).toBe("kinopoisk");
  });
  it("to'g'ridan-to'g'ri fayl (faqat https)", () => {
    expect(parseVideoLink("https://cdn.example.com/movie.mp4")).toEqual({ kind: "file", src: "https://cdn.example.com/movie.mp4" });
    expect(parseVideoLink("http://cdn.example.com/movie.mp4")).toBeNull();
    expect(parseVideoLink("https://cdn.example.com/movie.exe")).toBeNull();
    expect(isMediaFileUrl("https://res.cloudinary.com/x/song.mp3", "audio")).toBe(true);
    expect(isMediaFileUrl("http://res.cloudinary.com/x/song.mp3", "audio")).toBe(false);
    expect(isMediaFileUrl("https://x/clip.mp4", "video")).toBe(true);
  });
});

describe("Yandex Musiqa — yangi ulashish havolalari (owner 2026-10-23)", () => {
  it("/playlists/{id}?utm_... , iframe HTML-kodi va eski xesh ko'rinishi qabul qilinadi; begona xost yo'q", () => {
    expect(parseYandexMusic("https://music.yandex.ru/playlists/lk.3f2a9c1e-1111-2222-3333-444455556666?utm_source=desktop&utm_medium=copy_link"))
      .toEqual({ kind: "yandex", embed: "https://music.yandex.ru/iframe/playlists/lk.3f2a9c1e-1111-2222-3333-444455556666", label: "playlist lk.3f2a9c1e-1111-2222-3333-444455556666" });
    expect(parseYandexMusic('<iframe frameborder="0" src="https://music.yandex.ru/iframe/album/123/track/456" width="100%"></iframe>')?.embed)
      .toBe("https://music.yandex.ru/iframe/#track/456/123");
    expect(parseYandexMusic("https://music.yandex.ru/iframe/#playlist/jahon/1001")?.embed).toBe("https://music.yandex.ru/iframe/#playlist/jahon/1001");
    expect(parseYandexMusic("https://music.yandex.ru/album/123?utm_source=desktop&utm_medium=copy_link")?.embed).toBe("https://music.yandex.ru/iframe/#album/123");
    expect(parseYandexMusic("https://evil.example/playlists/lk.abc")).toBeNull();
    expect(parseYandexMusic('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
  });
});

