import { smmApi, type MediaMeta, type SmmFormat, type SmmItem } from "./smmApi";
import { smmStore } from "./smmStore";
import { buildScenes, loadImage, loadShots, pickShot, recordVideo, renderCarousel, renderStill, type Aspect, type VideoType } from "./studio";

// Post uchun rasm/video yaratish (QURILMADA) va e'lon qilish (fayllar vaqtincha serverga). Owner 2026-10-23.

export const BADGE: Record<string, string> = { feature: "Imkoniyat", tip: "Maslahat", case: "Tajriba", problem: "Muammo → yechim", news: "Yangilik" };
export const videoTypeOf = (category?: string): VideoType => (category === "problem" || category === "case" ? "problem" : category === "tip" ? "tip" : "promo");
export const aspectOf = (f: SmmFormat): Aspect => (f === "story" || f === "reel" ? "9:16" : "4:5");
const firstSentence = (s: string) => (/^(.{20,}?[.!?])\s/.exec(String(s || "").replace(/\s+/g, " ").trim())?.[1] || String(s || "").slice(0, 140));

function b64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

export interface GenOpts { mode: "ai" | "template"; videoType?: VideoType; audio?: Blob | null; lite?: boolean; onProgress?: (p: number) => void; signal?: AbortSignal }
export interface GenResult { media: MediaMeta[]; ai: boolean; aiUnavailable?: string; webm?: boolean }

/** Item formatiga qarab: post/story — 1 rasm, karusel — 3–6 slayd, reels — video (9:16). Eski mahalliy fayllar almashtiriladi. */
export async function generateMedia(taskId: string, index: number, it: SmmItem, o: GenOpts): Promise<GenResult> {
  const format = it.format || "post";
  const aspect = aspectOf(format);
  let bg: HTMLImageElement | null = null;
  let aiUnavailable: string | undefined;
  if (o.mode === "ai") {
    const r = await smmApi.aiImage({ taskId, index, aspect: format === "carousel" ? "4:5" : aspect });
    if (r.ok && r.data?.data) bg = await loadImage(b64ToBlob(r.data.data, r.data.mime));
    else aiUnavailable = r.errorData?.reason || r.error || "failed";
  }
  const badge = BADGE[it.category || ""] || "QurilishERP";
  const base = { title: it.title || it.topic || "QurilishERP", text: it.text, topic: it.topic, category: it.category, scenes: it.scenes };
  const out: { blob: Blob; kind: "image" | "video"; w: number; h: number }[] = [];
  let webm = false;
  if (format === "reel") {
    const v = await recordVideo(buildScenes(base, o.videoType || videoTypeOf(it.category)), { aspect: "9:16", bg, audio: o.audio, lite: o.lite, onProgress: o.onProgress, signal: o.signal });
    webm = !v.mp4;
    out.push({ blob: v.blob, kind: "video", w: v.w, h: v.h });
  } else if (format === "carousel") {
    for (const b of await renderCarousel(base, bg, badge)) out.push({ blob: b, kind: "image", w: 1080, h: 1350 });
  } else {
    const shots = bg ? null : await loadShots([pickShot(`${it.topic || ""} ${it.title} ${it.text}`)]);
    const r = await renderStill({ aspect, title: base.title, subtitle: it.scenes?.[0]?.text || firstSentence(it.text), badge, bg, shot: shots ? [...shots.values()][0] || null : null });
    out.push({ blob: r.blob, kind: "image", w: r.w, h: r.h });
  }
  // Eski (shu post uchun) mahalliy fayllar o'chiriladi — qurilma xotirasi to'lmasin
  for (const m of it.media || []) if (m.id.startsWith("loc_")) await smmStore.remove(m.id).catch(() => undefined);
  const source = o.mode === "ai" && bg ? "ai" : format === "reel" ? "code" : "template";
  const media: MediaMeta[] = [];
  for (const f of out) {
    const m = await smmStore.put(f.blob, { kind: f.kind, w: f.w, h: f.h, source, taskId, index, title: it.title });
    media.push({ id: m.id, kind: m.kind, mime: m.mime, w: m.w, h: m.h, size: m.size, source });
  }
  await smmApi.setMedia(taskId, index, media);
  return { media, ai: !!bg, aiUnavailable, webm };
}

/** Qurilmadan fayl qo'shish (o'z rasmi / reels uchun mp4). */
export async function addOwnFiles(taskId: string, index: number, it: SmmItem, files: File[]): Promise<MediaMeta[]> {
  const media: MediaMeta[] = [...(it.media || [])].filter((m) => m.id.startsWith("loc_"));
  for (const f of files.slice(0, 10)) {
    const kind = f.type.startsWith("video/") ? "video" : "image";
    const m = await smmStore.put(f, { kind, source: "upload", taskId, index, title: it.title });
    media.push({ id: m.id, kind, mime: m.mime, size: m.size, source: "upload" });
  }
  const list = media.slice(-10);
  await smmApi.setMedia(taskId, index, list);
  return list;
}

/** Mahalliy fayllar (shu qurilmada bo'lsa). missing — boshqa qurilmada yaratilganlar. */
export async function localBlobs(it: SmmItem): Promise<{ blobs: Blob[]; missing: number }> {
  const blobs: Blob[] = [];
  let missing = 0;
  for (const m of it.media || []) {
    const r = await smmStore.get(m.id);
    if (r) blobs.push(r.blob); else missing++;
  }
  return { blobs, missing };
}
