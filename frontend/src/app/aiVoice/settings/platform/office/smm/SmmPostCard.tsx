import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "../../../ui";
import { localMedia } from "../localMedia";
import { addOwnFiles, generateMedia, localBlobs, videoTypeOf } from "./generate";
import { smmApi, SMM_FORMATS, type SmmFormat, type SmmItem, type SmmSettings, type SmmStatus } from "./smmApi";
import { downloadBlob, extOf, fmtBytes, smmStore, smmUrl } from "./smmStore";
import { pickVideoMime, type VideoType } from "./studio";

// SMM post kartasi (owner 2026-10-23): rasm/video ko'rinishi (QURILMADA saqlangan), qayta yaratish (AI / shablon / video),
// yuklab olish, matnni tahrirlash, Telegram / Instagram'ga e'lon (holat va havolalar), avtopilot tasdig'i.
type K = (key: string, o?: Record<string, unknown>) => string;

export const IG_ERRORS = ["tg_channel_invalid", "tg_chat_not_found", "tg_not_channel", "tg_bot_not_admin", "tg_no_post_right", "tg_bot_missing", "tg_unreachable", "tg_failed","ig_not_configured", "public_url_required", "ig_token_invalid", "ig_permission", "ig_rate_limited", "ig_publish_limit", "ig_media_fetch",
  "ig_media_format", "ig_video_format", "ig_jpeg_required", "ig_timeout", "ig_expired", "ig_carousel_count", "ig_media_required", "ig_video_required",
  "ig_user_id_missing", "ig_unreachable", "already_published", "publishing", "telegram_failed", "not_configured", "file_too_large", "no_recorder",
  "media_missing", "rate_limited", "aborted"];
export const smmErr = (e: string | undefined, k: K, o?: Record<string, unknown>) => (e && IG_ERRORS.includes(e) ? k(`err.${e}`, { bot: "@bot", ...o }) : k("err.generic"));

interface Preview { id: string; url: string | null; kind: "image" | "video"; mime?: string; size?: number }

