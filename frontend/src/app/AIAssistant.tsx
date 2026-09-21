import { useState, useRef, useEffect } from "react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import UserPlus from "@hugeicons/core-free-icons/UserAdd01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Zap from "@hugeicons/core-free-icons/FlashIcon";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import UserGroup from "@hugeicons/core-free-icons/UserGroup02Icon";
import MessageIcon from "@hugeicons/core-free-icons/Message01Icon";
import CalendarIcon from "@hugeicons/core-free-icons/Calendar03Icon";
import Mic from "@hugeicons/core-free-icons/Mic01Icon";
import MicOff from "@hugeicons/core-free-icons/MicOff01Icon";
import VolumeHigh from "@hugeicons/core-free-icons/VolumeHighIcon";
import { MorphIcon } from "morphicons/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import type { AppUser } from "./App";
import { useModalPresence } from "./App";

interface AiMsg { role: 'user'|'assistant'; content: string; }
interface AiAction {
  type: string;
  // send_message
  toUserId?: string; toUserName?: string; text?: string; description?: string;
  // add_user
  firstName?: string; lastName?: string; phone?: string; role?: string; brigade?: string;
  // delete_user / update_user
  userId?: string; userName?: string; changes?: Record<string, any>;
}

const DIRECT_ACTIONS = ['add_user', 'delete_user', 'update_user'];

function actionIcon(type: string) {
  if (type === 'add_user') return <MorphIcon icon={UserPlus} className="w-4 h-4 text-green-500" />;
  if (type === 'delete_user') return <MorphIcon icon={Trash2} className="w-4 h-4 text-red-500" />;
  if (type === 'update_user') return <MorphIcon icon={Edit} className="w-4 h-4 text-blue-500" />;
  return <MorphIcon icon={Zap} className="w-4 h-4 text-amber-500" />;
}

// AI javobini "yozib chiqarayotgandek" bosqichma-bosqich ko'rsatadi — bir
// zumda to'liq matn chiqishidan farqli, bu "o'ylab, javob yozayotgan aqlli
// yordamchi" tuyg'usini beradi (ChatGPT/Claude uslubidagi tanish naqsh).
// Faqat BIR MARTA, xabar birinchi qo'shilganda ishlaydi (useEffect'ning
// `text` bog'liqligi — eski xabarlar qayta render bo'lganda animatsiya
// TAKRORLANMAYDI, chunki matn qiymati o'zgarmagan).
function StreamingText({ text, onTick }: { text: string; onTick?: () => void }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    let i = 0;
    const step = Math.max(1, Math.ceil(text.length / 45));
    const id = setInterval(() => {
      i += step;
      setShown(text.slice(0, i));
      onTick?.();
      if (i >= text.length) clearInterval(id);
    }, 14);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <>{shown}</>;
}

