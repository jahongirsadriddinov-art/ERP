import { api } from "../../../../../api";
import { call, type ApiResult } from "../../../api";

// SMM (owner 2026-10-23): rasmli postlar, Telegram / Instagram e'loni, avtopilot, statistika. Faqat dasturchi.
// Rasm/videolar QURILMADA (smmStore — IndexedDB); serverga faqat e'lon paytida vaqtincha yuboriladi.

export type SmmFormat = "post" | "carousel" | "reel" | "story";
export const SMM_FORMATS: SmmFormat[] = ["post", "carousel", "reel", "story"];
export type SmmMode = "off" | "approve" | "auto";
export interface MediaMeta { id: string; kind: "image" | "video"; mime?: string; w?: number; h?: number; size?: number; source?: string; at?: string }
export interface PubState { status: "publishing" | "published" | "failed"; at?: string; kind?: string; target?: string; url?: string; error?: string; detail?: string }
export interface SmmItem {
  title: string; text: string; hashtags?: string[]; format?: SmmFormat; lang?: string; topic?: string; category?: string; imagePrompt?: string;
  scenes?: { title: string; text: string }[]; media?: MediaMeta[]; approval?: "pending" | "approved" | "rejected"; tg?: PubState; ig?: PubState;
}
export interface SmmSettings {
  mode: SmmMode; days: number[]; times: string[]; formats: SmmFormat[]; language: "uz" | "ru" | "both";
  targets: { telegram: boolean; instagram: boolean }; dailyCap: number; paused: boolean; perWeek: number; next?: string; envKill: boolean;
}
export interface SmmStatus {
  telegram: { bot: boolean; channel: boolean; channelName?: string; devChat: boolean; viewsAvailable: boolean };
  instagram: { configured: boolean; userIdSet: boolean; via: "instagram" | "facebook"; appSet: boolean; username?: string; expiresAt?: string; lastRefreshAt?: string; refreshError?: string; publicUrl: boolean; secretsKey: boolean };
  gemini: { configured: boolean; imageModel: string };
  ffmpeg: boolean;
  items: { key: string; ok: boolean | null; required: boolean; for: "telegram" | "instagram" | "content" }[];
}
export interface SmmRunRow { key: string; status: string; mode?: string; format?: string; category?: string; topic?: string; taskId?: string; note?: string; at: string }
export interface SmmPostStat { taskId: string; index: number; title: string; kind: string; url?: string; publishedAt: string; metrics: Record<string, number>; engagement: number; reach: number; updatedAt?: string }
export interface SmmAnalytics {
  configured: boolean; updatedAt?: string; totals: Record<string, number>; posts: SmmPostStat[];
  account: { history: { date: string; followers: number | null; reach: number | null; profileViews: number | null; views: number | null }[]; latest: Record<string, number | string> | null };
  byFormat: { key: string; n: number; avgEngagement: number; avgReach: number }[];
  byHour: { key: number; n: number; avgEngagement: number; avgReach: number }[];
  best: { format: string | null; hour: number | null }; telegram: { sent: number; viewsAvailable: boolean };
}

const item = (id: string, i: number) => `/platform/agent-tasks/${id}/items/${i}`;

export const smmApi = {
  settings: () => call<{ settings: SmmSettings; status: SmmStatus }>("GET", "/platform/smm/settings"),
  saveSettings: (b: Partial<Omit<SmmSettings, "perWeek" | "next" | "envKill">>) => call<{ ok: true; settings: SmmSettings }>("PUT", "/platform/smm/settings", b),
  runs: () => call<{ runs: SmmRunRow[] }>("GET", "/platform/smm/runs"),
  igCheck: () => call<{ ok: true; username: string; followers?: number; mediaCount?: number }>("POST", "/platform/smm/instagram/check", {}),
  igRefresh: () => call<{ ok: true; expiresAt?: string }>("POST", "/platform/smm/instagram/refresh", {}),
  aiImage: (b: { taskId: string; index: number; aspect: "1:1" | "4:5" | "9:16"; prompt?: string }) =>
    call<{ mime: string; data: string; source: "ai" }>("POST", "/platform/smm/image", b),
  edit: (id: string, i: number, b: Partial<Pick<SmmItem, "title" | "text" | "format" | "scenes">> & { hashtags?: string[] | string }) =>
    call<{ ok: true; item: SmmItem }>("PATCH", item(id, i), b),
  setMedia: (id: string, i: number, media: MediaMeta[]) => call<{ ok: true; item: SmmItem }>("PUT", `${item(id, i)}/media`, { media }),
  approval: (id: string, i: number, decision: "approved" | "rejected") => call<{ ok: true; item: SmmItem }>("POST", `${item(id, i)}/approval`, { decision }),
  analytics: () => call<SmmAnalytics>("GET", "/platform/smm/analytics"),
  refreshAnalytics: () => call<{ ok: true; media: number; summary: SmmAnalytics }>("POST", "/platform/smm/analytics/refresh", {}),
  /** E'lon — fayllar VAQTINCHA yuboriladi (multipart). */
  async publish(id: string, i: number, b: { target: "telegram" | "instagram"; kind?: SmmFormat; tgTarget?: "channel" | "developer"; force?: boolean }, files: Blob[]):
    Promise<ApiResult<{ ok: true; sentTo?: "channel" | "developer"; url?: string; pending?: boolean }>> {
    const fd = new FormData();
    fd.set("target", b.target);
    if (b.kind) fd.set("kind", b.kind);
    if (b.tgTarget) fd.set("tgTarget", b.tgTarget);
    if (b.force) fd.set("force", "true");
    files.forEach((f, n) => fd.append("files", f, `smm-${n}.${f.type === "video/mp4" ? "mp4" : f.type === "video/webm" ? "webm" : f.type === "image/png" ? "png" : "jpg"}`));
    try {
      const r = await fetch(api(`/api/ai-voice${item(id, i)}/publish`), { method: "POST", body: fd, cache: "no-store" });
      const data = await r.json().catch(() => null);
      if (r.ok) return { ok: true, status: r.status, data, error: "" };
      return { ok: false, status: r.status, data: undefined as never, error: String(data?.error || `http_${r.status}`), errorData: data };
    } catch {
      return { ok: false, status: 0, data: undefined as never, error: "network" };
    }
  },
};