export default function SmmPostCard({ taskId, index, item, settings, status, onChanged, onOpenSettings }: {
  taskId: string; index: number; item: SmmItem; settings: SmmSettings | null; status: SmmStatus | null; onChanged: () => void; onOpenSettings?: () => void;
}) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.smm.${key}`, o) as string;
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [editing, setEditing] = useState(false);
  const [videoType, setVideoType] = useState<VideoType>(videoTypeOf(item.category));
  const [audioId, setAudioId] = useState("");
  const [tracks, setTracks] = useState<{ id: string; name: string }[]>([]);
  const [kind, setKind] = useState<SmmFormat>(item.format || "post");
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const format = item.format || "post";
  const mediaKey = (item.media || []).map((m) => m.id).join(",");

  useEffect(() => { setKind(item.format || "post"); }, [item.format]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const list: Preview[] = [];
      for (const m of item.media || []) list.push({ id: m.id, url: await smmUrl(m.id), kind: m.kind, mime: m.mime, size: m.size });
      if (alive) setPreviews(list);
    })();
    return () => { alive = false; };
  }, [mediaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (format !== "reel") return;
    localMedia.list("audio").then((l) => setTracks(l.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined);
  }, [format]);

  const missing = previews.filter((p) => !p.url).length;
  const recorderMime = useMemo(() => (typeof window !== "undefined" ? pickVideoMime() : null), []);
  const full = [item.title, item.text, (item.hashtags || []).join(" ")].filter(Boolean).join("\n\n");

  const generate = async (mode: "ai" | "template") => {
    if (busy) return;
    setBusy(mode); setProgress(0);
    abort.current = new AbortController();
    try {
      const audio = audioId ? await localMedia.blob(audioId) : null;
      const r = await generateMedia(taskId, index, item, { mode, videoType, audio, onProgress: setProgress, signal: abort.current.signal, lite: (navigator.hardwareConcurrency || 8) <= 4 });
      if (mode === "ai" && !r.ai) toast.message(k("aiUnavailable"));
      else toast.success(format === "reel" ? k("videoReady") : k("imageReady"));
      if (r.webm) toast.message(k("webmNote"));
      onChanged();
    } catch (e) {
      toast.error(smmErr((e as Error)?.message, k));
    } finally {
      setBusy(null); abort.current = null;
    }
  };

  const publish = async (target: "telegram" | "instagram", opts: { force?: boolean; silent?: boolean } = {}) => {
    const { blobs, missing: miss } = await localBlobs(item);
    if (target === "instagram" && (!blobs.length || miss)) { if (!opts.silent) toast.error(k("err.media_missing")); return false; }
    setBusy(target);
    const r = await smmApi.publish(taskId, index, { target, kind: target === "instagram" ? kind : undefined, tgTarget: "channel", force: opts.force }, blobs);
    setBusy(null);
    if (!r.ok) { toast.error(smmErr(r.error, k, { bot: status?.telegram.botUsername ? `@${status.telegram.botUsername}` : "@bot" }) + (r.errorData?.detail ? ` — ${r.errorData.detail}` : "")); onChanged(); return false; }
    if (target === "telegram") {
      if (r.data?.sentTo === "developer") toast.message(k("sentToMe"), onOpenSettings ? { action: { label: k("connectChannel"), onClick: onOpenSettings } } : undefined);
      else toast.success(k("sentChannel"));
    }
    else toast.success(k("igQueued"));
    onChanged();
    return true;
  };

  /** Avtopilot posti: rasm/video yo'q bo'lsa — shu qurilmada yaratiladi, so'ng sozlangan joylarga e'lon va tasdiq. */
  const approve = async () => {
    if (busy) return;
    let it = item;
    if (!(item.media || []).some((m) => m.id.startsWith("loc_")) || missing) {
      setBusy("approve");
      try {
        const g = await generateMedia(taskId, index, item, { mode: "ai", videoType, onProgress: setProgress });
        it = { ...item, media: g.media };
      } catch (e) { setBusy(null); toast.error(smmErr((e as Error)?.message, k)); return; }
    }
    setBusy("approve");
    const { blobs } = await localBlobs(it);
    const results: string[] = [];
    if (settings?.targets.instagram !== false && status?.instagram.configured) {
      const r = await smmApi.publish(taskId, index, { target: "instagram", kind: it.format || "post" }, blobs);
      results.push(r.ok ? k("igQueued") : `Instagram: ${smmErr(r.error, k)}`);
    }
    if (settings?.targets.telegram !== false && status?.telegram.bot) {
      const r = await smmApi.publish(taskId, index, { target: "telegram", tgTarget: "channel" }, blobs);
      results.push(r.ok ? (r.data?.sentTo === "developer" ? k("sentToMe") : k("sentChannel")) : `Telegram: ${smmErr(r.error, k)}`);
    }
    const a = await smmApi.approval(taskId, index, "approved");
    setBusy(null);
    if (!a.ok) toast.error(smmErr(a.error, k));
    else toast.success([k("approved"), ...results].join(" · "));
    onChanged();
  };
  const reject = async () => {
    const r = await smmApi.approval(taskId, index, "rejected");
    if (!r.ok) toast.error(smmErr(r.error, k));
    onChanged();
  };

  const download = async (p: Preview, i: number) => {
    const r = await smmStore.get(p.id);
    if (r) downloadBlob(r.blob, `qurilisherp-${taskId.slice(-6)}-${index + 1}-${i + 1}.${extOf(r.blob.type)}`);
  };
  const removeLocal = async () => {
    for (const p of previews) await smmStore.remove(p.id);
    await smmApi.setMedia(taskId, index, []);
    onChanged();
  };
  const onFiles = async (fl: FileList | null) => {
    if (!fl?.length) return;
    await addOwnFiles(taskId, index, item, [...fl]);
    onChanged();
  };

  const ig = item.ig, tg = item.tg;
  const btn = "h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50";
  return (
    <div className="rounded-lg border border-border px-2.5 py-2 space-y-1.5" data-testid={`ai-office-item-${index}`}>
      {item.approval === "pending" && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 space-y-1.5" data-testid="smm-approval">
          <p className="text-[11.5px] font-semibold">{k("pending")}</p>
          <p className="text-[11px] text-muted-foreground">{k("pendingHint")}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={approve} disabled={!!busy} data-testid="smm-approve" className="h-7 px-3 rounded-full bg-emerald-600 text-white text-[11.5px] font-semibold disabled:opacity-50">{busy === "approve" ? k("working") : k("approve")}</button>
            <button type="button" onClick={reject} disabled={!!busy} className={btn}>{k("reject")}</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Badge tone="sky">{k(`formats.${format}`)}</Badge>
        {item.category && <Badge>{k(`cats.${item.category}`)}</Badge>}
        {item.approval === "approved" && <Badge tone="green">{k("approvedBadge")}</Badge>}
        {item.approval === "rejected" && <Badge tone="red">{k("rejectedBadge")}</Badge>}
      </div>

      {/* Ko'rinish (qurilmadagi fayllar) */}
      {previews.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="smm-preview">
          {previews.map((p, i) => (
            <div key={p.id} className="relative flex-shrink-0">
              {!p.url ? (
                <div className="w-28 h-36 rounded-lg bg-muted/50 grid place-items-center text-[10.5px] text-muted-foreground text-center px-2">{item.media?.[i]?.source?.startsWith("server") ? k("serverEphemeral") : k("notOnDevice")}</div>
              ) : p.kind === "video" ? (
                <video src={p.url} controls playsInline className="h-52 rounded-lg bg-black" data-testid="smm-preview-video" />
              ) : (
                <img src={p.url} alt={item.title} className={`${previews.length > 1 ? "h-40" : "max-h-72 w-full"} rounded-lg object-contain bg-muted/30`} data-testid="smm-preview-img" />
              )}
              {p.url && (
                <button type="button" onClick={() => download(p, i)} aria-label={k("download")} className="absolute bottom-1 right-1 h-6 px-2 rounded-full bg-black/60 text-white text-[10.5px] font-semibold">{k("save")}{p.size ? ` · ${fmtBytes(p.size)}` : ""}</button>
              )}
            </div>
          ))}
        </div>
      )}
      {busy && (busy === "ai" || busy === "template" || busy === "approve") && format === "reel" && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">{k("recording")}
            <button type="button" onClick={() => abort.current?.abort()} className="underline">{k("stop")}</button></div>
        </div>
      )}

      {editing ? (
        <EditForm item={item} k={k} onCancel={() => setEditing(false)} onSave={async (b) => {
          const r = await smmApi.edit(taskId, index, b);
          if (!r.ok) { toast.error(smmErr(r.error, k)); return; }
          toast.success(k("saved")); setEditing(false); onChanged();
        }} />
      ) : (
        <>
          {item.title && <p className="text-[12.5px] font-bold">{item.title}</p>}
          <p className="text-[12.5px] whitespace-pre-wrap break-words">{item.text}</p>
          {!!item.hashtags?.length && <p className="text-[11.5px] text-sky-700 dark:text-sky-300">{item.hashtags.join(" ")}</p>}
          {item.editorNotes && (
            <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/40 px-2 py-1.5 whitespace-pre-wrap" data-testid="smm-editor-notes">
              <b>{k("editorNotes")}</b> {item.editorNotes}
            </p>
          )}
        </>
      )}

      {/* Rasm / video */}
      <div className="flex flex-wrap items-center gap-1.5">
        {format === "reel" && (
          <>
            <select value={videoType} onChange={(e) => setVideoType(e.target.value as VideoType)} aria-label={k("videoType")} className="h-7 rounded-full border border-border bg-background px-2 text-[11.5px]">
              {(["promo", "problem", "tip"] as VideoType[]).map((v) => <option key={v} value={v}>{k(`vtypes.${v}`)}</option>)}
            </select>
            {tracks.length > 0 && (
              <select value={audioId} onChange={(e) => setAudioId(e.target.value)} aria-label={k("music")} className="h-7 max-w-[9rem] rounded-full border border-border bg-background px-2 text-[11.5px]">
                <option value="">{k("noMusic")}</option>
                {tracks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
          </>
        )}
        <button type="button" className={btn} disabled={!!busy} onClick={() => generate("ai")} data-testid="smm-gen-ai">
          {busy === "ai" ? k("working") : format === "reel" ? k("makeVideo") : previews.length ? k("regenAi") : k("makeAi")}
        </button>
        <button type="button" className={btn} disabled={!!busy} onClick={() => generate("template")} data-testid="smm-gen-template">
          {busy === "template" ? k("working") : format === "reel" ? k("makeVideoNoAi") : k("makeTemplate")}
        </button>
        <button type="button" className={btn} disabled={!!busy} onClick={() => fileRef.current?.click()}>{k("ownFile")}</button>
        <input ref={fileRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        {previews.some((p) => p.url) && <button type="button" className={`${btn} text-red-600`} onClick={removeLocal}>{k("deleteLocal")}</button>}
      </div>
      {format === "reel" && recorderMime && !recorderMime.startsWith("video/mp4") && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300" data-testid="smm-webm-note">{status?.ffmpeg ? k("webmServer") : k("webmNoServer")}</p>
      )}

      {/* E'lon */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <button type="button" onClick={() => navigator.clipboard.writeText(full).then(() => toast.success(k("copied")), () => toast.error(k("err.generic")))} className={btn}>{k("copy")}</button>
        <button type="button" className={btn} disabled={!!busy} onClick={() => publish("telegram")} data-testid="smm-pub-tg">{busy === "telegram" ? k("working") : status?.telegram.channel ? k("toChannel") : k("toBotSelf")}</button>
        <select value={kind} onChange={(e) => setKind(e.target.value as SmmFormat)} aria-label={k("igKind")} className="h-7 rounded-full border border-border bg-background px-2 text-[11.5px]" data-testid="smm-ig-kind">
          {SMM_FORMATS.map((f) => <option key={f} value={f}>{k(`formats.${f}`)}</option>)}
        </select>
        <button type="button" className={btn} disabled={!!busy || ig?.status === "publishing"} onClick={() => publish("instagram", { force: ig?.status === "published" })} data-testid="smm-pub-ig">
          {busy === "instagram" || ig?.status === "publishing" ? k("igPublishing") : ig?.status === "published" ? k("toInstagramAgain") : k("toInstagram")}
        </button>
        <button type="button" className={btn} onClick={() => setEditing((v) => !v)} data-testid="smm-edit">{k("edit")}</button>
      </div>

      {(tg || ig) && (
        <div className="flex flex-wrap gap-1.5 text-[11px]" data-testid="smm-pub-status">
          {tg && <PubBadge label="Telegram" s={tg} k={k} />}
          {ig && <PubBadge label="Instagram" s={ig} k={k} />}
        </div>
      )}
    </div>
  );
}

function PubBadge({ label, s, k }: { label: string; s: NonNullable<SmmItem["ig"]>; k: K }) {
  const tone = s.status === "published" ? "green" : s.status === "failed" ? "red" : "amber";
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <Badge tone={tone}>{label}: {k(`pub.${s.status}`)}{s.kind ? ` · ${k(`formats.${s.kind}`)}` : ""}</Badge>
      {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline font-semibold" data-testid={`smm-link-${label.toLowerCase()}`}>{k("open")}</a>}
      {s.status === "failed" && <span className="text-red-600">{smmErr(s.error, k)}{s.detail ? ` — ${s.detail}` : ""}</span>}
    </span>
  );
}

function EditForm({ item, k, onSave, onCancel }: { item: SmmItem; k: K; onCancel: () => void; onSave: (b: { title: string; text: string; hashtags: string; format: SmmFormat; scenes: { title: string; text: string }[] }) => void }) {
  const [f, setF] = useState({ title: item.title, text: item.text, hashtags: (item.hashtags || []).join(" "), format: (item.format || "post") as SmmFormat, scenes: item.scenes || [] });
  const input = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]";
  return (
    <div className="space-y-1.5" data-testid="smm-edit-form">
      <label className="block text-[11px] text-muted-foreground">{k("f.title")}<input className={input} value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="block text-[11px] text-muted-foreground">{k("f.text")}<textarea className={input} rows={6} value={f.text} maxLength={4000} onChange={(e) => setF({ ...f, text: e.target.value })} data-testid="smm-edit-text" /></label>
      <p className="text-[10.5px] text-muted-foreground text-right">{f.text.length} / 2200 · Telegram caption ≤ 1024</p>
      <label className="block text-[11px] text-muted-foreground">{k("f.hashtags")}<input className={input} value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} /></label>
      <label className="block text-[11px] text-muted-foreground">{k("f.format")}
        <select className={input} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as SmmFormat })}>
          {SMM_FORMATS.map((x) => <option key={x} value={x}>{k(`formats.${x}`)}</option>)}
        </select>
      </label>
      <p className="text-[11px] font-semibold text-muted-foreground">{k("f.scenes")}</p>
      {f.scenes.map((s, i) => (
        <div key={i} className="flex gap-1.5">
          <input className={`${input} w-2/5`} value={s.title} maxLength={120} placeholder={k("f.sceneTitle")} onChange={(e) => setF({ ...f, scenes: f.scenes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
          <input className={input} value={s.text} maxLength={400} placeholder={k("f.sceneText")} onChange={(e) => setF({ ...f, scenes: f.scenes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
          <button type="button" aria-label={k("f.remove")} onClick={() => setF({ ...f, scenes: f.scenes.filter((_, j) => j !== i) })} className="px-2 text-muted-foreground hover:text-red-600">×</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {f.scenes.length < 8 && <button type="button" onClick={() => setF({ ...f, scenes: [...f.scenes, { title: "", text: "" }] })} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold">{k("f.addScene")}</button>}
        <button type="button" onClick={() => onSave(f)} disabled={!f.text.trim()} data-testid="smm-edit-save" className="h-7 px-3 rounded-full bg-primary text-primary-foreground text-[11.5px] font-semibold disabled:opacity-50">{k("f.save")}</button>
        <button type="button" onClick={onCancel} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold">{k("f.cancel")}</button>
      </div>
    </div>
  );
}
