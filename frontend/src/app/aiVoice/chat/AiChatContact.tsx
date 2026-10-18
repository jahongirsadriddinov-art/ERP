import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { API_BASE } from "../../api";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Alert from "@hugeicons/core-free-icons/Alert02Icon";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import BetaBadge from "../BetaBadge";
import { openAiVoiceCall } from "../bus";
import { useAiStatus } from "../aiStatus";
import {
  answerAiChatConfirm, bindAiChatUser, loadAiChat, retryAiChat, sendAiChat, setAiChatNotice, tashkentDay, useAiChat, type AiChatEntry,
} from "./aiChatStore";
import type { AiChatErrorCode } from "./api";

// Chatdagi "AI yordamchi" kontakti (egasi so'rovi #6): ro'yxat tepasida qadalgan qator (AiChatListItem) va
// suhbat oynasi (AiChatThread) — Telegram'dagidek yozish va 📞 bilan ovozli qo'ng'iroq (bus.openAiVoiceCall →
// AiVoiceRoot). ChatPage faqat shu ikki komponentni ulaydi. AI firmada faol bo'lmasa qator ko'rinmaydi.

const GRADIENT = { background: "linear-gradient(135deg, var(--primary), var(--accent))" } as const;

function AiAvatar({ size = 40, online = false }: { size?: number; online?: boolean }) {
  const icon = Math.round(size * 0.45);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-full flex items-center justify-center shadow-sm" style={GRADIENT}>
        <MorphIcon icon={AiSparkles} className="text-white" style={{ width: icon, height: icon }} />
      </div>
      {online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-card" />}
    </div>
  );
}

const errKey = (c: AiChatErrorCode | null | undefined) =>
  c === "rate" ? "aiVoiceCall.errRate"
    : c === "ai_disabled" ? "aiVoiceCall.errDisabled"
      : c === "off_shift" ? "aiVoiceCall.errOffShift"
        : c === "agent_error" ? "aiVoiceCall.errAgent"
          : "aiVoiceCall.errSend";

/** Ro'yxatdagi qadalgan AI kontakti. AI faol bo'lmasa — hech narsa. */
export function AiChatListItem({ userId, active, onOpen }: { userId: string; active: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const status = useAiStatus(userId);
  const chat = useAiChat();
  useEffect(() => { bindAiChatUser(userId); }, [userId]);
  if (!status.aiActive) return null;
  const last = [...chat.items].reverse().find((i) => i.kind === "msg" && i.text);
  const preview = chat.thinking ? t("aiVoiceCall.thinking") + "…" : last?.text || t("aiVoiceCall.contactSubtitle");
  return (
    <button
      type="button"
      data-testid="ai-chat-contact"
      onClick={onOpen}
      className={`w-full flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 liquid-transition text-left ${active ? "bg-secondary/60 ring-1 ring-primary/40" : ""}`}
    >
      <AiAvatar online />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-semibold truncate min-w-0">{t("aiVoiceCall.contactName")}</p>
          <BetaBadge interactive={false} />
        </div>
        <p className={`text-xs truncate ${chat.thinking ? "text-primary" : "text-muted-foreground"}`}>{preview}</p>
      </div>
    </button>
  );
}

function dayLabel(day: string, t: (k: string) => string, lang: string): string {
  const today = tashkentDay();
  const y = tashkentDay(new Date(Date.now() - 86_400_000));
  if (day === today) return t("aiVoiceCall.today");
  if (day === y) return t("aiVoiceCall.yesterday");
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  try { return d.toLocaleDateString(lang === "ru" ? "ru-RU" : "uz-UZ", { day: "numeric", month: "long", timeZone: "Asia/Tashkent" }); } catch { return day; }
}

// AI yuborgan rasm/video (owner 2026-10-19): matndagi [[image:URL]] / [[video:URL]] belgilarini ko'rsatadi.
// Faqat https URL (xavfsizlik) — boshqasi oddiy matn bo'lib qoladi.
const MEDIA_RE = /\[\[(image|video):(https:\/\/[^\]\s]+)\]\]/g;
/** Faqat o'z backendimiz (/uploads) yoki Cloudinary — AI matniga yozdirilgan begona havola yuklanmaydi. */
function trustedMediaUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    const own = new URL(API_BASE || window.location.origin).hostname;
    return h === own || h === "res.cloudinary.com";
  } catch { return false; }
}

