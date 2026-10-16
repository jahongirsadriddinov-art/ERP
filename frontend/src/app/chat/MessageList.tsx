// Suhbat oynasidagi xabarlar: sana ajratgichlari, Telegram uslubidagi pufakchalar (ketma-ket xabarlar guruhlanadi),
// "Yangi xabarlar" chizig'i, pastga tushish tugmasi, yangi xabar kelganda silliq skroll (faqat pastda bo'lsa).
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import FileText from "@hugeicons/core-free-icons/FileTextIcon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import VideoIcon from "@hugeicons/core-free-icons/Video01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import { SafeImg, fmtVideoDuration, msgReplyPreview } from "../App";
import type { AppUser, Group, Msg } from "../App";
import { openMediaViewer } from "../MediaViewer";
import { VoicePlayer, VideoPlayer } from "../MediaPlayers";
import { openExternalUrl } from "../platform";
import { getSocket } from "../socket";
import { ChatAvatar } from "./ChatAvatar";
import { avatarColor, dayLabel, fmtClock, tashkentDayKey } from "./chatModel";

const RUN_GAP_MS = 5 * 60_000;
const MEDIA_ONLY = new Set(["image", "video", "audio", "location", "video_invite"]);

export interface MessageListProps {
  threadKey: string;
  thread: Msg[];
  me: AppUser;
  isGroup: boolean;
  groups: Group[];
  firstUnreadId: string | null;
  keyboardInset: number;
  userById: (id: string) => AppUser | undefined;
  findMsg: (id: string) => Msg | null;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onContext: (msgId: string, x: number, y: number) => void;
  onRetry: (m: Msg) => void;
  onStartVideoChat: (g: Group) => void;
  onBackgroundClick: () => void;
}

// Suhbat foni — mavzu ranglaridan (yorug'/qorong'i rejimga mos), mayda nuqtali naqsh
const WALLPAPER: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--muted) 75%, var(--background))",
  backgroundImage: "radial-gradient(color-mix(in srgb, var(--foreground) 8%, transparent) 1px, transparent 1.3px)",
  backgroundSize: "20px 20px",
};

