import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import LogOut from "@hugeicons/core-free-icons/Logout01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import FileText from "@hugeicons/core-free-icons/FileTextIcon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Unlock from "@hugeicons/core-free-icons/LockOpenIcon";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { connectSocket } from "./socket";
import type { AppUser, Msg, Role } from "./App";
import { ROLE_LABELS, VoicePlayer } from "./App";
import { SkeletonList, SkeletonMessage } from "./Skeleton";
import { openExternalUrl } from "./platform";

// ─── Developer Panel ────────────────────────────────────────────────────────────
export default function DeveloperPanel({ currentUser, onLogout }: { currentUser: AppUser; onLogout: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"firms" | "users" | "subscriptions" | "messages" | "plans" | "promocodes">("subscriptions");
  const [companies, setCompanies] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  // Tariflar — ENDI kodda qattiq yozilmagan, backenddagi Plan kolleksiyasidan
  // (routes/plans.ts) o'qiladi va shu yerning o'zidan tahrirlanadi.
  const [plans, setPlans] = useState<any[]>([]);
  const [features, setFeatures] = useState<{ key: string; label: string }[]>([]);
  const [planSaving, setPlanSaving] = useState<string|null>(null);
  const [newPlan, setNewPlan] = useState<{ key: string; label: string; days: string; amount: string; features: string[]; period: string; tier: string } | null>(null);
  // Promokodlar (routes/promocodes.ts) — narxni kamaytiruvchi kodlar.
  const [promoCodes, setPromoCodes] = useState<any[]>([]);
  const [promoSaving, setPromoSaving] = useState<string|null>(null);
  const [newPromo, setNewPromo] = useState<{ code: string; type: "percent"|"fixed"; value: string; maxUses: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [subLoading, setSubLoading] = useState<string|null>(null);
  const [renewPlan, setRenewPlan] = useState<Record<string, string>>({}); // subId → selectedPlan
  const [adjustDays, setAdjustDays] = useState<Record<string, string>>({}); // subId → kun soni (+/-)
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
      const [cr, ur, sr, pr, fr, pcr] = await Promise.all([
        fetch(`${API_BASE}/api/companies`, { headers: authHdr }),
        fetch(`${API_BASE}/api/users`, { headers: authHdr }),
        fetch(`${API_BASE}/api/admin/subscriptions`, { headers: authHdr }),
        fetch(`${API_BASE}/api/plans/admin`, { headers: authHdr }),
        fetch(`${API_BASE}/api/plans/features`, { headers: authHdr }),
        fetch(`${API_BASE}/api/promocodes`, { headers: authHdr }),
      ]);
      if (!cr.ok) { setErr(t('devPanel.errors.loadCompanies')); setLoading(false); return; }
      setCompanies(await cr.json());
      setUsers(ur.ok ? await ur.json() : []);
      setSubs(sr.ok ? await sr.json() : []);
      setPlans(pr.ok ? await pr.json() : []);
      setFeatures(fr.ok ? await fr.json() : []);
      setPromoCodes(pcr.ok ? await pcr.json() : []);
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
    const cfg = plans.find(p => p.key === plan) || plans.find(p => p.key === 'bepul') || { days: 30, amount: 0 };
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

  // ── Tariflar (Plan) — admin panelidan narx/kun/funksiya boshqaruvi ──
  const savePlan = async (plan: any) => {
    setPlanSaving(plan.key);
    try {
      const res = await fetch(`${API_BASE}/api/plans/admin/${plan.key}`, {
        method: "PUT", headers: authHdr,
        body: JSON.stringify({
          label: plan.label, days: plan.days, amount: plan.amount, features: plan.features, active: plan.active,
          period: plan.period || undefined, tier: plan.tier ? Number(plan.tier) : undefined,
        }),
      });
      if (res.ok) { toast.success(t('devPanel.plans.savedToast')); await load(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.plans.saveError')); }
    } catch { toast.error(t('devPanel.plans.saveError')); }
    setPlanSaving(null);
  };
  const deletePlan = async (key: string) => {
    if (!window.confirm(t('devPanel.plans.confirmDelete'))) return;
    const res = await fetch(`${API_BASE}/api/plans/admin/${key}`, { method: "DELETE", headers: authHdr });
    if (res.ok) load(); else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.plans.deleteError')); }
  };
  const createPlan = async () => {
    if (!newPlan || !newPlan.key.trim() || !newPlan.label.trim()) return;
    const res = await fetch(`${API_BASE}/api/plans/admin`, {
      method: "POST", headers: authHdr,
      body: JSON.stringify({
        key: newPlan.key.trim(), label: newPlan.label.trim(),
        days: Number(newPlan.days) || 30, amount: Number(newPlan.amount) || 0,
        features: newPlan.features,
        period: newPlan.period || undefined, tier: newPlan.tier ? Number(newPlan.tier) : undefined,
      }),
    });
    if (res.ok) { setNewPlan(null); toast.success(t('devPanel.plans.createdToast')); await load(); }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.plans.saveError')); }
  };

  // ── Promokodlar (routes/promocodes.ts) ──
  const savePromo = async (promo: any) => {
    setPromoSaving(promo.id || promo._id);
    try {
      const res = await fetch(`${API_BASE}/api/promocodes/${promo.id || promo._id}`, {
        method: "PUT", headers: authHdr,
        body: JSON.stringify({ active: promo.active }),
      });
      if (res.ok) { await load(); } else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.promocodes.saveError')); }
    } catch { toast.error(t('devPanel.promocodes.saveError')); }
    setPromoSaving(null);
  };
  const deletePromo = async (id: string) => {
    if (!window.confirm(t('devPanel.promocodes.confirmDelete'))) return;
    const res = await fetch(`${API_BASE}/api/promocodes/${id}`, { method: "DELETE", headers: authHdr });
    if (res.ok) load(); else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.promocodes.deleteError')); }
  };
  const createPromo = async () => {
    if (!newPromo || !newPromo.code.trim() || !newPromo.value.trim()) return;
    const res = await fetch(`${API_BASE}/api/promocodes`, {
      method: "POST", headers: authHdr,
      body: JSON.stringify({
        code: newPromo.code.trim(), type: newPromo.type, value: Number(newPromo.value) || 0,
        maxUses: newPromo.maxUses.trim() ? Number(newPromo.maxUses) : undefined,
      }),
    });
    if (res.ok) { setNewPromo(null); toast.success(t('devPanel.promocodes.createdToast')); await load(); }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.promocodes.saveError')); }
  };

  // ── Obuna muddatini istalgan firmaga, istalgan vaqtda qo'shish/ayirish ──
  const adjustSubDays = async (id: string) => {
    const raw = (adjustDays[id] || '').trim();
    const days = Number(raw);
    if (!raw || !Number.isFinite(days) || days === 0) { toast.error(t('devPanel.subscriptions.adjustDaysInvalid')); return; }
    setSubLoading(id);
    const res = await fetch(`${API_BASE}/api/admin/subscriptions/${id}/adjust-days`, {
      method: "POST", headers: authHdr, body: JSON.stringify({ days }),
    });
    if (res.ok) { setAdjustDays(prev => ({ ...prev, [id]: '' })); toast.success(t('devPanel.subscriptions.adjustDaysToast', { days })); await load(); }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || t('devPanel.errors.renew')); }
    setSubLoading(null);
  };

  const companyName = (cid: string) => companies.find(c => c.id === cid)?.name || "—";
  const planLabel = (key: string) => plans.find(p => p.key === key)?.label || key;

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
  const toggleBlock = async (u: any) => {
    const action = u.isBlocked ? "unblock" : "block";
    if (!u.isBlocked && !window.confirm(t('devPanel.confirm.blockUser', { name: u.name, phone: u.phone }))) return;
    const res = await fetch(`${API_BASE}/api/users/${u.id}/${action}`, { method: "PATCH", headers: authHdr });
    if (res.ok) { load(); toast.success(u.isBlocked ? t('devPanel.users.unblockedToast', { name: u.name }) : t('devPanel.users.blockedToast', { name: u.name })); }
    else { const d = await res.json().catch(() => ({})); setErr(d.error || t('devPanel.errors.block')); }
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

  // Umumiy ko'rinish statistikasi — allaqachon yuklangan companies/users/subs
  // massivlaridan hisoblanadi, alohida so'rov shart emas.
  const activeSubsCount = subs.filter(s => s.status === "active").length;
  const pendingSubsCount = subs.filter(s => s.status === "pending").length;
  const expiringSoonCount = subs.filter(s => s.status === "active" && typeof s.daysLeft === "number" && s.daysLeft <= 3).length;

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="glass sticky top-0 z-20 px-4 py-3 flex items-center justify-between gap-2 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-sm font-bold shadow-sm shrink-0">🛠</div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight truncate">{t('devPanel.title')}</p>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">{t('devPanel.headerSubtitle', { name: currentUser.name })}</p>
          </div>
        </div>
        <button onClick={() => { localStorage.removeItem("currentUser"); localStorage.removeItem("token"); onLogout(); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-600 border border-border rounded-xl px-3 py-2 shrink-0">
          <MorphIcon icon={LogOut} className="w-4 h-4"  /> <span className="hidden sm:inline">{t('devPanel.logout')}</span>
        </button>
      </header>

      {/* Umumiy ko'rinish — statistika kartochkalari, barcha tab'larda ko'rinadi */}
      {!loading && (
        <div className="mx-4 mt-3 grid grid-cols-2 md:grid-cols-4 gap-2.5 flex-shrink-0">
          {[
            { label: t('devPanel.stats.totalFirms'), value: companies.length, accent: "text-primary" },
            { label: t('devPanel.stats.activeSubs'), value: activeSubsCount, accent: "text-green-600 dark:text-green-400" },
            { label: t('devPanel.stats.pending'), value: pendingSubsCount, accent: pendingSubsCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
            { label: t('devPanel.stats.totalUsers'), value: users.length, accent: "text-accent" },
          ].map(s => (
            <div key={s.label} className="surface rounded-2xl px-3.5 py-3">
              <p className="text-[10px] text-muted-foreground font-semibold truncate">{s.label}</p>
              <p className={`text-xl font-bold font-mono mt-0.5 ${s.accent}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}
      {expiringSoonCount > 0 && (
        <div className="mx-4 mt-2.5 flex items-center gap-2 text-[11px] font-semibold text-orange-700 dark:text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2 flex-shrink-0">
          ⚠️ {expiringSoonCount} {t('devPanel.stats.expiringSoon')}
        </div>
      )}

      <div className="mx-4 mt-3 flex items-center gap-2 flex-shrink-0">
        <div className="flex-1 nav-pill-desktop grid grid-cols-2 sm:flex sm:flex-wrap gap-1 p-1 rounded-2xl sm:rounded-full">
          <button onClick={() => setTab("subscriptions")} className={`relative py-2 rounded-full text-[13px] font-semibold liquid-transition sm:flex-1 ${tab === "subscriptions" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {t('devPanel.tabs.subscriptions')} {subs.filter(s => s.status === "pending").length > 0 && <span className="ml-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full badge-pulse">{subs.filter(s => s.status === "pending").length}</span>}
          </button>
          <button onClick={() => setTab("firms")} className={`py-2 rounded-full text-[13px] font-semibold liquid-transition sm:flex-1 ${tab === "firms" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{t('devPanel.tabs.firms', { count: companies.length })}</button>
          <button onClick={() => setTab("users")} className={`py-2 rounded-full text-[13px] font-semibold liquid-transition sm:flex-1 ${tab === "users" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{t('devPanel.tabs.users')}</button>
          <button onClick={() => setTab("messages")} className={`py-2 rounded-full text-[13px] font-semibold liquid-transition sm:flex-1 ${tab === "messages" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {t('devPanel.tabs.messages')}
          </button>
          <button onClick={() => setTab("plans")} className={`py-2 rounded-full text-[13px] font-semibold liquid-transition sm:flex-1 ${tab === "plans" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {t('devPanel.tabs.plans')}
          </button>
          <button onClick={() => setTab("promocodes")} className={`py-2 rounded-full text-[13px] font-semibold liquid-transition sm:flex-1 ${tab === "promocodes" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {t('devPanel.tabs.promocodes')}
          </button>
        </div>
        {/* Ma'lumotlar FAQAT panel birinchi ochilganda yuklanardi — keyin
            (masalan panel ochiq turgan payt boshqa joyda yangi to'lov/
            ro'yxatdan o'tish sodir bo'lsa) hech qachon o'zi yangilanmasdi,
            "hech narsa o'zgarmagan" degan taassurot qoldirardi. */}
        <button onClick={load} disabled={loading} title={t('devPanel.refresh')} aria-label={t('devPanel.refresh')}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 liquid-transition flex-shrink-0">
          <MorphIcon icon={RefreshCw} className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {err && <div className="mx-4 mt-3 bg-red-500/10 text-red-700 dark:text-red-400 text-sm p-3 rounded-lg border border-red-500/20 flex-shrink-0">{err}</div>}

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
        {loading ? (
          <SkeletonList items={5}/>
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
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-lg ${statusColor}`}>{statusLabel}</span>
                    {s.autoActivated && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t('devPanel.subscriptions.autoActivated')}</span>}
                  </div>
                </div>
                <div className="flex items-center justify-between text-[12px] text-muted-foreground mb-3">
                  <span>📦 {s.selectedPlan ? planLabel(s.selectedPlan) : "—"}</span>
                  <span className="font-semibold text-foreground">{s.amount ? t('devPanel.subscriptions.amount', { amount: s.amount.toLocaleString() }) : "—"}</span>
                </div>
                {s.requestedAt && <p className="text-[11px] text-muted-foreground mb-3">{t('devPanel.subscriptions.requestedAt')} {new Date(s.requestedAt).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}</p>}
                {Array.isArray(s.payments) && s.payments.length > 0 && (
                  <details className="mb-3 group">
                    <summary className="text-[11px] font-semibold text-muted-foreground cursor-pointer select-none list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 liquid-transition inline-block">▸</span> {t('devPanel.subscriptions.paymentsTitle')} ({s.payments.length})
                    </summary>
                    <div className="mt-2 space-y-1.5 border-l-2 border-border/60 pl-3">
                      {s.payments.map((p: any) => {
                        const pColor = p.status === 'paid' ? 'text-green-700 dark:text-green-400' : p.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400';
                        return (
                          <div key={p.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("uz-UZ", { timeZone: "Asia/Tashkent" })} · {p.provider}</span>
                            <span className={`font-semibold ${pColor}`}>{p.amount.toLocaleString()} {t('devPanel.subscriptions.somSuffix')} — {t(`devPanel.subscriptions.paymentStatus.${p.status}`)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
                {expiryWarning && (
                  <div className="mb-3">
                    <p className="text-[11px] text-orange-700 dark:text-orange-400 font-semibold mb-2">{t('devPanel.subscriptions.expiryWarning', { days: s.daysLeft })}</p>
                    <div className="flex items-center gap-2">
                      <select value={renewPlan[s.id] || s.selectedPlan || '1month'}
                        onChange={e => setRenewPlan(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="flex-1 text-xs border border-orange-400/40 rounded-lg px-2 py-1.5 bg-transparent">
                        {plans.map(p => (
                          <option key={p.key} value={p.key}>{p.label} — {p.amount.toLocaleString()} {t('devPanel.subscriptions.somSuffix')}</option>
                        ))}
                      </select>
                      <button onClick={() => renewSub(s.id)} disabled={subLoading === s.id}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-orange-500 text-white disabled:opacity-60 flex items-center gap-1 shrink-0">
                        {subLoading === s.id ? <MorphIcon icon={Loader2} className="w-3 h-3 animate-spin"  /> : "+"} {t('devPanel.subscriptions.extend')}
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
                        {plans.map(p => (
                          <option key={p.key} value={p.key}>{p.label}{p.amount ? ` — ${p.amount.toLocaleString()} ${t('devPanel.subscriptions.somSuffix')}` : ` — ${t('devPanel.subscriptions.freeLabel')}`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setRenewPlan(prev => ({ ...prev, [s.id]: prev[s.id] || 'bepul' })); approveSub(s.id); }} disabled={subLoading === s.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-1">
                        {subLoading === s.id ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin"  /> : "✅"} {t('devPanel.subscriptions.approve')}
                      </button>
                      <button onClick={() => rejectSub(s.id)} disabled={subLoading === s.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10 disabled:opacity-60 flex items-center justify-center gap-1">
                        {subLoading === s.id ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin"  /> : "❌"} {t('devPanel.subscriptions.reject')}
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
                        {plans.map(p => (
                          <option key={p.key} value={p.key}>{p.label} — {p.amount.toLocaleString()} {t('devPanel.subscriptions.somSuffix')}</option>
                        ))}
                      </select>
                      <button onClick={() => renewSub(s.id)} disabled={subLoading === s.id}
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1 shrink-0">
                        {subLoading === s.id ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin"  /> : "🔄"} {t('devPanel.subscriptions.renew')}
                      </button>
                    </div>
                  </div>
                )}
                {/* Muddatni istalgan holatdagi (faol/kutilayotgan/tugagan/rad
                    etilgan) firmaga istalgan vaqt qo'shish/ayirish — masalan
                    bonus kunlar berish yoki xato bilan berilgan muddatni
                    qisqartirish uchun. */}
                <div className="flex items-center gap-2 pt-2 mt-2 border-t border-border/30">
                  <input type="number" placeholder={t('devPanel.subscriptions.adjustDaysPlaceholder')}
                    value={adjustDays[s.id] || ''}
                    onChange={e => setAdjustDays(prev => ({ ...prev, [s.id]: e.target.value }))}
                    className="flex-1 text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  <button onClick={() => adjustSubDays(s.id)} disabled={subLoading === s.id}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-60 shrink-0">
                    {t('devPanel.subscriptions.adjustDaysBtn')}
                  </button>
                </div>
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
                    {c.logoUrl ? <img src={c.logoUrl} alt="" className="w-full h-full object-cover" /> : <MorphIcon icon={Building2} className="w-5 h-5 text-primary"  />}
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
                  <MorphIcon icon={Trash2} className="w-3.5 h-3.5"  /> {t('devPanel.firms.delete')}
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
                  <MorphIcon icon={ChevronLeft} className="w-4 h-4" /> {t('devPanel.messages.back')}
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
                    <MorphIcon icon={ChevronLeft} className="w-3.5 h-3.5 rotate-180 opacity-40 md:hidden flex-shrink-0 ml-1" />
                  </button>
                );
              })}
            </div>

            {/* Column 2: Chat — firmaning umumiy "🛠 Dasturchi" guruhi (barcha xodimlar shu yerdan yozadi) */}
            <div className={`${devMobileStep === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 flex-col surface rounded-2xl overflow-hidden min-h-[60vh] md:min-h-0`}>
              {!selDevFirm ? (
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">{t('devPanel.messages.selectFirm')}</div>
              ) : devGroupLoading ? (
                <div className="flex-1 flex flex-col justify-end gap-2.5 p-3">
                  <SkeletonMessage/><SkeletonMessage mine/><SkeletonMessage/>
                </div>
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
                              <button onClick={()=>openExternalUrl(m.mediaUrl!)} className="flex items-center gap-2 mb-1 hover:opacity-75 transition-opacity text-left">
                                <MorphIcon icon={FileText} className="w-4 h-4 flex-shrink-0" />
                                <span className="truncate max-w-[140px] font-medium">{m.fileName || t('devPanel.messages.fileFallback')}</span>
                              </button>
                            )}
                            {m.type==='location' && m.location && (
                              <a href={`https://maps.google.com/?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/10 rounded-xl px-2.5 py-1.5 mb-1 hover:bg-black/20 transition-colors">
                                <MorphIcon icon={MapPin} className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                <span className="text-[10px]">{t('devPanel.messages.location')}</span>
                              </a>
                            )}
                            {m.text && !['🖼️ Rasm','🎥 Video','🎤 Ovozli xabar','📍 Lokatsiya'].includes(m.text) && (
                              <p className="break-words">{m.text}</p>
                            )}
                            <p className={`text-[9px] mt-0.5 ${mine?'text-white/60':'text-muted-foreground'}`}>{new Date(m.timestamp).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tashkent'})}</p>
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
                      {devMsgLoading ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Send} className="w-4 h-4" />}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : tab === "users" ? (
          users.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">{t('devPanel.users.empty')}</p> :
          users.map(u => (
            <div key={u.id} className={`surface rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${u.isBlocked ? "ring-1 ring-red-500/40" : ""}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">{u.name}</p>
                  {u.isBlocked && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 shrink-0">{t('devPanel.users.blockedBadge')}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground font-mono">{u.phone}</p>
                <p className={`text-[11px] truncate ${u.companyId ? "text-muted-foreground" : "text-red-500 font-semibold"}`}>{u.companyId ? companyName(u.companyId) : t('devPanel.users.noCompany')}{u.isOwner ? t('devPanel.users.ownerSuffix') : ""}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">
                {u.role !== "dasturchi" && (
                  <select value={u.companyId || ""} onChange={e => assignCompany(u, e.target.value)}
                    title={t('devPanel.users.assignTitle')}
                    className={`flex-1 sm:flex-initial min-w-0 text-xs border rounded-lg px-2 py-1.5 bg-transparent sm:max-w-[110px] ${u.companyId ? "border-border/60" : "border-red-500/50 text-red-600"}`}>
                    <option value="">{t('devPanel.users.noCompanyOption')}</option>
                    {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <select value={u.role} onChange={e => changeRole(u, e.target.value)} disabled={u.role === "dasturchi"}
                  className="flex-1 sm:flex-initial min-w-0 text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                  {["direktor","orinbosar","prorab","brigadir","ishchi"].map(r => <option key={r} value={r}>{ROLE_LABELS[r as Role]}</option>)}
                  {u.role === "dasturchi" && <option value="dasturchi">{t('devPanel.users.developerOption')}</option>}
                </select>
                {u.role !== "dasturchi" && !u.isOwner && (
                  <button onClick={() => toggleBlock(u)} disabled={u.id === currentUser.id}
                    aria-label={u.isBlocked ? t('devPanel.users.unblockAria') : t('devPanel.users.blockAria')}
                    title={u.isBlocked ? t('devPanel.users.unblockAria') : t('devPanel.users.blockAria')}
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center disabled:opacity-30 shrink-0 liquid-transition ${u.isBlocked ? "border-green-500/30 text-green-600 hover:bg-green-500/10" : "border-orange-500/30 text-orange-600 hover:bg-orange-500/10"}`}>
                    <MorphIcon icon={u.isBlocked ? Unlock : Lock} className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => deleteUser(u)} disabled={u.id === currentUser.id} aria-label={t('devPanel.users.deleteAria')}
                  className="w-9 h-9 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center disabled:opacity-30 shrink-0">
                  <MorphIcon icon={Trash2} className="w-4 h-4"  />
                </button>
              </div>
            </div>
          ))
        ) : tab === "plans" ? (
          // ── Tariflar — narx/kun/yorliq/funksiyalarni tahrirlash, yangi tarif qo'shish ──
          <div className="space-y-3">
            {plans.map(p => (
              <div key={p.key} className={`surface rounded-2xl p-4 space-y-3 ${!p.active ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground">{p.key}</span>
                  <button onClick={() => savePlan({ ...p, active: !p.active })} disabled={planSaving === p.key}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full ${p.active ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {p.active ? t('devPanel.plans.active') : t('devPanel.plans.inactive')}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t('devPanel.plans.labelField')}</label>
                    <input value={p.label} onChange={e => setPlans(prev => prev.map(x => x.key === p.key ? { ...x, label: e.target.value } : x))}
                      className="w-full text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t('devPanel.plans.daysField')}</label>
                    <input type="number" value={p.days} onChange={e => setPlans(prev => prev.map(x => x.key === p.key ? { ...x, days: Number(e.target.value) } : x))}
                      className="w-full text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t('devPanel.plans.amountField')}</label>
                    <input type="number" value={p.amount} onChange={e => setPlans(prev => prev.map(x => x.key === p.key ? { ...x, amount: Number(e.target.value) } : x))}
                      className="w-full text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t('devPanel.plans.periodField')}</label>
                    <select value={p.period || ''} onChange={e => setPlans(prev => prev.map(x => x.key === p.key ? { ...x, period: e.target.value || undefined } : x))}
                      className="w-full text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                      <option value="">{t('devPanel.plans.periodNone')}</option>
                      <option value="1month">{t('devPanel.plans.period1Month')}</option>
                      <option value="3month">{t('devPanel.plans.period3Month')}</option>
                      <option value="12month">{t('devPanel.plans.period12Month')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t('devPanel.plans.tierField')}</label>
                    <select value={p.tier || ''} onChange={e => setPlans(prev => prev.map(x => x.key === p.key ? { ...x, tier: e.target.value ? Number(e.target.value) : undefined } : x))}
                      className="w-full text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                      <option value="">{t('devPanel.plans.tierNone')}</option>
                      <option value="1">{t('devPanel.plans.tier1')}</option>
                      <option value="2">{t('devPanel.plans.tier2')}</option>
                      <option value="3">{t('devPanel.plans.tier3')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1.5">{t('devPanel.plans.featuresField')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {features.map(f => {
                      const enabled = (p.features || []).includes(f.key);
                      return (
                        <button key={f.key}
                          onClick={() => setPlans(prev => prev.map(x => x.key === p.key ? { ...x, features: enabled ? x.features.filter((k: string) => k !== f.key) : [...x.features, f.key] } : x))}
                          className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full border liquid-transition ${enabled ? "bg-primary/10 border-primary/40 text-primary" : "border-border/60 text-muted-foreground"}`}>
                          {enabled ? "✓ " : ""}{f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => savePlan(p)} disabled={planSaving === p.key}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-primary text-white disabled:opacity-60 flex items-center justify-center gap-1">
                    {planSaving === p.key ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : t('devPanel.plans.save')}
                  </button>
                  <button onClick={() => deletePlan(p.key)}
                    className="px-3 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10">
                    <MorphIcon icon={Trash2} className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Yangi tarif qo'shish */}
            {newPlan ? (
              <div className="surface rounded-2xl p-4 space-y-3 ring-1 ring-primary/40">
                <p className="text-xs font-bold text-primary">{t('devPanel.plans.newTitle')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder={t('devPanel.plans.keyField')} value={newPlan.key} onChange={e => setNewPlan({ ...newPlan, key: e.target.value.replace(/[^a-z0-9_-]/gi, '') })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  <input placeholder={t('devPanel.plans.labelField')} value={newPlan.label} onChange={e => setNewPlan({ ...newPlan, label: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent" />
                  <input type="number" placeholder={t('devPanel.plans.daysField')} value={newPlan.days} onChange={e => setNewPlan({ ...newPlan, days: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  <input type="number" placeholder={t('devPanel.plans.amountField')} value={newPlan.amount} onChange={e => setNewPlan({ ...newPlan, amount: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  <select value={newPlan.period} onChange={e => setNewPlan({ ...newPlan, period: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                    <option value="">{t('devPanel.plans.periodNone')}</option>
                    <option value="1month">{t('devPanel.plans.period1Month')}</option>
                    <option value="3month">{t('devPanel.plans.period3Month')}</option>
                    <option value="12month">{t('devPanel.plans.period12Month')}</option>
                  </select>
                  <select value={newPlan.tier} onChange={e => setNewPlan({ ...newPlan, tier: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                    <option value="">{t('devPanel.plans.tierNone')}</option>
                    <option value="1">{t('devPanel.plans.tier1')}</option>
                    <option value="2">{t('devPanel.plans.tier2')}</option>
                    <option value="3">{t('devPanel.plans.tier3')}</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {features.map(f => {
                    const enabled = newPlan.features.includes(f.key);
                    return (
                      <button key={f.key}
                        onClick={() => setNewPlan({ ...newPlan, features: enabled ? newPlan.features.filter(k => k !== f.key) : [...newPlan.features, f.key] })}
                        className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full border liquid-transition ${enabled ? "bg-primary/10 border-primary/40 text-primary" : "border-border/60 text-muted-foreground"}`}>
                        {enabled ? "✓ " : ""}{f.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button onClick={createPlan} className="flex-1 py-2 rounded-xl text-xs font-bold bg-primary text-white">{t('devPanel.plans.create')}</button>
                  <button onClick={() => setNewPlan(null)} className="px-3 py-2 rounded-xl text-xs font-bold border border-border/60">{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewPlan({ key: '', label: '', days: '30', amount: '0', features: [], period: '', tier: '' })}
                className="w-full py-3 rounded-2xl text-xs font-bold border-2 border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary liquid-transition">
                + {t('devPanel.plans.newTitle')}
              </button>
            )}
          </div>
        ) : (
          // ── Promokodlar — narxni kamaytiruvchi kodlar (routes/promocodes.ts) ──
          <div className="space-y-3">
            {promoCodes.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">{t('devPanel.promocodes.empty')}</p>}
            {promoCodes.map((pc: any) => (
              <div key={pc.id || pc._id} className={`surface rounded-2xl p-4 space-y-2 ${!pc.active ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-mono font-bold">{pc.code}</span>
                  <button onClick={() => savePromo({ ...pc, active: !pc.active })} disabled={promoSaving === (pc.id || pc._id)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full ${pc.active ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {pc.active ? t('devPanel.plans.active') : t('devPanel.plans.inactive')}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {pc.type === 'percent' ? t('devPanel.promocodes.percentOff', { value: pc.value }) : t('devPanel.promocodes.fixedOff', { value: pc.value.toLocaleString('uz-UZ') })}
                  {typeof pc.maxUses === 'number' && ` · ${t('devPanel.promocodes.usedOf', { used: pc.usedCount || 0, max: pc.maxUses })}`}
                  {typeof pc.maxUses !== 'number' && ` · ${t('devPanel.promocodes.usedCount', { count: pc.usedCount || 0 })}`}
                </p>
                <button onClick={() => deletePromo(pc.id || pc._id)}
                  className="w-full py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-600 hover:bg-red-500/10 flex items-center justify-center gap-1">
                  <MorphIcon icon={Trash2} className="w-3.5 h-3.5" /> {t('devPanel.promocodes.delete')}
                </button>
              </div>
            ))}

            {newPromo ? (
              <div className="surface rounded-2xl p-4 space-y-3 ring-1 ring-primary/40">
                <p className="text-xs font-bold text-primary">{t('devPanel.promocodes.newTitle')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder={t('devPanel.promocodes.codeField')} value={newPromo.code} onChange={e => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  <select value={newPromo.type} onChange={e => setNewPromo({ ...newPromo, type: e.target.value as "percent"|"fixed" })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent">
                    <option value="percent">{t('devPanel.promocodes.typePercent')}</option>
                    <option value="fixed">{t('devPanel.promocodes.typeFixed')}</option>
                  </select>
                  <input type="number" placeholder={t('devPanel.promocodes.valueField')} value={newPromo.value} onChange={e => setNewPromo({ ...newPromo, value: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                  <input type="number" placeholder={t('devPanel.promocodes.maxUsesField')} value={newPromo.maxUses} onChange={e => setNewPromo({ ...newPromo, maxUses: e.target.value })}
                    className="text-xs border border-border/60 rounded-lg px-2 py-1.5 bg-transparent font-mono" />
                </div>
                <div className="flex gap-2">
                  <button onClick={createPromo} className="flex-1 py-2 rounded-xl text-xs font-bold bg-primary text-white">{t('devPanel.promocodes.create')}</button>
                  <button onClick={() => setNewPromo(null)} className="px-3 py-2 rounded-xl text-xs font-bold border border-border/60">{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewPromo({ code: '', type: 'percent', value: '10', maxUses: '' })}
                className="w-full py-3 rounded-2xl text-xs font-bold border-2 border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary liquid-transition">
                + {t('devPanel.promocodes.newTitle')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