export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MEDIA_RE)) {
    const at = m.index ?? 0;
    if (!trustedMediaUrl(m[2])) continue;   // begona host — oddiy matn bo'lib qoladi (kuzatuv pikseli bo'lmasin)
    if (at > last) parts.push(text.slice(last, at).replace(/\n+$/, ""));
    parts.push(m[1] === "image"
      ? <a key={at} href={m[2]} target="_blank" rel="noreferrer" className="block mt-1.5"><img src={m[2]} alt="" loading="lazy" className="max-w-full max-h-72 rounded-xl" /></a>
      : <video key={at} src={m[2]} controls playsInline preload="metadata" className="block mt-1.5 max-w-full max-h-72 rounded-xl" />);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CallEntry({ e }: { e: AiChatEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const time = (() => { try { return new Date(e.at).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }); } catch { return ""; } })();
  return (
    <div className="flex justify-center my-2">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/80 px-3.5 py-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full text-primary flex items-center justify-center flex-shrink-0" style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}>
            <MorphIcon icon={Phone} className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{t("aiVoiceCall.callEntry")}</p>
            <p className="text-[11px] text-muted-foreground">{time}</p>
          </div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-[11px] font-semibold text-primary px-2 py-1 rounded-lg hover:bg-muted/60">
            {open ? t("aiVoiceCall.callEntryHide") : t("aiVoiceCall.callEntryShow")}
          </button>
        </div>
        {open && (
          <div className="mt-2 pt-2 border-t border-border/60 space-y-1 max-h-64 overflow-y-auto overscroll-contain">
            {(e.lines || []).map((l, i) => (
              <p key={i} className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                <span className={`font-semibold ${l.role === "assistant" ? "text-primary" : ""}`}>{l.role === "assistant" ? t("aiVoiceCall.aiShort") : t("aiVoiceCall.you")}:</span> {l.text}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmCard({ e, lang }: { e: AiChatEntry; lang: string }) {
  const { t } = useTranslation();
  const c = e.confirm!;
  return (
    <div className="flex justify-start" data-testid="ai-chat-confirm">
      <div className="max-w-[88%] sm:max-w-[75%] rounded-2xl rounded-bl-md border border-amber-500/40 bg-amber-500/[0.07] px-3.5 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">{t("aiVoiceCall.confirmTitle")}</p>
        <p className="text-sm mt-1 whitespace-pre-wrap break-words">{c.summary}</p>
        {c.state === "done" ? (
          <p className="text-xs text-muted-foreground mt-2">{c.result || t("aiVoiceCall.confirmDone")}</p>
        ) : (
          <div className="flex gap-2 mt-2.5">
            <button type="button" disabled={c.state === "busy"} onClick={() => void answerAiChatConfirm(e.id, true, lang)} className="btn btn-primary h-9 px-4 rounded-xl text-xs disabled:opacity-50">{t("aiVoiceCall.confirmYes")}</button>
            <button type="button" disabled={c.state === "busy"} onClick={() => void answerAiChatConfirm(e.id, false, lang)} className="btn btn-ghost h-9 px-4 rounded-xl text-xs disabled:opacity-50">{t("aiVoiceCall.confirmNo")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Suhbat oynasi (ChatPage o'ng paneli / telefonda butun ekran). */
export function AiChatThread({ userId, onBack, backAlways = false }: { userId: string; onBack: () => void; backAlways?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "ru" ? "ru" : i18n.language === "uz-cyrl" ? "uz-cyrl" : "uz";
  const chat = useAiChat();
  const [text, setText] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const firstScroll = useRef(true);
  const atBottomRef = useRef(true);

  useEffect(() => { bindAiChatUser(userId); void loadAiChat(); }, [userId]);

  // Kun ajratgichlari bilan ro'yxat
  const rows = useMemo(() => {
    const out: ({ type: "day"; key: string; day: string } | { type: "item"; key: string; e: AiChatEntry })[] = [];
    let prev = "";
    for (const e of chat.items) {
      if (e.day && e.day !== prev) { out.push({ type: "day", key: `d:${e.day}:${e.id}`, day: e.day }); prev = e.day; }
      out.push({ type: "item", key: e.id, e });
    }
    return out;
  }, [chat.items]);

  const scrollToEnd = (smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // Yangi xabar/javobda: foydalanuvchi pastda bo'lsa (yoki o'zi yozgan bo'lsa) — oxirigacha tushadi
  useLayoutEffect(() => {
    if (chat.status !== "ready" && chat.items.length === 0) return;
    const last = chat.items[chat.items.length - 1];
    const mine = last?.role === "user" && last.sending;
    if (firstScroll.current) { firstScroll.current = false; scrollToEnd(false); return; }
    if (atBottomRef.current || mine) scrollToEnd(true);
  }, [chat.items.length, chat.thinking, chat.status]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const b = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = b;
    if (b !== atBottom) setAtBottom(b);
  };

  // Matn maydoni balandligi (≤ 6 qator)
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => {
    if (chat.lastError && chat.items.every((i) => !i.failed)) toast.error(t(errKey(chat.lastError)));
  }, [chat.lastError]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabled = chat.aiActive === false;
  const canSend = !!text.trim() && !chat.thinking && !disabled;
  const submit = (value = text) => {
    if (!value.trim() || chat.thinking || disabled) return;
    void sendAiChat(value, lang);
    setText("");
    atBottomRef.current = true;
    requestAnimationFrame(() => taRef.current?.focus());
  };
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // Telefonda Enter — yangi qator (yuborish tugma bilan); kompyuterda — yuborish
    const fine = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;
    if (!fine) return;
    e.preventDefault();
    submit();
  };
  const startCall = () => {
    // Sinxron chaqiriladi — AudioContext foydalanuvchi bosishi ichida ochilsin
    if (!openAiVoiceCall("chat")) toast.message(t("aiVoiceCall.comingSoon"));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full" data-testid="ai-chat-thread">
      {/* Sarlavha */}
      <div className="glass border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0 z-10">
        <button type="button" onClick={onBack} aria-label={t("aiVoiceCall.back")} className={`${backAlways ? "" : "md:hidden "}p-2 -ml-2 mr-1 text-muted-foreground hover:bg-muted rounded-full transition-colors`}>
          <MorphIcon icon={ChevronLeft} className="w-5 h-5" />
        </button>
        <AiAvatar size={36} online />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-semibold truncate min-w-0">{t("aiVoiceCall.contactName")}</p>
            <BetaBadge />
          </div>
          <p className={`text-[11px] truncate ${chat.thinking ? "text-primary" : "text-muted-foreground"}`} aria-live="polite">
            {chat.thinking ? `${t("aiVoiceCall.thinking")}…` : t("aiVoiceCall.contactOnline")}
          </p>
        </div>
        <button type="button" onClick={startCall} disabled={disabled} data-testid="ai-chat-call" title={t("aiVoiceCall.call")} aria-label={t("aiVoiceCall.call")} className="btn btn-ghost w-10 h-10 p-0 rounded-full text-primary flex-shrink-0 disabled:opacity-40">
          <MorphIcon icon={Phone} className="w-5 h-5" />
        </button>
      </div>

      {/* Ovozli qo'ng'iroq matnga o'tdi (kvota/limit) — izoh */}
      {chat.notice && (
        <div className="flex-shrink-0 px-3 pt-2" data-testid="ai-chat-notice" role="status">
          <div className="max-w-3xl mx-auto flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-xs">
            <MorphIcon icon={Alert} className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-px" />
            <p className="flex-1 min-w-0 leading-snug">{t(chat.notice)}</p>
            <button type="button" onClick={() => setAiChatNotice(null)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground flex-shrink-0">{t("aiVoiceCall.close")}</button>
          </div>
        </div>
      )}

      {/* Xabarlar */}
      <div className="relative flex-1 min-h-0">
        <div ref={listRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4" data-testid="ai-chat-list" role="log" aria-live="polite">
          <div className="max-w-3xl mx-auto flex flex-col gap-1.5 min-h-full">
            <p className="text-center text-[10.5px] text-muted-foreground/80 mx-auto max-w-xs mb-2 leading-snug">{t("aiVoiceCall.historyNote")}</p>

            {chat.status === "loading" && chat.items.length === 0 && (
              <div className="space-y-2.5 py-2" aria-hidden>
                {[60, 45, 70].map((w, i) => (
                  <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}><div className="h-9 rounded-2xl bg-muted/70 animate-pulse" style={{ width: `${w}%` }} /></div>
                ))}
              </div>
            )}

            {chat.status === "error" && chat.items.length === 0 && (
              <div className="m-auto text-center py-8">
                <p className="text-sm text-muted-foreground">{t("aiVoiceCall.errLoad")}</p>
                <button type="button" onClick={() => void loadAiChat(true)} className="btn btn-ghost h-9 px-4 rounded-xl text-xs mt-2 inline-flex items-center gap-1.5">
                  <MorphIcon icon={Refresh} className="w-3.5 h-3.5" />{t("aiVoiceCall.retry")}
                </button>
              </div>
            )}

            {chat.status === "ready" && chat.items.length === 0 && (
              <div className="m-auto text-center py-6 px-2 animate-pop-in">
                <div className="mx-auto w-fit"><AiAvatar size={64} /></div>
                <p className="text-base font-bold mt-3">{t("aiVoiceCall.chatEmptyTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">{t("aiVoiceCall.chatEmptyBody")}</p>
                {!disabled && (
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    {(["suggestion1", "suggestion2", "suggestion3"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => submit(t(`aiVoiceCall.${k}`))} className="text-xs px-3 py-2 rounded-full border border-border bg-card hover:bg-muted/60 liquid-transition">
                        {t(`aiVoiceCall.${k}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rows.map((r) => {
              if (r.type === "day") {
                return (
                  <div key={r.key} className="flex justify-center my-2 sticky top-0 z-[1]">
                    <span className="text-[10.5px] font-semibold text-muted-foreground bg-card/90 backdrop-blur border border-border/60 rounded-full px-2.5 py-0.5 shadow-sm">{dayLabel(r.day, t, lang)}</span>
                  </div>
                );
              }
              const e = r.e;
              if (e.kind === "call") return <CallEntry key={r.key} e={e} />;
              if (e.kind === "confirm") return <ConfirmCard key={r.key} e={e} lang={lang} />;
              const mine = e.role === "user";
              return (
                <div key={r.key} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <div
                    data-testid={mine ? "ai-chat-msg-user" : "ai-chat-msg-ai"}
                    className={`max-w-[85%] sm:max-w-[75%] px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${mine
                      ? `rounded-2xl rounded-br-md text-white ${e.sending ? "opacity-70" : ""}`
                      : "rounded-2xl rounded-bl-md bg-card border border-border/60"}`}
                    style={mine ? GRADIENT : undefined}
                  >
                    <RichText text={e.text || ""} />
                  </div>
                  {e.failed && (
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-red-500">
                      <MorphIcon icon={Alert} className="w-3.5 h-3.5" />
                      <span>{t(errKey(e.failed))}</span>
                      {e.failed !== "ai_disabled" && e.failed !== "off_shift" && (
                        <button type="button" onClick={() => void retryAiChat(e.id, lang)} className="font-semibold underline underline-offset-2 ml-1">{t("aiVoiceCall.retry")}</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {chat.callExpectedUntil > 0 && !chat.thinking && (
              <div className="flex justify-center my-1" data-testid="ai-chat-calling" role="status">
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-primary rounded-full px-3 py-1.5 border border-primary/30 animate-pulse" style={{ background: "color-mix(in srgb, var(--primary) 10%, transparent)" }}>
                  <MorphIcon icon={Phone} className="w-3.5 h-3.5" />{t("aiVoiceCall.callingYou")}
                </span>
              </div>
            )}

            {chat.thinking && (
              <div className="flex justify-start" aria-label={t("aiVoiceCall.thinking")}>
                <div className="rounded-2xl rounded-bl-md bg-card border border-border/60 px-4 py-3 flex items-center gap-1.5 shadow-sm">
                  {[0, 1, 2].map((i) => <span key={i} className="ai-thinking-dot w-1.5 h-1.5 rounded-full bg-primary" style={{ animationDelay: `${i * 0.18}s` }} />)}
                </div>
              </div>
            )}
          </div>
        </div>
        {!atBottom && (
          <button type="button" onClick={() => scrollToEnd(true)} aria-label={t("aiVoiceCall.scrollDown")} className="absolute right-4 bottom-3 w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground animate-pop-in">
            <MorphIcon icon={ArrowDown} className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Yozish maydoni */}
      <div className="flex-shrink-0 border-t border-border bg-card/80 backdrop-blur-xl px-3 pt-2.5" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
        {disabled && <p className="text-[11px] text-center text-muted-foreground mb-2">{t("aiVoiceCall.errDisabled")}</p>}
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 2000))}
            onKeyDown={onKey}
            rows={1}
            disabled={disabled}
            placeholder={t("aiVoiceCall.placeholder")}
            aria-label={t("aiVoiceCall.placeholder")}
            data-testid="ai-chat-input"
            className="flex-1 resize-none rounded-2xl bg-muted/60 border border-transparent focus:border-primary/40 focus:bg-card outline-none px-4 py-2.5 text-[16px] sm:text-sm leading-snug max-h-[140px] overflow-y-auto disabled:opacity-50"
          />
          <button type="button" onClick={() => submit()} disabled={!canSend} data-testid="ai-chat-send" aria-label={t("aiVoiceCall.send")} title={t("aiVoiceCall.send")} className="btn btn-primary w-11 h-11 p-0 rounded-full flex-shrink-0 disabled:opacity-40">
            <MorphIcon icon={Send} className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