const fmtSize = (n?: number) => (n == null ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export function MessageList(p: MessageListProps) {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showDown, setShowDown] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const nearBottomRef = useRef(true);
  const prevLenRef = useRef(0);
  const prevKeyRef = useRef<string | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lenRef = useRef(p.thread.length);
  lenRef.current = p.thread.length;

  const distFromBottom = () => { const el = scrollRef.current; return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0; };
  const toBottom = (smooth: boolean) => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // Suhbat almashganda — "Yangi xabarlar" chizig'iga yoki oxiriga (animatsiyasiz, sakrashsiz)
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const keyChanged = prevKeyRef.current !== p.threadKey;
    const len = p.thread.length;
    if (keyChanged) {
      prevKeyRef.current = p.threadKey;
      setNewBelow(0);
      const marker = p.firstUnreadId ? el.querySelector<HTMLElement>("[data-unread-marker]") : null;
      if (marker) el.scrollTop = Math.max(0, marker.offsetTop - 48);
      else el.scrollTop = el.scrollHeight;
      nearBottomRef.current = distFromBottom() < 120;
      setShowDown(!nearBottomRef.current);
    } else if (len > prevLenRef.current) {
      const last = p.thread[len - 1];
      if (nearBottomRef.current || last?.fromUserId === p.me.id) toBottom(true);
      else setNewBelow((n) => n + (len - prevLenRef.current));
    }
    prevLenRef.current = len;
  }, [p.threadKey, p.thread.length]);

  // Klaviatura ochilganda pastda bo'lsa — pastda qolamiz
  useEffect(() => { if (nearBottomRef.current) toBottom(false); }, [p.keyboardInset]);
  // Rasm/video kech yuklansa ham pastda turish
  useEffect(() => {
    const el = scrollRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const inner = el.firstElementChild; if (!inner) return;
    // Yangi xabar qo'shilganda emas (u silliq skroll qilinadi) — faqat media kech yuklanib balandlik o'zgarsa
    let seenLen = lenRef.current;
    const ro = new ResizeObserver(() => {
      if (seenLen !== lenRef.current) { seenLen = lenRef.current; return; }
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [p.threadKey]);

  const onScroll = () => {
    const d = distFromBottom();
    nearBottomRef.current = d < 120;
    setShowDown(d > 280);
    if (d < 40) setNewBelow(0);
  };

  const startLongPress = (msgId: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressRef.current = setTimeout(() => p.onContext(msgId, touch.clientX, touch.clientY), 450);
  };
  const endLongPress = () => { if (longPressRef.current) clearTimeout(longPressRef.current); };

  // Ketma-ketlik: bir xil yuboruvchi, 5 daqiqa ichida, bir kunda → bitta "run"
  const meta = useMemo(() => p.thread.map((m, i) => {
    const prev = p.thread[i - 1], next = p.thread[i + 1];
    const t0 = Date.parse(m.timestamp);
    const day = tashkentDayKey(t0);
    const prevDay = prev ? tashkentDayKey(Date.parse(prev.timestamp)) : null;
    const nextDay = next ? tashkentDayKey(Date.parse(next.timestamp)) : null;
    const sys = (x?: Msg) => x?.type === "video_event";
    const firstOfRun = !prev || sys(prev) || prev.fromUserId !== m.fromUserId || prevDay !== day || t0 - Date.parse(prev.timestamp) > RUN_GAP_MS;
    const lastOfRun = !next || sys(next) || next.fromUserId !== m.fromUserId || nextDay !== day || Date.parse(next.timestamp) - t0 > RUN_GAP_MS;
    return { day, newDay: prevDay !== day, t0, firstOfRun, lastOfRun };
  }), [p.thread]);

  const joinVideoInvite = (m: Msg) => {
    const g = p.groups.find((gr) => gr.id === m.videoChatGroupId);
    if (!g) { toast.error(t("common.notFound")); return; }
    // Havola eskirgan bo'lishi mumkin — avval serverdan holatini so'raymiz
    const sock = getSocket();
    if (!sock) { p.onStartVideoChat(g); return; }
    sock.emit("videochat:check", { groupId: g.id }, (r: any) => {
      if (r?.active) { p.onStartVideoChat(g); return; }
      if (r?.lastEndedAt) {
        const min = Math.max(0, Math.floor((Date.now() - new Date(r.lastEndedAt).getTime()) / 60000));
        const ago = min < 1 ? t("call.agoNow") : min < 60 ? t("call.agoMin", { count: min }) : min < 1440 ? t("call.agoHour", { count: Math.floor(min / 60) }) : t("call.agoDay", { count: Math.floor(min / 1440) });
        toast.message(t("call.videoChatEndedToast", { ago, duration: fmtVideoDuration(r.lastDurationSec || 0) }));
      } else toast.message(t("call.videoChatEndedSimple"));
    });
  };

  const renderMeta = (m: Msg, mine: boolean, overlay: boolean) => (
    <span className={`inline-flex items-center gap-1 text-[11px] leading-none whitespace-nowrap select-none
      ${overlay ? "bg-black/50 text-white rounded-full px-1.5 py-1" : mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
      {m.edited && <span className="italic">{t("chat.editedLabel")}</span>}
      {m.pinned && <span>📌</span>}
      <span className="tabular-nums">{fmtClock(m.timestamp)}</span>
      {mine && (m.status === "sending" ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" />
        : m.status === "failed" ? null
        : <MorphIcon icon={m.read ? CheckCheck : Check} data-testid={m.read ? "msg-read" : "msg-sent"} className={`w-4 h-4 ${m.read && !overlay ? (mine ? "text-sky-300" : "") : ""}`} />)}
    </span>
  );

  const renderContent = (m: Msg, mine: boolean, showName: boolean) => {
    const replyMsg = m.replyToId ? p.findMsg(m.replyToId) : null;
    const sender = p.userById(m.fromUserId);
    const textShown = m.text && !(m.type && MEDIA_ONLY.has(m.type));
    const mediaOnly = (m.type === "image" || m.type === "video") && !textShown;
    return (
      <>
        {showName && (
          <p className="text-[13px] font-semibold mb-0.5 truncate" style={{ color: avatarColor(`u:${m.fromUserId}`) }}>{sender?.name || t("chat.unknownSender")}</p>
        )}
        {replyMsg && (
          <div className={`rounded-lg pl-2 pr-2 py-1 mb-1 border-l-[3px] max-w-full ${mine ? "bg-white/15 border-white/70" : "bg-primary/8 border-primary"}`}>
            <p className={`text-[12px] font-semibold truncate ${mine ? "" : "text-primary"}`}>{replyMsg.fromUserId === p.me.id ? t("chat.you") : p.userById(replyMsg.fromUserId)?.name}</p>
            <p className="text-[12px] truncate opacity-80">{msgReplyPreview(t, replyMsg)}</p>
          </div>
        )}
        {m.type === "image" && m.mediaUrl && (
          <div className="relative -mx-1 mb-0.5">
            <SafeImg src={m.mediaUrl} alt={t("chat.imageAlt")} className="rounded-xl max-w-full max-h-72 object-cover cursor-pointer" fallbackClassName="w-44 h-32" onClick={() => openMediaViewer(m.mediaUrl as string, "image")} />
            {mediaOnly && <span className="absolute bottom-1.5 right-1.5">{renderMeta(m, mine, true)}</span>}
          </div>
        )}
        {m.type === "video" && m.mediaUrl && (
          <div className="relative mb-0.5 w-[260px] max-w-full" onClick={(e) => e.stopPropagation()}>
            <VideoPlayer src={m.mediaUrl} compact className="aspect-video max-h-60" onExpand={() => openMediaViewer(m.mediaUrl as string, "video")} />
          </div>
        )}
        {m.type === "audio" && m.mediaUrl && <VoicePlayer src={m.mediaUrl} mine={mine} />}
        {m.type === "file" && m.mediaUrl && (
          // <a download> boshqa origin va Android WebView'da ishlamaydi — openExternalUrl to'g'ri yo'naltiradi
          <button type="button" onClick={(e) => { e.stopPropagation(); openExternalUrl(m.mediaUrl!); }} className="flex items-center gap-2.5 mb-1 text-left hover:opacity-80">
            <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${mine ? "bg-white/20" : "bg-primary/12 text-primary"}`}><MorphIcon icon={FileText} className="w-5 h-5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-medium truncate max-w-[180px]">{m.fileName}</span><span className="block text-[11px] opacity-65">{fmtSize(m.fileSize)}</span></span>
          </button>
        )}
        {m.type === "location" && m.location && (
          <a href={`https://maps.google.com/?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 mb-1 ${mine ? "bg-white/15" : "bg-muted"} hover:opacity-85`}>
            <MorphIcon icon={MapPin} className="w-5 h-5 text-green-500 flex-shrink-0" />
            <span><span className="block text-[13px] font-medium">{t("chat.locationLabel")}</span><span className="block text-[11px] opacity-70">{m.location.lat.toFixed(4)}, {m.location.lng.toFixed(4)}</span></span>
          </a>
        )}
        {/* Video chatga taklif — bosilsa o'sha guruhning video chatiga qo'shiladi */}
        {m.type === "video_invite" && (
          <button type="button" onClick={(e) => { e.stopPropagation(); joinVideoInvite(m); }}
            className="flex items-center gap-2.5 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5 mb-1 hover:bg-green-500/20 text-left w-full">
            <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0"><MorphIcon icon={VideoIcon} className="w-4 h-4 text-green-500" /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-green-700 dark:text-green-400">{t("call.joinVideoChatBtn")}</span>
              <span className="block text-[11px] opacity-75 truncate">{m.text}</span>
            </span>
          </button>
        )}
        {/* m.type — til-mustaqil: media yorlig'i matn sifatida qayta chiqmaydi */}
        {textShown ? (
          <p className="text-[15px] sm:text-sm leading-snug whitespace-pre-wrap break-words">
            {m.text}
            {/* Vaqt matn oxirida o'ng tomonda "suzadi" (Telegram usuli) */}
            <span className="float-right ml-2 relative top-[5px]">{renderMeta(m, mine, false)}</span>
          </p>
        ) : !mediaOnly ? (
          <div className="flex justify-end">{renderMeta(m, mine, false)}</div>
        ) : m.type === "video" ? (
          <div className="flex justify-end mt-0.5">{renderMeta(m, mine, false)}</div>
        ) : null}
        {m.status === "failed" && (
          <button type="button" onClick={(e) => { e.stopPropagation(); p.onRetry(m); }}
            className={`mt-1 flex items-center gap-1 text-[11px] underline ${mine ? "text-red-200" : "text-red-500"}`} aria-label={t("chat.retrySend")}>
            <MorphIcon icon={AlertCircle} className="w-3.5 h-3.5" />{t("chat.retrySend")}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="flex-1 min-h-0 relative">
      <div ref={scrollRef} onScroll={onScroll} onClick={p.onBackgroundClick} data-testid="chat-thread-scroll"
        className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide" style={WALLPAPER}>
        <div className="min-h-full flex flex-col justify-end max-w-3xl mx-auto w-full px-2 sm:px-4 pt-3 pb-2">
          {p.thread.length === 0 && (
            <div className="self-center my-auto text-center text-sm text-muted-foreground bg-card/80 rounded-2xl px-4 py-3 shadow-sm">{t("chatUi.noMessagesYet")}</div>
          )}
          {p.thread.map((m, i) => {
            const mi = meta[i];
            const sep = mi.newDay && (
              <div className="sticky top-1 z-[1] flex justify-center my-2 pointer-events-none" data-testid="chat-day-sep">
                <span className="text-[12px] font-medium text-foreground/80 bg-card/85 backdrop-blur rounded-full px-3 py-1 shadow-sm">{dayLabel(mi.t0, i18n.language, t)}</span>
              </div>
            );
            const marker = p.firstUnreadId === m.id && (
              <div data-unread-marker className="my-2 -mx-4 py-1 bg-card/70 text-center text-[12px] font-medium text-primary">{t("chatUi.newBelow")}</div>
            );
            if (m.type === "video_event") {
              const ev = m.videoEvent;
              const label = ev?.kind === "ended"
                ? t("call.videoChatEventEnded", { duration: fmtVideoDuration(ev.durationSec || 0) })
                : t("call.videoChatEventStarted", { name: ev?.by || "" });
              return (
                <Fragment key={m.id}>{sep}{marker}
                  <div className="flex justify-center my-1.5">
                    <span className="text-[12px] text-foreground/80 bg-card/85 rounded-full px-3 py-1 shadow-sm">{label} · {fmtClock(m.timestamp)}</span>
                  </div>
                </Fragment>
              );
            }
            const mine = m.fromUserId === p.me.id;
            const isSel = p.selected.has(m.id);
            const showAvatar = p.isGroup && !mine;
            const sender = showAvatar ? p.userById(m.fromUserId) : undefined;
            const tailCls = mine ? (mi.lastOfRun ? "rounded-br-[6px]" : "") : (mi.lastOfRun ? "rounded-bl-[6px]" : "");
            return (
              <Fragment key={m.id}>{sep}{marker}
                <div data-testid="chat-msg" data-mine={mine ? "1" : "0"}
                  className={`flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"} ${mi.firstOfRun ? "mt-2" : "mt-0.5"} ${p.selectMode ? "pl-8 relative cursor-pointer" : ""} ${isSel ? "bg-primary/10 -mx-2 px-2 rounded-lg" : ""}`}
                  onClick={(e) => { e.stopPropagation(); if (p.selectMode) p.onToggleSelect(m.id); }}>
                  {p.selectMode && (
                    <span className={`absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSel ? "bg-primary border-primary" : "bg-card border-border"}`}>
                      {isSel && <MorphIcon icon={Check} className="w-3 h-3 text-white" />}
                    </span>
                  )}
                  {showAvatar && (
                    <span className="w-8 flex-shrink-0 self-end">
                      {mi.lastOfRun && <ChatAvatar name={sender?.name || "?"} src={sender?.avatar} seed={`u:${m.fromUserId}`} size={32} />}
                    </span>
                  )}
                  <div
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!p.selectMode) p.onContext(m.id, e.clientX, e.clientY); }}
                    onTouchStart={(e) => { if (!p.selectMode) startLongPress(m.id, e); }}
                    onTouchEnd={endLongPress} onTouchMove={endLongPress}
                    className={`relative max-w-[82%] sm:max-w-[70%] min-w-[72px] px-3 py-1.5 rounded-[18px] shadow-[0_1px_1px_rgba(0,0,0,0.08)] ${tailCls}
                      ${mine ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground"}
                      ${m.pinned ? "ring-1 ring-amber-400/60" : ""} ${m.status === "sending" ? "opacity-80" : ""}`}
                  >
                    {renderContent(m, mine, p.isGroup && !mine && mi.firstOfRun)}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Pastga tushish (yangi xabarlar soni bilan) */}
      <button type="button" aria-label={t("chatUi.scrollDown")} data-testid="chat-scroll-down" onClick={() => { toBottom(true); setNewBelow(0); }}
        className={`absolute right-3 bottom-3 w-11 h-11 rounded-full bg-card border border-border/70 shadow-lg flex items-center justify-center text-muted-foreground transition-all duration-200
          ${showDown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"}`}>
        <MorphIcon icon={ChevronDown} className="w-5 h-5" />
        {newBelow > 0 && <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 min-w-[20px] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">{newBelow}</span>}
      </button>
    </div>
  );
}
