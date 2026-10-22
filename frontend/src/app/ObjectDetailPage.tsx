import { confirmDialog } from "./lib/confirmDialog";
import { useState, useRef, useEffect } from "react";
import { oneOf, usePersistentState } from "./lib/persistentState";
import { ActionSheet } from "./components/SwipeRow";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Package from "@hugeicons/core-free-icons/Package01Icon";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ChevronUp from "@hugeicons/core-free-icons/ArrowUp01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import Camera from "@hugeicons/core-free-icons/Camera01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Share2 from "@hugeicons/core-free-icons/Share01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { API_BASE, parseSmetaFile, uploadChatMedia } from "./api";
import { motion } from "motion/react";
import { PlanFactCard } from "./PlanFact";
import { PieceworkTab, useCompanyFeatures } from "./Piecework";
import { DailyReports } from "./DailyReports";
import { openMediaViewer } from "./MediaViewer";
import { SkeletonList } from "./Skeleton";
import { EscClose, LocationInput, SMETA_GROUP_LABEL, SMETA_GROUP_ORDER, SafeImg, SendTransferModal, TransferRow, fmt, fmtNum, hwheel, isAdmin, useModalPresence, type AppUser, type Project, type ReqMat, type SmetaResourceRow, type SmetaResult, type SmetaWorkRow, type Transfer } from "./App";

