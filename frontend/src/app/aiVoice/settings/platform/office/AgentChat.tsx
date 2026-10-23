import "../../../../i18n/aiVoiceNs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { officeApi, type ChatMsg, type OfficeAgent } from "./officeApi";
import { blobToWav16k, speak } from "./sound";

// AI ofis — agent bilan suhbat (owner 2026-10-23): yozib yoki MIKROFON bilan gapiring → matn (Gemini transkripsiya) → agent o'z ishi
// haqida javob beradi (Gemini) → javob ovoz chiqarib o'qiladi (ovoz yoqilgan bo'lsa) va 3D'da gap pufagi chiqadi.
// "Buyruq qilib yuborish" — matn vazifa sifatida (suhbatda hech narsa bajarilmaydi).
type K = (key: string, o?: any) => string;
const isRu = (s: string) => /[а-яё]/i.test(s);

export default function AgentChat({ agent, taskable, onCommand, onSpeak }: {
  agent: OfficeAgent; taskable: boolean; onCommand: (text: string) => void; onSpeak?: (text: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<"idle" | "rec" | "stt">("idle");
  const [err, setErr] = useState<string | null>(null);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo?.({ top: 1e6 }); }, [msgs]);
  useEffect(() => () => { try { mr.current?.stream.getTracks().forEach((x) => x.stop()); } catch { /* */ } onSpeak?.(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (v = text) => {
    const q = v.trim();
    if (!q || busy) return;
    setBusy(true); setErr(null); setText("");
    const history = msgs.slice(-8);
    setMsgs((m) => [...m, { role: "me", text: q }]);
    const r = await officeApi.chat(agent.id, q, history);
    setBusy(false);
    if (!r.ok || !r.data?.reply) { setErr(k(r.error === "not_configured" ? "chat.notConfigured" : "chat.failed")); return; }
    const reply = r.data.reply;
    setMsgs((m) => [...m, { role: "agent", text: reply }]);
    onSpeak?.(reply);
    const spoken = speak(reply, isRu(reply) ? "ru" : "uz", () => onSpeak?.(null));
    if (!spoken) setTimeout(() => onSpeak?.(null), Math.min(9000, 1500 + reply.length * 45));
  };

  const mic = async () => {
    setErr(null);
    if (rec === "rec") { mr.current?.stop(); return; }
    if (rec === "stt") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr(k("chat.noMic")); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop());
        setRec("stt");
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
          const wav = await blobToWav16k(blob);
          const lang = String(i18n.language || "uz").startsWith("ru") ? "ru" : "uz";
          const res = await officeApi.transcribe(wav, lang);
          const said = res.ok ? (res.data?.text || "").trim() : "";
          if (!said) setErr(k("chat.notHeard"));
          else await send(said);
        } catch { setErr(k("chat.notHeard")); }
        setRec("idle");
      };
      mr.current = r;
      r.start();
      setRec("rec");
      setTimeout(() => { if (r.state === "recording") r.stop(); }, 30_000);
    } catch { setErr(k("chat.noMic")); setRec("idle"); }
  };

  return (
    <div className="space-y-1.5" data-testid="ai-office-chat">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("chat.title")}</p>
      {!!msgs.length && (
        <div ref={list} className="max-h-48 overflow-y-auto space-y-1.5 rounded-xl bg-muted/30 p-2" data-testid="ai-office-chat-log">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "me" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[12.5px] ${m.role === "me" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}
                data-testid={m.role === "agent" ? "ai-office-chat-reply" : undefined}>{m.text}</p>
            </div>
          ))}
          {busy && <p className="text-[11px] text-muted-foreground">…</p>}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button type="button" onClick={mic} data-multi-tap data-testid="ai-office-mic" aria-pressed={rec === "rec"} title={k("chat.mic")} aria-label={k("chat.mic")}
          className={`w-10 h-10 flex-shrink-0 rounded-full grid place-items-center text-lg ${rec === "rec" ? "bg-red-500 text-white animate-pulse" : rec === "stt" ? "bg-muted opacity-60" : "bg-muted hover:bg-muted/70"}`}>
          {rec === "stt" ? "…" : "🎤"}
        </button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={rec === "rec" ? k("chat.listening") : k("chat.placeholder")} data-testid="ai-office-chat-input"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); send(); } }}
          className="flex-1 min-w-0 h-10 rounded-xl border border-border bg-background px-3 text-[13px]" />
        <button type="button" onClick={() => send()} disabled={busy || !text.trim()} data-testid="ai-office-chat-send"
          className="h-10 px-3.5 rounded-full bg-foreground text-background text-[12.5px] font-semibold disabled:opacity-50">{k("chat.ask")}</button>
      </div>
      {taskable && text.trim() && (
        <button type="button" onClick={() => { onCommand(text.trim()); setText(""); }} data-testid="ai-office-chat-to-task" className="text-[11.5px] font-semibold text-primary">
          → {k("chat.asCommand")}
        </button>
      )}
      {err && <p className="text-[11.5px] text-red-600" data-testid="ai-office-chat-err">{err}</p>}
    </div>
  );
}
