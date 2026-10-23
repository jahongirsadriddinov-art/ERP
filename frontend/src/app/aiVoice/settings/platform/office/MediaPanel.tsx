import "../../../../i18n/aiVoiceNs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadChatMedia } from "../../../../api";
import { isMediaFileUrl, parseVideoLink, parseYandexMusic } from "./media";
import { player, sound, useMuted, usePlayer } from "./sound";
import { openExternalUrl } from "../../../../platform";
import { currentMovie, mediaStore, useMedia, yandexEmbed } from "./mediaStore";
import { fmtSize, localMedia, UPLOAD_LIMIT } from "./localMedia";

// AI ofis — musiqa va kino (owner 2026-10-23). MediaHost Dasturchi paneli ILDIZIDA bir marta o'rnatiladi (tab, ofis/yurish
// rejimi almashganda ham yashaydi): <audio> va Yandex <iframe> shu yerda — ofis, kompyuter va tugmalar faqat boshqaradi.
//  • X / "–" musiqani to'xtatmaydi — kichik pleyerga aylantiradi (nomi, ⏯, ⏭, kattalashtirish, ■ to'xtatish);
//  • Yandex vidjeti — baland (pleylist/albom ro'yxati ko'rinadi), hech qachon qayta yaratilmaydi (faqat CSS bilan yashiriladi);
//  • o'z qo'shiqlari — ro'yxat (hozirgisi ajratilgan, bosib o'ynatish, tartibni o'zgartirish, o'chirish); qurilmadagi fayl
//    darhol o'ynaydi (serverga yuklanmaydi, xohlasa shu kompyuterda saqlanadi), "Serverga yuklash" — alohida;
//  • kino — ▶ Ko'rish (oyna / kattalashtirish), kichraytirish; ■ — to'xtatish. Kinozalda ekranga ham chiqadi.
type K = (key: string, o?: any) => string;

export function MuteButton({ k, dark = false }: { k: K; dark?: boolean }) {
  const muted = useMuted();
  return (
    <button type="button" onClick={() => sound.setMuted(!muted)} aria-pressed={!muted} data-multi-tap data-testid="ai-office-mute" title={muted ? k("media.unmute") : k("media.mute")}
      className={dark ? "h-9 px-3 rounded-full bg-black/60 text-white text-[13px] font-semibold backdrop-blur" : "h-8 px-3 rounded-full border border-border bg-card/60 text-[12px] font-semibold inline-flex items-center gap-1.5"}>
      {muted ? "🔇" : "🔊"}<span className="sr-only">{muted ? k("media.unmute") : k("media.mute")}</span>
    </button>
  );
}

/** Nechta MediaHost o'rnatilgan (Dasturchi panelida bo'lsa — AiOffice o'zinikini qo'ymaydi). */
export const hostState = { n: 0 };

/** Dasturchi paneli ildizida: musiqa oynasi (yashirin bo'lsa ham iframe yashaydi), kichik pleyer, kino oynasi. */
export function MediaHost() {
  useState(() => { hostState.n++; return 0; });
  useEffect(() => () => { hostState.n--; }, []);
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const m = useMedia();
  const [opened, setOpened] = useState(false);
  useEffect(() => { void mediaStore.load(); }, []);
  useEffect(() => { if (m.music === "full" || m.yandexOn) setOpened(true); }, [m.music, m.yandexOn]);
  return (
    <>
      {opened && (
        <div className={m.music === "full" ? "fixed z-[120] right-2 bottom-2 sm:right-4 sm:bottom-4" : "fixed -left-[10000px] top-0 w-[400px] h-[700px] overflow-hidden"} aria-hidden={m.music !== "full"}>
          <MediaPanel k={k} />
        </div>
      )}
      {m.music === "mini" && <MiniPlayer k={k} />}
      {m.cinema !== "closed" && <CinemaWindow k={k} />}
    </>
  );
}

