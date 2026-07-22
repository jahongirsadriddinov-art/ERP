import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, Loader2, Building2, Trash2, ChevronLeft, Send, FileText, MapPin } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { connectSocket } from "./socket";
import type { AppUser, Msg, Role } from "./App";
import { ROLE_LABELS, VoicePlayer } from "./App";

// Har bir tarifda BIRINCHI OY BEPUL — backend/src/routes/subscriptions.ts PLAN_CONFIG bilan bir xil.
const DEV_PLAN_CONFIG: Record<string, { label: string; days: number; amount: number }> = {
  'bepul':   { label: '1 oy bepul', days: 30,  amount: 0 },
  '1month':  { label: '1 oylik',   days: 30,  amount: 0 },
  '3month':  { label: '3 oylik',   days: 90,  amount: 1_400_000 },
  '6month':  { label: '6 oylik',   days: 180, amount: 3_500_000 },
  '12month': { label: '12 oylik',  days: 365, amount: 7_700_000 },
};

// ─── Developer Panel ────────────────────────────────────────────────────────────
export default function DeveloperPanel({ currentUser, onLogout }: { currentUser: AppUser; onLogout: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"firms" | "users" | "subscriptions" | "messages">("subscriptions");
  const [companies, setCompanies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [subLoading, setSubLoading] = useState<string|null>(null);
  const [renewPlan, setRenewPlan] = useState<Record<string, string>>({}); // subId → selectedPlan
  // Messages tab state — har firma uchun bitta umumiy "🛠 Dasturchi" guruh chati
  // (o'sha firmaning barcha xodimlari ham shu guruh orqali yozadi — ikkala
  // tomon bir xil xabarlarni ko'rishi uchun groupId asosida ishlaydi).
  const [selDevFirm, setSelDevFirm] = useState<any|null>(null);
  const [selDevGroup, setSelDevGroup] = useState<any|null>(null);
  const [devGroupLoading, setDevGroupLoading] = useState(false);
  const [devMsgs, setDevMsgs] = useState<Msg[]>([]);
  const [devMobileStep, setDevMobileStep] = useState<'firms'|'chat'>('firms');
  const [devMsgText, setDevMsgText] = useState("");
  const [devMsgLoading, setDevMsgLoading] = useState(false);
  const devMsgBottomRef = useRef<HTMLDivElement>(null);

  const token = localStorage.getItem("token") || "";
  const authHdr = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  const load = async () => {
    setErr(""); setLoading(true);
    try {
      const [cr, ur, sr] = await Promise.all([
        fetch(`${API_BASE}/api/companies`, { headers: authHdr }),
        fetch(`${API_BASE}/api/users`, { headers: authHdr }),
        fetch(`${API_BASE}/api/admin/subscriptions`, { headers: authHdr }),
      ]);
      if (!cr.ok) { setErr(t('devPanel.errors.loadCompanies')); setLoading(false); return; }
      setCompanies(await cr.json());
      setUsers(ur.ok ? await ur.json() : []);
      setSubs(sr.ok ? await sr.json() : []);
    } catch { setErr(t('devPanel.errors.connection')); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Tanlangan firmaning umumiy "🛠 Dasturchi" guruhini topish/yaratish (yo'q
  // bo'lsa) va shu guruh xabarlarini yuklash — xodimlar ChatPage'dan xuddi
  // shu guruhga yozadi, shuning uchun ikkala tomon bir xil xabarlarni ko'radi.
  const openDevGroup = async (firm: any) => {
    setSelDevFirm(firm);
    setSelDevGroup(null);
    setDevMsgs([]);
    setDevMobileStep('chat');
    setDevGroupLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/groups/dev-support`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ companyId: firm.id || firm._id }),
      });
      if (r.ok) {
        const g = await r.json();
        setSelDevGroup(g);
        connectSocket(currentUser.id).emit('join:group', g.id);
        const mr = await fetch(`${API_BASE}/api/messages?userId=${currentUser.id}`, { headers: authHdr });
        if (mr.ok) {
          const all = await mr.json();
          setDevMsgs(all.filter((m: any) => !m.deleted && m.groupId === g.id));
        }
      } else {
        setErr(t('devPanel.errors.loadGroup'));
      }
    } catch { setErr(t('devPanel.errors.connection')); }
    setDevGroupLoading(false);
  };

  // Real-time — shu guruhga tegishli yangi xabarlarni ko'rsatish
  useEffect(() => {
    const sock = connectSocket(currentUser.id);
    const onNew = (m: any) => {
      if (selDevGroup && m.groupId === selDevGroup.id && !m.deleted)
        setDevMsgs(prev => prev.some(x => x.id === (m.id || m._id)) ? prev : [...prev, { ...m, id: m.id || m._id }]);
    };
    sock.on('message:new', onNew);
    return () => { sock.off('message:new', onNew); };
  // eslint-disable-next-line
  }, [currentUser.id, selDevGroup?.id]);

  useEffect(() => { devMsgBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [devMsgs]);

  const sendDevMsg = async () => {
    if (!devMsgText.trim() || !selDevGroup) return;
    setDevMsgLoading(true);
    try {
      await fetch(`${API_BASE}/api/messages`, {
        method: 'POST', headers: authHdr,
        body: JSON.stringify({ fromUserId: currentUser.id, groupId: selDevGroup.id, text: devMsgText.trim() }),
      });
      setDevMsgText('');
    } catch {}
    setDevMsgLoading(false);
  };

  const approveSub = async (id: string) => {
    const plan = renewPlan[id] || 'bepul';
    const cfg = DEV_PLAN_CONFIG[plan] || DEV_PLAN_CONFIG['bepul'];
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/approve`, {
      method: "POST", headers: authHdr,
      body: JSON.stringify({ selectedPlan: plan, days: cfg.days, amount: cfg.amount }),
    });
    if (res.ok) { await load(); } else { setErr(t('devPanel.errors.approve')); }
    setSubLoading(null);
  };
  const rejectSub = async (id: string) => {
    if (!window.confirm(t('devPanel.confirm.rejectSub'))) return;
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/reject`, { method: "POST", headers: authHdr });
    if (res.ok) { await load(); } else { setErr(t('devPanel.errors.reject')); }
    setSubLoading(null);
  };
  const renewSub = async (id: string) => {
    const plan = renewPlan[id] || '1month';
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/renew`, {
      method: "POST", headers: authHdr,
      body: JSON.stringify({ selectedPlan: plan }),
    });
    if (res.ok) { await load(); } else { setErr(t('devPanel.errors.renew')); }
    setSubLoading(null);
  };

  const companyName = (cid: string) => companies.find(c => c.id === cid)?.name || "—";
  const planLabel = (key: string) => DEV_PLAN_CONFIG[key] ? t(`devPanel.planLabels.${key}`) : key;

  const deleteCompany = async (c: any) => {
    if (!window.confirm(t('devPanel.confirm.deleteCompany', { name: c.name, userCount: c.userCount, objectCount: c.objectCount }))) return;
    const res = await fetch(`${API_BASE}/api/companies/${c.id}`, { method: "DELETE" });
    if (res.ok) load(); else setErr(t('devPanel.errors.delete'));
  };
  const toggleStatus = async (c: any) => {
    const status = c.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    const res = await fetch(`${API_BASE}/api/companies/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) load();
  };
  const deleteUser = async (u: any) => {
    if (u.id === currentUser.id) { setErr(t('devPanel.errors.selfDelete')); return; }
    if (!window.confirm(t('devPanel.confirm.deleteUser', { name: u.name, phone: u.phone }))) return;
    const res = await fetch(`${API_BASE}/api/users/${u.id}`, { method: "DELETE", headers: authHdr });
    if (res.ok) load(); else setErr(t('devPanel.errors.delete'));
  };
  const changeRole = async (u: any, role: string) => {
    const res = await fetch(`${API_BASE}/api/auth/users/${u.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (res.ok) load(); else setErr(t('devPanel.errors.changeRole'));
  };
  // Eski tenant-bug qurbonlarini (companyId noto'g'ri/yo'q xodimlar) to'g'ri firmaga biriktirish
  const assignCompany = async (u: any, companyId: string) => {
    const res = await fetch(`${API_BASE}/api/users/${u.id}`, { method: "PUT", headers: authHdr, body: JSON.stringify({ companyId: companyId || null }) });
    if (res.ok) { load(); toast.success(t('devPanel.assignSuccessToast', { name: u.name })); }
    else setErr(t('devPanel.errors.assignCompany'));
  };

  return (
    <div className="min-h-screen bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="glass sticky top-0 z-20 px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-slate-800 text-white flex items-center justify-center text-sm font-bold">🛠</div>
          <div>
            <p className="text-sm font-bold leading-tight">{t('devPanel.title')}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{t('devPanel.headerSubtitle', { name: currentUser.name })}</p>
          </div>
        </div>
        <button onClick={() => { localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-600 border border-border rounded-xl px-3 py-2">
          <LogOut className="w-4 h-4" /> {t('devPanel.logout')}
        </button>
      </header>

      <div className="mx-4 mt-3 nav-pill-desktop flex gap-1 flex-wrap p-1 rounded-full">
        <button onClick={() => setTab("subscriptions")} className={`relative flex-1 py-2 rounded-full text-[13px] font-semibold liquid-transition ${tab === "subscriptions" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
          {t('devPanel.tabs.subscriptions')} {subs.filter(s => s.status === "pending").length > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full badge-pulse">{subs.filter(s => s.status === "pending").length}</span>}
        </button>
        <button onClick={() => setTab("firms")} className={`flex-1 py-2 rounded-full text-[13px] font-semibold liquid-transition ${tab === "firms" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{t('devPanel.tabs.firms', { count: companies.length })}</button>
        <button onClick={() => setTab("users")} className={`flex-1 py-2 rounded-full text-[13px] font-semibold liquid-transition ${tab === "users" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{t('devPanel.tabs.users')}</button>
        <button onClick={() => setTab("messages")} className={`flex-1 py-2 rounded-full text-[13px] font-semibold liquid-transition ${tab === "messages" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
          {t('devPanel.tabs.messages')}
        </button>
      </div>

      {err && <div className="mx-4 mt-3 bg-red-500/10 text-red-700 dark:text-red-400 text-sm p-3 rounded-lg border border-red-500/20">{err}</div>}

      <div className="p-4 space-y-3 pb-24">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tab === "subscriptions" ? (
          subs.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">{t('devPanel.subscriptions.empty')}</p> :
          subs.map(s => {
            const isPending = s.status === "pending";
            const isActive = s.status === "active";
            const isExpired = s.status === "expired";
            const isRejected = s.status === "rejected";
            const expiryWarning = isActive && typeof s.daysLeft === "number" && s.daysLeft <= 3;
            const statusLabel = isPending ? t('devPanel.subscriptions.statusPending') : isActive ? t('devPanel.subscriptions.statusActive', { days: s.daysLeft }) : isExpired ? t('devPanel.subscriptions.statusExpired') : t('devPanel.subscriptions.statusRejected');
            const statusColor = isPending ? "text-yellow-700 bg-yellow-500/10" : isActive ? (expiryWarning ? "text-orange-700 bg-orange-500/10" : "text-green-800 bg-green-500/10") : "text-red-700 bg-red-500/10";
            return (
              <div key={s.id} className={`surface rounded-2xl p-4 ${expiryWarning ? "ring-1 ring-orange-500/40" : ""} ${isPending ? "ring-1 ring-yellow-500/40" : ""}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{s.companyName}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{s.branchId} · {s.userPhone}</p>
                    <p className="text-[11px] text-muted-foreground">{s.userName}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-lg shrink-0 ${statusColor}`}>{statusLabel}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-muted-foreground mb-3">
                  <span>📦 {s.selectedPlan ? planLabel(s.selectedPlan) : "—"}</span>
                  <span className="font-semibold text-foreground">{s.amount ? t('devPanel.subscriptions.amount', { amount: s.amount.toLocaleString() }) : "—"}</span>
                </div>
                {s.requestedAt && <p className="text-[11px] text-muted-foreground mb-3">{t('devPanel.subscriptions.requestedAt')} {new Date(s.requestedAt).toLocaleString("uz-UZ")}</p>}
                {expiryWarning && (
                  <div className="mb-3">
                    <p className="text-[11px] text-orange-700 dark:text-orange-400 font-semibold mb-2">{t('devPanel.subscriptions.expiryWarning', { days: s.daysLeft })}</p>
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || s.selectedPlan || '1month'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-orange-400/40 rounded-lg px-2 py-1.5 bg-transparent">
                        {Object.entries(DEV_PLAN_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{planLabel(k)} — {v.amount.toLocaleString()} {t('devPanel.subscriptions.somSuffix')}</option>
                        ))}
                      </select>
                      <button onClick={() => renewSub(s.id)} disabled={subLoading === s.id}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-orange-500 text-white disabled:opacity-60 flex items-center gap-1 shrink-0">
                        {subLoading === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"} {t('devPanel.subscriptions.extend')}
                      </button>
                    </div>
                  </div>
                )}
                {isPending && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || 'bepul'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-green-500/40 rounded-lg px-2 py-1.5 bg-transparent">
                        {Object.entries(DEV_PLAN_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{planLabel(k)}{v.amount ? ` — ${v.amount.toLocaleString()} ${t('devPanel.subscriptions.somSuffix')}` : ` — ${t('devPanel.subscriptions.freeLabel')}`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setRenewPlan(prev => ({ ...prev, [s.id]: prev[s.id] || 'bepul' })); approveSub(s.id); }} disabled={subLoading === s.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-1">
                        {subLoading === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "✅"} {t('devPanel.subscriptions.approve')}
                      </button>
                      <button onClick={() => rejectSub(s.id)} disabled={subLoading === s.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10 disabled:opacity-60 flex items-center justify-center gap-1">
                        {subLoading === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "❌"} {t('devPanel.subscriptions.reject')}
                      </button>
                    </div>
                  </div>
                )}
                {(isExpired || isRejected) && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || s.selectedPlan || '1month'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-border/60 rounded-lg px-2 py-2 bg-transparent">
                        {Object.entries(DEV_PLAN_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{planLabel(k)} — {v.amount.toLocaleString()} {t('devPanel.subscriptions.somSuffix')}</option>
                        ))}
                      </select>
                      <button onClick={() => renewSub(s.id)} disabled={subLoading === s.id}
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1 shrink-0">
                        {subLoading === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "🔄"} {t('devPanel.subscriptions.renew')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : tab === "firms" ? (
          companies.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">{t('devPanel.firms.empty')}</p> :
          companies.map(c => (
            <div key={c.id} className="surface rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                    {c.logoUrl ? <img src={c.logoUrl} alt="" className="w-full h-full object-cover" /> : <Building2 className="w-5 h-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{c.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{c.branchId} · {c.status}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{t('devPanel.firms.owner')} {c.owner?.name || "—"} · {c.owner?.phone || c.phone}</p>
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 text-right">{t('devPanel.firms.userCountShort', { count: c.userCount })}<br/>{t('devPanel.firms.objectCountShort', { count: c.objectCount })}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => toggleStatus(c)} className="flex-1 text-xs font-semibold py-2 rounded-lg border border-border/60 hover:bg-muted">
                  {c.status === "SUSPENDED" ? t('devPanel.firms.activate') : t('devPanel.firms.suspend')}
                </button>
                <button onClick={() => deleteCompany(c)} className="flex-1 text-xs font-semibold py-2 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> {t('devPanel.firms.delete')}
                </button>
              </div>
            </div>
          ))
        ) : tab === "messages" ? (
          <div className="flex flex-col md:flex-row gap-0 md:gap-2 md:h-[60vh] md:min-h-[320px]">
            {/* Mobile: breadcrumb/back nav */}
            {devMobileStep !== 'firms' && (
              <div className="md:hidden flex items-center gap-2 mb-2 pb-2 border-b border-border/40">
                <button onClick={() => { setDevMobileStep('firms'); setSelDevFirm(null); setSelDevGroup(null); setDevMsgs([]); }}
                  className="flex items-center gap-1 text-xs text-primary font-semibold py-1.5 px-2 rounded-lg hover:bg-primary/10">
                  <ChevronLeft className="w-4 h-4"/> {t('devPanel.messages.back')}
                </button>
                <span className="text-xs font-semibold text-foreground truncate">{selDevFirm?.name}</span>
              </div>
            )}

            {/* Column 1: Firmalar */}
            <div className={`${devMobileStep === 'firms' ? 'flex' : 'hidden'} md:flex flex-col gap-1 overflow-y-auto w-full md:w-40 md:shrink-0`}>
              <p className="text-[10px] font-semibold text-muted-foreground px-1 pb-1">{t('devPanel.messages.firmsTitle')}</p>
              {companies.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">{t('devPanel.firms.empty')}</p>}
              {companies.map((c: any) => {
                const cid = c.id || c._id;
                const isActive = selDevFirm && (selDevFirm.id || selDevFirm._id) === cid;
                return (
                  <button key={cid} onClick={() => openDevGroup(c)}
                    className={`w-full text-left px-3 py-2.5 md:py-2 rounded-xl text-xs font-semibold border border-border/40 flex items-center justify-between ${isActive?'bg-primary text-white':'surface'}`}>
                    <div className="min-w-0">
                      <p className="truncate">{c.name}</p>
                      <p className={`text-[10px] font-normal truncate ${isActive?'text-white/70':'text-muted-foreground'}`}>{c.branchId || ''}</p>
                    </div>
                    <ChevronLeft className="w-3.5 h-3.5 rotate-180 opacity-40 md:hidden flex-shrink-0 ml-1"/>
                  </button>
                );
              })}
            </div>

            {/* Column 2: Chat — firmaning umumiy "🛠 Dasturchi" guruhi (barcha xodimlar shu yerdan yozadi) */}
            <div className={`${devMobileStep === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 flex-col surface rounded-2xl overflow-hidden min-h-[60vh] md:min-h-0`}>
              {!selDevFirm ? (
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">{t('devPanel.messages.selectFirm')}</div>
              ) : devGroupLoading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary"/></div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 flex-shrink-0">
                    <div className="w-7 h-7 rounded-full bg-orange-500/15 flex items-center justify-center text-[14px] flex-shrink-0">🛠</div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-none truncate">{selDevFirm.name}</p>
                      <p className="text-[10px] text-muted-foreground">{t('devPanel.messages.subtitle')}</p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {devMsgs.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">{t('devPanel.messages.empty')}</p>}
                    {devMsgs.map(m => {
                      const mine = m.fromUserId === currentUser.id;
                      const sender = !mine ? users.find((u: any) => u.id === m.fromUserId) : null;
                      return (
                        <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'}`}>
                          <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs ${mine?'bg-gradient-to-br from-primary to-primary/90 text-white':'bg-muted'}`}>
                            {!mine && sender && <p className="text-[9px] font-semibold text-primary mb-0.5">{sender.name}</p>}
                            {m.type==='image' && m.mediaUrl && (
                              <img src={m.mediaUrl} alt={t('devPanel.messages.imageAlt')} loading="lazy" decoding="async" className="rounded-xl max-w-full max-h-52 object-cover mb-1 cursor-pointer" onClick={()=>window.open(m.mediaUrl,'_blank')}/>
                            )}
                            {m.type==='video' && m.mediaUrl && (
                              <video src={m.mediaUrl} controls preload="metadata" className="rounded-xl max-w-full max-h-52 mb-1"/>
                            )}
                            {m.type==='audio' && m.mediaUrl && (
                              <VoicePlayer src={m.mediaUrl} mine={mine}/>
                            )}
                            {m.type==='file' && m.mediaUrl && (
                              <a href={m.mediaUrl} download={m.fileName} className="flex items-center gap-2 mb-1 hover:opacity-75 transition-opacity">
                                <FileText className="w-4 h-4 flex-shrink-0"/>
                                <span className="truncate max-w-[140px] font-medium">{m.fileName || t('devPanel.messages.fileFallback')}</span>
                              </a>
                            )}
                            {m.type==='location' && m.location && (
                              <a href={`https://maps.google.com/?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/10 rounded-xl px-2.5 py-1.5 mb-1 hover:bg-black/20 transition-colors">
                                <MapPin className="w-3.5 h-3.5 text-green-400 flex-shrink-0"/>
                                <span className="text-[10px]">{t('devPanel.messages.location')}</span>
                              </a>
                            )}
                            {m.text && !['🖼️ Rasm','🎥 Video','🎤 Ovozli xabar','📍 Lokatsiya'].includes(m.text) && (
                              <p className="break-words">{m.text}</p>
                            )}
                            <p className={`text-[9px] mt-0.5 ${mine?'text-white/60':'text-muted-foreground'}`}>{new Date(m.timestamp).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit'})}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={devMsgBottomRef}/>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/40 flex-shrink-0">
                    <input value={devMsgText} onChange={e => setDevMsgText(e.target.value)}
                      onKeyDown={e => e.key==='Enter'&&!e.shiftKey&&sendDevMsg()}
                      placeholder={t('devPanel.messages.inputPlaceholder')}
                      className="flex-1 text-sm md:text-xs bg-muted/50 rounded-xl px-3 py-2.5 md:py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"/>
                    <button onClick={sendDevMsg} disabled={devMsgLoading||!devMsgText.trim()} aria-label={t('devPanel.messages.sendAria')}
                      className="w-10 h-10 md:w-8 md:h-8 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0">
                      {devMsgLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          users.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">{t('devPanel.users.empty')}</p> :
          users.map(u => (
            <div key={u.id} className="surface rounded-2xl p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{u.name}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{u.phone}</p>
                <p className={`text-[11px] truncate ${u.companyId ? "text-muted-foreground" : "text-red-500 font-semibold"}`}>{u.companyId ? companyName(u.companyId) : t('devPanel.users.noCompany')}{u.isOwner ? t('devPanel.users.ownerSuffix') : ""}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {u.role !== "dasturchi" && (
                  <select value={u.companyId || ""} onChange={e => assignCompany(u, e.target.value)}
                    title={t('devPanel.users.assignTitle')}
                    className={`text-xs border rounded-lg px-2 py-1.5 bg-transparent max-w-[110px] ${u.companyId ? "border-border/60" : "border-red-500/50 text-red-600"}`}>
                    <option value="">{t('devPanel.users.noCompanyOption')}</option>
                    {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <select value={u.role} onChange={e => changeRole(u, e.target.value)} disabled={u.role === "dasturchi"}
                  className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                  {["direktor","orinbosar","prorab","brigadir","ishchi"].map(r => <option key={r} value={r}>{ROLE_LABELS[r as Role]}</option>)}
                  {u.role === "dasturchi" && <option value="dasturchi">{t('devPanel.users.developerOption')}</option>}
                </select>
                <button onClick={() => deleteUser(u)} disabled={u.id === currentUser.id} aria-label={t('devPanel.users.deleteAria')}
                  className="w-9 h-9 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center disabled:opacity-30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
