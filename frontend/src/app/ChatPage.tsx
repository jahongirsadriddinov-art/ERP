import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import Building2 from "@hugeicons/core-free-icons/Building02Icon";
import Users from "@hugeicons/core-free-icons/UserMultipleIcon";
import HardHat from "@hugeicons/core-free-icons/HardHatIcon";
import Package from "@hugeicons/core-free-icons/Package01Icon";
import Plus from "@hugeicons/core-free-icons/PlusSignIcon";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Clock from "@hugeicons/core-free-icons/Clock01Icon";
import AlertTriangle from "@hugeicons/core-free-icons/Alert02Icon";
import ChevronRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import User from "@hugeicons/core-free-icons/UserIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Download from "@hugeicons/core-free-icons/Download01Icon";
import BarChart2 from "@hugeicons/core-free-icons/BarChartIcon";
import DollarSign from "@hugeicons/core-free-icons/DollarSignIcon";
import MessageCircle from "@hugeicons/core-free-icons/Message01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ChevronUp from "@hugeicons/core-free-icons/ArrowUp01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import TrendingDown from "@hugeicons/core-free-icons/TradeDownIcon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import LogOut from "@hugeicons/core-free-icons/Logout01Icon";
import Camera from "@hugeicons/core-free-icons/Camera01Icon";
import Home from "@hugeicons/core-free-icons/Home01Icon";
import UserPlus from "@hugeicons/core-free-icons/UserAdd01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Megaphone from "@hugeicons/core-free-icons/Megaphone01Icon";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Paperclip from "@hugeicons/core-free-icons/Attachment01Icon";
import Mic from "@hugeicons/core-free-icons/Mic01Icon";
import VideoIcon from "@hugeicons/core-free-icons/Video01Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import MapIcon from "@hugeicons/core-free-icons/MapIcon";
import FileText from "@hugeicons/core-free-icons/FileTextIcon";
import CornerDownLeft from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import Share2 from "@hugeicons/core-free-icons/Share01Icon";
import SquareCheck from "@hugeicons/core-free-icons/CheckmarkSquare01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import MoreHorizontal from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Upload from "@hugeicons/core-free-icons/Upload01Icon";
import Palette from "@hugeicons/core-free-icons/PaletteIcon";
import Sun from "@hugeicons/core-free-icons/Sun01Icon";
import Moon from "@hugeicons/core-free-icons/Moon02Icon";
import Monitor from "@hugeicons/core-free-icons/ComputerIcon";
import Smartphone from "@hugeicons/core-free-icons/SmartPhone01Icon";
import LogOutDevice from "@hugeicons/core-free-icons/Logout03Icon";
import PhoneOff from "@hugeicons/core-free-icons/PhoneOff01Icon";
import MicOff from "@hugeicons/core-free-icons/MicOff01Icon";
import VideoOff from "@hugeicons/core-free-icons/VideoOffIcon";
import Users2 from "@hugeicons/core-free-icons/UserGroup02Icon";
import Copy from "@hugeicons/core-free-icons/Copy01Icon";
import Bell from "@hugeicons/core-free-icons/BellIcon";
import Pin from "@hugeicons/core-free-icons/PinIcon";
import PinOff from "@hugeicons/core-free-icons/PinOffIcon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import Languages from "@hugeicons/core-free-icons/TranslateIcon";
import CreditCard from "@hugeicons/core-free-icons/CreditCardIcon";
import Calendar from "@hugeicons/core-free-icons/Calendar01Icon";
import QrCode from "@hugeicons/core-free-icons/QrCodeIcon";
import WifiOff from "@hugeicons/core-free-icons/WifiOff01Icon";
import Euro from "@hugeicons/core-free-icons/EuroIcon";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Volume2 from "@hugeicons/core-free-icons/VolumeHighIcon";
import VolumeX from "@hugeicons/core-free-icons/VolumeOffIcon";
import { MorphIcon, type IconNode } from "morphicons/react";
import { toast, Toaster } from "sonner";
import { isSoundEnabled, setSoundEnabled, getSoundVolume, setSoundVolume, playSound, sfx } from "./sound";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { API_BASE, parseSmetaFile, uploadChatMedia, offlineQueueCount } from "./api";
import { AnnouncementComposer, AnnouncementContent, AnnouncementPopup, type AnnouncementData } from "./AnnouncementParts";
import { connectSocket, getSocket, disconnectSocket } from "./socket";
import { motion, AnimatePresence } from "motion/react";
import { setSiteLanguage, SiteLang, langLabel } from "./i18n";
import { isTelegramMiniApp, getTelegramInitData, markManualLogout, clearManualLogout, telegramAutoLoginAllowed } from "./telegramWebApp";
import { installAndroidBackHandler, saveOrShareBlob, openExternalUrl, isNative, isTabletOrLarger } from "./platform";
import QrLoginPanel from "./QrLoginPanel";
import { AppDownloadCards } from "./AppDownload";
import { openMediaViewer } from "./MediaViewer";
import { VoicePlayer, VideoPlayer } from "./MediaPlayers";
import { guessExpType } from "./lib/expense";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { Skeleton, SkeletonList, SkeletonPage, SkeletonMessage, SkeletonTable, SkeletonProfile } from "./Skeleton";
import { useGeoTracker, accuracyQuality, QUALITY_COLOR, type GpsStatus } from "./useGeoTracker";
import PullToRefresh from "./PullToRefresh";
import { isPinSet, useAppLock, markActiveNow, clearPin, PinSetupScreen, PinLockScreen, ChangePinModal, ForgotPinScreen, syncPinFromServer, isBiometricEnabled, setBiometricEnabled, biometricAvailable, biometricSupported, tryBiometricUnlock, nativeBiometricSupported, registerWebAuthnBiometric, getLockTimeoutMin, setLockTimeoutMin, LOCK_TIMEOUT_OPTIONS } from "./AppLock";
import type { LandingFocus } from "./LandingPage";
import { Avatar, RoleBadge, SafeImg, fmtVideoDuration, msgReplyPreview, msgTypePreview, roleLabel, useModalPresence, EscClose } from "./App";
import type { AppUser, Group, Msg } from "./App";

