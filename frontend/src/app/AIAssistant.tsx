import { useState, useRef, useEffect } from "react";
import { X, Check, Send, Loader2 } from "lucide-react";
import { API_BASE } from "./api";
import type { AppUser } from "./App";

interface AiMsg { role: 'user'|'assistant'; content: string; }
interface AiAction { type: string; toUserId?: string; toUserName?: string; text?: string; description?: string; }

export default function AIAssistant({ currentUser, users, token, open, onClose }:
  { currentUser: AppUser; users: AppUser[]; token: string; open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<AiMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ action: AiAction; response: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, pending, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);

  const send = async () => {
    const text = input.trim();
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
        setMsgs(p => [...p, { role: 'assistant', content: `⚠️ ${data.error || 'Xatolik yuz berdi'}` }]);
      } else if (data.type === 'action' && data.action) {
        setMsgs(p => [...p, { role: 'assistant', content: data.response }]);
        setPending({ action: data.action, response: data.response });
      } else {
        setMsgs(p => [...p, { role: 'assistant', content: data.response || 'Javob yo\'q' }]);
      }
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: '⚠️ Server bilan ulanishda xatolik' }]);
    }
    setLoading(false);
  };

  const confirm = async () => {
    if (!pending) return;
    setLoading(true);
    setPending(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/execute`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ action: pending.action }),
      });
      const data = await res.json();
      const result = res.ok ? `✅ ${data.result || 'Bajarildi'}` : `⚠️ ${data.error || 'Xatolik'}`;
      setMsgs(p => [...p, { role: 'assistant', content: result }]);
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: '⚠️ Amalga oshirishda xatolik' }]);
    }
    setLoading(false);
  };

  const cancel = () => {
    setPending(null);
    setMsgs(p => [...p, { role: 'assistant', content: '❌ Bekor qilindi' }]);
  };

  const greeting = `Salom, ${currentUser.name.split(' ')[0]}! Men AI yordamchisiman.\n\nMasalan: "Alibekka 'Ertaga soat 9da yig\'ilish bor' deb xabar yubor"`;

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[78vh] sm:max-h-[640px] rounded-2xl shadow-2xl border border-border/50 flex flex-col overflow-hidden animate-pop-in"
        style={{ background: 'var(--card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/40 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--primary)/10, var(--accent)/10)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
            <span className="text-white text-sm">✨</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-none">AI Yordamchi</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Buyruqni bajaruvchi asistent</p>
          </div>
          <button onClick={onClose} aria-label="Yopish" className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-hide">
          {msgs.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{greeting}</p>
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {[
                  "Xodimlar ro'yxati",
                  "Rahimovga xabar yubor",
                  "Bugun nima qilsa bo'ladi?",
                ].map(hint => (
                  <button key={hint} onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                    className="text-[10px] px-2.5 py-1.5 rounded-full border border-border/60 hover:bg-muted/60 transition-colors">
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-muted/70 text-foreground rounded-bl-sm'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted/70 px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-1.5">
                <div className="flex gap-0.5">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${i*150}ms` }}/>
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">O'ylayapti...</span>
              </div>
            </div>
          )}
          {/* Confirmation card */}
          {pending && !loading && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="text-base flex-shrink-0">🤖</span>
                <p className="text-xs leading-relaxed font-medium">{pending.action.description || pending.response}</p>
              </div>
              {pending.action.text && (
                <div className="bg-white/10 dark:bg-black/20 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Xabar matni:</p>
                  <p className="text-xs font-medium">"{pending.action.text}"</p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={confirm}
                  className="flex-1 bg-green-600 text-white text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-transform">
                  <Check className="w-3.5 h-3.5"/> Ha, bajar
                </button>
                <button onClick={cancel}
                  className="flex-1 border border-red-500/40 text-red-500 text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-transform">
                  <X className="w-3.5 h-3.5"/> Yo'q
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/40 flex-shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Buyruq bering..."
            className="flex-1 text-sm bg-muted/50 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
            disabled={loading || !!pending}
          />
          <button onClick={send} disabled={loading || !input.trim() || !!pending} aria-label="Xabar yuborish"
            className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all active:scale-95 flex-shrink-0"
            style={{ background: 'var(--primary)' }}>
            {loading ? <Loader2 className="w-4 h-4 text-white animate-spin"/> : <Send className="w-4 h-4 text-white"/>}
          </button>
        </div>
      </div>
    </div>
  );
}
