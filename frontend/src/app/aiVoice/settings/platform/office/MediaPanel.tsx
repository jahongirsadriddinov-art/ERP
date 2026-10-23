import "../../../../i18n/aiVoiceNs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadChatMedia } from "../../../../api";
import { officeApi, type OfficeMedia } from "./officeApi";
import { isMediaFileUrl, parseVideoLink, parseYandexMusic } from "./media";
import { player, sound, useMuted, usePlayer } from "./sound";
import { openExternalUrl } from "../../../../platform";

// AI ofis — musiqa va kino boshqaruvi (owner 2026-10-23):
//  • Musiqa: Yandex Musiqa ulashish havolasi → rasmiy iframe vidjeti; o'z qo'shiqlari (yuklash) — pleylist, play/pause/keyingi/ovoz;
//  • Kino: YouTube / VK Video / Rutube / mp4-webm havola yoki yuklangan video — kinozal ekranida; Kinopoisk — faqat "ochish".
// Hammasi serverda saqlanadi (/platform/office/media — faqat dasturchi). Ovoz o'chiq bo'lsa — vidjet yuklanmaydi.
type K = (key: string, o?: any) => string;

export function MuteButton({ k, dark = false }: { k: K; dark?: boolean }) {
  const muted = useMuted();
  return (
    <button type="button" onClick={() => sound.setMuted(!muted)} aria-pressed={!muted} data-testid="ai-office-mute" title={muted ? k("media.unmute") : k("media.mute")}
      className={dark ? "h-9 px-3 rounded-full bg-black/60 text-white text-[13px] font-semibold backdrop-blur" : "h-8 px-3 rounded-full border border-border bg-card/60 text-[12px] font-semibold inline-flex items-center gap-1.5"}>
      {muted ? "🔇" : "🔊"}<span className="sr-only">{muted ? k("media.unmute") : k("media.mute")}</span>
    </button>
  );
}

