import { confirmDialog } from "./lib/confirmDialog";
import { useState, useRef, useEffect, Suspense } from "react";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Users from "@hugeicons/core-free-icons/UserMultipleIcon";
import HardHat from "@hugeicons/core-free-icons/HardHatIcon";
import Package from "@hugeicons/core-free-icons/Package01Icon";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import AlertTriangle from "@hugeicons/core-free-icons/Alert02Icon";
import ChevronRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import User from "@hugeicons/core-free-icons/UserIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import UserPlus from "@hugeicons/core-free-icons/UserAdd01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import FileText from "@hugeicons/core-free-icons/FileTextIcon";
import Upload from "@hugeicons/core-free-icons/Upload01Icon";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { API_BASE, parseSmetaFile, uploadChatMedia } from "./api";
import { motion, AnimatePresence } from "motion/react";
import { EquipmentDetails } from "./EquipmentExtras";
import { saveOrShareBlob, openExternalUrl } from "./platform";
import { SkeletonList } from "./Skeleton";
import { Avatar, ESignDocs, EscClose, LocationInput, ROLE_LABELS, RoleBadge, SendTransferModal, TransferRow, fmt, i18n_common_close, isAdmin, roleLabel, useBackupActions, useModalPresence, type AppUser, type Project, type Role, type SmetaResult, type Transfer, ManagementModalShell } from "./App";