function MiniPlayer({ k }: { k: K }) {
  const m = useMedia();
  const ps = usePlayer();
  const tr = ps.tracks[ps.index];
  const title = ps.playing && tr ? tr.name : m.yandexOn ? "Yandex Music" : tr?.name || "—";
  return (
    <div className="fixed z-[120] left-2 bottom-2 sm:left-4 sm:bottom-4 flex items-center gap-1.5 rounded-full bg-card text-foreground border border-border shadow-2xl pl-3 pr-1 py-1 max-w-[calc(100vw-16px)]" data-multi-tap data-testid="ai-office-mini">
      <span className="text-[12px] font-semibold truncate max-w-[160px]">🎵 {title}</span>
      {!!ps.tracks.length && <button type="button" onClick={() => player.toggle()} className="w-8 h-8 rounded-full hover:bg-muted" aria-label="play/pause" data-testid="ai-office-mini-toggle">{ps.playing ? "⏸" : "▶"}</button>}
      {!!ps.tracks.length && <button type="button" onClick={() => player.next()} className="w-8 h-8 rounded-full hover:bg-muted" aria-label="next">⏭</button>}
      <button type="button" onClick={() => mediaStore.openMusic()} className="w-8 h-8 rounded-full hover:bg-muted" aria-label={k("media.expand")} title={k("media.expand")} data-testid="ai-office-mini-expand">⤢</button>
      <button type="button" onClick={() => mediaStore.stopMusic()} className="w-8 h-8 rounded-full hover:bg-muted text-red-600" aria-label={k("media.stop")} title={k("media.stop")} data-testid="ai-office-mini-stop">■</button>
    </div>
  );
}

const posKey = (m: ReturnType<typeof useMedia>) => `aiOffice.pos.${m.cinemaLocal ? `local:${m.cinemaLocal}` : m.media?.cinema || ""}`;
const readPos = (key: string) => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
const savePos = (key: string, t: number) => { try { localStorage.setItem(key, String(Math.floor(t))); } catch { /* */ } };

function CinemaWindow({ k }: { k: K }) {
  const m = useMedia();
  const muted = useMuted();
  const box = useRef<HTMLDivElement>(null);
  const mv = currentMovie(m);
  if (!mv) return null;
  const full = m.cinema === "full";
  return (
    <div ref={box} data-testid="ai-office-cinema-win"
      className={full ? "fixed z-[121] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(94vw,1100px)] rounded-2xl overflow-hidden bg-black shadow-2xl border border-white/10"
        : "fixed z-[121] left-2 bottom-16 sm:left-4 w-[min(300px,60vw)] rounded-xl overflow-hidden bg-black shadow-2xl border border-white/10"}>
      <div className="flex items-center gap-1 px-2 py-1 bg-[#15171c] text-white text-[12px]">
        <span className="font-semibold mr-auto truncate">🎬 {k("media.cinema")}</span>
        {full && <button type="button" onClick={() => { try { void box.current?.requestFullscreen?.(); } catch { /* */ } }} className="h-7 px-2 rounded-full hover:bg-white/10" data-testid="ai-office-cinema-big">⛶ {k("media.bigger")}</button>}
        <button type="button" onClick={() => (full ? mediaStore.minimizeCinema() : mediaStore.watch("full"))} className="w-7 h-7 rounded-full hover:bg-white/10" aria-label={full ? k("media.minimize") : k("media.expand")} data-testid="ai-office-cinema-min">{full ? "–" : "⤢"}</button>
        <button type="button" onClick={() => mediaStore.stopCinema()} className="w-7 h-7 rounded-full hover:bg-white/10 text-red-400" aria-label={k("media.stop")} data-testid="ai-office-cinema-stop">■</button>
      </div>
      <div className="aspect-video">
        {mv.kind === "kinopoisk" ? (
          <div className="w-full h-full grid place-items-center text-center p-6 text-white">
            <div><p className="text-sm mb-3">{k("media.kinopoisk")}</p>
              <a href={mv.open} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 px-4 rounded-full bg-[#ff6600] text-white text-[13px] font-semibold items-center">{k("media.openKp")}</a></div>
          </div>
        ) : mv.kind === "file" ? (
          <video src={mv.src} className="w-full h-full" controls autoPlay playsInline muted={muted} data-testid="ai-office-movie"
            // Har video uchun oxirgi joy eslab qolinadi (qayta ochilganda davom etadi)
            onLoadedMetadata={(e) => { const t = readPos(posKey(m)); if (t > 5 && t < (e.currentTarget.duration || Infinity) - 5) e.currentTarget.currentTime = t; }}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (Math.floor(v.currentTime) % 3 === 0) savePos(posKey(m), v.currentTime); }}
            onPause={(e) => savePos(posKey(m), e.currentTarget.currentTime)} />
        ) : (
          <iframe title="movie" className="w-full h-full border-0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen data-testid="ai-office-movie"
            src={`${mv.embed}${mv.embed.includes("?") ? "&" : "?"}autoplay=1${muted ? "&mute=1" : ""}`} referrerPolicy="strict-origin-when-cross-origin" />
        )}
      </div>
    </div>
  );
}