export default function MediaPanel({ media, onSaved, onClose }: { media: OfficeMedia; onSaved: (m: OfficeMedia) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const [tab, setTab] = useState<"music" | "cinema">("music");
  const [yandex, setYandex] = useState(media.yandex);
  const [cinema, setCinema] = useState(media.cinema);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const muted = useMuted();
  const ps = usePlayer();
  const fileA = useRef<HTMLInputElement>(null), fileV = useRef<HTMLInputElement>(null);
  useEffect(() => { player.setTracks(media.tracks); }, [media.tracks]);

  const save = async (b: Partial<OfficeMedia>) => {
    setBusy(true); setErr(null);
    const r = await officeApi.saveMedia(b);
    setBusy(false);
    if (r.ok && r.data) { onSaved(r.data.media); return true; }
    setErr(k("media.invalid"));
    return false;
  };
  const ym = parseYandexMusic(media.yandex);
  const vid = parseVideoLink(media.cinema) || (isMediaFileUrl(media.cinema, "video") ? { kind: "file" as const, src: media.cinema } : null);

  const upload = async (f: File | undefined, kind: "audio" | "video") => {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const r = await uploadChatMedia(f, f.name);
      if (kind === "audio") await save({ tracks: [...media.tracks, { id: Math.random().toString(36).slice(2, 10), name: f.name.replace(/\.[^.]+$/, ""), url: r.url }] });
      else { setCinema(r.url); await save({ cinema: r.url }); }
    } catch { setErr(k("errors.generic")); }
    setBusy(false);
  };

  const input = "flex-1 min-w-0 h-9 rounded-xl border border-border bg-background px-3 text-[13px]";
  const btn = "h-9 px-3.5 rounded-full bg-primary text-primary-foreground text-[12.5px] font-semibold disabled:opacity-50";
  return (
    <div className="w-[min(380px,calc(100vw-16px))] max-h-[min(80vh,620px)] flex flex-col rounded-2xl bg-card text-foreground border border-border shadow-2xl" data-testid="ai-office-media">
      <div className="flex items-center gap-1 p-2 border-b border-border">
        {(["music", "cinema"] as const).map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)} aria-pressed={tab === x} data-testid={`ai-office-media-tab-${x}`}
            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold ${tab === x ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>
            {x === "music" ? "🎵 " : "🎬 "}{k(`media.${x}`)}
          </button>
        ))}
        <span className="ml-auto" />
        <MuteButton k={k} />
        <button type="button" onClick={onClose} aria-label={k("close")} className="w-8 h-8 rounded-full grid place-items-center hover:bg-muted">✕</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {tab === "music" ? (
          <>
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Yandex Music</p>
              <div className="flex gap-1.5">
                <input value={yandex} onChange={(e) => setYandex(e.target.value)} placeholder="https://music.yandex.ru/playlists/… (Ulashish → Havolani nusxalash)" className={input} data-testid="ai-office-yandex" />
                <button type="button" disabled={busy || (!!yandex.trim() && !parseYandexMusic(yandex))} onClick={() => save({ yandex: yandex.trim() })} className={btn} data-testid="ai-office-yandex-save">{k("media.save")}</button>
              </div>
              {!!yandex.trim() && !parseYandexMusic(yandex) && <p className="text-[11.5px] text-red-600" data-testid="ai-office-yandex-invalid">{k("media.badYandex")}</p>}
              {/* "Mening to'lqinim", pleylistlarim, qidiruv — Yandex'ning o'zida (ochiq API yo'q, faqat rasmiy vidjet joylanadi) */}
              <div className="flex flex-wrap gap-1.5" data-testid="ai-office-yandex-links">
                {[
                  { k: "wave", label: "🌊 Moya volna", url: "https://music.yandex.ru/" },
                  { k: "mine", label: "❤️ Mening pleylistlarim", url: "https://music.yandex.ru/home/collection" },
                  { k: "search", label: "🔍 Qo'shiq qidirish", url: "https://music.yandex.ru/search" },
                ].map((b) => (
                  <button key={b.k} type="button" onClick={() => void openExternalUrl(b.url)} data-testid={`ai-office-yandex-open-${b.k}`}
                    className="h-8 px-3 rounded-full bg-muted text-[12px] font-semibold hover:bg-muted/70">{b.label}</button>
                ))}
              </div>
              {ym && (muted ? (
                <p className="text-[11.5px] text-muted-foreground rounded-xl bg-muted/50 px-3 py-2">{k("media.mutedHint")}</p>
              ) : (
                <iframe title="Yandex Music" src={ym.embed} className="w-full h-[180px] rounded-xl border-0" allow="autoplay; encrypted-media" data-testid="ai-office-yandex-frame"
                  sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="strict-origin-when-cross-origin" />
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex-1">{k("media.mySongs")}</p>
                <input ref={fileA} type="file" accept="audio/*" hidden onChange={(e) => { upload(e.target.files?.[0], "audio"); e.target.value = ""; }} data-testid="ai-office-track-file" />
                <button type="button" onClick={() => fileA.current?.click()} disabled={busy} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold">＋ {k("media.upload")}</button>
              </div>
              {!media.tracks.length && <p className="text-[11.5px] text-muted-foreground">{k("media.noSongs")}</p>}
              {media.tracks.map((tr, i) => (
                <div key={tr.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${ps.index === i && ps.playing ? "border-primary bg-primary/5" : "border-border"}`}>
                  <button type="button" onClick={() => (ps.index === i && ps.playing ? player.pause() : player.play(i))} className="w-8 h-8 rounded-full bg-muted grid place-items-center" data-testid={`ai-office-track-play-${i}`}>
                    {ps.index === i && ps.playing ? "⏸" : "▶"}
                  </button>
                  <span className="flex-1 min-w-0 truncate text-[12.5px]">{tr.name}</span>
                  <button type="button" onClick={() => save({ tracks: media.tracks.filter((x) => x.id !== tr.id) })} aria-label={k("actions.remove")} className="w-7 h-7 rounded-full hover:bg-muted text-muted-foreground">✕</button>
                </div>
              ))}
              {!!media.tracks.length && (
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={() => player.toggle()} className="w-9 h-9 rounded-full bg-foreground text-background" data-testid="ai-office-player-toggle">{ps.playing ? "⏸" : "▶"}</button>
                  <button type="button" onClick={() => player.next()} className="w-9 h-9 rounded-full bg-muted">⏭</button>
                  <input type="range" min={0} max={1} step={0.05} value={ps.volume} onChange={(e) => player.setVolume(Number(e.target.value))} className="flex-1" aria-label={k("media.volume")} />
                </div>
              )}
              {muted && ps.playing && <p className="text-[11px] text-amber-600">{k("media.mutedHint")}</p>}
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("media.cinemaLink")}</p>
            <div className="flex gap-1.5">
              <input value={cinema} onChange={(e) => setCinema(e.target.value)} placeholder="YouTube / VK Video / Rutube / .mp4" className={input} data-testid="ai-office-cinema-url" />
              <button type="button" disabled={busy || (!!cinema.trim() && !parseVideoLink(cinema) && !isMediaFileUrl(cinema, "video"))} onClick={() => save({ cinema: cinema.trim() })} className={btn} data-testid="ai-office-cinema-save">{k("media.save")}</button>
            </div>
            {!!cinema.trim() && !parseVideoLink(cinema) && !isMediaFileUrl(cinema, "video") && <p className="text-[11.5px] text-red-600">{k("media.badVideo")}</p>}
            <div className="flex items-center gap-2">
              <input ref={fileV} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => { upload(e.target.files?.[0], "video"); e.target.value = ""; }} />
              <button type="button" onClick={() => fileV.current?.click()} disabled={busy} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold">＋ {k("media.uploadVideo")}</button>
              {media.cinema && <button type="button" onClick={() => { setCinema(""); save({ cinema: "" }); }} className="h-8 px-3 rounded-full text-[12px] text-muted-foreground hover:bg-muted">{k("media.clear")}</button>}
            </div>
            {vid?.kind === "kinopoisk" ? (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-1.5" data-testid="ai-office-kinopoisk">
                <p className="text-[12px]">{k("media.kinopoisk")}</p>
                <a href={vid.open} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 px-3 rounded-full bg-[#ff6600] text-white text-[12px] font-semibold items-center">{k("media.openKp")}</a>
              </div>
            ) : vid ? (
              <p className="text-[12px] text-muted-foreground" data-testid="ai-office-cinema-ok">✅ {k("media.cinemaReady", { kind: vid.kind === "file" ? k("media.file") : vid.kind === "youtube" ? "YouTube" : vid.kind === "vk" ? "VK Video" : "Rutube" })}</p>
            ) : (
              <p className="text-[12px] text-muted-foreground">{k("media.cinemaDefault")}</p>
            )}
          </div>
        )}
        {err && <p className="text-[12px] text-red-600" data-testid="ai-office-media-err">{err}</p>}
      </div>
    </div>
  );
}