export function AdminDashboard({ currentUser, users, projects, transfers, setUsers, onSendTransfer, onConfirmTransfer, onRejectTransfer, onSelectProject, onAddUser, onUpdateUser, onDeleteUser, onAddProject, hasFeature }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; transfers: Transfer[];
    setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
    onSendTransfer: (t: Transfer) => void; onConfirmTransfer: (id: string, d?: string) => void;
    onRejectTransfer: (id: string) => void; onSelectProject: (p: Project) => void; onAddUser: (u: AppUser) => Promise<{ ok: boolean; error?: string }>;
    onUpdateUser: (u: AppUser) => void; onDeleteUser: (id: string) => void;
    onAddProject: (p: Project) => void;
    // Obuna tarifida "backup" funksiyasi yoqilganmi — App() komponentidan
    // (companyFeatures/hasFeature) uzatiladi, chunki AdminDashboard alohida
    // komponent bo'lib, o'zining obuna ma'lumotlarini so'ramaydi.
    hasFeature: (key: string) => boolean;
  }) {
  const { t } = useTranslation();
  const [showAddUser, setShowAddUser] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showAddObject, setShowAddObject] = useState(false);
  const [editUser, setEditUser] = useState<AppUser|null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    return localStorage.getItem("admin_activeTab") || "rahbariyat";
  });
  const [stats, setStats] = useState<{
    activeProjects: number; totalProjects: number; totalEmployees: number;
    totalExpenses: number; pendingTransfers: number; todayAttendance: number;
  } | null>(null);
  const [showEquipment, setShowEquipment] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showESign, setShowESign] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);
  const [export1cLoading, setExport1cLoading] = useState(false);
  const handleExport1c = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setExport1cLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/export1c/transactions`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast.error(t('dashboard.backupError')); return; }
      const blob = await r.blob();
      const saved = await saveOrShareBlob(`1c-export-${new Date().toISOString().split('T')[0]}.xlsx`, blob);
      if (!saved.ok) toast.error(t('dashboard.backupError'));
    } catch { toast.error(t('dashboard.backupError')); }
    finally { setExport1cLoading(false); }
  };

  useEffect(() => {
    localStorage.setItem("admin_activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE}/api/dashboard/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : null).then(d => { if (d) setStats(d); }).catch(() => {});
  }, []);

  const { backupLoading, handleBackup, importFileRef, importLoading, handleImportBackup } = useBackupActions();

  const brigades = [...new Set(users.filter(u => u.brigade).map(u => u.brigade!))];

  const sections = [
    { key: "rahbariyat", label: t('dashboard.leadership'), icon: Building2 },
    { key: "boshxodimlar", label: t('dashboard.topStaff'), icon: Users },
    { key: "brigadalar", label: t('dashboard.brigades'), icon: HardHat },
    { key: "faolobyektlar", label: t('dashboard.activeObjects'), icon: Package },
  ];

  const toggle = (key: string) => setActiveTab(prev => prev === key ? "" : key);

  return (
    <>
    {/* Stats strip — real data from API.
        XATO TUZATILDI ("responsive ahvoli juda yomon, kesilib qolyapti"):
        avval bu qat'iy `flex` (o'ralmaydigan, yig'ilmaydigan) qator edi —
        5 ta chip + Backup tugmasi umumiy kengligi keng desktop'dan
        boshqa deyarli har qanday enda (ayniqsa iPad kabi ~768px'da,
        aynan `md:` chegarasida) sig'may qolib, `truncate` matnni
        "Bugun keldl..." kabi chala kesib ko'rsatardi. Endi qat'iy sig'ish
        o'rniga GORIZONTAL SKROLL (mobil ilovalardagi filter-chip qatori
        naqshi) ishlatiladi — hech qaysi chip HECH QACHON kesilmaydi yoki
        siqilmaydi, shunchaki kerak bo'lsa yon tomonga suriladi. */}
    {stats && (
      <div className="flex-shrink-0 hidden lg:flex items-center gap-2 pl-3 pr-6 pt-3 pb-1 overflow-x-auto scrollbar-hide scroll-smooth">
        {[
          { label: t('dashboard.activeObjects'), value: stats.activeProjects, color: "text-green-600 dark:text-green-400" },
          { label: t('dashboard.totalStaff'), value: stats.totalEmployees, color: "text-blue-600 dark:text-blue-300" },
          { label: t('dashboard.pendingTransfers'), value: stats.pendingTransfers, color: "text-amber-600 dark:text-amber-300" },
          { label: t('dashboard.todayAttendance'), value: stats.todayAttendance, color: "text-primary" },
          { label: t('dashboard.totalExpenses'), value: fmt(stats.totalExpenses), color: "text-foreground" },
        ].map(s => (
          <div key={s.label} className="surface rounded-lg px-3 py-1.5 flex items-center gap-2 flex-shrink-0 whitespace-nowrap liquid-transition hover:shadow-sm">
            <span className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</span>
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </div>
        ))}
        {hasFeature('backup') && (
          <button onClick={handleBackup} disabled={backupLoading}
            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition disabled:opacity-60 text-muted-foreground hover:text-foreground flex-shrink-0 whitespace-nowrap ml-auto">
            {backupLoading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Download} className="w-3.5 h-3.5" />}
            {t('dashboard.backup')}
          </button>
        )}
        {hasFeature('backup') && (
          <>
            <input ref={importFileRef} type="file" accept="application/json" className="hidden" onChange={handleImportBackup} />
            <button onClick={() => importFileRef.current?.click()} disabled={importLoading}
              title={t('dashboard.importWarning') as string}
              className="flex items-center gap-1.5 text-xs border border-destructive/30 text-destructive rounded-lg px-3 py-1.5 hover:bg-destructive/10 active:scale-95 liquid-transition disabled:opacity-60 flex-shrink-0 whitespace-nowrap">
              {importLoading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Upload} className="w-3.5 h-3.5" />}
              {t('dashboard.importBackup')}
            </button>
          </>
        )}
        <button onClick={handleExport1c} disabled={export1cLoading}
          className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition disabled:opacity-60 text-muted-foreground hover:text-foreground flex-shrink-0 whitespace-nowrap">
          {export1cLoading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={Download} className="w-3.5 h-3.5" />}
          {t('dashboard.export1c')}
        </button>
      </div>
    )}
    {/* Boshqaruv — jihozlar/xavfsizlik/hujjatlar/ish haqi (avval umuman yo'q
        edi, product-audit'da topilgan bo'shliqlar). Har biri o'z modalida
        ochiladi — mavjud accordion/grid tuzilishini o'zgartirmasdan. */}
    <div className="flex-shrink-0 flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto scrollbar-hide">
      <button onClick={() => setShowEquipment(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={Package} className="w-3.5 h-3.5 text-primary" />{t('management.equipment')}
      </button>
      <button onClick={() => setShowSafety(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={AlertTriangle} className="w-3.5 h-3.5 text-amber-500" />{t('management.safety')}
      </button>
      <button onClick={() => setShowESign(true)} className="flex items-center gap-1.5 text-xs border border-primary/40 bg-primary/5 text-primary rounded-lg px-3 py-1.5 hover:bg-primary/10 active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap font-semibold">
        ✍️ {t('management.esign', { defaultValue: "E-hujjat va imzo" })}
      </button>
      <button onClick={() => setShowDocuments(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={FileText} className="w-3.5 h-3.5 text-blue-500" />{t('management.documents')}
      </button>
      <button onClick={() => setShowPayroll(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 hover:bg-muted active:scale-95 liquid-transition flex-shrink-0 whitespace-nowrap">
        <MorphIcon icon={Wallet} className="w-3.5 h-3.5 text-green-600" />{t('management.payroll')}
      </button>
    </div>
    {/* Desktop: 4-column grid */}
    <div className="hidden lg:grid lg:grid-cols-2 xl:grid-cols-4 gap-3 overflow-hidden bg-background p-3 flex-1 min-h-0">
      {/* Col 1 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="icon-chip w-6 h-6"><MorphIcon icon={Building2} className="w-3.5 h-3.5" /></div>
          <h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.leadership')}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          {users.filter(u => u.role === "direktor").map(u => (
            <div key={u.id} className="mb-2">
              <div className="bg-primary text-white rounded-md p-3 flex items-center gap-2">
                <Avatar user={u} size="sm"/><div><p className="text-sm md:text-xs font-semibold">{u.name}</p><p className="text-sm md:text-xs text-white/90">{roleLabel(t, u.role)}</p></div>
              </div>
              {users.filter(u2 => u2.role === "orinbosar").map(u2 => (
                <div key={u2.id} className="ml-4 mt-2 border-l-2 border-dashed border-primary/30 pl-3">
                  <div className="bg-secondary rounded-md p-3 flex items-center gap-2">
                    <Avatar user={u2} size="sm"/><div><p className="text-sm md:text-xs font-semibold">{u2.name}</p><p className="text-sm md:text-xs text-muted-foreground">{roleLabel(t, u2.role)}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u2.phone}</p></div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('dashboard.staffShort')}</p>
              <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-[9px] bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold"><MorphIcon icon={UserPlus} className="w-2.5 h-2.5" />{t('common.add')}</button>
            </div>
            {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
              <div key={r} className="flex items-center justify-between py-1">
                <span className="text-sm md:text-xs text-muted-foreground">{roleLabel(t, r)}</span>
                <span className="text-sm md:text-xs font-mono font-semibold">{users.filter(u=>u.role===r).length}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Col 2 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.05 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip w-6 h-6"><MorphIcon icon={Users} className="w-3.5 h-3.5" /></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.topStaff')}</h2></div>
          <button onClick={() => setShowAddUser(true)} className="text-sm md:text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 font-semibold flex items-center gap-1"><MorphIcon icon={UserPlus} className="w-2.5 h-2.5" />{t('common.add')}</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-border/50">
          {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
            <div key={u.id} className="flex items-center gap-2.5 py-2 px-3 hover:bg-muted/40 transition-colors group">
              <Avatar user={u} size="sm"/>
              <div className="flex-1 min-w-0"><p className="text-sm md:text-xs font-semibold truncate">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p>{u.brigade&&<p className="text-[9px] text-muted-foreground">{u.brigade}</p>}</div>
              <RoleBadge role={u.role}/>
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button aria-label={t('common.edit')} onClick={() => setEditUser(u)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3 h-3" /></button>
                <button aria-label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDeleteUser'))) onDeleteUser(u.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Col 3 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.10 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip w-6 h-6"><MorphIcon icon={HardHat} className="w-3.5 h-3.5" /></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.brigades')}</h2></div>
          <button onClick={() => setShowSend(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary text-white px-2 py-1 rounded hover:bg-primary/90 font-semibold"><MorphIcon icon={Send} className="w-2.5 h-2.5" />{t('dashboard.send')}</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          {brigades.map(brigade => (
            <div key={brigade} className="mb-3">
              <div className="flex items-center justify-between px-3 py-1.5 bg-secondary rounded-md mb-1">
                <span className="text-[11px] font-semibold text-secondary-foreground">{brigade}</span>
                <span className="text-sm md:text-xs text-muted-foreground">{t('dashboard.peopleCount', { count: users.filter(u=>u.brigade===brigade).length })}</span>
              </div>
              {users.filter(u => u.brigade===brigade).map(m => (
                <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group">
                  <Avatar user={m} size="sm"/>
                  <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                  <RoleBadge role={m.role}/>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3 h-3" /></button>
                    <button aria-label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-sm md:text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase mb-2 flex items-center gap-1"><MorphIcon icon={Package} className="w-2.5 h-2.5" />{t('dashboard.incomingShort')}</p>
              {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").map(t => (
                <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={projects} onConfirm={onConfirmTransfer} onReject={onRejectTransfer}/>
              ))}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">{t('dashboard.allWorkers')}</p>
            {users.filter(u => u.role==="ishchi" || u.role==="brigadir").map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/40 rounded transition-colors group mb-1">
                <Avatar user={m} size="sm"/>
                <div className="flex-1 min-w-0"><p className="text-sm md:text-xs text-foreground truncate">{m.name}</p></div>
                <RoleBadge role={m.role}/>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3 h-3" /></button>
                  <button aria-label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Col 4 */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.15 }}
        className="surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2"><div className="icon-chip icon-chip-accent w-6 h-6"><MorphIcon icon={Package} className="w-3.5 h-3.5" /></div><h2 className="text-sm md:text-xs font-bold uppercase tracking-wider font-['Roboto_Slab',serif]">{t('dashboard.activeObjects')}</h2></div>
          <button onClick={()=>setShowAddObject(true)} className="text-sm md:text-xs bg-accent text-white px-2 py-1 rounded hover:bg-accent/90 font-semibold flex items-center gap-1 dark:bg-accent/10 dark:text-accent dark:hover:bg-accent/20"><MorphIcon icon={Plus} className="w-2.5 h-2.5" />{t('common.add')}</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {[["active",t('dashboard.statusActive'),"text-green-800 dark:text-green-400"],["paused",t('dashboard.statusPausedShort'),"text-amber-500"],["completed",t('dashboard.statusCompleted'),"text-blue-500"]].map(([s,l,c])=>(
              <div key={s} className="bg-muted/40 rounded-lg p-2 text-center">
                <p className={`text-sm font-bold font-mono ${c}`}>{projects.filter(p=>p.status===s).length}</p>
                <p className="text-[9px] text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          {projects.map(p => {
            const pend = transfers.filter(t=>t.projectId===p.id&&t.status==="pending").length;
            const foreman = users.find(u=>u.id===p.foremanId);
            return (
              <div key={p.id} onClick={()=>onSelectProject(p)} className="surface rounded-xl p-3 cursor-pointer hover:border-primary/40 liquid-transition group mb-2">
                <div className="flex items-start justify-between gap-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1"><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status==="active"?"bg-green-500":p.status==="paused"?"bg-amber-400":"bg-blue-400"}`}/><p className="text-sm md:text-xs font-semibold truncate">{p.name}</p></div>
                    <p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MorphIcon icon={MapPin} className="w-2.5 h-2.5" />{p.location}</p>
                    {foreman&&<p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MorphIcon icon={HardHat} className="w-2.5 h-2.5" />{foreman.name}</p>}
                  </div>
                  <MorphIcon icon={ChevronRight} className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-0.5" />
                </div>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                  <span className="text-[9px] text-muted-foreground font-mono">{fmt(p.budget)}</span>
                  {pend>0&&<span className="ml-auto text-[9px] bg-amber-500/15 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded font-semibold">{t('dashboard.pendingCount', { count: pend })}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>

    {/* Mobile: Accordion */}
    <div className="flex flex-col gap-2.5 lg:hidden overflow-y-auto scrollbar-hide px-3 pt-1 pb-4">
      {sections.map(section => {
        const isOpen = activeTab === section.key;
        return (
          <div key={section.key} className={`shrink-0 rounded-2xl overflow-hidden border bg-card/80 backdrop-blur-sm shadow-sm transition-shadow ${isOpen ? "border-primary/40 shadow-lg shadow-primary/10" : "border-border"}`}>
            {/* Header — always visible */}
            <button
              onClick={() => toggle(section.key)}
              className={`w-full flex items-center justify-between px-4 py-4 transition-colors ${isOpen ? "bg-primary text-white" : "bg-card hover:bg-muted/30"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isOpen ? "bg-white/20" : "bg-primary/10"}`}>
                  <MorphIcon icon={section.icon} className={`w-4 h-4 ${isOpen ? "text-white" : "text-primary"}`} />
                </div>
                <span className={`text-sm font-bold tracking-wide font-['Roboto_Slab',serif] ${isOpen ? "text-white" : "text-foreground"}`}>{section.label}</span>
              </div>
              <MorphIcon icon={ChevronDown} className={`w-5 h-5 transition-transform duration-300 ${isOpen ? "rotate-180 text-white" : "text-muted-foreground"}`} />
            </button>

            {/* Content — only visible when open */}
            {isOpen && (
              <div className="animate-slide-up-fade">
                {section.key === "rahbariyat" && (
                  <div className="p-4 space-y-3">
                    {users.filter(u => u.role === "direktor").map(u => (
                      <div key={u.id}>
                        <div className="bg-primary text-white rounded-xl p-3 flex items-center gap-3">
                          <Avatar user={u} size="sm"/>
                          <div><p className="text-sm font-semibold">{u.name}</p><p className="text-[11px] text-white/90">{roleLabel(t, u.role)}</p></div>
                        </div>
                        {users.filter(u2 => u2.role === "orinbosar").map(u2 => (
                          <div key={u2.id} className="ml-6 mt-2 border-l-2 border-dashed border-primary/30 pl-3">
                            <div className="bg-secondary rounded-xl p-3 flex items-center gap-2">
                              <Avatar user={u2} size="sm"/>
                              <div><p className="text-sm font-semibold">{u2.name}</p><p className="text-sm md:text-xs text-muted-foreground">{roleLabel(t, u2.role)}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u2.phone}</p></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-3 border-t border-border">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('dashboard.staffCount')}</p>
                        <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1 text-sm md:text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full hover:bg-primary/20 font-semibold"><MorphIcon icon={UserPlus} className="w-3 h-3" />{t('common.add')}</button>
                      </div>
                      {(["direktor","orinbosar","prorab","brigadir","ishchi"] as Role[]).map(r => (
                        <div key={r} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                          <span className="text-sm text-muted-foreground">{roleLabel(t, r)}</span>
                          <span className="text-sm font-mono font-bold">{users.filter(u=>u.role===r).length}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {section.key === "boshxodimlar" && (
                  <div>
                    <div className="flex justify-end px-4 py-2 border-b border-border/30">
                      <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><MorphIcon icon={UserPlus} className="w-3 h-3" />{t('common.add')}</button>
                    </div>
                    {users.filter(u => ["orinbosar","prorab"].includes(u.role)).map(u => (
                      <div key={u.id} className="flex items-center gap-3 py-3 px-4 border-b border-border/40 hover:bg-muted/30">
                        <Avatar user={u} size="sm"/>
                        <div className="flex-1"><p className="text-sm font-semibold">{u.name}</p><p className="text-sm md:text-xs text-muted-foreground font-mono">{u.phone}</p></div>
                        <RoleBadge role={u.role}/>
                        <div className="flex gap-1">
                          <button aria-label={t('common.edit')} onClick={() => setEditUser(u)} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-4 h-4" /></button>
                          <button aria-label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDeleteUser'))) onDeleteUser(u.id); }} className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {section.key === "brigadalar" && (
                  <div className="p-4 space-y-3">
                    <div className="flex justify-end">
                      <button onClick={() => setShowSend(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-primary text-white px-3 py-1.5 rounded-full font-semibold"><MorphIcon icon={Send} className="w-3 h-3" />{t('dashboard.send')}</button>
                    </div>
                    {brigades.map(brigade => (
                      <div key={brigade} className="bg-muted/30 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-secondary">
                          <span className="text-sm md:text-xs font-semibold">{brigade}</span>
                          <span className="text-sm md:text-xs text-muted-foreground">{t('dashboard.peopleCount', { count: users.filter(u=>u.brigade===brigade).length })}</span>
                        </div>
                        {users.filter(u => u.brigade===brigade).map(m => (
                          <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 border-t border-border/30">
                            <Avatar user={m} size="sm"/>
                            <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                            <RoleBadge role={m.role}/>
                            <div className="flex gap-1">
                              <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3.5 h-3.5" /></button>
                              <button aria-label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-border">
                      <p className="text-sm md:text-xs font-semibold text-muted-foreground uppercase mb-2">{t('dashboard.allWorkers')}</p>
                      {users.filter(u => u.role==="ishchi" || u.role==="brigadir").map(m => (
                        <div key={m.id} className="flex items-center gap-3 py-2.5 px-2 border-b border-border/30">
                          <Avatar user={m} size="sm"/>
                          <div className="flex-1"><p className="text-sm">{m.name}</p></div>
                          <RoleBadge role={m.role}/>
                          <div className="flex gap-1">
                            <button aria-label={t('common.edit')} onClick={() => setEditUser(m)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"><MorphIcon icon={Edit} className="w-3.5 h-3.5" /></button>
                            <button aria-label={t('common.delete')} onClick={async () => { if (await confirmDialog(t('common.confirmDeleteUser'))) onDeleteUser(m.id); }} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-sm md:text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase mb-2 flex items-center gap-1"><MorphIcon icon={Package} className="w-3 h-3" />{t('dashboard.incomingMaterials')}</p>
                        {transfers.filter(t=>t.toUserId===currentUser.id&&t.status==="pending").map(t => (
                          <TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={projects} onConfirm={onConfirmTransfer} onReject={onRejectTransfer}/>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {section.key === "faolobyektlar" && (
                  <div className="p-4">
                    <div className="flex justify-end mb-3">
                      <button onClick={()=>setShowAddObject(true)} className="flex items-center gap-1.5 text-sm md:text-xs bg-accent text-white px-3 py-1.5 rounded-full font-semibold"><MorphIcon icon={Plus} className="w-3 h-3" />{t('common.add')}</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[["active",t('dashboard.statusActive'),"text-green-800 dark:text-green-400","bg-green-500/10"],["paused",t('dashboard.statusPausedFull'),"text-amber-500","bg-amber-500/10"],["completed",t('dashboard.statusCompleted'),"text-blue-500 dark:text-blue-400","bg-blue-500/10"]].map(([s,l,c,bg])=>(
                        <div key={s} className={`${bg} border border-border rounded-xl p-3 text-center`}>
                          <p className={`text-lg font-bold font-mono ${c}`}>{projects.filter(p=>p.status===s).length}</p>
                          <p className="text-sm md:text-xs text-muted-foreground">{l}</p>
                        </div>
                      ))}
                    </div>
                    {projects.map(p => {
                      const pend = transfers.filter(t=>t.projectId===p.id&&t.status==="pending").length;
                      const foreman = users.find(u=>u.id===p.foremanId);
                      return (
                        <div key={p.id} onClick={()=>onSelectProject(p)} className="surface rounded-xl p-4 cursor-pointer hover:border-primary/50 liquid-transition mb-3 active:scale-98">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status==="active"?"bg-green-500":p.status==="paused"?"bg-amber-400":"bg-blue-400"}`}/><p className="text-sm font-semibold">{p.name}</p></div>
                              <p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1"><MorphIcon icon={MapPin} className="w-3 h-3" />{p.location}</p>
                              {foreman&&<p className="text-sm md:text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MorphIcon icon={HardHat} className="w-3 h-3" />{foreman.name}</p>}
                            </div>
                            <MorphIcon icon={ChevronRight} className="w-5 h-5 text-muted-foreground mt-0.5" />
                          </div>
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                            <span className="text-sm md:text-xs text-muted-foreground font-mono">{fmt(p.budget)}</span>
                            {pend>0&&<span className="ml-auto text-sm md:text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">{t('dashboard.pendingCount', { count: pend })}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>

      {showAddUser && <AddUserModal currentUser={currentUser} users={users} projects={projects} onClose={()=>setShowAddUser(false)} onAdd={onAddUser}/>}
      {editUser && <EditUserModal currentUser={currentUser} user={editUser} onClose={()=>setEditUser(null)} onUpdate={u=>{onUpdateUser(u);setEditUser(null);}}/>}
      {showSend && <SendTransferModal currentUser={currentUser} projects={projects} allUsers={users} onClose={()=>setShowSend(false)} onSend={t=>{onSendTransfer(t);setShowSend(false);}}/>}
      {showAddObject && <AddObjectModal users={users} onClose={()=>setShowAddObject(false)} onAdd={p=>{onAddProject(p);setShowAddObject(false);}}/>}
      {showEquipment && <EquipmentModal projects={projects} onClose={()=>setShowEquipment(false)}/>}
      {showSafety && <SafetyModal projects={projects} onClose={()=>setShowSafety(false)}/>}
      {showDocuments && <DocumentsModal projects={projects} currentUser={currentUser} onClose={()=>setShowDocuments(false)}/>}
      {showESign && (
        <Suspense fallback={null}>
          <ESignDocs onClose={() => setShowESign(false)} currentUserName={currentUser.name}
            companyName={localStorage.getItem("erp_companyName") || ""}
            projects={projects.map(p => ({ id: p.id, name: p.name, location: p.location }))} />
        </Suspense>
      )}
      {showPayroll && <PayrollModal users={users} onClose={()=>setShowPayroll(false)}/>}
    </>
  );
}

// ─── Add User Modal ────────────────────────────────────────────────────────────
export function AddUserModal({ currentUser, users, projects, onClose, onAdd }:
  { currentUser: AppUser; users: AppUser[]; projects: Project[]; onClose: () => void; onAdd: (u: AppUser) => Promise<{ ok: boolean; error?: string }> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "", phone: "+998 ", role: "ishchi" as Role,
    brigade: currentUser.brigade ?? "", newBrigade: "", projectIds: [] as string[],
    baseSalary: "",
  });
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Role options based on who's adding
  const allowedRoles: Role[] = currentUser.role === "brigadir"
    ? ["ishchi"]
    : currentUser.role === "prorab"
    ? ["brigadir", "ishchi"]
    : ["orinbosar", "prorab", "brigadir", "ishchi"];

  const brigades = [...new Set(users.filter(u => u.brigade).map(u => u.brigade!))];
  if (currentUser.brigade && !brigades.includes(currentUser.brigade)) brigades.push(currentUser.brigade);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = form.phone.replace(/\D/g, "");
    if (phone.length < 9) { setErr(t('addUser.phoneInvalid')); return; }
    if (!form.name.trim()) { setErr(t('addUser.nameRequired')); return; }
    if (users.find(u => u.phone.replace(/\D/g,"") === phone)) { setErr(t('addUser.phoneTaken')); return; }

    const newUser: AppUser = {
      id: `u${Date.now()}`,
      name: form.name.trim(),
      phone: form.phone,
      role: form.role,
      brigade: (form.role === "brigadir" || form.role === "ishchi") ? (form.brigade === "__new__" ? form.newBrigade : form.brigade) : undefined,
      projectIds: form.projectIds,
      baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined,
    };
    setErr(""); setSubmitting(true);
    const result = await onAdd(newUser);
    setSubmitting(false);
    if (result.ok) onClose();
    else setErr(result.error || t('addUser.notAdded'));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" >
      <EscClose onClose={onClose} />
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(27,58,107,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={UserPlus} className="w-4 h-4 text-primary" />{t('addUser.title')}</h3>
          <button aria-label={t('common.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2.5 text-xs text-red-700 dark:text-red-400 flex items-center gap-2"><MorphIcon icon={AlertCircle} className="w-3.5 h-3.5 flex-shrink-0" />{err}</div>}
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.nameLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={t('addUser.namePlaceholder')} value={form.name} onChange={e => { setErr(""); setForm({...form, name: e.target.value}); }} required/>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.phoneLabel')}</label>
            <input inputMode="tel" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              value={form.phone} onChange={e => {
                setErr("");
                const val = e.target.value;
                if (val.startsWith("+998 ")) setForm({...form, phone: "+998 " + val.slice(5).replace(/\D/g, "").slice(0, 9)});
                else if (val === "+998" || val === "") setForm({...form, phone: "+998 "});
              }} required/>
            <p className="text-sm md:text-xs text-muted-foreground mt-1">{t('addUser.smsHint')}</p>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.positionLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {allowedRoles.map(r => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
            </select>
          </div>
          {isAdmin(currentUser.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.baseSalaryLabel')}</label>
              <input type="number" min="0" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={t('addUser.baseSalaryPlaceholder') as string} value={form.baseSalary} onChange={e => setForm({...form, baseSalary: e.target.value})}/>
            </div>
          )}
          {(form.role === "brigadir" || form.role === "ishchi") && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.brigadeLabel')}</label>
              {currentUser.role === "brigadir" ? (
                <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-muted font-medium" value={currentUser.brigade} readOnly/>
              ) : (
                <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.brigade} onChange={e => setForm({...form, brigade: e.target.value})}>
                  <option value="">{t('addUser.selectPlaceholder')}</option>
                  {brigades.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="__new__">{t('addUser.newBrigade')}</option>
                </select>
              )}
              {form.brigade === "__new__" && (
                <input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background mt-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={t('addUser.newBrigadePlaceholder')} onChange={e => setForm({...form, newBrigade: e.target.value})}/>
              )}
            </div>
          )}
          {isAdmin(currentUser.role) && form.role !== "orinbosar" && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.objects')}</label>
              <div className="space-y-1 max-h-28 overflow-y-auto border border-border rounded p-2">
                {projects.map(p => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={form.projectIds.includes(p.id)}
                      onChange={e => setForm({...form, projectIds: e.target.checked ? [...form.projectIds, p.id] : form.projectIds.filter(id => id !== p.id)})}
                      className="w-3 h-3 accent-primary"/>
                    <span className="text-sm md:text-xs">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={submitting} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50">{t('addUser.cancel')}</button>
            <button type="submit" disabled={submitting} className="flex-1 text-sm md:text-xs bg-primary text-white rounded px-3 py-2 hover:bg-primary/90 transition-colors font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
              {submitting && <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" />}{t('common.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit User Modal ─────────────────────────────────────────────────────────────
export function EditUserModal({ user, currentUser, onClose, onUpdate }: { user: AppUser; currentUser: AppUser; onClose: () => void; onUpdate: (u: AppUser) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: user.name, role: user.role, phone: user.phone, brigade: user.brigade || "", baseSalary: user.baseSalary != null ? String(user.baseSalary) : "" });
  // "Direktor" va "dasturchi" lavozimini FAQAT dasturchi paneli o'zgartira oladi —
  // oddiy admin (direktor/o'rinbosar) tahrirlash oynasidan xodimni direktor yoki
  // dasturchi qilib qo'ya olmasligi kerak (imtiyoz eskalatsiyasi xatosi edi).
  const editableRoles: Role[] = currentUser.role === "dasturchi"
    ? (Object.keys(ROLE_LABELS) as Role[])
    : (["orinbosar", "prorab", "brigadir", "ishchi"] as Role[]);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" >
      <EscClose onClose={onClose} />
      <div className="bg-card rounded-lg border border-border shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm flex items-center gap-2"><MorphIcon icon={Edit} className="w-4 h-4 text-primary" />{t('editUser.title')}</h3>
          <button aria-label={t('editUser.close')} onClick={onClose} className="p-1 rounded hover:bg-muted"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={e => {
          e.preventDefault();
          onUpdate({ ...user, ...form, baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined });
          onClose();
        }} className="p-4 space-y-3">
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.nameLabel')}</label>
            <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              placeholder={t('editUser.namePlaceholder')} value={form.name} onChange={e => setForm({...form, name: e.target.value})} required autoFocus
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.phoneLabel')}</label>
            <input inputMode="tel" className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary font-mono disabled:opacity-50"
              placeholder="+998901234567" value={form.phone} onChange={e => setForm({...form, phone: e.target.value.replace(/[^\d+]/g, "")})} required
              disabled={!(currentUser.role === 'direktor' || currentUser.role === 'orinbosar')} />
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.positionLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.role} onChange={e => setForm({...form, role: e.target.value as Role})}>
              {editableRoles.map(r => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
              {!editableRoles.includes(form.role) && <option value={form.role}>{roleLabel(t, form.role)}</option>}
            </select>
          </div>
          {isAdmin(currentUser.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('addUser.baseSalaryLabel')}</label>
              <input type="number" min="0" className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={t('addUser.baseSalaryPlaceholder') as string} value={form.baseSalary} onChange={e => setForm({...form, baseSalary: e.target.value})}/>
            </div>
          )}
          {["ishchi", "brigadir"].includes(form.role) && (
            <div>
              <label className="text-sm md:text-xs font-medium block mb-1">{t('editUser.brigadeLabel')}</label>
              <input className="w-full text-sm md:text-xs border border-border rounded px-2.5 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.brigade} onChange={e => setForm({...form, brigade: e.target.value})}/>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted transition-colors">{t('editUser.cancel')}</button>
            <button type="submit" className="flex-1 text-sm md:text-xs bg-primary text-white rounded px-3 py-2 hover:bg-primary/90 font-semibold">{t('editUser.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Object Modal ────────────────────────────────────────────────────────
export function AddObjectModal({ users, onClose, onAdd }:
  { users: AppUser[]; onClose: () => void; onAdd: (p: Project) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: "", budget: "", location: "", foremanId: "" });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState("");
  const [smeta, setSmeta] = useState<File|null>(null);
  const [loading, setLoading] = useState(false);
  const [smetaMsg, setSmetaMsg] = useState("");
  const [smetaPercent, setSmetaPercent] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(API_BASE + '/api/objects', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name: form.name, budget: form.budget ? Number(form.budget) : undefined, location: form.location || undefined, foremanId: form.foremanId || undefined, ...(coords ? { lat: coords.lat, lng: coords.lng } : {}), geofenceRadius: radius.trim() ? Number(radius) : null})
      });
      if (!res.ok) throw new Error();
      const obj = await res.json();
      
      let finalMats: any[] = [];
      let finalBudget = obj.budget;

      let smetaResult: SmetaResult | undefined;
      if (smeta) {
        setSmetaMsg(t('addObject.smetaAnalyzing'));
        try {
          smetaResult = await parseSmetaFile(smeta, obj.id || obj._id);
          finalMats = smetaResult!.resources.filter(r => r.group === 'material');
          finalBudget = smetaResult!.meta?.totalWithoutVat ?? finalBudget;
        } catch (e) {
          // Obyekt yaratildi, lekin smeta o'qilmadi — ogohlantirib davom etamiz
          setSmetaMsg((e as Error).message || t('addObject.smetaParseFailed'));
        }
      }

      const newP: Project = {
        id: obj._id,
        name: obj.name,
        budget: finalBudget || 0,
        location: form.location,
        status: 'active',
        foremanId: form.foremanId,
        startDate: new Date().toISOString().split('T')[0],
        requiredMaterials: finalMats.map((m:any) => ({ id: String(m.index ?? m.id), name: m.rawName ?? m.name, quantity: m.qty ?? m.needed, unit: m.unit, category: m.category || 'Qurilish', price: m.price ?? undefined })),
        smeta: smetaResult,
      };
      onAdd(newP);
    } catch(err) {
      toast.error(t('addObject.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" >
      <EscClose onClose={onClose} />
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border" style={{ background: "linear-gradient(to right, rgba(217,70,15,0.06), transparent)" }}>
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Package} className="w-4 h-4 text-accent" />{t('addObject.title')}</h3>
          <button aria-label={t('addObject.close')} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.nameLabel')}</label><input className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder={t('addObject.namePlaceholder')} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.locationLabel')}</label><LocationInput placeholder={t('addObject.locationPlaceholder')} value={form.location} onChange={v=>setForm({...form,location:v})} onCoords={setCoords}/></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.geofence', "\"Ishga keldim\" radiusi (metr)")}</label>
            <input type="number" inputMode="numeric" min={50} max={100000} step={50} placeholder={t('addObject.geofenceOff', "Bo'sh — tekshirilmaydi")} className="w-full text-base sm:text-sm border border-border rounded-xl px-3 h-11 bg-input-background focus:outline-none" value={radius} onChange={e=>setRadius(e.target.value)}/>
            <p className="text-[11px] text-muted-foreground mt-1">Bo'sh qoldirsangiz — "Ishga keldim" joyi tekshirilmaydi. Prorablarga tekshiruv qo'llanmaydi.</p>
            <p className="text-[11px] text-muted-foreground mt-1">{coords ? t('addObject.geofenceOk', "✓ Obyekt nuqtasi tanlandi — ishchilar faqat shu radius ichida ishga kela oladi") : t('addObject.geofenceHint', "Manzilni xaritadan tanlang — shunda ishchilar faqat obyektda \"Ishga keldim\" bosa oladi")}</p></div>
          <div><label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.budgetLabel')}</label><input type="number" className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder="50000000" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})}/></div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.foremanLabel')}</label>
            <select className="w-full text-sm md:text-xs border border-border rounded px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" value={form.foremanId} onChange={e=>setForm({...form,foremanId:e.target.value})}>
              <option value="">{t('addObject.selectPlaceholder')}</option>
              {users.filter(u=>u.role==="prorab").map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm md:text-xs font-medium block mb-1">{t('addObject.smetaLabel')}</label>
            <input type="file" accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.txt" className="w-full text-sm md:text-xs border border-border rounded px-3 py-1.5 bg-input-background file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm md:text-xs file:bg-primary file:text-white hover:file:bg-primary/90" onChange={e=>setSmeta(e.target.files?.[0]||null)}/>
            {loading && smeta && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><MorphIcon icon={Loader2} className="w-3 h-3 animate-spin" />{smetaMsg || t('addObject.smetaLoading')}</div>
                {smetaPercent > 0 && <div className="w-full bg-muted rounded-full h-1 mt-1"><div className="bg-accent h-1 rounded-full liquid-transition" style={{width:`${smetaPercent}%`}}/></div>}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="flex-1 text-sm md:text-xs border border-border rounded px-3 py-2 hover:bg-muted">{t('addObject.cancel')}</button><button type="submit" disabled={loading} className="flex-1 text-sm md:text-xs bg-accent text-white rounded px-3 py-2 font-semibold hover:bg-accent/90">{loading?t('addObject.smetaLoading'):t('addObject.submit')}</button></div>
        </form>
      </div>
    </div>
  );
}


// ─── Jihoz/texnika kuzatuvi ──────────────────────────────────────────────────
export function EquipmentModal({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [openEq, setOpenEq] = useState<string | null>(null);
  const meRole = (() => { try { return JSON.parse(localStorage.getItem('currentUser') || '{}'); } catch { return {}; } })();
  const canManageEq = isAdmin(meRole.role) || !!meRole.isOwner;
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(""); const [type, setType] = useState(""); const [objectId, setObjectId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/equipment`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const add = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(`${API_BASE}/api/equipment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type: type.trim() || undefined, objectId: objectId || undefined }) });
      if (r.ok) { setName(""); setType(""); setObjectId(""); load(); } else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setAdding(false);
  };
  const setStatus = async (id: string, status: string) => {
    try { await fetch(`${API_BASE}/api/equipment/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load(); } catch {}
  };
  const remove = async (id: string) => {
    if (!await confirmDialog(t('common.confirmDelete') as string)) return;
    try { await fetch(`${API_BASE}/api/equipment/${id}`, { method: 'DELETE' }); load(); } catch {}
  };
  const statusColor: Record<string,string> = { available: 'text-green-600 bg-green-500/10', in_use: 'text-blue-600 bg-blue-500/10', maintenance: 'text-amber-600 bg-amber-500/10', broken: 'text-red-600 bg-red-500/10' };
  const statusLabel: Record<string,string> = { available: t('management.eqAvailable'), in_use: t('management.eqInUse'), maintenance: t('management.eqMaintenance'), broken: t('management.eqBroken') };

  return (
    <ManagementModalShell icon={Package} title={t('management.equipment')} onClose={onClose}>
      <div className="space-y-2 mb-4">
        <input value={name} onChange={e=>setName(e.target.value)} placeholder={t('management.eqNamePlaceholder') as string} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
        <div className="grid grid-cols-2 gap-2">
          <input value={type} onChange={e=>setType(e.target.value)} placeholder={t('management.eqTypePlaceholder') as string} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
          <select value={objectId} onChange={e=>setObjectId(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="">{t('management.eqNoProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={add} disabled={adding || !name.trim()} className="btn btn-primary w-full py-2 text-sm disabled:opacity-50">{t('common.add')}</button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.eqEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map(e => (
            <div key={e.id} className="border border-border/50 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setOpenEq(openEq === e.id ? null : e.id)} className="flex-1 min-w-0 text-left" aria-expanded={openEq === e.id}>
                <p className="text-sm font-medium truncate">{e.name}{e.type ? ` — ${e.type}` : ''}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {e.objectId ? (projects.find(p=>p.id===e.objectId)?.name || '') : ''}
                  {e.nextServiceDate ? ` · ${t('equipmentX.serviceShort')} ${e.nextServiceDate}` : ''}
                  {e.engineHours ? ` · ${e.engineHours} m/h` : ''}
                </p>
              </button>
              <select value={e.status} onChange={ev=>setStatus(e.id, ev.target.value)} className={`text-[10px] font-semibold rounded-full px-2 py-1 border-none focus:outline-none ${statusColor[e.status]}`}>
                {Object.keys(statusLabel).map(k => <option key={k} value={k}>{statusLabel[k]}</option>)}
              </select>
              <button onClick={()=>remove(e.id)} aria-label={t('common.delete')} className="p-1 text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
            </div>
            <AnimatePresence initial={false}>
              {openEq === e.id && <EquipmentDetails key="d" eq={e} canManage={canManageEq} onChanged={load} />}
            </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Xavfsizlik hodisalari ───────────────────────────────────────────────────
export function SafetyModal({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitleField] = useState(""); const [severity, setSeverity] = useState("medium"); const [objectId, setObjectId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/safety`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const add = async () => {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(`${API_BASE}/api/safety`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), severity, objectId: objectId || undefined }) });
      if (r.ok) { setTitleField(""); setSeverity("medium"); setObjectId(""); load(); } else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setAdding(false);
  };
  const setStatus = async (id: string, status: string) => {
    try { await fetch(`${API_BASE}/api/safety/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load(); } catch {}
  };
  const sevColor: Record<string,string> = { low: 'text-muted-foreground bg-muted', medium: 'text-amber-600 bg-amber-500/10', high: 'text-orange-600 bg-orange-500/10', critical: 'text-red-600 bg-red-500/10' };
  const statusLabel: Record<string,string> = { open: t('management.safOpen'), investigating: t('management.safInvestigating'), resolved: t('management.safResolved') };

  return (
    <ManagementModalShell icon={AlertTriangle} title={t('management.safety')} onClose={onClose}>
      <div className="space-y-2 mb-4">
        <input value={title} onChange={e=>setTitleField(e.target.value)} placeholder={t('management.safTitlePlaceholder') as string} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
        <div className="grid grid-cols-2 gap-2">
          <select value={severity} onChange={e=>setSeverity(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="low">{t('management.sevLow')}</option>
            <option value="medium">{t('management.sevMedium')}</option>
            <option value="high">{t('management.sevHigh')}</option>
            <option value="critical">{t('management.sevCritical')}</option>
          </select>
          <select value={objectId} onChange={e=>setObjectId(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="">{t('management.eqNoProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={add} disabled={adding || !title.trim()} className="btn btn-primary w-full py-2 text-sm disabled:opacity-50">{t('management.safReportBtn')}</button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.safEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((inc:any) => (
            <div key={inc.id} className="border border-border/50 rounded-xl px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{inc.title}</p>
                  <p className="text-[10px] text-muted-foreground">{inc.reportedBy?.name} · {new Date(inc.occurredAt).toLocaleDateString('uz-UZ')}</p>
                </div>
                <span className={`text-[9px] font-bold rounded-full px-2 py-0.5 flex-shrink-0 ${sevColor[inc.severity]}`}>{inc.severity.toUpperCase()}</span>
              </div>
              <select value={inc.status} onChange={ev=>setStatus(inc.id, ev.target.value)} className="mt-1.5 text-[10px] font-semibold border border-border rounded-full px-2 py-1 bg-transparent focus:outline-none">
                {Object.keys(statusLabel).map(k => <option key={k} value={k}>{statusLabel[k]}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Hujjat/shartnoma boshqaruvi ─────────────────────────────────────────────
export function DocumentsModal({ projects, currentUser, onClose }: { projects: Project[]; currentUser: AppUser; onClose: () => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("contract"); const [objectId, setObjectId] = useState("");
  const [expiry, setExpiry] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canSign = isAdmin(currentUser.role);
  const setDocExpiry = async (id: string, v: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/documents/${id}/expiry`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresAt: v || null }) });
      if (r.ok) load(); else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
  };
  const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/documents`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const sign = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/documents/${id}/sign`, { method: 'POST' });
      if (r.ok) load(); else toast.error((await r.json().catch(()=>({})))?.error || t('common.error'));
    } catch { toast.error(t('common.error')); }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadChatMedia(file, file.name);
      const r = await fetch(`${API_BASE}/api/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(expiry ? { expiresAt: expiry } : {}), title: file.name, fileUrl: up.url, fileName: file.name, category, objectId: objectId || undefined }) });
      if (r.ok) load(); else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setUploading(false);
  };
  const remove = async (id: string) => {
    if (!await confirmDialog(t('common.confirmDelete') as string)) return;
    try { await fetch(`${API_BASE}/api/documents/${id}`, { method: 'DELETE' }); load(); } catch {}
  };
  const catLabel: Record<string,string> = { contract: t('management.catContract'), permit: t('management.catPermit'), invoice: t('management.catInvoice'), other: t('management.catOther') };

  return (
    <ManagementModalShell icon={FileText} title={t('management.documents')} onClose={onClose}>
      <div className="space-y-2 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={e=>setCategory(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            {Object.keys(catLabel).map(k => <option key={k} value={k}>{catLabel[k]}</option>)}
          </select>
          <select value={objectId} onChange={e=>setObjectId(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
            <option value="">{t('management.eqNoProject')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex-shrink-0">{t('docsX.expiresAt')}</span>
          <input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)} className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 bg-input-background focus:outline-none" />
        </label>
        <input ref={fileRef} type="file" className="hidden" onChange={upload} />
        <button onClick={()=>fileRef.current?.click()} disabled={uploading} className="btn btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2">
          {uploading ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Upload} className="w-4 h-4" />}
          {t('management.docUploadBtn')}
        </button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.docEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((d:any) => {
            const iSigned = (d.signatures || []).some((s:any) => s.userId === currentUser.id);
            return (
            <div key={d.id} className="border border-border/50 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <MorphIcon icon={FileText} className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <button onClick={()=>openExternalUrl(d.fileUrl)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-[10px] text-muted-foreground">{catLabel[d.category]} · {d.uploadedBy?.name}</p>
                </button>
                {d.expiresAt && (
                  <span className={`text-[9px] font-bold rounded-full px-2 py-0.5 flex-shrink-0 ${daysLeft(d.expiresAt) < 0 ? 'text-red-600 bg-red-500/10' : daysLeft(d.expiresAt) <= 7 ? 'text-amber-700 bg-amber-500/10' : 'text-muted-foreground bg-muted'}`}>
                    {daysLeft(d.expiresAt) < 0 ? t('docsX.expired') : t('docsX.until', { date: String(d.expiresAt).slice(0, 10) })}
                  </span>
                )}
                {canSign && (
                  <input type="date" aria-label={t('docsX.expiresAt')} title={t('docsX.expiresAt')} value={d.expiresAt ? String(d.expiresAt).slice(0, 10) : ''}
                    onChange={ev => setDocExpiry(d.id, ev.target.value)} className="w-7 sm:w-auto text-[10px] bg-transparent border border-border/60 rounded-md px-1 py-0.5 text-muted-foreground" />
                )}
                {canSign && !iSigned && (
                  <button onClick={()=>sign(d.id)} title={t('management.docSignBtn')} aria-label={t('management.docSignBtn')} className="p-1 text-muted-foreground hover:text-primary"><MorphIcon icon={Check} className="w-3.5 h-3.5" /></button>
                )}
                <button onClick={()=>remove(d.id)} aria-label={t('common.delete')} className="p-1 text-muted-foreground hover:text-destructive"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
              </div>
              {(d.signatures || []).length > 0 && (
                <p className="text-[10px] text-green-600 mt-1 pl-6">{t('management.docSignedBy', { names: d.signatures.map((s:any)=>s.name).join(', ') })}</p>
              )}
            </div>
          );})}
        </div>
      )}
    </ManagementModalShell>
  );
}

// ─── Ish haqi hisob-kitobi ────────────────────────────────────────────────────
export function PayrollModal({ users, onClose }: { users: AppUser[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0,7));
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);

  const load = async (p: string) => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/payroll?period=${p}`); if (r.ok) setList(await r.json()); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period]);

  const calculate = async () => {
    setCalculating(true);
    try {
      const r = await fetch(`${API_BASE}/api/payroll/calculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period }) });
      if (r.ok) { const d = await r.json(); setList(d.records); toast.success(t('management.payrollCalculated', { count: d.count })); }
      else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
    setCalculating(false);
  };
  const patch = async (id: string, body: any) => {
    try { const r = await fetch(`${API_BASE}/api/payroll/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.ok) load(period); } catch {}
  };
  const statusLabel: Record<string,string> = { draft: t('management.payDraft'), finalized: t('management.payFinalized'), paid: t('management.payPaid') };

  return (
    <ManagementModalShell icon={Wallet} title={t('management.payroll')} onClose={onClose}>
      <div className="flex items-center gap-2 mb-4">
        <input type="month" value={period} onChange={e=>setPeriod(e.target.value)} className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
        <button onClick={calculate} disabled={calculating} className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50 whitespace-nowrap">
          {calculating ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : t('management.payCalculateBtn')}
        </button>
      </div>
      {loading ? <SkeletonList items={3} withAvatar={false} /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('management.payEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {list.map((r:any) => (
            <div key={r.id} className="border border-border/50 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold truncate">{r.userName}</p>
                <span className="text-sm font-mono font-bold text-primary">{r.netPay.toLocaleString()} so'm</span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1.5">{t('management.payDaysWorked', { days: r.presentDays })} · {t('management.payBase', { amount: r.baseSalary.toLocaleString() })}{r.pieceworkPay ? ` · ${t('piecework.payCol')}: ${Number(r.pieceworkPay).toLocaleString()}` : ''}</p>
              <div className="grid grid-cols-3 gap-1.5">
                <input type="number" defaultValue={r.bonuses} placeholder={t('management.payBonus') as string} disabled={r.status==='paid'}
                  onBlur={e=>patch(r.id, { bonuses: Number(e.target.value)||0 })} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-input-background focus:outline-none disabled:opacity-50" />
                <input type="number" defaultValue={r.deductions} placeholder={t('management.payDeduction') as string} disabled={r.status==='paid'}
                  onBlur={e=>patch(r.id, { deductions: Number(e.target.value)||0 })} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-input-background focus:outline-none disabled:opacity-50" />
                <select value={r.status} disabled={r.status==='paid'} onChange={e=>patch(r.id, { status: e.target.value })} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-input-background focus:outline-none disabled:opacity-50">
                  {Object.keys(statusLabel).map(k => <option key={k} value={k}>{statusLabel[k]}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </ManagementModalShell>
  );
}