export function MediaPanel({ k, embedded = false }: { k: K; embedded?: boolean }) {
  const m = useMedia();
  const media = m.media || { yandex: "", tracks: [], cinema: "" };
  const [yandex, setYandex] = useState(media.yandex);
  const [cinema, setCinema] = useState(media.cinema);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(true);
  const muted = useMuted();
  const ps = usePlayer();
  const fileA = useRef<HTMLInputElement>(null), fileV = useRef<HTMLInputElement>(null);
  useEffect(() => { setYandex(media.yandex); }, [media.yandex]);
  useEffect(() => { setCinema(media.cinema); }, [media.cinema]);
  const tab = m.tab;

  const save = async (b: Parameters<typeof mediaStore.save>[0]) => {
    setBusy(true); setErr(null);
    const ok = await mediaStore.save(b);
    setBusy(false);
    if (!ok) setErr(k("media.invalid"));
    return ok;
  };
  const ym = yandexEmbed(m);
  const vid = currentMovie(m);
  const tall = !!ym && !/#track\//.test(ym.embed);

  // Qurilmadagi fayl: darhol o'ynaydi (blob:), xohlasa shu kompyuterda saqlanadi; serverga — faqat so'ralsa
  const addLocal = async (f: File | undefined, kind: "audio" | "video") => {
    if (!f) return;
    setErr(null);
    const it = await mediaStore.addLocal(f, kind, keep);
    if (kind === "audio") { const i = player.state.tracks.findIndex((x) => x.local === it.id); if (i >= 0) void player.play(i); }
    else { await mediaStore.setCinemaLocal(it.id); mediaStore.watch("full"); }
  };
  const toServer = async (id: string, kind: "audio" | "video") => {
    const it = m.local.find((x) => x.id === id);
    if (!it) return;
    if (it.size > UPLOAD_LIMIT) { setErr(k("media.tooBig", { size: fmtSize(UPLOAD_LIMIT) })); return; }
    setBusy(true); setErr(null);
    try {
      const blob = await localMedia.blob(id);
      if (!blob) throw new Error("no blob");
      const ext = (it.type.split("/")[1] || (kind === "audio" ? "mp3" : "mp4")).replace("mpeg", "mp3");
      const r = await uploadChatMedia(blob, `${it.name}.${ext}`);
      if (kind === "audio") await save({ tracks: [...media.tracks, { id: Math.random().toString(36).slice(2, 10), name: it.name, url: r.url }] });
      else await save({ cinema: r.url });
    } catch { setErr(k("errors.generic")); }
    setBusy(false);
  };
  const move = (i: number, d: number) => {
    const list = [...media.tracks];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void save({ tracks: list });
  };

  const input = "flex-1 min-w-0 h-9 rounded-xl border border-border bg-background px-3 text-[13px]";
  const btn = "h-9 px-3.5 rounded-full bg-primary text-primary-foreground text-[12.5px] font-semibold disabled:opacity-50";
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className={embedded ? "h-full flex flex-col" : "w-[min(400px,calc(100vw-16px))] max-h-[min(86vh,720px)] flex flex-col rounded-2xl bg-card text-foreground border border-border shadow-2xl"} data-testid={embedded ? "ai-office-pc-media" : "ai-office-media"}>
      <div className="flex items-center gap-1 p-2 border-b border-border">
        {(["music", "cinema"] as const).map((x) => (
          <button key={x} type="button" onClick={() => mediaStore.setTab(x)} aria-pressed={tab === x} data-testid={`ai-office-media-tab-${x}`}
            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold ${tab === x ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>
            {x === "music" ? "🎵 " : "🎬 "}{k(`media.${x}`)}
          </button>
        ))}
        <span className="ml-auto" />
        <MuteButton k={k} />
        {!embedded && <button type="button" onClick={() => mediaStore.minimizeMusic()} aria-label={k("close")} title={k("media.minimize")} data-testid="ai-office-media-min" className="w-8 h-8 rounded-full grid place-items-center hover:bg-muted">✕</button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {tab === "music" ? (
          <>
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Yandex Music</p>
              <div className="flex gap-1.5">
                <input value={yandex} onChange={(e) => setYandex(e.target.value)} placeholder="https://music.yandex.ru/playlists/… (Ulashish → Havolani nusxalash)" className={input} data-testid="ai-office-yandex" />
                <button type="button" disabled={busy || (!!yandex.trim() && !parseYandexMusic(yandex))} onClick={async () => { if (await save({ yandex: yandex.trim() })) mediaStore.playYandex(); }} className={btn} data-testid="ai-office-yandex-save">{k("media.save")}</button>
              </div>
              {!!yandex.trim() && !parseYandexMusic(yandex) && <p className="text-[11.5px] text-red-600" data-testid="ai-office-yandex-invalid">{k("media.badYandex")}</p>}
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
              {ym && !embedded && (muted ? (
                <p className="text-[11.5px] text-muted-foreground rounded-xl bg-muted/50 px-3 py-2">{k("media.mutedHint")}</p>
              ) : m.yandexOn ? (
                <iframe title="Yandex Music" src={ym.embed} className={`w-full ${tall ? "h-[450px]" : "h-[180px]"} rounded-xl border-0`} allow="autoplay; encrypted-media" data-testid="ai-office-yandex-frame"
                  sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="strict-origin-when-cross-origin" />
              ) : (
                <button type="button" onClick={() => mediaStore.playYandex()} className="h-9 px-4 rounded-full bg-[#ffcc00] text-[#1f2328] text-[12.5px] font-semibold" data-testid="ai-office-yandex-load">▶ Yandex Music</button>
              ))}
              {ym && embedded && (
                <button type="button" onClick={() => { mediaStore.playYandex(); mediaStore.openMusic("music"); }} className="h-9 px-4 rounded-full bg-[#ffcc00] text-[#1f2328] text-[12.5px] font-semibold">▶ Yandex Music — {k("media.openPlayer")}</button>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex-1">{k("media.mySongs")}</p>
                <input ref={fileA} type="file" accept="audio/*" hidden onChange={(e) => { void addLocal(e.target.files?.[0], "audio"); e.target.value = ""; }} data-testid="ai-office-track-file" />
                <button type="button" onClick={() => fileA.current?.click()} disabled={busy} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold">＋ {k("media.fromDevice")}</button>
              </div>
              <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {k("media.keepHere")}</label>
              {!ps.tracks.length && <p className="text-[11.5px] text-muted-foreground">{k("media.noSongs")}</p>}
              <div className="space-y-1" data-multi-tap data-testid="ai-office-tracklist">
                {ps.tracks.map((tr, i) => {
                  const cur = ps.index === i;
                  const si = media.tracks.findIndex((x) => x.id === tr.id);
                  return (
                    <div key={tr.id} className={`flex items-center gap-1.5 rounded-xl border px-2 py-1 ${cur ? "border-primary bg-primary/5" : "border-border"}`} data-testid={`ai-office-track-${i}`} aria-current={cur}>
                      <button type="button" onClick={() => (cur && ps.playing ? player.pause() : void player.play(i))} className="w-8 h-8 rounded-full bg-muted grid place-items-center flex-shrink-0" data-testid={`ai-office-track-play-${i}`}>
                        {cur && ps.playing ? "⏸" : "▶"}
                      </button>
                      <span className="flex-1 min-w-0 truncate text-[12.5px]">{tr.name}{tr.local && <span className="ml-1 text-[10.5px] text-muted-foreground">💻 {tr.size ? fmtSize(tr.size) : ""}</span>}</span>
                      {si >= 0 && <>
                        <button type="button" onClick={() => move(si, -1)} className="w-6 h-7 rounded hover:bg-muted text-muted-foreground" aria-label="up">↑</button>
                        <button type="button" onClick={() => move(si, 1)} className="w-6 h-7 rounded hover:bg-muted text-muted-foreground" aria-label="down">↓</button>
                      </>}
                      {tr.local && <button type="button" onClick={() => toServer(tr.local!, "audio")} className="h-7 px-2 rounded-full hover:bg-muted text-[11px]" title={k("media.toServer")}>☁</button>}
                      <button type="button" onClick={() => (tr.local ? mediaStore.removeLocal(tr.local) : save({ tracks: media.tracks.filter((x) => x.id !== tr.id) }))} aria-label={k("actions.remove")} className="w-7 h-7 rounded-full hover:bg-muted text-muted-foreground">✕</button>
                    </div>
                  );
                })}
              </div>
              {!!ps.tracks.length && (
                <div className="space-y-1 pt-1" data-multi-tap>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => player.prev()} className="w-9 h-9 rounded-full bg-muted">⏮</button>
                    <button type="button" onClick={() => player.toggle()} className="w-10 h-10 rounded-full bg-foreground text-background" data-testid="ai-office-player-toggle">{ps.playing ? "⏸" : "▶"}</button>
                    <button type="button" onClick={() => player.next()} className="w-9 h-9 rounded-full bg-muted">⏭</button>
                    <input type="range" min={0} max={1} step={0.05} value={ps.volume} onChange={(e) => player.setVolume(Number(e.target.value))} className="flex-1" aria-label={k("media.volume")} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>{fmt(ps.time)}</span>
                    <input type="range" min={0} max={Math.max(1, ps.duration || 1)} step={1} value={Math.min(ps.time, ps.duration || 1)} onChange={(e) => player.seek(Number(e.target.value))} className="flex-1" aria-label="seek" />
                    <span>{fmt(ps.duration || 0)}</span>
                  </div>
                </div>
              )}
              {muted && ps.playing && <p className="text-[11px] text-amber-600">{k("media.mutedHint")}</p>}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("media.cinemaLink")}</p>
            <div className="flex gap-1.5">
              <input value={cinema} onChange={(e) => setCinema(e.target.value)} placeholder="YouTube / VK Video / Rutube / .mp4" className={input} data-testid="ai-office-cinema-url" />
              <button type="button" disabled={busy || (!!cinema.trim() && !parseVideoLink(cinema) && !isMediaFileUrl(cinema, "video"))} onClick={() => save({ cinema: cinema.trim() })} className={btn} data-testid="ai-office-cinema-save">{k("media.save")}</button>
            </div>
            {!!cinema.trim() && !parseVideoLink(cinema) && !isMediaFileUrl(cinema, "video") && <p className="text-[11.5px] text-red-600">{k("media.badVideo")}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileV} type="file" accept="video/*" hidden onChange={(e) => { void addLocal(e.target.files?.[0], "video"); e.target.value = ""; }} data-testid="ai-office-video-file" />
              <button type="button" onClick={() => fileV.current?.click()} disabled={busy} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold">＋ {k("media.videoFromDevice")}</button>
              {(media.cinema || m.cinemaLocal) && <button type="button" onClick={() => { setCinema(""); void mediaStore.setCinemaLocal(null); void save({ cinema: "" }); mediaStore.stopCinema(); }} className="h-8 px-3 rounded-full text-[12px] text-muted-foreground hover:bg-muted">{k("media.clear")}</button>}
            </div>
            <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {k("media.keepHere")}</label>
            {vid?.kind === "kinopoisk" ? (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 space-y-1.5" data-testid="ai-office-kinopoisk">
                <p className="text-[12px]">{k("media.kinopoisk")}</p>
                <a href={vid.open} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 px-3 rounded-full bg-[#ff6600] text-white text-[12px] font-semibold items-center">{k("media.openKp")}</a>
              </div>
            ) : vid ? (
              <div className="space-y-2">
                <p className="text-[12px] text-muted-foreground" data-testid="ai-office-cinema-ok">✅ {k("media.cinemaReady", { kind: vid.kind === "file" ? k("media.file") : vid.kind === "youtube" ? "YouTube" : vid.kind === "vk" ? "VK Video" : "Rutube" })}</p>
                <button type="button" onClick={() => mediaStore.watch("full")} className="w-full h-11 rounded-xl bg-[#e5484d] text-white text-[14px] font-bold" data-testid="ai-office-watch">▶ {k("media.watch")}</button>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">{k("media.cinemaDefault")}</p>
            )}
            {!!m.local.filter((x) => x.kind === "video").length && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("media.savedHere")}</p>
                {m.local.filter((x) => x.kind === "video").map((v) => (
                  <div key={v.id} className={`flex items-center gap-1.5 rounded-xl border px-2 py-1 ${m.cinemaLocal === v.id ? "border-primary bg-primary/5" : "border-border"}`}>
                    <button type="button" onClick={async () => { await mediaStore.setCinemaLocal(v.id); mediaStore.watch("full"); }} className="w-8 h-8 rounded-full bg-muted">▶</button>
                    <span className="flex-1 min-w-0 truncate text-[12.5px]">{v.name} <span className="text-[10.5px] text-muted-foreground">{fmtSize(v.size)}</span></span>
                    <button type="button" onClick={() => toServer(v.id, "video")} className="h-7 px-2 rounded-full hover:bg-muted text-[11px]" title={k("media.toServer")}>☁ {k("media.toServerShort")}</button>
                    <button type="button" onClick={() => mediaStore.removeLocal(v.id)} aria-label={k("actions.remove")} className="w-7 h-7 rounded-full hover:bg-muted text-muted-foreground">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {err && <p className="text-[12px] text-red-600" data-testid="ai-office-media-err">{err}</p>}
      </div>
    </div>
  );
}

export default MediaHost;