export function ObjectDetailPage({ project, currentUser, users, transfers, onBack, onSendTransfer, onConfirm, onReject, onSmetaUploaded, onUpdateStatus, onUpdateProject, onDeleteProject }:
  { project: Project; currentUser: AppUser; users: AppUser[]; transfers: Transfer[];
    onBack: () => void; onSendTransfer: (t: Transfer) => void; onConfirm: (id: string, d?: string) => void; onReject: (id: string) => void; onSmetaUploaded: (pid: string, result: SmetaResult) => void;
    onUpdateStatus: (pid: string, status: "active"|"paused"|"completed") => void;
    onUpdateProject: (pid: string, patch: Partial<Project>) => void;
    onDeleteProject: (pid: string) => void;
  }) {
  const { t } = useTranslation();
  const canPlanFact = isAdmin(currentUser.role) || !!currentUser.isOwner || currentUser.role === "prorab" || currentUser.role === "brigadir";
  const companyFeatures = useCompanyFeatures();
  const showPiecework = !!companyFeatures?.piecework;
  const [tab, setTab] = usePersistentState<"plan"|"required"|"smeta"|"pending"|"confirmed"|"media"|"piece">(
    `object.tab:${project.id}`, "required", oneOf(["plan", "required", "smeta", "pending", "confirmed", "media", "piece"]));
  const [showEditProject, setShowEditProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  // Ish jarayoni rasm/video — BARCHA xodim (ishchi, brigadir, prorab ham)
  // qo'sha oladi, faqat direktor/o'rinbosar emas (aniq talab).
  const [mediaItems, setMediaItems] = useState<{ id: string; type: 'image'|'video'; url: string; caption?: string; uploadedBy: { userId: string; name: string; role: string }; createdAt: string; aiAnalysis?: { stage?: string; progressPercent?: number | null; workVisible?: string; safety?: Array<{ issue: string; severity: string }>; quality?: string[] } }[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const loadMedia = async () => {
    setMediaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media`);
      if (res.ok) setMediaItems(await res.json());
    } catch {}
    setMediaLoading(false);
  };
  useEffect(() => { loadMedia(); /* eslint-disable-next-line */ }, [project.id]);
  // Fayl tanlangach darhol yuklanmaydi — avval ko'rinish + izoh (matn) yozish oynasi chiqadi.
  const [pendingMedia, setPendingMedia] = useState<{ file: File; preview: string; type: 'image'|'video' } | null>(null);
  const [pendingCaption, setPendingCaption] = useState("");
  const [editingCaption, setEditingCaption] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => () => { if (pendingMedia) URL.revokeObjectURL(pendingMedia.preview); }, [pendingMedia]);
  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingCaption("");
    setPendingMedia({ file, preview: URL.createObjectURL(file), type: file.type.startsWith('video') ? 'video' : 'image' });
  };
  const submitPendingMedia = async () => {
    if (!pendingMedia) return;
    setUploadingMedia(true);
    try {
      const { url } = await uploadChatMedia(pendingMedia.file, pendingMedia.file.name);
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: pendingMedia.type, caption: pendingCaption.trim() || undefined }),
      });
      if (res.ok) { const m = await res.json(); setMediaItems(prev => [m, ...prev]); toast.success(t('objectDetail.mediaUploaded')); setPendingMedia(null); }
      else toast.error(t('objectDetail.mediaUploadError'));
    } catch { toast.error(t('objectDetail.mediaUploadError')); }
    setUploadingMedia(false);
  };
  const saveCaption = async () => {
    if (!editingCaption) return;
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media/${editingCaption.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caption: editingCaption.text }),
      });
      if (!res.ok) throw new Error();
      const m = await res.json();
      setMediaItems(prev => prev.map(x => x.id === m.id ? { ...x, caption: m.caption } : x));
      setEditingCaption(null);
    } catch { toast.error(t('common.error')); }
  };
  const handleMediaDelete = async (mediaId: string) => {
    if (!await confirmDialog(t('objectDetail.confirmMediaDelete'))) return;
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}/media/${mediaId}`, { method: 'DELETE' });
      if (res.ok) setMediaItems(prev => prev.filter(m => m.id !== mediaId));
      else toast.error(t('common.error'));
    } catch { toast.error(t('common.error')); }
  };
  const [showSend, setShowSend] = useState(false);
  const [uploadingSmeta, setUploadingSmeta] = useState(false);
  const [smetaMsg, setSmetaMsg] = useState("");
  const [smetaPercent, setSmetaPercent] = useState(0);
  const [matSearch, setMatSearch] = useState("");
  const [selectedMat, setSelectedMat] = useState<ReqMat | null>(null);
  const projT = transfers.filter(t => t.projectId === project.id);
  const pendT = projT.filter(t => t.status === "pending");
  const confT = projT.filter(t => t.status === "confirmed");
  const foreman = users.find(u => u.id === project.foremanId);
  const [initialTransferData, setInitialTransferData] = useState<Partial<Transfer> | undefined>();
  // Qidiruv (kiril+lotin) — real vaqtda material nomi bo'yicha filtr
  const filteredMats = project.requiredMaterials.filter(m => m.name.toLowerCase().includes(matSearch.trim().toLowerCase()));
  
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background/50">
      {/* MUHIM: header va tab-panel ILGARI ikkalasi ALOHIDA sticky (top-0 va
          top-[53px], qattiq piksel) edi — header uzun nom/status+smeta
          tugmasi tor ekranda IKKI QATORGA o'tganda balandligi 53px'dan
          oshib, tab-panel ustidan bosib qolar edi ("qo'shilib ketgan"
          ko'rinish). Endi ikkalasi BITTA sticky konteynerda — header
          balandligidan qat'i nazar tab-panel doim to'g'ri joyda turadi. */}
      <div className="flex-shrink-0 z-10 sticky top-0">
      {/* Owner 2026-10-22: telefonda tepa qism pastdagini siqib qo'yardi — endi ixcham: orqaga, nom+holat, "Yuborish"
          va ⋯ menyu (tahrirlash, mijoz havolasi, smeta yuklash, o'chirish). Kompyuterda tugmalar ham ko'rinadi. */}
      <div className="glass border-b border-border px-3 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} aria-label={t('common.back')} className="h-10 w-10 sm:w-auto sm:px-2 -ml-1 flex items-center justify-center gap-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 flex-shrink-0">
            <MorphIcon icon={ArrowLeft} className="w-5 h-5 sm:w-4 sm:h-4" /><span className="hidden sm:inline">{t('common.back')}</span>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[15px] sm:text-sm font-semibold truncate min-w-0" title={project.name}>{project.name}</span>
              <select
                aria-label={t('objectDetail.statusLabel', { defaultValue: 'Holat' })}
                className="text-xs bg-transparent border-none font-semibold focus:outline-none cursor-pointer outline-none flex-shrink-0"
                style={{ color: project.status === "active" ? "#22c55e" : project.status === "paused" ? "#f59e0b" : "#3b82f6" }}
                value={project.status}
                disabled={!isAdmin(currentUser.role)}
                onChange={async (e) => {
                  const newStatus = e.target.value as "active"|"paused"|"completed";
                  try {
                    const res = await fetch(`${API_BASE}/api/objects/${project.id}/status`, {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus })
                    });
                    if (res.ok) { onUpdateStatus(project.id, newStatus); }
                  } catch { toast.error(t('common.error')); }
                }}
              >
                <option value="active">{t('objectDetail.statusActive')}</option>
                <option value="paused">{t('objectDetail.statusPaused')}</option>
                <option value="completed">{t('objectDetail.statusCompleted')}</option>
              </select>
            </div>
            {project.location && <p className="text-xs text-muted-foreground truncate">{project.location}</p>}
          </div>
          <button onClick={()=>{setInitialTransferData(undefined);setShowSend(true);}} aria-label={t('common.send')}
            className="h-10 px-3 sm:px-3.5 rounded-full bg-primary text-white text-sm font-semibold inline-flex items-center gap-1.5 flex-shrink-0 shadow-sm">
            <MorphIcon icon={Send} className="w-4 h-4" /><span className="hidden min-[400px]:inline">{t('common.send')}</span>
          </button>
          <button type="button" onClick={() => setHeaderMenu(true)} aria-label={t('objectDetail.more', { defaultValue: 'Boshqa amallar' })} data-testid="object-more"
            className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 flex-shrink-0">
            <span className="text-xl leading-none">⋯</span>
          </button>
        </div>
        <input type="file" id="smeta-upload" className="hidden" accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.txt" onChange={async e=>{
          const file = e.target.files?.[0];
          if(!file) return;
          setUploadingSmeta(true); setSmetaMsg(t('objectDetail.analyzing')); setSmetaPercent(40);
          try {
            const result = await parseSmetaFile(file, project.id);
            onSmetaUploaded(project.id, result);
            const matN = result.resources.filter((r:any)=>r.group==='material').length;
            setSmetaMsg(`✓ ${result.resources.length} resurs, ${matN} material`);
            setSmetaPercent(100);
            setTab("smeta");
            setTimeout(() => { setUploadingSmeta(false); setSmetaMsg(''); setSmetaPercent(0); }, 2500);
          } catch (err) {
            setSmetaMsg(`✗ ${(err as Error).message || t('objectDetail.smetaFailedGeneric')}`);
            setSmetaPercent(0);
            setTimeout(() => { setUploadingSmeta(false); setSmetaMsg(''); }, 4000);
          }
          e.target.value='';
        }}/>
        {uploadingSmeta && (
          <div className={`mt-2 rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2 ${smetaMsg.startsWith('✓') ? "bg-green-500/15 text-green-800 dark:text-green-400" : smetaMsg.startsWith('✗') ? "bg-destructive/15 text-destructive" : "bg-accent/10 text-accent"}`}>
            {smetaMsg.startsWith('✓') ? <MorphIcon icon={CheckCircle} className="w-4 h-4 flex-shrink-0" /> : smetaMsg.startsWith('✗') ? <MorphIcon icon={AlertCircle} className="w-4 h-4 flex-shrink-0" /> : <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin flex-shrink-0" />}
            <span className="flex-1 min-w-0 truncate">{smetaMsg.replace(/^[✓✗]\s*/, '') || t('objectDetail.uploading')}</span>
            {smetaPercent > 0 && !smetaMsg.startsWith('✗') && <div className="w-16 bg-accent/20 rounded-full h-1"><div className={`${smetaMsg.startsWith('✓') ? 'bg-green-500' : 'bg-accent'} h-1 rounded-full`} style={{width:`${smetaPercent}%`}}/></div>}
          </div>
        )}
        {headerMenu && (
          <ActionSheet title={project.name} onClose={() => setHeaderMenu(false)} actions={[
            ...(isAdmin(currentUser.role) ? [{ key: "edit", label: t('objectDetail.editProject'), icon: Edit, onClick: () => setShowEditProject(true) }] : []),
            // Smeta butun material ro'yxatini almashtiradi — faqat rahbar yoki obyekt prorabi (backend ham tekshiradi)
            ...(isAdmin(currentUser.role) || !!currentUser.isOwner || project.foremanId === currentUser.id ? [{ key: "smeta", label: t('objectDetail.smetaUpload'), icon: Download, onClick: () => { if (!uploadingSmeta) document.getElementById('smeta-upload')?.click(); } }] : []),
            ...(isAdmin(currentUser.role) ? [{ key: "link", label: t('objectDetail.clientLinkBtn'), icon: Share2, onClick: async () => {
              try {
                const res = await fetch(`${API_BASE}/api/objects/${project.id}/client-link`, { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.url) { await navigator.clipboard.writeText(data.url).catch(() => {}); toast.success(t('objectDetail.clientLinkCopied')); }
                else toast.error(t('common.error'));
              } catch { toast.error(t('common.error')); }
            } }] : []),
            ...(isAdmin(currentUser.role) ? [{ key: "del", label: t('objectDetail.deleteProject'), icon: Trash, tone: "danger" as const, onClick: async () => {
              if (deletingProject || !await confirmDialog(t('objectDetail.confirmDeleteProject', { name: project.name }))) return;
              setDeletingProject(true);
              try {
                const res = await fetch(`${API_BASE}/api/objects/${project.id}`, { method: 'DELETE' });
                if (res.ok) { toast.success(t('objectDetail.deleteProjectSuccess')); onDeleteProject(project.id); onBack(); }
                else toast.error(t('objectDetail.deleteProjectError'));
              } catch { toast.error(t('objectDetail.deleteProjectError')); }
              setDeletingProject(false);
            } }] : []),
          ]} />
        )}
      </div>
      <div className="glass border-b border-border px-3 py-2 flex gap-1 overflow-x-auto scrollbar-hide">
        {([["required",t('objectDetail.tabRequired'),project.requiredMaterials.length], ["pending",t('objectDetail.tabPending'),pendT.length],["confirmed",t('objectDetail.tabConfirmed'),confT.length], ...(project.smeta ? [["smeta",t('objectDetail.tabSmeta'),project.smeta.resources.length] as [string,string,number]] : []), ["media",t('objectDetail.tabMedia'),mediaItems.length], ...(showPiecework ? [["piece",t('piecework.tab'),NaN] as [string,string,number]] : []), ...(canPlanFact ? [["plan",t('planFact.tab'),NaN] as [string,string,number]] : [])] as [string,string,number][]).map(([k,l,c])=>(
          <button key={k} onClick={()=>setTab(k as any)} className={`relative flex items-center gap-1.5 text-sm md:text-xs py-2 px-3 rounded-full font-medium liquid-transition whitespace-nowrap ${tab===k?"text-primary":"text-muted-foreground hover:text-foreground"}`}>
            {tab===k && (
              <motion.div layoutId="objectDetailTabPill" className="absolute inset-0 rounded-full bg-primary/10 -z-10"
                transition={{ type: "spring", stiffness: 480, damping: 34 }}  />
            )}
            {l}{Number.isFinite(c) && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${tab===k?"bg-primary text-white":"bg-muted text-muted-foreground"}`}>{c}</span>}
          </button>
        ))}
      </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {tab==="plan" && <div className="flex-1 min-h-0 overflow-y-auto"><PlanFactCard objectId={project.id} canEdit={isAdmin(currentUser.role) || !!currentUser.isOwner} /><DailyReports objectId={project.id} canWrite={canPlanFact} /></div>}
        {tab==="piece" && showPiecework && <div className="flex-1 min-h-0 overflow-y-auto"><PieceworkTab objectId={project.id} users={users} currentUser={currentUser} isBoss={isAdmin(currentUser.role) || !!currentUser.isOwner} isForeman={project.foremanId === currentUser.id || currentUser.role === 'prorab' || currentUser.role === 'brigadir'} /></div>}
        {tab==="smeta" && project.smeta && <SmetaResultView smeta={project.smeta}/>}
        {tab==="required" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Kompakt tepa: qidiruv + soni + byudjet (bitta yupqa qator).
                "Sodda chiroyli compact" dizayn talabi: pill-shakldagi qidiruv
                + alohida chip'lar (avvalgi qattiq chiziqli input + oddiy matn
                o'rniga) — zich joy egallashda davom etadi, faqat ko'rinishi
                boshqa joylardagi (.surface, rounded-full chip) uslubga mos. */}
            <div className="flex-shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-border/50 bg-muted/10">
              <div className="relative flex-1 min-w-0">
                <MorphIcon icon={Search} className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input type="text" placeholder={t('objectDetail.searchMaterial')} value={matSearch} onChange={e=>setMatSearch(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-[11px] bg-input-background border border-border rounded-full focus:outline-none focus:ring-1 focus:ring-primary liquid-transition"/>
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap shrink-0 bg-muted/60 px-2 py-1 rounded-full">{filteredMats.length} ta</span>
              <span className="text-[10px] font-semibold text-primary whitespace-nowrap shrink-0 bg-primary/10 px-2 py-1 rounded-full">{fmt(project.budget)}</span>
            </div>
            {/* Zich jadval — barcha materiallar minimal joyda. MUHIM:
                overflow-x-auto avval yo'q edi — 5 ustunli jadval tor
                (mobil) ekranga sig'masdan, o'ng tomondagi ustunlar (Narx,
                Summa) ko'rish/scroll qilib bo'lmaydigan holda "yo'qolib"
                qolardi. min-w-max jadvalni siqib qisqartirish o'rniga
                o'z tabiiy kengligida saqlaydi, konteyner esa uni gorizontal
                aylantirishga imkon beradi. */}
            {/* min-h-0 SHART: flex-1 + overflow-auto bo'lsagina scroll
                ishlaydi deb o'ylanardi, lekin bu yo'q bo'lsa flex element
                o'z ICHIDAGI kontent balandligidan kichik bo'lishni "rad
                etadi" (flex bolalarining standart min-height:auto) — natijada
                jadval pastga cheksiz o'sib, ko'rinmas qismi hech qanday
                scrollsiz shunchaki kesilib qolardi ("davomini ko'rish uchun
                scroll bo'lmayapti"). */}
            {/* XATO TUZATILDI: avval shu BITTA <div> ham vertikal (qatorlar
                ro'yxati), ham gorizontal (keng jadval) scrollni birga
                bajarishga urinardi (overflow-auto = ikkalasi). Mobil
                teginish-imo-ishoralarida bu noaniq: chapga suring desa ham
                brauzer ko'pincha vertikal scroll deb "qulflab" qo'yadi —
                natijada gorizontal suzish DEYARLI ishlamaydi (aniq xabar
                qilingan xato: "chapga qilirlamayadpi"). Endi ikkita ALOHIDA
                konteyner: TASHQI faqat vertikal (butun jadval + sticky sarlavha
                yuqoriga-pastga suriladi), ICHKI faqat gorizontal (qator
                matni chapga-o'ngga suriladi) — ikki yo'nalish endi bir-biriga
                xalaqit bermaydi. */}
            {/* touch-action CHEKLOVSIZ (auto): brauzer barmoq yo'nalishini o'zi aniqlaydi — gorizontal
                surish jadvalni, vertikal surish sahifani suradi. Avval jadvalda touch-pan-x bor edi va
                u telefonda jadval ustidan PASTGA surishni butunlay to'sib qo'yardi. */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide pb-20 sm:pb-2">
              <div className="overflow-x-auto" onWheel={hwheel}>
                <table className="w-full xl:w-auto xl:min-w-[760px] min-w-[560px] text-left border-collapse text-[11px] leading-tight">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border">
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground">{t('objectDetail.colName')}</th>
                      <th className="px-4 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">{t('objectDetail.colUnit')}</th>
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">{t('objectDetail.colQty')}</th>
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">{t('objectDetail.colPrice')}</th>
                      <th className="px-2.5 py-2 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">{t('objectDetail.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMats.map((m, i) => {
                      const total = m.price != null ? m.price * m.quantity : null;
                      return (
                        <tr key={m.id} onClick={() => setSelectedMat(m)}
                          className={`cursor-pointer hover:bg-primary/5 border-b border-border/25 liquid-transition ${i % 2 === 1 ? "bg-muted/15" : ""}`}>
                          <td className="px-2.5 py-1.5 font-semibold text-primary leading-snug" title={m.name}><div className="min-w-[220px] max-w-[480px] line-clamp-2">{m.name}</div></td>
                          <td className="px-4 py-1.5 text-muted-foreground whitespace-nowrap">{m.unit}</td>
                          <td className="px-2.5 py-1.5 font-mono text-right whitespace-nowrap">{fmtNum(m.quantity)}</td>
                          <td className="px-2.5 py-1.5 font-mono text-right whitespace-nowrap text-muted-foreground">{m.price != null ? fmtNum(m.price) : "—"}</td>
                          <td className="px-2.5 py-1.5 font-mono text-right font-semibold whitespace-nowrap">{total != null ? fmtNum(total) : "—"}</td>
                        </tr>
                      );
                    })}
                    {filteredMats.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-10 text-center text-muted-foreground">
                        <MorphIcon icon={Package} className="w-8 h-8 mx-auto mb-2 opacity-25" />
                        {project.requiredMaterials.length === 0 ? t('objectDetail.noSmeta') : t('common.notFound')}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {tab==="pending" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {pendT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><MorphIcon icon={CheckCircle} className="w-10 h-10 mx-auto mb-2 text-green-400 opacity-50" /><p className="text-sm md:text-xs">{t('objectDetail.noPending')}</p></div>
            :pendT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
        {tab==="confirmed" && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide pb-24 sm:pb-4 space-y-2 animate-slide-up-fade">
            {confT.length===0?<div className="text-center py-10 text-muted-foreground animate-pop-in"><MorphIcon icon={Package} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('objectDetail.noConfirmed')}</p></div>
            :confT.map(t=><TransferRow key={t.id} t={t} currentUser={currentUser} allUsers={users} projects={[project]} onConfirm={onConfirm} onReject={onReject}/>)}
          </div>
        )}
        {tab==="media" && (
          <div className="flex-1 overflow-y-auto p-3 scrollbar-hide pb-24 sm:pb-4 space-y-3 animate-slide-up-fade">
            {/* Aniq talab: BARCHA xodim (ishchi, brigadir, prorab ham)
                qo'sha oladi — direktor/o'rinbosarga cheklanmagan. */}
            <input ref={mediaFileRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={handleMediaUpload} />
            <button onClick={() => mediaFileRef.current?.click()} disabled={uploadingMedia}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold border-2 border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary liquid-transition disabled:opacity-50">
              <MorphIcon icon={Camera} className="w-4 h-4" />{t('objectDetail.mediaAddBtn')}
            </button>
            {pendingMedia && (
              <div className="surface border border-primary/25 rounded-2xl p-3 flex flex-col sm:flex-row gap-3 animate-slide-up-fade">
                <div className="w-full sm:w-40 h-40 sm:h-32 rounded-xl overflow-hidden bg-black/80 flex-shrink-0">
                  {pendingMedia.type === 'video'
                    ? <video src={pendingMedia.preview} className="w-full h-full object-contain" controls playsInline />
                    : <img src={pendingMedia.preview} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <textarea value={pendingCaption} onChange={e => setPendingCaption(e.target.value.slice(0, 300))} rows={3} autoFocus
                    placeholder={t('objectDetail.mediaCaptionPh', "Izoh yozing (ixtiyoriy) — nima qilindi, qayerda...")}
                    className="w-full flex-1 text-sm rounded-xl border border-border bg-background/60 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  <div className="flex gap-2">
                    <button onClick={() => setPendingMedia(null)} disabled={uploadingMedia}
                      className="flex-1 sm:flex-none h-10 px-4 rounded-xl text-sm font-semibold border border-border hover:bg-muted liquid-transition disabled:opacity-50">{t('common.cancel')}</button>
                    <button onClick={submitPendingMedia} disabled={uploadingMedia}
                      className="flex-1 sm:flex-none h-10 px-5 rounded-xl text-sm font-bold bg-primary text-primary-foreground flex items-center justify-center gap-2 hover:opacity-90 liquid-transition disabled:opacity-60">
                      {uploadingMedia ? <MorphIcon icon={Loader2} className="w-4 h-4 animate-spin" /> : <MorphIcon icon={Send} className="w-4 h-4" />}
                      {uploadingMedia ? t('objectDetail.mediaUploading') : t('objectDetail.mediaPublish', "Joylash")}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {mediaLoading ? (
              <SkeletonList items={3} withAvatar={false} />
            ) : mediaItems.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground animate-pop-in"><MorphIcon icon={Camera} className="w-10 h-10 mx-auto mb-2 opacity-30" /><p className="text-sm md:text-xs">{t('objectDetail.mediaEmpty')}</p></div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {mediaItems.map(m => {
                  const canManage = m.uploadedBy?.userId === currentUser.id || isAdmin(currentUser.role);
                  const editing = editingCaption?.id === m.id;
                  return (
                  <div key={m.id} className="surface border border-border/70 rounded-2xl overflow-hidden flex flex-col">
                    <button type="button" onClick={() => openMediaViewer(m.url, m.type)} className="relative block w-full aspect-[4/3] bg-muted overflow-hidden group">
                      {m.type === 'video' ? (
                        <>
                          <video src={`${m.url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                            <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center text-white shadow-lg group-hover:scale-110 liquid-transition">
                              <svg viewBox="0 0 24 24" className="w-5 h-5 ml-0.5" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>
                            </span>
                          </span>
                        </>
                      ) : (
                        <SafeImg src={m.url} className="w-full h-full object-cover group-hover:scale-[1.03] liquid-transition" />
                      )}
                    </button>
                    <div className="p-2.5 flex-1 flex flex-col gap-1.5 min-w-0">
                      {editing ? (
                        <textarea value={editingCaption!.text} autoFocus rows={3}
                          onChange={e => setEditingCaption({ id: m.id, text: e.target.value.slice(0, 300) })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCaption(); } if (e.key === 'Escape') setEditingCaption(null); }}
                          className="w-full text-xs rounded-lg border border-border bg-background/60 px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
                      ) : m.caption ? (
                        <p className="text-xs text-foreground/85 leading-snug line-clamp-3 break-words whitespace-pre-wrap">{m.caption}</p>
                      ) : null}
                      {/* AI foto-nazorat bahosi (bosqich, foiz, xavfsizlik) */}
                      {m.aiAnalysis && (m.aiAnalysis.stage || m.aiAnalysis.safety?.length) ? (
                        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="rounded-lg bg-primary/[0.06] px-2 py-1.5 text-[10.5px] leading-snug space-y-0.5">
                          <p className="font-semibold text-primary">🤖 {m.aiAnalysis.stage || t('objectDetail.aiPhoto')}{typeof m.aiAnalysis.progressPercent === 'number' ? ` · ~${m.aiAnalysis.progressPercent}%` : ''}</p>
                          {(m.aiAnalysis.safety || []).filter(s => s.severity !== 'low').slice(0, 2).map((s, i) => (
                            <p key={i} className="text-red-600 dark:text-red-400">⚠️ {s.issue}</p>
                          ))}
                          {(m.aiAnalysis.quality || []).slice(0, 1).map((q, i) => <p key={i} className="text-amber-700 dark:text-amber-300">• {q}</p>)}
                        </motion.div>
                      ) : null}
                      <div className="mt-auto flex items-center gap-1.5 min-w-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold truncate">{m.uploadedBy?.name || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}</p>
                        </div>
                        {canManage && (editing ? (
                          <>
                            <button onClick={() => setEditingCaption(null)} aria-label={t('common.cancel')} className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted liquid-transition"><MorphIcon icon={X} className="w-4 h-4" /></button>
                            <button onClick={saveCaption} aria-label={t('common.save')} className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary text-primary-foreground hover:opacity-90 liquid-transition"><MorphIcon icon={Check} className="w-4 h-4" /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setEditingCaption({ id: m.id, text: m.caption || '' })} aria-label={t('common.edit')} title={t('common.edit')}
                              className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 liquid-transition"><MorphIcon icon={Edit} className="w-4 h-4" /></button>
                            <button onClick={() => handleMediaDelete(m.id)} aria-label={t('common.delete')} title={t('common.delete')}
                              className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-500/10 text-red-500 hover:bg-red-500/20 liquid-transition"><MorphIcon icon={Trash2} className="w-4 h-4" /></button>
                          </>
                        ))}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {showSend && <SendTransferModal currentUser={currentUser} projects={[project]} allUsers={users} onClose={()=>setShowSend(false)} onSend={t=>{onSendTransfer(t);setShowSend(false);}} initialTransfer={initialTransferData}/>}
      {selectedMat && <MaterialDetailsModal mat={selectedMat} confT={confT} pendT={pendT} objectId={project.id} canEdit={isAdmin(currentUser.role)}
        onClose={() => setSelectedMat(null)} onSend={() => {
        setInitialTransferData({ projectId: project.id, materialName: selectedMat.name, unit: selectedMat.unit });
        setShowSend(true);
      }}
        onUpdated={patch => {
          const updated = { ...selectedMat, ...patch };
          onUpdateProject(project.id, { requiredMaterials: project.requiredMaterials.map(m => m.id === selectedMat.id ? updated : m) });
          setSelectedMat(updated);
        }} />}
      {showEditProject && (
        <ProjectEditModal project={project} users={users} onClose={() => setShowEditProject(false)}
          onSave={patch => { onUpdateProject(project.id, patch); setShowEditProject(false); }} />
      )}
    </div>
  );
}

// ─── Material Details Modal ───────────────────────────────────────────────────
export function MaterialDetailsModal({ mat, confT, pendT, objectId, canEdit, onClose, onSend, onUpdated }:
  { mat: ReqMat; confT: Transfer[]; pendT: Transfer[]; objectId: string; canEdit?: boolean; onClose: () => void; onSend?: () => void; onUpdated?: (patch: Partial<ReqMat>) => void; }) {
  // `t` diqqat: bu komponentda transfer o'zgaruvchisi sifatida ham ishlatiladi
  // (.filter/.map(t=>...)), shuning uchun tarjima funksiyasi `tt` deb nomlangan.
  const { t: tt } = useTranslation();
  useModalPresence();
  const sent = confT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const pending = pendT.filter(t=>t.materialName===mat.name).reduce((a,t)=>a+t.quantity,0);
  const totalSpent = sent * (mat.price || 0);

  const [editing, setEditing] = useState(false);
  const [eName, setEName] = useState(mat.name);
  const [eUnit, setEUnit] = useState(mat.unit);
  const [eQty, setEQty] = useState(String(mat.quantity));
  const [ePrice, setEPrice] = useState(mat.price != null ? String(mat.price) : "");
  const [saving, setSaving] = useState(false);

  const saveEdit = async () => {
    if (!eName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/materials/object/${objectId}/by-name`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentName: mat.name, name: eName.trim(), unit: eUnit.trim(), needed: Number(eQty) || 0, price: ePrice ? Number(ePrice) : null }),
      });
      if (res.ok) {
        onUpdated?.({ name: eName.trim(), unit: eUnit.trim(), quantity: Number(eQty) || 0, price: ePrice ? Number(ePrice) : undefined });
        setEditing(false);
      } else toast.error(tt('common.error'));
    } catch { toast.error(tt('common.error')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex flex-col justify-end sm:justify-center sm:items-center backdrop-blur-sm liquid-transition">
      <div className="bg-background/90 backdrop-blur-xl w-full sm:w-[450px] sm:rounded-2xl rounded-t-[2rem] overflow-hidden animate-slide-up-fade flex flex-col shadow-2xl border border-white/20">
        <div className="p-5 border-b border-border/50 flex justify-between items-center bg-card/50">
          <h3 className="font-semibold text-base truncate pr-4">{mat.name}</h3>
          <div className="flex items-center gap-2">
            {canEdit && !editing && <button onClick={()=>setEditing(true)} aria-label={tt('materialDetails.editBtn')} title={tt('materialDetails.editBtn')} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full liquid-transition"><MorphIcon icon={Edit} className="w-4 h-4" /></button>}
            {onSend && <button onClick={()=>{onClose(); onSend();}} className="flex items-center gap-1.5 bg-primary text-white text-sm md:text-xs px-3 py-1.5 rounded-full hover:bg-primary/90 font-medium liquid-transition shadow-md shadow-primary/20"><MorphIcon icon={Send} className="w-3 h-3" />{tt('common.send')}</button>}
            <button aria-label={tt('common.close')} onClick={onClose} className="p-1.5 text-muted-foreground hover:bg-muted/50 rounded-full liquid-transition bg-muted/20"><MorphIcon icon={X} className="w-4 h-4" /></button>
          </div>
        </div>
        {editing ? (
          <div className="p-4 space-y-2.5">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.editNameLabel')}</label>
              <input value={eName} onChange={e=>setEName(e.target.value)} autoFocus className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.colUnit')}</label>
                <input value={eUnit} onChange={e=>setEUnit(e.target.value)} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.colQty')}</label>
                <input type="number" min="0" value={eQty} onChange={e=>setEQty(e.target.value)} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{tt('objectDetail.colPrice')}</label>
              <input type="number" min="0" value={ePrice} onChange={e=>setEPrice(e.target.value)} className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={()=>setEditing(false)} className="btn btn-outline flex-1 py-2">{tt('common.cancel')}</button>
              <button onClick={saveEdit} disabled={saving} className="btn btn-primary flex-1 py-2 disabled:opacity-50">{tt('common.save')}</button>
            </div>
          </div>
        ) : (
        <div className="p-4 overflow-y-auto overflow-x-hidden">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-muted p-2.5 rounded-lg border border-border">
              <p className="text-sm md:text-xs text-muted-foreground mb-1">{tt('materialDetails.planned')}</p>
              <p className="font-semibold text-sm">{mat.quantity.toLocaleString()} <span className="text-sm md:text-xs font-normal">{mat.unit}</span></p>
              {mat.price ? <p className="text-sm md:text-xs text-muted-foreground mt-1">{tt('materialDetails.priceLabel', { price: fmt(mat.price), unit: mat.unit })}</p> : <p className="text-sm md:text-xs text-muted-foreground mt-1">{tt('materialDetails.noPriceSet')}</p>}
            </div>
            <div className="bg-green-500/10 p-2.5 rounded-lg border border-green-500/20">
              <p className="text-sm md:text-xs text-green-700 dark:text-green-400 mb-1">{tt('materialDetails.delivered')}</p>
              <p className="font-semibold text-sm text-green-700 dark:text-green-400">{sent.toLocaleString()} <span className="text-sm md:text-xs font-normal">{mat.unit}</span></p>
              {(mat.price ?? 0) > 0 && <p className="text-sm md:text-xs text-green-700/70 mt-1">{tt('materialDetails.totalSpent', { amount: fmt(totalSpent) })}</p>}
            </div>
          </div>

          <h4 className="text-sm md:text-xs font-semibold mb-2">{tt('materialDetails.history')}</h4>
          {confT.filter(t=>t.materialName===mat.name).length === 0 && pendT.filter(t=>t.materialName===mat.name).length === 0 ? (
             <p className="text-sm md:text-xs text-muted-foreground py-4 text-center">{tt('materialDetails.noHistory')}</p>
          ) : (
            <div className="space-y-2">
              {pendT.filter(t=>t.materialName===mat.name).map(t => (
                <div key={t.id} className="border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded p-2 text-sm md:text-xs">
                  <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-500 mb-1"><span>{t.quantity.toLocaleString()} {t.unit} {tt('materialDetails.pendingSuffix')}</span><span>{(t.date || t.sentDate || '').split('T')[0]}</span></div>
                  <p className="text-sm md:text-xs text-amber-700/70">{tt('materialDetails.sender', { name: t.fromUserName })}</p>
                </div>
              ))}
              {confT.filter(t=>t.materialName===mat.name).map(t => (
                <div key={t.id} className="border border-border bg-card rounded p-2 text-sm md:text-xs">
                  <div className="flex justify-between font-semibold mb-1"><span>{t.quantity.toLocaleString()} {t.unit}</span><span className="text-muted-foreground text-sm md:text-xs">{t.confirmedDate?.split('T')[0] || (t.date || t.sentDate || '').split('T')[0]}</span></div>
                  <p className="text-sm md:text-xs text-muted-foreground">{tt('materialDetails.sender', { name: t.fromUserName })}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

// ─── Object Detail ─────────────────────────────────────────────────────────────
// ─── Smeta natijasi ko'rinishi — barcha bo'limlar, to'liq aniqlik ─────────────
export function SmetaResultView({ smeta }: { smeta: SmetaResult }) {
  const [openGroup, setOpenGroup] = useState<string | null>("material");
  const [openWork, setOpenWork] = useState<number | null>(null);
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({});

  const byGroup: Record<string, SmetaResourceRow[]> = {};
  for (const r of smeta.resources) (byGroup[r.group] = byGroup[r.group] || []).push(r);
  const groupSum = (rows: SmetaResourceRow[]) => rows.reduce((s, r) => s + (r.total || 0), 0);
  const budget = smeta.meta?.totalWithoutVat ?? smeta.resources.reduce((s, r) => s + (r.total || 0), 0);
  const vat = smeta.meta?.totalWithVat;

  const sections: { name: string; works: SmetaWorkRow[] }[] = [];
  for (const w of smeta.works) {
    const sec = w.section || "— (bo'limsiz)";
    let s = sections.find(x => x.name === sec);
    if (!s) { s = { name: sec, works: [] }; sections.push(s); }
    s.works.push(w);
  }

  // Jadvallarda touch-action cheklovi yo'q — vertikal va gorizontal surish ikkalasi ishlaydi.
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-3 p-4 pb-24 animate-slide-up-fade">
      {/* Meta + byudjet (parser natijasidan) */}
      <div className="glass-card rounded-xl p-4 border border-border">
        {smeta.meta?.objectName && <p className="text-sm font-bold leading-snug">{smeta.meta.objectName}</p>}
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Resurs summasi (byudjet)</span><span className="font-mono font-bold text-primary">{fmtNum(budget)} so'm</span></div>
          {vat != null && <div className="flex justify-between"><span className="text-muted-foreground">НДС bilan</span><span className="font-mono">{fmtNum(vat)} so'm</span></div>}
        </div>
        <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg ${smeta.validation.ok ? "bg-green-500/15 text-green-800 dark:text-green-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}>
          {smeta.validation.ok ? `✓ Tekshiruv o'tdi — ${smeta.resources.length} resurs, guruh summalari mos` : `⚠ ${smeta.validation.errors.length} xato`}
          {smeta.validation.warnings.length > 0 && ` · ${smeta.validation.warnings.length} ogohlantirish`}
        </div>
      </div>

      {/* A: РЕСУРСНЫЙ РАСЧЕТ — 5 alohida guruh */}
      <p className="text-sm font-bold px-1 pt-1">РЕСУРСНЫЙ РАСЧЕТ <span className="text-muted-foreground">({smeta.resources.length} qator)</span></p>
      {SMETA_GROUP_ORDER.filter(g => byGroup[g]?.length).map(g => {
        const rows = byGroup[g]; const sum = groupSum(rows); const open = openGroup === g;
        return (
          <div key={g} className="glass-card rounded-xl border border-border overflow-hidden">
            <button onClick={() => setOpenGroup(open ? null : g)} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/30">
              <span className="text-sm font-semibold text-left">{SMETA_GROUP_LABEL[g]} <span className="text-muted-foreground font-normal">({rows.length})</span></span>
              <span className="flex items-center gap-2"><span className="font-mono text-sm font-bold">{fmtNum(sum)}</span><MorphIcon icon={open ? ChevronUp : ChevronDown} className="w-4 h-4 shrink-0" /></span>
            </button>
            {/* XATO TUZATILDI: sahifaning o'zi (yuqorida) vertikal scroll
                qiladi, bu jadval esa gorizontal — ikkalasi izolyatsiya
                qilinmagan bo'lsa, mobil/APK'da touch imo-ishorasi ko'pincha
                vertikalga "qulflanib", gorizontal svayp deyarli ishlamaydi
                ("smeta bo'limida chapga qimirlatib bo'lmayapti"). Talab
                jadvalidagi bilan bir xil touch-action izolyatsiyasi. */}
            {open && (
              <div className="overflow-x-auto border-t border-border" onWheel={hwheel}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground"><tr>
                    <th className="px-2 py-1.5">№</th><th className="px-2 py-1.5">Шифр</th><th className="px-2 py-1.5">Наименование</th>
                    <th className="px-2 py-1.5">Ед.</th><th className="px-2 py-1.5 text-right">Кол-во</th><th className="px-2 py-1.5 text-right">Цена</th><th className="px-2 py-1.5 text-right">Сумма</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.index} className={`border-t border-border/50 ${(r.total != null && r.total < 0) || r.qty < 0 ? "bg-red-500/5" : ""}`}>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.index}</td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.shifr || "-"}</td>
                        <td className="px-2 py-1.5 min-w-[200px] whitespace-normal" title={r.rawName}>{r.rawName}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.unit}</td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{fmtNum(r.qty)}</td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{fmtNum(r.price)}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold whitespace-nowrap">{fmtNum(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/30 font-bold"><td className="px-2 py-1.5" colSpan={6}>ИТОГО ПО ГРУППЕ:</td><td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{fmtNum(sum)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <div className="glass-card rounded-xl border-2 border-primary/30 px-4 py-3 flex items-center justify-between bg-primary/5">
        <span className="text-sm font-bold">ИТОГО ПО РЕСУРСНОМУ РАСЧЕТУ</span>
        <span className="font-mono text-base font-bold text-primary">{fmtNum(budget)}</span>
      </div>

      {/* B: РЕСУРСНАЯ ВЕДОМОСТЬ — ishlar (bo'limlarga guruhlangan) */}
      {smeta.works.length > 0 && <p className="text-sm font-bold px-1 pt-2">РЕСУРСНАЯ ВЕДОМОСТЬ / Ishlar <span className="text-muted-foreground">({smeta.works.length})</span></p>}
      {sections.map((sec, si) => {
        const so = openSection[sec.name] ?? (si === 0);
        return (
          <div key={sec.name} className="glass-card rounded-xl border border-border overflow-hidden">
            <button onClick={() => setOpenSection(p => ({ ...p, [sec.name]: !so }))} className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/20 hover:bg-muted/40">
              <span className="text-sm font-semibold text-left">{sec.name} <span className="text-muted-foreground font-normal">({sec.works.length})</span></span>
              <MorphIcon icon={so ? ChevronUp : ChevronDown} className="w-4 h-4 shrink-0" />
            </button>
            {so && sec.works.map(w => {
              const wo = openWork === w.index;
              return (
                <div key={w.index} className="border-t border-border/50">
                  <button onClick={() => setOpenWork(wo ? null : w.index)} className="w-full flex items-start justify-between gap-2 px-4 py-2 hover:bg-muted/20 text-left">
                    <span className="text-xs leading-snug"><span className="text-muted-foreground">{w.index}.</span> {w.shifr && <span className="font-mono text-primary">{w.shifr} </span>}{w.name} <span className="text-muted-foreground">[{w.unit}]</span></span>
                    <span className="flex items-center gap-1 shrink-0"><span className="text-[10px] text-muted-foreground whitespace-nowrap">{w.norms.length} n.</span><MorphIcon icon={wo ? ChevronUp : ChevronDown} className="w-3.5 h-3.5" /></span>
                  </button>
                  {wo && w.norms.length > 0 && (
                    <div className="overflow-x-auto px-4 pb-2" onWheel={hwheel}>
                      <table className="w-full text-left text-[11px]">
                        <thead className="text-muted-foreground"><tr><th className="py-1 pr-2">№</th><th className="pr-2">Шифр</th><th className="pr-2">Наименование</th><th className="pr-2">Ед.</th><th className="text-right pr-2">На ед.</th><th className="text-right">По проекту</th></tr></thead>
                        <tbody>
                          {w.norms.map(n => (
                            <tr key={n.index} className="border-t border-border/40">
                              <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{n.index}</td>
                              <td className="pr-2 font-mono text-muted-foreground">{n.shifr || "-"}</td>
                              <td className="pr-2 min-w-[160px] whitespace-normal">{n.name}</td>
                              <td className="pr-2 whitespace-nowrap">{n.unit}</td>
                              <td className="text-right pr-2 font-mono whitespace-nowrap">{fmtNum(n.perUnit)}</td>
                              <td className="text-right font-mono whitespace-nowrap">{fmtNum(n.byProject)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Loyihani tahrirlash modali ───────────────────────────────────────────────
export function ProjectEditModal({ project, users, onClose, onSave }:
  { project: Project; users: AppUser[]; onClose: () => void; onSave: (patch: Partial<Project>) => void }) {
  const { t } = useTranslation();
  useModalPresence();
  const [name, setName] = useState(project.name);
  const [budget, setBudget] = useState(project.budget ? String(project.budget) : "");
  const [location, setLocation] = useState(project.location || "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(String((project as any).geofenceRadius || 300));
  const [foremanId, setForemanId] = useState(project.foremanId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const foremen = users.filter(u => u.role === 'prorab' || u.role === 'brigadir' || u.role === 'direktor' || u.role === 'orinbosar');

  const save = async () => {
    if (name.trim().length < 2) { setError(t('objectDetail.editNameError')); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/api/objects/${project.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), budget: budget ? Number(budget) : null, location: location.trim(), foremanId: foremanId || null, ...(coords ? { lat: coords.lat, lng: coords.lng } : {}), geofenceRadius: Number(radius) || 300 }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t('common.error')); return; }
      onSave({ name: name.trim(), budget: budget ? Number(budget) : 0, location: location.trim(), foremanId: foremanId || undefined });
    } catch { setError(t('common.error')); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" >
      <EscClose onClose={onClose} />
      <div className="glass-modal rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Edit} className="w-4 h-4 text-primary" />{t('objectDetail.editProject')}</h3>
          <button aria-label={t('groupCreate.close')} onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>
        {error && <div className="bg-red-500/10 text-red-600 text-xs p-2 rounded-lg mb-2">{error}</div>}
        <div className="space-y-2.5">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editNameLabel')}</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editBudgetLabel')}</label>
            <input type="number" min="0" value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editLocationLabel')}</label>
            <LocationInput value={location} onChange={setLocation} onCoords={setCoords} />
            <label className="text-xs text-muted-foreground block mt-2">{t('addObject.geofence', "\"Ishga keldim\" radiusi (metr)")}</label>
            <input type="number" min={50} max={5000} step={50} value={radius} onChange={e => setRadius(e.target.value)}
              className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/40 mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t('objectDetail.editForemanLabel')}</label>
            <select value={foremanId} onChange={e => setForemanId(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none">
              <option value="">{t('objectDetail.editForemanNone')}</option>
              {foremen.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <button disabled={saving} onClick={save} className="btn btn-primary w-full py-2.5 mt-4 disabled:opacity-50">
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}