// Ovoz orqali kiritish/eshittirish — brauzerning o'zining Web Speech API'si
// (server'ga hech narsa yuborilmaydi, to'liq mahalliy). Har ikkalasi ham
// qo'llab-quvvatlanmasa (masalan ba'zi brauzerlar/WebView'lar) tugmalar
// shunchaki ko'rsatilmaydi — "ishlamaydigan tugma" ko'rsatishdan ko'ra yaxshiroq.
const SpeechRecognitionAPI: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
const speechRecognitionSupported = !!SpeechRecognitionAPI;
const speechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export default function AIAssistant({ currentUser, users, token, open, onClose, onUserAdded, onUserDeleted, onUserUpdated }:
  {
    currentUser: AppUser; users: AppUser[]; token: string; open: boolean; onClose: () => void;
    onUserAdded?: (u: AppUser) => void;
    onUserDeleted?: (id: string) => void;
    onUserUpdated?: (u: AppUser) => void;
  }) {
  const { t, i18n } = useTranslation();
  useModalPresence();
  const [msgs, setMsgs] = useState<AiMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ action: AiAction; response: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const speechLang = i18n.language?.startsWith('ru') ? 'ru-RU' : 'uz-UZ';

  const scrollDown = () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollDown(); }, [msgs, pending, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);
  // Modal yopilganda tinglash/gapirish davom etib qolmasin.
  useEffect(() => { if (!open) { recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); } }, [open]);

  // Ovozni matnga — natija KELGANDA to'g'ridan-to'g'ri yuboriladi (input
  // state orqali emas, `send(transcript)` ga bevosita berib) — aks holda
  // React'ning eskirgan (stale) `input` qiymati muammosi yuzaga kelardi.
  const toggleListening = () => {
    if (!speechRecognitionSupported) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = speechLang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.onresult = (e: any) => {
      let transcript = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
        if (e.results[i].isFinal) isFinal = true;
      }
      setInput(transcript);
      if (isFinal && transcript.trim()) {
        recognition.stop();
        send(transcript.trim());
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const speak = (text: string, idx: number) => {
    if (!speechSynthesisSupported) return;
    window.speechSynthesis.cancel();
    if (speakingIdx === idx) { setSpeakingIdx(null); return; }
    const utter = new SpeechSynthesisUtterance(text.replace(/[✅⚠️❌]/g, ''));
    utter.lang = speechLang;
    utter.onend = () => setSpeakingIdx(null);
    utter.onerror = () => setSpeakingIdx(null);
    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utter);
  };

  const executeAction = async (action: AiAction): Promise<string> => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/execute`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        // Notify parent so UI updates immediately (no page reload needed)
        if (action.type === 'add_user' && data.user && onUserAdded) {
          onUserAdded({ id: data.user.id, name: data.user.name, role: data.user.role, phone: data.user.phone, projectIds: [] });
        }
        if (action.type === 'delete_user' && data.deletedId && onUserDeleted) {
          onUserDeleted(data.deletedId);
        }
        if (action.type === 'update_user' && data.user && onUserUpdated) {
          const existing = users.find(u => u.id === String(data.user.id));
          if (existing) onUserUpdated({ ...existing, name: data.user.name, role: data.user.role, phone: data.user.phone });
        }
        return `✅ ${data.result || t('ai.actionDone')}`;
      }
      return `⚠️ ${data.error || t('ai.actionError')}`;
    } catch {
      return `⚠️ ${t('ai.executeError')}`;
    }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput('');
    const newMsgs: AiMsg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ message: text, history: msgs.slice(-8) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsgs(p => [...p, { role: 'assistant', content: `⚠️ ${data.error || t('ai.errorGeneric')}` }]);
      } else if (data.type === 'direct_action' && data.action && DIRECT_ACTIONS.includes(data.action.type)) {
        // Direct actions execute immediately — no confirmation dialog shown
        setMsgs(p => [...p, { role: 'assistant', content: data.response || t('ai.thinking') }]);
        const result = await executeAction(data.action);
        setMsgs(p => [...p, { role: 'assistant', content: result }]);
      } else if (data.type === 'action' && data.action) {
        // send_message and similar — show confirmation
        setMsgs(p => [...p, { role: 'assistant', content: data.response }]);
        setPending({ action: data.action, response: data.response });
      } else {
        setMsgs(p => [...p, { role: 'assistant', content: data.response || t('ai.noResponse') }]);
      }
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: `⚠️ ${t('ai.serverError')}` }]);
    }
    setLoading(false);
  };

  const confirm = async () => {
    if (!pending) return;
    setLoading(true);
    const action = pending.action;
    setPending(null);
    const result = await executeAction(action);
    setMsgs(p => [...p, { role: 'assistant', content: result }]);
    setLoading(false);
  };

  const cancel = () => {
    setPending(null);
    setMsgs(p => [...p, { role: 'assistant', content: `❌ ${t('ai.cancelled')}` }]);
  };

  const greeting = t('ai.greeting', { name: currentUser.name.split(' ')[0] });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="ai-glass-panel w-full sm:max-w-md h-[88vh] sm:h-auto sm:max-h-[680px] sm:rounded-3xl rounded-t-3xl shadow-2xl border border-border/40 flex flex-col overflow-hidden animate-slide-up-fade"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — 2-avlod: shisha panel + orb atrofida yumshoq "nafas
            olayotgan" porlash (faqat doira/blur shakllar — romb xatosi
            takrorlanmasligi uchun hech qachon kvadrat+aylanish qo'llanmaydi),
            avatarda "faol/onlayn" nuqtasi. */}
        <div className="relative flex items-center gap-3 px-5 py-4 flex-shrink-0 border-b border-border/20">
          <div className="relative w-11 h-11 flex-shrink-0">
            <div className="ai-ambient-glow" />
            <div className="ai-badge-ring w-full h-full relative z-[1]">
              <div className="ai-badge-inner">
                <MorphIcon icon={AiSparkles} className="w-[18px] h-[18px] text-white" />
              </div>
            </div>
            <span className="ai-status-dot absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 z-[2]" style={{ borderColor: 'var(--card)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight flex items-center gap-1.5">
              <span className="ai-gradient-text">{t('ai.title')}</span>
              <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-full text-white uppercase flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>AI</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">{t('ai.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('ai.close')}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-muted/60 text-muted-foreground transition-colors flex-shrink-0">
            <MorphIcon icon={X} className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
          {msgs.length === 0 && (
            <div className="text-center py-6 px-2">
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="ai-ambient-glow ai-glow-pulse" />
                <div className="ai-badge-ring w-full h-full relative z-[1]">
                  <div className="ai-badge-inner">
                    <MorphIcon icon={AiSparkles} className="w-7 h-7 text-white" />
                  </div>
                </div>
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">{t('ai.title')}</p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line mb-4">{greeting}</p>
              <div className="flex flex-col gap-2 max-w-[260px] mx-auto">
                {[
                  { icon: UserGroup, label: t('ai.hints.employeeList') },
                  { icon: UserPlus, label: t('ai.hints.addEmployee') },
                  { icon: MessageIcon, label: t('ai.hints.sendMessage') },
                  { icon: CalendarIcon, label: t('ai.hints.todayTasks') },
                ].map(({ icon, label }) => (
                  <button key={label} onClick={() => { setInput(label); inputRef.current?.focus(); }}
                    className="ai-glass-bubble flex items-center gap-2.5 text-[12px] px-3.5 py-2.5 rounded-2xl hover:bg-muted/40 transition-colors font-medium text-left">
                    <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)' }}>
                      <MorphIcon icon={icon} className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                  style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
                  <MorphIcon icon={AiSparkles} className="w-3 h-3 text-white" />
                </div>
              )}
              <div className="flex flex-col gap-1 max-w-[80%]">
                <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'rounded-br-md text-white shadow-md'
                    : 'ai-glass-bubble text-foreground rounded-bl-md'
                }`}
                  style={m.role === 'user' ? { background: 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 80%, var(--accent)))' } : undefined}>
                  {m.role === 'assistant' ? <StreamingText text={m.content} onTick={scrollDown} /> : m.content}
                </div>
                {m.role === 'assistant' && speechSynthesisSupported && (
                  <button onClick={() => speak(m.content, i)} aria-label={t('ai.readAloud')}
                    className={`self-start flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${speakingIdx === i ? 'text-white' : 'text-muted-foreground hover:text-foreground'}`}
                    style={speakingIdx === i ? { background: 'linear-gradient(135deg, var(--primary), var(--accent))' } : undefined}>
                    <MorphIcon icon={VolumeHigh} className="w-3 h-3" /> {speakingIdx === i ? t('ai.stopReading') : t('ai.readAloud')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-end gap-2 justify-start">
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
                <MorphIcon icon={AiSparkles} className="w-3 h-3 text-white" />
              </div>
              <div className="ai-glass-bubble px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-2">
                <div className="flex gap-1">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full ai-thinking-dot"
                      style={{ animationDelay: `${i*160}ms`, background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}/>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground">{t('ai.thinking')}</span>
              </div>
            </div>
          )}
          {pending && !loading && (
            <div className="bg-amber-50/80 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-700/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                {actionIcon(pending.action.type)}
                <p className="text-[13px] leading-relaxed font-medium">{pending.action.description || pending.response}</p>
              </div>
              {pending.action.text && (
                <div className="bg-white/60 dark:bg-black/20 rounded-xl px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">{t('ai.messageTextLabel')}</p>
                  <p className="text-[13px] font-medium">"{pending.action.text}"</p>
                </div>
              )}
              {pending.action.toUserName && (
                <p className="text-[11px] text-muted-foreground">{t('ai.recipientLabel')}: <span className="font-semibold text-foreground">{pending.action.toUserName}</span></p>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={confirm}
                  className="flex-1 bg-green-600 text-white text-[13px] font-bold py-2.5 rounded-2xl flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-sm">
                  <MorphIcon icon={Check} className="w-3.5 h-3.5" /> {t('ai.confirm')}
                </button>
                <button onClick={cancel}
                  className="flex-1 border-2 border-red-400/50 text-red-500 text-[13px] font-bold py-2.5 rounded-2xl flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
                  <MorphIcon icon={X} className="w-3.5 h-3.5" /> {t('ai.cancel')}
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input — suzuvchi "pill" panel + ovozli kiritish tugmasi */}
        <div className="px-3 pb-3 pt-2 flex-shrink-0">
          {listening && (
            <div className="flex items-center justify-center gap-1 mb-2">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="w-1 rounded-full ai-thinking-dot" style={{ height: 12 + (i % 3) * 6, animationDelay: `${i * 90}ms`, background: 'linear-gradient(180deg, var(--primary), var(--accent))' }} />
              ))}
              <span className="text-[11px] text-muted-foreground ml-1.5">{t('ai.listening')}</span>
            </div>
          )}
          <div className="ai-glass-bubble flex items-center gap-1.5 rounded-full pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder={listening ? t('ai.listeningPlaceholder') as string : t('ai.placeholder')}
              className="flex-1 min-w-0 text-[14px] bg-transparent focus:outline-none placeholder:text-muted-foreground/50"
              disabled={loading || !!pending}
            />
            {speechRecognitionSupported && (
              <button onClick={toggleListening} disabled={loading || !!pending} aria-label={listening ? t('ai.stopListening') : t('ai.startListening')}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-92 flex-shrink-0 disabled:opacity-35 ${listening ? 'text-white' : 'text-muted-foreground hover:text-foreground bg-muted/60'}`}
                style={listening ? { background: 'linear-gradient(135deg, #ef4444, #f97316)' } : undefined}>
                <MorphIcon icon={listening ? MicOff : Mic} className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => send()} disabled={loading || !input.trim() || !!pending} aria-label={t('ai.sendAriaLabel')}
              className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-35 transition-all active:scale-92 flex-shrink-0"
              style={{
                background: input.trim() ? 'linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 80%, var(--accent)))' : 'var(--muted)',
                boxShadow: input.trim() ? '0 4px 16px color-mix(in srgb, var(--primary) 45%, transparent)' : undefined,
              }}>
              {loading ? <MorphIcon icon={Loader2} className="w-4 h-4 text-white animate-spin" /> : <MorphIcon icon={Send} className="w-4 h-4 text-white" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
