import { useState, useRef, useEffect } from "react";
import { X, Check, Send, Loader2, UserPlus, Trash2, Edit, Zap } from "lucide-react";
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
  if (type === 'add_user') return <UserPlus className="w-4 h-4 text-green-500"/>;
  if (type === 'delete_user') return <Trash2 className="w-4 h-4 text-red-500"/>;
  if (type === 'update_user') return <Edit className="w-4 h-4 text-blue-500"/>;
  return <Zap className="w-4 h-4 text-amber-500"/>;
}

export default function AIAssistant({ currentUser, users, token, open, onClose, onUserAdded, onUserDeleted, onUserUpdated }:
  {
    currentUser: AppUser; users: AppUser[]; token: string; open: boolean; onClose: () => void;
    onUserAdded?: (u: AppUser) => void;
    onUserDeleted?: (id: string) => void;
    onUserUpdated?: (u: AppUser) => void;
  }) {
  const { t } = useTranslation();
  useModalPresence();
  const [msgs, setMsgs] = useState<AiMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ action: AiAction; response: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const authHdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, pending, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);

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
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[82vh] sm:max-h-[660px] rounded-2xl shadow-2xl border border-border/50 flex flex-col overflow-hidden animate-pop-in"
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
            <p className="text-sm font-bold leading-none">{t('ai.title')}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('ai.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('ai.close')} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground">
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
                  t('ai.hints.employeeList'),
                  t('ai.hints.addEmployee'),
                  t('ai.hints.sendMessage'),
                  t('ai.hints.todayTasks'),
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
              <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
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
                <span className="text-[10px] text-muted-foreground">{t('ai.thinking')}</span>
              </div>
            </div>
          )}
          {/* Confirmation card — only for send_message */}
          {pending && !loading && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-start gap-2">
                {actionIcon(pending.action.type)}
                <p className="text-xs leading-relaxed font-medium">{pending.action.description || pending.response}</p>
              </div>
              {pending.action.text && (
                <div className="bg-white/10 dark:bg-black/20 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-muted-foreground mb-0.5">{t('ai.messageTextLabel')}</p>
                  <p className="text-xs font-medium">"{pending.action.text}"</p>
                </div>
              )}
              {pending.action.toUserName && (
                <p className="text-[10px] text-muted-foreground">{t('ai.recipientLabel')}: <span className="font-semibold text-foreground">{pending.action.toUserName}</span></p>
              )}
              <div className="flex gap-2">
                <button onClick={confirm}
                  className="flex-1 bg-green-600 text-white text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-transform">
                  <Check className="w-3.5 h-3.5"/> {t('ai.confirm')}
                </button>
                <button onClick={cancel}
                  className="flex-1 border border-red-500/40 text-red-500 text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-transform">
                  <X className="w-3.5 h-3.5"/> {t('ai.cancel')}
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
            placeholder={t('ai.placeholder')}
            className="flex-1 text-sm bg-muted/50 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
            disabled={loading || !!pending}
          />
          <button onClick={send} disabled={loading || !input.trim() || !!pending} aria-label={t('ai.sendAriaLabel')}
            className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all active:scale-95 flex-shrink-0"
            style={{ background: 'var(--primary)' }}>
            {loading ? <Loader2 className="w-4 h-4 text-white animate-spin"/> : <Send className="w-4 h-4 text-white"/>}
          </button>
        </div>
      </div>
    </div>
  );
}