// App.tsx'dan ajratilgan — faqat shu sahifa ochilganda yuklanadi (boshlang'ich yuklanish tezroq).
// ─── Chat Page ─────────────────────────────────────────────────────────────────
export default function ChatPage({ currentUser, users, messages, groups, onlineUsers, onSend, onMarkRead, onEdit, onDelete, onPin, onChatOpen, onCreateGroup, onStartCall, onStartVideoChat, canModifyMessages, onGetDevSupport, onRenameGroup, onAddGroupMembers, onRemoveGroupMember, onLeaveGroup, onDeleteGroup }:
  {
    currentUser: AppUser; users: AppUser[]; messages: Msg[];
    groups: Group[]; onlineUsers: string[];
    onSend: (m: Msg) => void; onMarkRead: (id: string) => void;
    onEdit: (id: string, text: string) => void;
    onDelete: (id: string) => void;
    onPin: (id: string) => void;
    onChatOpen: (open: boolean) => void;
    onCreateGroup: (name: string, memberIds: string[]) => Promise<any>;
    onStartCall: (mode: 'voice'|'video', target: { peer?: AppUser; group?: Group }) => void;
    onStartVideoChat: (group: Group) => void;
    canModifyMessages?: boolean;
    onGetDevSupport?: () => Promise<Group|null>;
    onRenameGroup: (groupId: string, name: string) => Promise<void>;
    onAddGroupMembers: (groupId: string, memberIds: string[]) => Promise<void>;
    onRemoveGroupMember: (groupId: string, userId: string) => Promise<void>;
    onLeaveGroup: (groupId: string) => Promise<void>;
    onDeleteGroup: (groupId: string) => Promise<void>;
  }
) {
  const [selUser, setSelUser] = useState<AppUser|null>(null);
  const [selGroup, setSelGroup] = useState<Group|null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [text, setText] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{msgId:string; x:number; y:number}|null>(null);
  const [replyTo, setReplyTo] = useState<Msg|null>(null);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editText, setEditText] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForward, setShowForward] = useState<Msg|null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);

  const mediaRecRef = useRef<MediaRecorder|null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const fileImgRef = useRef<HTMLInputElement>(null);
  const fileAllRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  const { t: tChat } = useTranslation();
  const contacts = users.filter(u => u.id !== currentUser.id);
  const userById = (id: string) => users.find(u => u.id === id);
  const isOnline = (id: string) => onlineUsers.includes(id);

  // Har bir guruh/kontakt uchun oxirgi xabar + o'qilmagan sonini BITTA o'tishda
  // hisoblaymiz. Avval sidebar'dagi HAR BIR qator butun `messages` massivini
  // o'zi alohida filter qilardi (N kontakt × M xabar) — har renderda, hatto
  // shunchaki matn yozayotganda ham — xabar tarixi o'sgani sari sezilarli
  // sekinlashardi ("chat sekin ketyapti").
  const { lastByGroup, lastByUser, unreadByUser } = useMemo(() => {
    const lastByGroup = new Map<string, Msg>();
    const lastByUser = new Map<string, Msg>();
    const unreadByUser = new Map<string, number>();
    for (const m of messages) {
      if (m.deleted) continue;
      if (m.groupId) {
        lastByGroup.set(m.groupId, m);
      } else {
        const other = m.fromUserId === currentUser.id ? m.toUserId : m.fromUserId;
        if (!other) continue;
        lastByUser.set(other, m);
        if (m.toUserId === currentUser.id && !m.read) {
          unreadByUser.set(other, (unreadByUser.get(other) || 0) + 1);
        }
      }
    }
    return { lastByGroup, lastByUser, unreadByUser };
  }, [messages, currentUser.id]);
  const unread = (uid: string) => unreadByUser.get(uid) || 0;

  const thread = useMemo(() => (
    selGroup
      ? messages.filter(m => !m.deleted && m.groupId === selGroup.id)
      : selUser
        ? messages.filter(m =>
            !m.deleted && !m.groupId &&
            ((m.fromUserId===currentUser.id && m.toUserId===selUser.id) ||
             (m.fromUserId===selUser.id && m.toUserId===currentUser.id)))
        : []
  ), [messages, selGroup?.id, selUser?.id, currentUser.id]);
  const pinned = thread.filter(m => m.pinned).slice(-1)[0] ?? null;

  const closeChat = () => { setSelUser(null); setSelGroup(null); setSelectMode(false); setSelected(new Set()); };

  useEffect(() => { onChatOpen(!!(selUser || selGroup)); }, [selUser, selGroup]);
  // Guruh ma'lumoti (a'zolar/nomi) yangilansa yoki guruh o'chirilsa/undan
  // chiqib ketilsa — ochiq suhbat oynasi eskirgan nusxani ko'rsatib
  // qolmasin (masalan boshqa qurilmada nomi o'zgartirilgan bo'lsa).
  useEffect(() => {
    if (!selGroup) return;
    const fresh = groups.find(g => g.id === selGroup.id);
    if (!fresh) { setSelGroup(null); setShowGroupSettings(false); }
    else if (fresh !== selGroup) setSelGroup(fresh);
  }, [groups, selGroup]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (selUser && unread(selUser.id) > 0) onMarkRead(selUser.id);
  }, [thread.length, selUser, selGroup]);

  const doSend = (extras: Partial<Msg> = {}) => {
    if (!selUser && !selGroup) return;
    const msgText = (extras.text !== undefined ? extras.text : text).trim();
    if (!msgText && !extras.mediaUrl && !extras.location) return;
    const msg: Msg = {
      id: `msg${Date.now()}`,
      fromUserId: currentUser.id,
      toUserId: selGroup ? '' : selUser!.id,
      ...(selGroup ? { groupId: selGroup.id } : {}),
      text: msgText,
      timestamp: new Date().toISOString(),
      read: false,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
      ...extras,
    };
    onSend(msg);
    playSound("send");
    setText(""); setReplyTo(null); setShowAttach(false);
  };

  // Media serverga yuklanadi — blob emas, qabul qiluvchi ham ko'radi
  const sendMedia = async (blob: Blob | File, type: NonNullable<Msg['type']>, label: string, filename?: string) => {
    if (!selUser && !selGroup) return;
    try {
      const up = await uploadChatMedia(blob, filename);
      doSend({ type, text: label, mediaUrl: up.url, fileName: up.fileName, fileSize: up.fileSize });
    } catch { toast.error(tChat('chat.uploadFailed')); }
  };

  const startRec = async () => {
    if (!selUser && !selGroup) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendMedia(blob, 'audio', tChat('chat.voiceMessage'), 'voice.webm');
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRecRef.current = mr;
      setIsRecording(true); setRecSec(0);
      timerRef.current = setInterval(() => setRecSec(s => s + 1), 1000);
    } catch { toast.error(tChat('chat.micPermission')); }
  };
  const stopRec = () => {
    mediaRecRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  };
  const cancelRec = () => {
    if (mediaRecRef.current?.state === 'recording') {
      mediaRecRef.current.ondataavailable = null;
      mediaRecRef.current.onstop = null;
      mediaRecRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false); audioChunksRef.current = [];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || (!selUser && !selGroup)) return;
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    sendMedia(file, isImg ? 'image' : isVid ? 'video' : 'file',
      isImg ? tChat('chat.photo') : isVid ? tChat('chat.video') : `📎 ${file.name}`, file.name);
    e.target.value = '';
    setShowAttach(false);
  };

  const sendLocation = () => {
    if (!navigator.geolocation) { toast.error(tChat('chat.geoNotSupported')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => doSend({ type: 'location', text: tChat('chat.locationMessage'), location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => toast.error(tChat('chat.geoPermission'))
    );
    setShowAttach(false);
  };

  const ctxMsg = ctxMenu ? (messages.find(m => m.id === ctxMenu.msgId) ?? null) : null;
  const ctxMine = ctxMsg?.fromUserId === currentUser.id;

  const startLongPress = (msgId: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressRef.current = setTimeout(() => setCtxMenu({ msgId, x: touch.clientX, y: touch.clientY }), 500);
  };
  const endLongPress = () => { if (longPressRef.current) clearTimeout(longPressRef.current); };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const saveEdit = () => {
    if (editingId && editText.trim()) onEdit(editingId, editText.trim());
    setEditingId(null); setEditText("");
  };

  const fmtTime = (sec: number) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
  const fmtSize = (n?: number) => n == null ? '' : n > 1e6 ? `${(n/1e6).toFixed(1)} MB` : `${Math.round(n/1e3)} KB`;
  const findMsg = (id: string) => messages.find(m => m.id === id) ?? null;

  const renderBubble = (m: Msg, mine: boolean) => {
    if (m.deleted) return <p className="italic opacity-50 text-xs">{tChat("chat.deletedMessage")}</p>;
    const replyMsg = m.replyToId ? findMsg(m.replyToId) : null;
    return (
      <>
        {/* Guruhda — yuboruvchi nomi (o'zganiki) */}
        {selGroup && !mine && (
          <p className="text-[11px] font-bold mb-0.5" style={{ color: 'var(--primary)' }}>{userById(m.fromUserId)?.name || tChat('chat.unknownSender')}</p>
        )}
        {replyMsg && (
          <div className={`border-l-2 ${mine?'border-white/50':'border-primary/50'} pl-2 mb-1.5 opacity-75 max-w-full`}>
            <p className="text-[10px] font-semibold">{replyMsg.fromUserId===currentUser.id?tChat('chat.you'):userById(replyMsg.fromUserId)?.name}</p>
            <p className="text-[10px] truncate">{msgReplyPreview(tChat, replyMsg)}</p>
          </div>
        )}
        {m.type==='image' && m.mediaUrl && (
          <SafeImg src={m.mediaUrl as string} alt={tChat('chat.imageAlt')} className="rounded-xl max-w-full max-h-52 object-cover mb-1 cursor-pointer" fallbackClassName="w-40 h-28" onClick={()=>openMediaViewer(m.mediaUrl as string, 'image')}/>
        )}
        {m.type==='video' && m.mediaUrl && (
          <div className="mb-1 w-[260px] max-w-full" onClick={e => e.stopPropagation()}>
            <VideoPlayer src={m.mediaUrl as string} compact className="aspect-video max-h-60" onExpand={() => openMediaViewer(m.mediaUrl as string, 'video')} />
          </div>
        )}
        {m.type==='audio' && m.mediaUrl && (
          <VoicePlayer src={m.mediaUrl} mine={mine}/>
        )}
        {m.type==='file' && m.mediaUrl && (
          // MUHIM: oddiy <a download> boshqa origin (Cloudinary) uchun
          // brauzer tomonidan e'tiborga OLINMAYDI, Android APK'ning WebView'ida
          // esa <a> bosilishi ilova ichida "navigatsiya" qilib, hech qanday
          // yuklab olishsiz sahifani ochib/buzib qo'yishi mumkin edi.
          // openExternalUrl — Android'da tizim brauzeri/yuklab olish
          // menejeriga, web'da yangi tabga to'g'ri yo'naltiradi.
          <button onClick={()=>openExternalUrl(m.mediaUrl!)} className="flex items-center gap-2 mb-1 hover:opacity-75 transition-opacity text-left">
            <MorphIcon icon={FileText} className="w-5 h-5 flex-shrink-0" />
            <div className="min-w-0"><p className="text-xs font-medium truncate max-w-[150px]">{m.fileName}</p><p className="text-[10px] opacity-60">{fmtSize(m.fileSize)}</p></div>
          </button>
        )}
        {m.type==='location' && m.location && (
          <a href={`https://maps.google.com/?q=${m.location.lat},${m.location.lng}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/10 rounded-xl px-3 py-2 mb-1 hover:bg-black/20 transition-colors">
            <MorphIcon icon={MapPin} className="w-4 h-4 text-green-400 flex-shrink-0" />
            <div><p className="text-xs font-medium">{tChat('chat.locationLabel')}</p><p className="text-[10px] opacity-70">{m.location.lat.toFixed(4)}, {m.location.lng.toFixed(4)}</p></div>
          </a>
        )}
        {/* Video chatga taklif — bosilsa TO'G'RIDAN-TO'G'RI o'sha guruhning
            video chatiga qo'shiladi (aniq talab: "taklifni bossa video
            chatga avtomatik o'tadigan bo'lsin"). */}
        {m.type==='video_invite' && (
          <button onClick={() => {
            const g = groups.find(gr => gr.id === m.videoChatGroupId);
            if (!g) { toast.error(tChat('common.notFound')); return; }
            // Havola eskirgan bo'lishi mumkin — avval serverdan holatini so'raymiz.
            const sock = getSocket();
            if (!sock) { onStartVideoChat(g); return; }
            sock.emit('videochat:check', { groupId: g.id }, (r: any) => {
              if (r?.active) { onStartVideoChat(g); return; }
              if (r?.lastEndedAt) {
                const min = Math.max(0, Math.floor((Date.now() - new Date(r.lastEndedAt).getTime()) / 60000));
                const ago = min < 1 ? tChat('call.agoNow') : min < 60 ? tChat('call.agoMin', { count: min }) : min < 1440 ? tChat('call.agoHour', { count: Math.floor(min / 60) }) : tChat('call.agoDay', { count: Math.floor(min / 1440) });
                toast.message(tChat('call.videoChatEndedToast', { ago, duration: fmtVideoDuration(r.lastDurationSec || 0) }));
              } else toast.message(tChat('call.videoChatEndedSimple'));
            });
          }} className="flex items-center gap-2.5 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5 mb-1 hover:bg-green-500/20 liquid-transition text-left w-full">
            <span className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <MorphIcon icon={VideoIcon} className="w-4 h-4 text-green-500" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-green-600 dark:text-green-400">{tChat('call.joinVideoChatBtn')}</p>
              <p className="text-[11px] opacity-70 truncate">{m.text}</p>
            </div>
          </button>
        )}
        {/* XATO TUZATILDI: avval bu tekshiruv m.text'ni QATTIQ KODLANGAN
            o'zbekcha yorliqlar bilan solishtirardi ("🖼️ Rasm" va h.k.) —
            xabar matni endi jo'natuvchining o'sha paytdagi tiliga qarab
            saqlanadi (masalan ruscha "🖼️ Фото"), shu sabab boshqa tilda
            ko'rayotgan qabul qiluvchi uchun solishtiruv mos kelmay, avtomatik
            yorliq rasm/video ostida QAYTA matn sifatida ham chiqib qolardi.
            m.type — til-mustaqil, doim to'g'ri ishlaydi. */}
        {m.text && !(m.type && (['image','video','audio','location','video_invite'] as (string|undefined)[]).includes(m.type)) && (
          <p className="leading-relaxed whitespace-pre-wrap break-words text-sm md:text-xs">{m.text}</p>
        )}
      </>
    );
  };

  return (
    <div className="flex h-full w-full" onClick={() => { setCtxMenu(null); setShowAttach(false); }}>
      <input ref={fileImgRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange}/>
      <input ref={fileAllRef} type="file" accept="*/*" className="hidden" onChange={handleFileChange}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange}/>

      {/* Contacts List */}
      <div className={`${(selUser||selGroup)?'hidden md:flex':'flex'} w-full md:w-64 flex-shrink-0 border-r border-border flex-col bg-card/60 backdrop-blur-xl`}>
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
          <p className="text-base font-bold">{tChat("chat.messages")}</p>
          <button onClick={() => setShowNewGroup(true)} title={tChat('chat.newGroup')} aria-label={tChat('chat.newGroup')} className="btn btn-primary w-8 h-8 p-0 rounded-full"><MorphIcon icon={Users2} className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {/* Guruhlar */}
          {groups.filter(g => !g.devSupport).map(g => {
            const last = lastByGroup.get(g.id);
            const lastText = last ? `${userById(last.fromUserId)?.name?.split(' ')[0] || ''}: ${msgTypePreview(tChat, last)}` : tChat('chat.memberCount', { count: g.memberIds?.length || 0 });
            return (
              <button key={g.id} onClick={() => { setSelGroup(g); setSelUser(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 liquid-transition text-left ${selGroup?.id===g.id?'bg-secondary/60 ring-1 ring-primary/40':''}`}>
                <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {g.avatar ? <img src={g.avatar} className="w-full h-full object-cover"/> : <MorphIcon icon={Users2} className="w-[18px] h-[18px]" />}
                </div>
                <div className="flex-1 min-w-0">
                  {/* XATO TUZATILDI ("bir tomoni ichiga kirip kesilib qolgan"):
                      `truncate` o'zi YETARLI EMAS — flex qatordagi elementning
                      standart min-width'i "auto" (matn uzunligiga teng), shu
                      sabab uzun nom vaqt bilan bir qatorda TORAYIB (shrink)
                      bo'lishdan bosh tortib, butun qatorni sidebar chegarasidan
                      TASHQARIGA chiqarib yuborardi — natijasi esa ota elementning
                      overflow-hidden'i tomonidan "kesilib qolgan" ko'rinish edi.
                      min-w-0 aynan shu qatordagi elementga (nafaqat ota divga)
                      qo'yilishi kerak edi. */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate min-w-0">{g.name}</p>
                    {last && <p className="text-[10px] text-muted-foreground ml-1 flex-shrink-0">{new Date(last.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tashkent"})}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{lastText}</p>
                </div>
              </button>
            );
          })}
          {/* devSupport — ko'rinishi: to'g'ridan-to'g'ri chat (guruh emas) */}
          {groups.filter(g => g.devSupport).map(g => {
            const last = lastByGroup.get(g.id);
            const lastText = last ? msgTypePreview(tChat, last) : tChat('chat.devSupportSubtitle');
            return (
              <button key={g.id} onClick={() => { setSelGroup(g); setSelUser(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 liquid-transition text-left ${selGroup?.id===g.id?'bg-secondary/60 ring-1 ring-primary/40':''}`}>
                <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0 text-xl">🛠</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate min-w-0">{tChat('common.roles.dasturchi')}</p>
                    {last && <p className="text-[10px] text-muted-foreground ml-1 flex-shrink-0">{new Date(last.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tashkent"})}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{lastText}</p>
                </div>
              </button>
            );
          })}
          {/* Dasturchi virtual entry — only for company members who don't yet have devSupport group */}
          {currentUser.role !== 'dasturchi' && currentUser.companyId && onGetDevSupport && !groups.some(g => g.devSupport) && (
            <button onClick={async () => { const g = await onGetDevSupport(); if (g) { setSelGroup(g); setSelUser(null); } }}
              className="w-full flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 liquid-transition text-left">
              <div className="w-10 h-10 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center flex-shrink-0 text-lg">🛠</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{tChat('common.roles.dasturchi')}</p>
                <p className="text-xs text-muted-foreground truncate">{tChat('chat.devSupportSubtitle')}</p>
              </div>
            </button>
          )}
          {contacts.length===0 && groups.length===0 && <p className="text-center text-xs text-muted-foreground py-8">{tChat("chat.noContacts")}</p>}
          {contacts.length===0 && groups.length>0 && <p className="text-center text-xs text-muted-foreground py-4 px-3">{tChat("chat.noOtherUsers")}</p>}
          {contacts.map(u => {
            const last = lastByUser.get(u.id);
            const ur = unread(u.id);
            const lastText = last ? msgTypePreview(tChat, last) : '...';
            return (
              <button key={u.id} onClick={() => { setSelUser(u); setSelGroup(null); setSelectMode(false); setSelected(new Set()); }}
                className={`w-full flex items-center gap-3 mx-2 my-0.5 px-3 py-2.5 rounded-2xl hover:bg-muted/50 liquid-transition text-left ${selUser?.id===u.id?'bg-secondary/60 ring-1 ring-primary/40':''}`}>
                <div className="relative flex-shrink-0">
                  <Avatar user={u} size="md"/>
                  {isOnline(u.id) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-card"/>}
                  {/* XATO TUZATILDI: qattiq kodlangan w-4 h-4 (16px) doira 2+ xonali
                      sonlarni ("12", "99" va h.k.) sig'dira olmay, matn KESILIB
                      qolardi — endi min-w-4 (o'sishga ruxsat) + px-1, va 9dan
                      ko'p bo'lsa "9+" ko'rsatiladi (chat ro'yxatlarida keng
                      qo'llaniladigan konvensiya, doira hech qachon cho'zilib
                      ketmaydi). */}
                  {ur>0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-accent rounded-full text-[9px] text-white flex items-center justify-center font-bold leading-none">{ur > 9 ? '9+' : ur}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate min-w-0">{u.name}</p>
                    {last && <p className="text-[10px] text-muted-foreground ml-1 flex-shrink-0">{new Date(last.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tashkent"})}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{isOnline(u.id) && !last ? "onlayn" : lastText}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail View */}
      <div className={`${!(selUser||selGroup)?'hidden md:flex':'flex'} flex-1 flex-col overflow-hidden bg-background/50`} onClick={e=>e.stopPropagation()}>
        {!(selUser||selGroup) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center animate-pop-in"><MorphIcon icon={MessageCircle} className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="text-sm">{tChat("chat.selectConversation")}</p></div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="glass border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0 z-10">
              <button onClick={closeChat} aria-label="Orqaga" className="md:hidden p-2 -ml-2 mr-1 text-muted-foreground hover:bg-muted rounded-full transition-colors">
                <MorphIcon icon={ChevronLeft} className="w-5 h-5" />
              </button>
              {selGroup ? (
                <button type="button" onClick={() => !selGroup.devSupport && setShowGroupSettings(true)} disabled={selGroup.devSupport} className="flex-shrink-0 disabled:cursor-default">
                  {selGroup.devSupport
                    ? <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0 text-xl">🛠</div>
                    : <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {selGroup.avatar ? <img src={selGroup.avatar} className="w-full h-full object-cover"/> : <MorphIcon icon={Users2} className="w-[18px] h-[18px]" />}
                      </div>}
                </button>
              ) : <div className="relative"><Avatar user={selUser!} size="sm"/>{isOnline(selUser!.id) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-card"/>}</div>}
              <button type="button" onClick={() => selGroup && !selGroup.devSupport && setShowGroupSettings(true)} className="flex-1 min-w-0 text-left" disabled={!selGroup || selGroup.devSupport}>
                <p className="text-sm font-semibold truncate">{selGroup ? (selGroup.devSupport ? tChat('common.roles.dasturchi') : selGroup.name) : selUser!.name}</p>
                {selGroup
                  ? (selGroup.activeVideoChat
                      ? <p className="text-[11px] text-green-600 dark:text-green-400 truncate font-medium">{tChat('chat.videoChatActive', { count: selGroup.activeVideoChat.participantIds?.length ?? 0 })}</p>
                      : <p className="text-[11px] text-muted-foreground truncate">{selGroup.devSupport ? tChat('chat.devSupportSubtitle') : tChat('chat.memberCount', { count: selGroup.memberIds?.length || 0 })}</p>)
                  : <p className="text-[11px] text-muted-foreground">{isOnline(selUser!.id) ? <span className="text-green-800 dark:text-green-400">onlayn</span> : roleLabel(tChat, selUser!.role)}</p>}
              </button>
              {!selectMode && !selGroup?.devSupport && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Guruhda faqat bitta video chat ikonkasi (kamera ixtiyoriy, alohida
                      ovozli qo'ng'iroq kerak emas); 1:1 chatda ikkala tugma qoladi. */}
                  {!selGroup && <button onClick={() => onStartCall('voice', { peer: selUser || undefined })} title={tChat('chat.voiceCall')} aria-label={tChat('chat.voiceCall')} className="btn btn-ghost w-9 h-9 p-0 rounded-full text-primary"><MorphIcon icon={Phone} className="w-[18px] h-[18px]" /></button>}
                  {/* Guruhda — Telegram-ga o'xshash DOIMIY video chat: hech
                      kim chaqirilmaydi, faol bo'lsa yashil nuqta bilan
                      "qo'shilish", aks holda oddiy "boshlash" ko'rinishi. */}
                  {selGroup ? (
                    <button onClick={() => onStartVideoChat(selGroup)}
                      title={selGroup.activeVideoChat ? tChat('chat.videoChatJoin') : tChat('chat.videoCall')}
                      aria-label={selGroup.activeVideoChat ? tChat('chat.videoChatJoin') : tChat('chat.videoCall')}
                      className={`btn w-9 h-9 p-0 rounded-full relative ${selGroup.activeVideoChat ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'btn-ghost text-primary'}`}>
                      <MorphIcon icon={VideoIcon} className="w-[18px] h-[18px]" />
                      {selGroup.activeVideoChat && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse border border-card" />}
                    </button>
                  ) : (
                    <button onClick={() => onStartCall('video', { peer: selUser || undefined })} title={tChat('chat.videoCall')} aria-label={tChat('chat.videoCall')} className="btn btn-ghost w-9 h-9 p-0 rounded-full text-primary"><MorphIcon icon={VideoIcon} className="w-[18px] h-[18px]" /></button>
                  )}
                  {selGroup && <button onClick={() => setShowGroupSettings(true)} title={tChat('groupSettings.title')} aria-label={tChat('groupSettings.title')} className="btn btn-ghost w-9 h-9 p-0 rounded-full text-muted-foreground"><MorphIcon icon={Settings} className="w-[18px] h-[18px]" /></button>}
                </div>
              )}
              {selectMode && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">{tChat('chat.selectedCount', { count: selected.size })}</span>
                  {selected.size>0 && <>
                    <button aria-label={tChat('chat.forward')} onClick={() => { const msg=messages.find(m=>m.id===[...selected][0]); if(msg) setShowForward(msg); }} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><MorphIcon icon={Share2} className="w-4 h-4" /></button>
                    {/* XATO TUZATILDI: o'chirish tugmasi shu yerda (tepadagi
                        tanlash paneli) rolga qaramasdan HAMMAGA ko'rinardi —
                        kontekst-menyudagi yagona-xabar o'chirish allaqachon
                        canModifyMessages bilan to'g'ri cheklangan edi (faqat
                        direktor/orinbosar), lekin shu ko'p-tanlash tugmasi
                        o'sha tekshiruvsiz qolib ketgan edi (aniq xabar
                        qilingan xato). Backend baribir rad etardi, lekin
                        tugmaning o'zi hammaga ko'rinishi noto'g'ri edi. */}
                    {canModifyMessages && (
                      <button aria-label={tChat('chat.deleteSelectedAria')} onClick={() => { selected.forEach(id=>onDelete(id)); setSelectMode(false); setSelected(new Set()); }} className="p-2 hover:bg-red-500/100/10 rounded-full text-red-500"><MorphIcon icon={Trash2} className="w-4 h-4" /></button>
                    )}
                  </>}
                  <button aria-label={tChat('chat.cancelSelectAria')} onClick={() => { setSelectMode(false); setSelected(new Set()); }} className="p-2 hover:bg-muted rounded-full text-muted-foreground"><MorphIcon icon={X} className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            {/* Pinned */}
            {pinned && (
              <div className="bg-primary/5 border-b border-primary/10 px-4 py-2 flex items-center gap-2">
                <div className="w-0.5 h-7 bg-primary rounded-full flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-primary">📌 {tChat("chat.pinnedMessage")}</p>
                  <p className="text-xs text-muted-foreground truncate">{msgReplyPreview(tChat, pinned)}</p>
                </div>
                <button aria-label={tChat('chat.closePinnedAria')} onClick={()=>onPin(pinned.id)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><MorphIcon icon={X} className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scrollbar-hide relative" onClick={()=>{setCtxMenu(null);setShowAttach(false);}}>
              <div className="min-h-full flex flex-col justify-end gap-1.5 max-w-3xl mx-auto w-full p-3">
              {thread.length===0 && <div className="text-center py-8 text-muted-foreground text-sm">Xabar yo'q. Birinchi bo'ling!</div>}
              {thread.map(m => {
                if (m.type === 'video_event') {
                  const ev = m.videoEvent;
                  const label = ev?.kind === 'ended'
                    ? tChat('call.videoChatEventEnded', { duration: fmtVideoDuration(ev.durationSec || 0) })
                    : tChat('call.videoChatEventStarted', { name: ev?.by || '' });
                  return (
                    <div key={m.id} className="flex justify-center my-1">
                      <span className="text-[11px] text-muted-foreground bg-muted/60 border border-border/50 rounded-full px-3 py-1">{label} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  );
                }
                const mine = m.fromUserId===currentUser.id;
                const isSel = selected.has(m.id);
                return (
                  <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'} ${selectMode?'pl-8 relative':''}`}
                    onClick={e=>{e.stopPropagation();if(selectMode)toggleSelect(m.id);}}>
                    {selectMode && (
                      <div className={`absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all ${isSel?'bg-primary border-primary':'bg-card border-border'}`}
                        onClick={e=>{e.stopPropagation();toggleSelect(m.id);}}>
                        {isSel && <MorphIcon icon={Check} className="w-3 h-3 text-white" />}
                      </div>
                    )}
                    <div
                      onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!selectMode)setCtxMenu({msgId:m.id,x:e.clientX,y:e.clientY});}}
                      onTouchStart={e=>{if(!selectMode)startLongPress(m.id,e);}}
                      onTouchEnd={endLongPress} onTouchMove={endLongPress}
                      className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm cursor-pointer liquid-transition
                        ${mine?'bg-gradient-to-br from-primary to-primary/90 text-white rounded-br-sm':'bg-card/90 backdrop-blur-md border border-white/20 rounded-bl-sm'}
                        ${isSel?'ring-2 ring-primary ring-offset-1':''}
                        ${m.pinned?'ring-1 ring-amber-400/50':''}`}
                    >
                      {renderBubble(m, mine)}
                      <div className={`flex items-center justify-end gap-1 mt-1 ${mine?'text-white/60':'text-muted-foreground'}`}>
                        {m.status === 'failed' && (
                          <button
                            onClick={e => { e.stopPropagation(); const { status, ...retry } = m; onSend(retry as Msg); }}
                            className="flex items-center gap-1 text-[9px] text-red-300 hover:text-red-200 underline"
                            aria-label={tChat('chat.retrySend')}>
                            <MorphIcon icon={AlertCircle} className="w-3 h-3" />{tChat('chat.retrySend')}
                          </button>
                        )}
                        {m.edited && <span className="text-[9px] italic">{tChat("chat.editedLabel")}</span>}
                        {m.pinned && <span className="text-[9px]">📌</span>}
                        <span className="text-[9px]">{new Date(m.timestamp).toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tashkent"})}</span>
                        {mine && (
                          m.status === 'sending' ? <MorphIcon icon={Loader2} className="w-3 h-3 animate-spin" /> :
                          m.status === 'failed' ? null :
                          <MorphIcon icon={m.read ? CheckCheck : Check} className={m.read ? "w-3.5 h-3.5" : "w-3 h-3"} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef}/>
              </div>

              {/* Context Menu — document.body'ga portal qilinadi, chunki bu sahifa
                  `.page-enter` animatsiyasi ichida (will-change: transform) joylashgan
                  va CSS spec bo'yicha will-change:transform ham position:fixed uchun
                  YANGI containing block yaratadi — natijada menyu haqiqiy viewport'ga
                  emas, shu animatsiyalangan ota-elementga nisbatan joylashib, telefon
                  va noutbukda "kesilib qolgan"/joyidan siljigan holatda ko'rinardi. */}
              {ctxMenu && ctxMsg && createPortal(
                (() => {
                  const canEdit = canModifyMessages && !ctxMsg.deleted;
                  const rows = 4 + (canEdit ? 1 : 0) + (canModifyMessages ? 1 : 0);
                  const menuW = 176;
                  const menuH = rows * 36 + 12 + (canModifyMessages ? 9 : 0);
                  const vw = window.innerWidth, vh = window.innerHeight;
                  const left = Math.min(Math.max(8, ctxMenu.x), vw - menuW - 8);
                  const top = Math.min(Math.max(8, ctxMenu.y), vh - menuH - 8);
                  const itemCls = "flex items-center gap-2.5 px-3 py-2 hover:bg-primary/10 hover:text-primary rounded-lg cursor-pointer text-xs text-foreground/85 transition-colors";
                  return (
                    <>
                    {/* XATO TUZATILDI: avval faqat xabarlar ro'yxati konteyneri
                        o'zining onClick'ida menyuni yopardi — sarlavha, pastki
                        navigatsiya, xabar yozish maydoni kabi BOSHQA joylarga
                        tegilsa menyu OCHIQ qolib ketardi (aniq xabar qilingan
                        xato). Endi butun ekranni qoplaydigan, menyudan pastroq
                        z-index'dagi "orqa fon" — QAYERGA tegilsa ham (menyuning
                        o'zidan tashqari — u o'z ichida stopPropagation qiladi)
                        menyu yopiladi. */}
                    <div className="fixed inset-0 z-[69]" onClick={()=>setCtxMenu(null)}/>
                    <div className="fixed z-[70] w-44 glass p-1.5 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-pop-in"
                      style={{ top, left }}
                      onClick={e=>e.stopPropagation()}>
                      <div onClick={()=>{setReplyTo(ctxMsg);setCtxMenu(null);}} className={itemCls}><MorphIcon icon={CornerDownLeft} className="w-3.5 h-3.5" />{tChat('chat.reply')}</div>
                      {canEdit && (
                        <div onClick={()=>{setEditingId(ctxMsg.id);setEditText(ctxMsg.text);setCtxMenu(null);}} className={itemCls}><MorphIcon icon={Edit} className="w-3.5 h-3.5" />{tChat('chat.edit')}</div>
                      )}
                      <div onClick={()=>{onPin(ctxMsg.id);setCtxMenu(null);}} className={itemCls}>
                        <MorphIcon icon={ctxMsg.pinned ? PinOff : Pin} className="w-3.5 h-3.5" />{ctxMsg.pinned?tChat('chat.unpin'):tChat('chat.pin')}
                      </div>
                      <div onClick={()=>{setShowForward(ctxMsg);setCtxMenu(null);}} className={itemCls}><MorphIcon icon={Share2} className="w-3.5 h-3.5" />{tChat('chat.forward')}</div>
                      <div onClick={()=>{setSelectMode(true);setSelected(new Set([ctxMsg.id]));setCtxMenu(null);}} className={itemCls}><MorphIcon icon={SquareCheck} className="w-3.5 h-3.5" />{tChat('chat.select')}</div>
                      {canModifyMessages && (
                        <>
                          <div className="h-px bg-border/60 my-0.5"/>
                          <div onClick={()=>{onDelete(ctxMsg.id);setCtxMenu(null);}} className="flex items-center gap-2.5 px-3 py-2 hover:bg-red-500/10 text-red-500 rounded-lg cursor-pointer text-xs transition-colors"><MorphIcon icon={Trash2} className="w-3.5 h-3.5" />{tChat('chat.delete')}</div>
                        </>
                      )}
                    </div>
                    </>
                  );
                })(),
                document.body
              )}
            </div>

            {/* Reply preview */}
            {replyTo && !editingId && (
              <div className="flex items-center gap-2 bg-muted/60 px-4 py-2 border-t border-border/30 flex-shrink-0">
                <div className="w-0.5 h-7 bg-primary rounded-full flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-primary">{replyTo.fromUserId===currentUser.id?tChat('chat.you'):userById(replyTo.fromUserId)?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{msgReplyPreview(tChat, replyTo)}</p>
                </div>
                <button aria-label={tChat('chat.cancelReplyAria')} onClick={()=>setReplyTo(null)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><MorphIcon icon={X} className="w-4 h-4" /></button>
              </div>
            )}

            {/* Edit preview */}
            {editingId && (
              <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 border-t border-amber-500/25 flex-shrink-0">
                <MorphIcon icon={Edit} className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-400">{tChat('chat.edit')}</p>
                  <p className="text-xs text-muted-foreground truncate">{messages.find(m=>m.id===editingId)?.text}</p>
                </div>
                <button aria-label={tChat('chat.cancelEditAria')} onClick={()=>{setEditingId(null);setEditText("");}} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0"><MorphIcon icon={X} className="w-4 h-4" /></button>
              </div>
            )}

            {/* Input — suzuvchi kapsula (sayt bo'ylab bir xil "pill" tili) */}
            {!selectMode && (
              <div className="px-3 flex-shrink-0 relative" style={{ paddingTop: '0.5rem', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }} onClick={e=>e.stopPropagation()}>
                {showAttach && (
                  <>
                  {/* Xuddi kontekst-menyudagi kabi — ekranning istalgan boshqa
                      joyiga (shu jumladan shu input maydonining o'zi, oldin
                      stopPropagation qilib chetlab o'tardi) tegilsa yopilsin. */}
                  <div className="fixed inset-0 z-40" onClick={()=>setShowAttach(false)}/>
                  <div className="absolute bottom-[4.5rem] left-3 glass p-2 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-slide-up-fade z-50 min-w-[190px]" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>fileImgRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><MorphIcon icon={ImageIcon} className="w-4 h-4 text-blue-500" />{tChat('chat.attachImage')}</button>
                    <button onClick={()=>camRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><MorphIcon icon={Camera} className="w-4 h-4 text-rose-500" />{tChat('chat.attachCamera')}</button>
                    <button onClick={()=>fileAllRef.current?.click()} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><MorphIcon icon={FileText} className="w-4 h-4 text-orange-500" />{tChat('chat.attachFile')}</button>
                    <button onClick={sendLocation} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-sm"><MorphIcon icon={MapPin} className="w-4 h-4 text-green-500" />{tChat('chat.attachLocation')}</button>
                  </div>
                  </>
                )}
                <div className="nav-pill-desktop flex gap-1.5 items-end rounded-2xl px-2 py-1.5 max-w-3xl mx-auto">
                  {isRecording ? (
                    <div className="flex-1 flex items-center gap-3 px-3 py-2.5">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>
                      <span className="text-sm font-mono text-red-500">{fmtTime(recSec)}</span>
                      <span className="text-xs text-red-400/80 flex-1">{tChat('chat.recording')}</span>
                    </div>
                  ) : (
                    <div className="flex-1 relative flex items-end">
                      <button onClick={()=>setShowAttach(!showAttach)} aria-label="Biriktirish"
                        className="absolute left-2 bottom-2 w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-white/10 transition-colors flex-shrink-0 z-10">
                        <MorphIcon icon={Paperclip} className="w-4 h-4" />
                      </button>
                      <textarea rows={1}
                        className="w-full resize-none text-sm bg-transparent focus:outline-none max-h-28 overflow-y-auto leading-relaxed pl-9 pr-3 py-2.5"
                        placeholder={tChat('chat.inputPlaceholder')}
                        value={editingId ? editText : text}
                        onChange={e=>{if(editingId)setEditText(e.target.value);else setText(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,112)+'px';}}
                        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(editingId)saveEdit();else doSend();}}}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0 pb-1">
                    {isRecording ? (
                      <>
                        <button aria-label={tChat('chat.cancelRecordingAria')} onClick={cancelRec} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-white/10 rounded-full transition-colors"><MorphIcon icon={X} className="w-4 h-4" /></button>
                        <button aria-label={tChat('chat.sendVoiceAria')} onClick={stopRec} className="w-9 h-9 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-full flex items-center justify-center active:scale-95 liquid-transition shadow-md shadow-red-500/30"><MorphIcon icon={Send} className="w-4 h-4 ml-0.5" /></button>
                      </>
                    ) : (editingId ? editText : text).trim() ? (
                      <button aria-label={tChat('chat.sendMessageAria')} onClick={()=>{if(editingId)saveEdit();else doSend();}} className="w-9 h-9 bg-gradient-to-br from-primary to-primary/80 text-white rounded-full flex items-center justify-center active:scale-95 liquid-transition shadow-md shadow-primary/30"><MorphIcon icon={Send} className="w-4 h-4 ml-0.5" /></button>
                    ) : (
                      <button aria-label={tChat('chat.recordVoiceAria')} onClick={startRec} className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-white/10 rounded-full transition-colors"><MorphIcon icon={Mic} className="w-5 h-5" /></button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Forward dialog */}
      {showForward && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={()=>setShowForward(null)}>
          <div className="glass-modal rounded-t-3xl sm:rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm">{tChat('chat.forwardTo')}</h3>
              <button aria-label={tChat('common.close')} onClick={()=>setShowForward(null)} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-hide">
              {contacts.map(u => (
                <button key={u.id} onClick={()=>{
                  onSend({id:`msg${Date.now()}`,fromUserId:currentUser.id,toUserId:u.id,text:showForward!.text,timestamp:new Date().toISOString(),read:false,type:showForward!.type,mediaUrl:showForward!.mediaUrl,fileName:showForward!.fileName,location:showForward!.location});
                  setShowForward(null);
                }} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/40 rounded-xl transition-colors text-left">
                  <Avatar user={u} size="sm"/>
                  <div><p className="text-sm font-medium">{u.name}</p><RoleBadge role={u.role}/></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Yangi guruh yaratish */}
      {showNewGroup && (
        <GroupCreateModal contacts={contacts} onClose={() => setShowNewGroup(false)}
          onCreate={async (name, ids) => { const g = await onCreateGroup(name, ids); setShowNewGroup(false); if (g) { setSelGroup(g); setSelUser(null); } }}/>
      )}

      {/* Guruh sozlamalari (a'zolar, nomi, chiqish/o'chirish) */}
      {showGroupSettings && selGroup && (
        <GroupSettingsModal group={selGroup} users={users} currentUser={currentUser} contacts={contacts}
          onClose={() => setShowGroupSettings(false)}
          onRename={name => onRenameGroup(selGroup.id, name)}
          onAddMembers={ids => onAddGroupMembers(selGroup.id, ids)}
          onRemoveMember={uid => onRemoveGroupMember(selGroup.id, uid)}
          onLeave={async () => { await onLeaveGroup(selGroup.id); setShowGroupSettings(false); closeChat(); }}
          onDelete={async () => { await onDeleteGroup(selGroup.id); setShowGroupSettings(false); closeChat(); }}
        />
      )}
    </div>
  );
}

// ─── Guruh sozlamalari modal ────────────────────────────────────────────────────
function GroupSettingsModal({ group, users, currentUser, contacts, onClose, onRename, onAddMembers, onRemoveMember, onLeave, onDelete }: {
  group: Group; users: AppUser[]; currentUser: AppUser; contacts: AppUser[]; onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onAddMembers: (memberIds: string[]) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onLeave: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  useModalPresence();
  const isGroupAdmin = (group.adminIds || []).includes(currentUser.id);
  const isCreator = String(group.createdBy) === String(currentUser.id);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(group.name);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [busy, setBusy] = useState(false);
  const memberUsers = (group.memberIds || []).map(id => users.find(u => u.id === id)).filter(Boolean) as AppUser[];
  const nonMembers = contacts.filter(u => !(group.memberIds || []).includes(u.id));

  const saveName = async () => {
    if (!name.trim() || name.trim() === group.name) { setEditingName(false); return; }
    setBusy(true);
    try { await onRename(name.trim()); } finally { setBusy(false); setEditingName(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" >
      <EscClose onClose={onClose} />
      <div className="glass-modal rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade max-h-[80vh] overflow-y-auto scrollbar-hide" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Users2} className="w-4 h-4 text-primary" />{t('groupSettings.title')}</h3>
          <button aria-label={t('groupCreate.close')} onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>

        {editingName ? (
          <div className="flex items-center gap-2 mb-4">
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" />
            <button onClick={saveName} disabled={busy} className="btn btn-primary px-3 py-2 text-xs disabled:opacity-50">{t('common.save')}</button>
          </div>
        ) : (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold truncate">{group.name}</p>
            {isGroupAdmin && (
              <button onClick={() => setEditingName(true)} aria-label={t('groupSettings.rename')} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full">
                <MorphIcon icon={Edit} className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('groupSettings.members', { count: memberUsers.length })}</p>
          {isGroupAdmin && nonMembers.length > 0 && (
            <button onClick={() => setShowAddMembers(v => !v)} className="text-xs font-semibold text-primary hover:underline">{t('groupSettings.addMembers')}</button>
          )}
        </div>

        {showAddMembers && (
          <AddGroupMembersInline contacts={nonMembers} onAdd={async ids => { setBusy(true); try { await onAddMembers(ids); } finally { setBusy(false); setShowAddMembers(false); } }} />
        )}

        <div className="space-y-1 mb-4">
          {memberUsers.map(u => (
            <div key={u.id} className="flex items-center gap-2.5 px-1 py-1.5">
              <Avatar user={u} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{u.name}{u.id === currentUser.id ? ` (${t('chat.you')})` : ''}</p>
                {(group.adminIds || []).includes(u.id) && <p className="text-[10px] text-primary font-semibold">{t('groupSettings.adminBadge')}</p>}
              </div>
              {isGroupAdmin && u.id !== currentUser.id && (
                <button onClick={() => onRemoveMember(u.id)} aria-label={t('groupSettings.removeMember')} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full">
                  <MorphIcon icon={X} className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-3 border-t border-border/50">
          <button onClick={onLeave} className="w-full text-sm font-semibold text-amber-600 hover:bg-amber-500/10 rounded-xl py-2.5">{t('groupSettings.leaveGroup')}</button>
          {isCreator && (
            <button onClick={() => { if (window.confirm(t('groupSettings.confirmDelete') as string)) onDelete(); }}
              className="w-full text-sm font-semibold text-destructive hover:bg-destructive/10 rounded-xl py-2.5">{t('groupSettings.deleteGroup')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddGroupMembersInline({ contacts, onAdd }: { contacts: AppUser[]; onAdd: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  return (
    <div className="bg-muted/30 rounded-xl p-2 mb-3 space-y-1 max-h-40 overflow-y-auto scrollbar-hide">
      {contacts.map(u => (
        <button key={u.id} type="button" onClick={() => toggle(u.id)}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left ${sel.has(u.id) ? 'bg-primary/10' : 'hover:bg-muted/50'}`}>
          <Avatar user={u} size="sm" />
          <p className="text-sm flex-1 truncate">{u.name}</p>
          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sel.has(u.id) ? 'bg-primary border-primary' : 'border-border'}`}>{sel.has(u.id) && <MorphIcon icon={Check} className="w-2.5 h-2.5 text-white" />}</div>
        </button>
      ))}
      <button disabled={sel.size === 0} onClick={() => onAdd(Array.from(sel))} className="btn btn-primary w-full py-2 text-xs mt-1 disabled:opacity-40">{t('groupSettings.addSelected', { count: sel.size })}</button>
    </div>
  );
}

// ─── Yangi guruh modal ──────────────────────────────────────────────────────────
function GroupCreateModal({ contacts, onClose, onCreate }:
  { contacts: AppUser[]; onClose: () => void; onCreate: (name: string, memberIds: string[]) => void }) {
  const { t } = useTranslation();
  useModalPresence();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const toggle = (id: string) => setSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const filtered = contacts.filter(u => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" >
      <EscClose onClose={onClose} />
      <div className="glass-modal rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-2"><MorphIcon icon={Users2} className="w-4 h-4 text-primary" />{t('groupCreate.title')}</h3>
          <button aria-label={t('groupCreate.close')} onClick={onClose} className="p-1.5 hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
        </div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder={t('groupCreate.namePlaceholder')} autoFocus
          className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-input-background focus:outline-none mb-2"/>
        <div className="relative mb-2">
          <MorphIcon icon={Search} className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder={t('groupCreate.searchPlaceholder')} className="w-full text-sm border border-border rounded-lg pl-9 pr-3 py-2 bg-input-background focus:outline-none"/>
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto scrollbar-hide mb-3">
          {filtered.map(u => (
            <button key={u.id} type="button" onClick={()=>toggle(u.id)}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors text-left ${sel.has(u.id)?'bg-primary/10':'hover:bg-muted/40'}`}>
              <Avatar user={u} size="sm"/>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{u.name}</p></div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${sel.has(u.id)?'bg-primary border-primary':'border-border'}`}>{sel.has(u.id) && <MorphIcon icon={Check} className="w-3 h-3 text-white" />}</div>
            </button>
          ))}
        </div>
        <button disabled={!name.trim() || sel.size===0} onClick={()=>onCreate(name.trim(), Array.from(sel))}
          className="btn btn-primary w-full py-2.5 disabled:opacity-40">{t('groupCreate.submit', { count: sel.size })}</button>
      </div>
    </div>
  );
}

