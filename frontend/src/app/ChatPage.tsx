import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import { IconTile } from "./components/IconTile";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import ChevronLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import VideoIcon from "@hugeicons/core-free-icons/Video01Icon";
import CornerDownLeft from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import Share2 from "@hugeicons/core-free-icons/Share01Icon";
import SquareCheck from "@hugeicons/core-free-icons/CheckmarkSquare01Icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import CopyIcon from "@hugeicons/core-free-icons/Copy01Icon";
import Pin from "@hugeicons/core-free-icons/PinIcon";
import PinOff from "@hugeicons/core-free-icons/PinOffIcon";
import MessageCircle from "@hugeicons/core-free-icons/Message01Icon";
import { playSound } from "./sound";
import { API_BASE, uploadChatMedia } from "./api";
import { RoleBadge, Avatar, msgReplyPreview, roleLabel, EscClose } from "./App";
import type { AppUser, Group, Msg } from "./App";
import { AiChatThread } from "./aiVoice/chat/AiChatContact";
import AiGroupButton from "./aiVoice/chat/AiGroupButton";
import { aiGroupAfterSend, aiSenderUser } from "./aiVoice/chat/aiGroup";
import { ChatList } from "./chat/ChatList";
import { ChatAvatar } from "./chat/ChatAvatar";
import { Composer, useKeyboardInset, type AttachKind } from "./chat/Composer";
import { MessageList } from "./chat/MessageList";
import { GroupCreateModal, GroupSettingsModal } from "./chat/GroupModals";
import { useChatPrefs } from "./chat/chatPrefs";
import { loadCustomWallpaper, wallpaperStyle } from "./chat/wallpaper";
import { buildEntries, groupKey, isDmUnread, isGroupUnread, userKey, type ChatEntry } from "./chat/chatModel";

// App.tsx'dan ajratilgan — faqat shu sahifa ochilganda yuklanadi (boshlang'ich yuklanish tezroq).
// Ro'yxat (jildlar, qidiruv, sozlamalar) — chat/ChatList; xabarlar — chat/MessageList; yozish — chat/Composer.
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
  // Chatdagi AI yordamchi kontakti (aiVoice/chat) — boshqa suhbat tanlansa yopiladi
  const [aiOpen, setAiOpen] = useState(false);
  useEffect(() => { if (selUser || selGroup) setAiOpen(false); }, [selUser, selGroup]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [text, setText] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{msgId:string; x:number; y:number}|null>(null);
  const [replyTo, setReplyTo] = useState<Msg|null>(null);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editText, setEditText] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForward, setShowForward] = useState<Msg|null>(null);
  const [firstUnread, setFirstUnread] = useState<{ key: string; id: string } | null>(null);
  const draftsRef = useRef<Map<string, string>>(new Map()); // har bir suhbat uchun yozilgan qoralama

  const fileImgRef = useRef<HTMLInputElement>(null);
  const fileAllRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const { t: tChat } = useTranslation();
  const [prefs, updatePrefs] = useChatPrefs(currentUser.id);
  const wallpaperCss = useMemo(
    () => wallpaperStyle(prefs.wallpaper, prefs.wallpaper === "custom" ? loadCustomWallpaper(currentUser.id) : null),
    [prefs.wallpaper, prefs.wallpaperRev, currentUser.id],
  );
  const keyboardInset = useKeyboardInset();
  const contacts = useMemo(() => users.filter(u => u.id !== currentUser.id), [users, currentUser.id]);
  const userById = useCallback((id: string) => users.find(u => u.id === id) || (aiSenderUser(id) as AppUser | undefined), [users]);
  const onlineSet = useMemo(() => new Set(onlineUsers), [onlineUsers]);
  const isOnline = (id: string) => onlineSet.has(id);

  // Barcha suhbatlar + o'qilmaganlar — BITTA o'tishda (chat/chatModel.buildEntries)
  const entries = useMemo(() => buildEntries({
    me: currentUser, users, groups, messages,
    groupSeen: prefs.groupSeen, baseline: prefs.baseline, readAllAt: prefs.readAllAt,
    supportName: tChat('common.roles.dasturchi'),
  }), [currentUser, users, groups, messages, prefs.groupSeen, prefs.baseline, prefs.readAllAt, tChat]);
  const entryByKey = useMemo(() => new Map(entries.map(e => [e.key, e])), [entries]);

  const selectedKey = selGroup ? groupKey(selGroup.id) : selUser ? userKey(selUser.id) : null;
  const selEntry = selectedKey ? entryByKey.get(selectedKey) : undefined;

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

  const resetThreadUi = () => { setSelectMode(false); setSelected(new Set()); setReplyTo(null); setEditingId(null); setEditText(""); setCtxMenu(null); };
  // Suhbat almashganda — qoralama saqlanadi/tiklanadi (Telegram kabi)
  const switchDraft = (nextKey: string | null) => {
    if (selectedKey) { if (text.trim()) draftsRef.current.set(selectedKey, text); else draftsRef.current.delete(selectedKey); }
    setText(nextKey ? draftsRef.current.get(nextKey) || "" : "");
  };
  const closeChat = () => { switchDraft(null); setSelUser(null); setSelGroup(null); resetThreadUi(); };

  // "Yangi xabarlar" chizig'i — ochilish paytidagi birinchi o'qilmagan xabar
  const computeFirstUnread = (key: string): string | null => {
    const seen = Math.max(prefs.groupSeen[key.slice(2)] || 0, prefs.baseline, prefs.readAllAt);
    const isG = key.startsWith('g:');
    const id = key.slice(2);
    const m = messages.find(x => isG
      ? x.groupId === id && isGroupUnread(x, currentUser.id, seen)
      : !x.groupId && x.fromUserId === id && isDmUnread(x, currentUser.id, prefs.readAllAt));
    return m?.id ?? null;
  };

  const openEntry = (e: ChatEntry) => {
    if (e.key === selectedKey) return;
    switchDraft(e.key);
    resetThreadUi();
    const fu = e.unread > 0 ? computeFirstUnread(e.key) : null;
    setFirstUnread(fu ? { key: e.key, id: fu } : null);
    if (e.group) { setSelGroup(e.group); setSelUser(null); }
    else if (e.user) { setSelUser(e.user); setSelGroup(null); }
  };
  const openGroup = (g: Group) => { switchDraft(groupKey(g.id)); resetThreadUi(); setFirstUnread(null); setSelGroup(g); setSelUser(null); };

  useEffect(() => { onChatOpen(!!(selUser || selGroup || aiOpen)); }, [selUser, selGroup, aiOpen]);
  // Refreshda ochiq suhbat qayta ochiladi (owner 2026-10-19: "qayerda bo'lsa o'sha joyda tursin")
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      const v = selGroup ? `g:${selGroup.id}` : selUser ? `u:${selUser.id}` : "";
      if (v) sessionStorage.setItem("erp_ui:chat.open", v); else sessionStorage.removeItem("erp_ui:chat.open");
    } catch { /* */ }
  }, [selUser, selGroup]);
  useEffect(() => {
    if (restoredRef.current) return;
    let want = "";
    try { want = sessionStorage.getItem("erp_ui:chat.open") || ""; } catch { /* */ }
    if (!want) { restoredRef.current = true; return; }
    const id = want.slice(2);
    if (want.startsWith("g:")) {
      const g = groups.find((x) => x.id === id);
      if (g) { restoredRef.current = true; openGroup(g); }
    } else {
      const u = users.find((x) => x.id === id);
      if (u) { restoredRef.current = true; switchDraft(want); resetThreadUi(); setSelUser(u); setSelGroup(null); }
    }
    // Ro'yxatlar keldi, lekin suhbat endi yo'q — tiklashdan voz kechamiz (keyingi tanlovlar saqlanaversin)
    if (!restoredRef.current && users.length && groups.length) restoredRef.current = true;
    // Ro'yxatlar hali kelmagan bo'lishi mumkin — kelganda qayta urinadi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, users]);
  // Guruh ma'lumoti yangilansa yoki guruh o'chirilsa/undan chiqilsa — ochiq oyna eskirgan nusxani ko'rsatmasin
  useEffect(() => {
    if (!selGroup) return;
    const fresh = groups.find(g => g.id === selGroup.id);
    if (!fresh) { setSelGroup(null); setShowGroupSettings(false); }
    else if (fresh !== selGroup) setSelGroup(fresh);
  }, [groups, selGroup]);

  // Ochiq suhbat o'qildi: DM — serverga (read-receipt), guruh — shu qurilmada "oxirgi ko'rilgan" vaqt
  const markGroupSeen = useCallback((gid: string, upTo?: number) => {
    const at = Math.max(Date.now(), upTo || 0);
    updatePrefs(p => ({ ...p, groupSeen: { ...p.groupSeen, [gid]: at } }));
  }, [updatePrefs]);
  useEffect(() => {
    if (!selEntry || selEntry.unread === 0) return;
    if (selEntry.kind === 'dm' && selEntry.user) onMarkRead(selEntry.user.id);
    else if (selEntry.group) markGroupSeen(selEntry.group.id, selEntry.lastTs);
  }, [selEntry?.key, selEntry?.unread]);

  const markChatRead = (e: ChatEntry) => {
    if (e.kind === 'dm' && e.user) onMarkRead(e.user.id);
    else if (e.group) markGroupSeen(e.group.id, e.lastTs);
  };

  // "Hammasini o'qildi qilish" — bitta so'rov (POST /api/messages/read-all); eski server bo'lsa — har bir suhbat bo'yicha
  const markAllRead = async () => {
    const unreadDms = entries.filter(e => e.kind === 'dm' && e.unread > 0 && e.user).map(e => e.user!.id);
    const total = entries.reduce((n, e) => n + e.unread, 0);
    if (!total) { toast.message(tChat('chatUi.markAllReadNothing')); return; }
    const now = Date.now();
    updatePrefs(p => ({ ...p, readAllAt: now }));
    toast.success(tChat('chatUi.markAllReadDone'));
    if (!unreadDms.length) return;
    try {
      const r = await fetch(`${API_BASE}/api/messages/read-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      unreadDms.forEach(id => onMarkRead(id));
    }
  };

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
    if (selGroup) aiGroupAfterSend(selGroup.id, msg, replyTo); // guruhdagi AI (@AI / AI xabariga javob)
    playSound("send");
    if (extras.text === undefined) setText("");
    setReplyTo(null);
    if (selectedKey) draftsRef.current.delete(selectedKey);
  };

  // Media serverga yuklanadi — blob emas, qabul qiluvchi ham ko'radi
  const sendMedia = async (blob: Blob | File, type: NonNullable<Msg['type']>, label: string, filename?: string) => {
    if (!selUser && !selGroup) return;
    try {
      const up = await uploadChatMedia(blob, filename);
      doSend({ type, text: label, mediaUrl: up.url, fileName: up.fileName, fileSize: up.fileSize });
    } catch { toast.error(tChat('chat.uploadFailed')); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || (!selUser && !selGroup)) return;
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');
    sendMedia(file, isImg ? 'image' : isVid ? 'video' : 'file',
      isImg ? tChat('chat.photo') : isVid ? tChat('chat.video') : `📎 ${file.name}`, file.name);
    e.target.value = '';
  };

  const sendLocation = () => {
    if (!navigator.geolocation) { toast.error(tChat('chat.geoNotSupported')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => doSend({ type: 'location', text: tChat('chat.locationMessage'), location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      () => toast.error(tChat('chat.geoPermission'))
    );
  };
  const onAttach = (k: AttachKind) => {
    if (k === 'image') fileImgRef.current?.click();
    else if (k === 'camera') camRef.current?.click();
    else if (k === 'file') fileAllRef.current?.click();
    else sendLocation();
  };

  const ctxMsg = ctxMenu ? (messages.find(m => m.id === ctxMenu.msgId) ?? null) : null;

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const saveEdit = () => {
    if (editingId && editText.trim()) onEdit(editingId, editText.trim());
    setEditingId(null); setEditText("");
  };
  const findMsg = useCallback((id: string) => messages.find(m => m.id === id) ?? null, [messages]);

  const threadOpen = !!(selUser || selGroup);
  const headerTitle = selGroup ? (selGroup.devSupport ? tChat('common.roles.dasturchi') : selGroup.name) : selUser?.name || '';

  const banner = replyTo && !editingId ? (
    <div className="flex items-center gap-3 bg-card/95 backdrop-blur px-4 py-2 border-t border-border/60">
      <MorphIcon icon={CornerDownLeft} className="w-5 h-5 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
        <p className="text-[12px] font-semibold text-primary truncate">{replyTo.fromUserId===currentUser.id?tChat('chat.you'):userById(replyTo.fromUserId)?.name}</p>
        <p className="text-[12px] text-muted-foreground truncate">{msgReplyPreview(tChat, replyTo)}</p>
      </div>
      <button aria-label={tChat('chat.cancelReplyAria')} onClick={()=>setReplyTo(null)} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted rounded-full flex-shrink-0"><MorphIcon icon={X} className="w-4 h-4" /></button>
    </div>
  ) : editingId ? (
    <div className="flex items-center gap-3 bg-card/95 backdrop-blur px-4 py-2 border-t border-border/60">
      <MorphIcon icon={Edit} className="w-5 h-5 text-amber-600 flex-shrink-0" />
      <div className="flex-1 min-w-0 border-l-2 border-amber-500 pl-2">
        <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">{tChat('chat.edit')}</p>
        <p className="text-[12px] text-muted-foreground truncate">{messages.find(m=>m.id===editingId)?.text}</p>
      </div>
      <button aria-label={tChat('chat.cancelEditAria')} onClick={()=>{setEditingId(null);setEditText("");}} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted rounded-full flex-shrink-0"><MorphIcon icon={X} className="w-4 h-4" /></button>
    </div>
  ) : null;

  return (
    <div className="flex h-full w-full min-h-0" onClick={() => setCtxMenu(null)}>
      <input ref={fileImgRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange}/>
      <input ref={fileAllRef} type="file" accept="*/*" className="hidden" onChange={handleFileChange}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange}/>

      {/* Suhbatlar ro'yxati */}
      <div className={`${(threadOpen||aiOpen)?'hidden md:flex':'flex'} w-full md:w-[340px] lg:w-[380px] flex-shrink-0 border-r border-border/70 flex-col min-h-0`}>
        <ChatList
          me={currentUser}
          entries={entries}
          onlineUsers={onlineSet}
          selectedKey={selectedKey}
          aiOpen={aiOpen}
          prefs={prefs}
          update={updatePrefs}
          userById={userById}
          onOpen={openEntry}
          onOpenAi={() => { closeChat(); setAiOpen(true); }}
          onNewGroup={() => setShowNewGroup(true)}
          onMarkAllRead={markAllRead}
          onMarkChatRead={markChatRead}
          devSupportVirtual={currentUser.role !== 'dasturchi' && currentUser.companyId && onGetDevSupport && !groups.some(g => g.devSupport)
            ? { onOpen: async () => { const g = await onGetDevSupport(); if (g) openGroup(g); } } : null}
        />
      </div>

      {/* Suhbat oynasi */}
      <div className={`${!(threadOpen||aiOpen)?'hidden md:flex':'flex'} flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-background`} onClick={e=>e.stopPropagation()}>
        {aiOpen && !threadOpen ? (
          <AiChatThread userId={currentUser.id} onBack={() => setAiOpen(false)} />
        ) : !threadOpen ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center animate-pop-in"><IconTile icon={MessageCircle} tone="blue" size="xl" variant="soft" className="mx-auto mb-3" /><p className="text-sm bg-card/70 rounded-full px-4 py-1.5">{tChat("chat.selectConversation")}</p></div>
          </div>
        ) : (
          <>
            {/* Sarlavha */}
            <div className="bg-card/95 backdrop-blur-xl border-b border-border/70 pl-1.5 pr-2 md:pl-4 h-14 flex items-center gap-2 flex-shrink-0 z-10" data-testid="chat-thread-header">
              <button onClick={closeChat} aria-label={tChat('chatUi.back')} className="md:hidden w-10 h-10 flex items-center justify-center text-primary hover:bg-muted rounded-full flex-shrink-0">
                <MorphIcon icon={ChevronLeft} className="w-6 h-6" />
              </button>
              <button type="button" onClick={() => selGroup && !selGroup.devSupport && setShowGroupSettings(true)} disabled={!selGroup || selGroup.devSupport}
                className="flex-1 min-w-0 flex items-center gap-3 text-left disabled:cursor-default">
                {selGroup
                  ? <ChatAvatar name={headerTitle} src={selGroup.avatar} seed={groupKey(selGroup.id)} size={40} group={!selGroup.devSupport} support={selGroup.devSupport} />
                  : <ChatAvatar name={selUser!.name} src={selUser!.avatar} seed={userKey(selUser!.id)} size={40} online={isOnline(selUser!.id)} />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold truncate leading-tight">{headerTitle}</span>
                  {selGroup
                    ? (selGroup.activeVideoChat
                        ? <span className="block text-[12px] text-green-600 dark:text-green-400 truncate font-medium">{tChat('chat.videoChatActive', { count: selGroup.activeVideoChat.participantIds?.length ?? 0 })}</span>
                        : <span className="block text-[12px] text-muted-foreground truncate">{selGroup.devSupport ? tChat('chat.devSupportSubtitle') : tChat('chat.memberCount', { count: selGroup.memberIds?.length || 0 })}</span>)
                    : <span className="block text-[12px] truncate">{isOnline(selUser!.id) ? <span className="text-primary">{tChat('chatUi.online')}</span> : <span className="text-muted-foreground">{roleLabel(tChat, selUser!.role)}</span>}</span>}
                </span>
              </button>
              {!selectMode && !selGroup?.devSupport && (
                <div className="flex items-center flex-shrink-0">
                  {/* Guruhda faqat bitta video chat ikonkasi; 1:1 chatda — ovozli va video */}
                  {!selGroup && <button onClick={() => onStartCall('voice', { peer: selUser || undefined })} title={tChat('chat.voiceCall')} aria-label={tChat('chat.voiceCall')} className="w-10 h-10 flex items-center justify-center rounded-full text-primary hover:bg-primary/10"><MorphIcon icon={Phone} className="w-5 h-5" /></button>}
                  {/* Guruhda — Telegram-ga o'xshash DOIMIY video chat: faol bo'lsa yashil nuqta bilan "qo'shilish" */}
                  {selGroup ? (
                    <button onClick={() => onStartVideoChat(selGroup)}
                      title={selGroup.activeVideoChat ? tChat('chat.videoChatJoin') : tChat('chat.videoCall')}
                      aria-label={selGroup.activeVideoChat ? tChat('chat.videoChatJoin') : tChat('chat.videoCall')}
                      className={`w-10 h-10 flex items-center justify-center rounded-full relative ${selGroup.activeVideoChat ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'text-primary hover:bg-primary/10'}`}>
                      <MorphIcon icon={VideoIcon} className="w-5 h-5" />
                      {selGroup.activeVideoChat && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-500 rounded-full animate-pulse border border-card" />}
                    </button>
                  ) : (
                    <button onClick={() => onStartCall('video', { peer: selUser || undefined })} title={tChat('chat.videoCall')} aria-label={tChat('chat.videoCall')} className="w-10 h-10 flex items-center justify-center rounded-full text-primary hover:bg-primary/10"><MorphIcon icon={VideoIcon} className="w-5 h-5" /></button>
                  )}
                  {selGroup && <AiGroupButton groupId={selGroup.id} userId={currentUser.id} />}
                  {selGroup && <button onClick={() => setShowGroupSettings(true)} title={tChat('groupSettings.title')} aria-label={tChat('groupSettings.title')} className="w-10 h-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><MorphIcon icon={Settings} className="w-5 h-5" /></button>}
                </div>
              )}
              {selectMode && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <span className="text-xs text-muted-foreground mr-1">{tChat('chat.selectedCount', { count: selected.size })}</span>
                  {selected.size>0 && <>
                    <button aria-label={tChat('chat.forward')} onClick={() => { const msg=messages.find(m=>m.id===[...selected][0]); if(msg) setShowForward(msg); }} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full text-muted-foreground"><MorphIcon icon={Share2} className="w-4 h-4" /></button>
                    {/* O'chirish — o'z xabarlari, boshqanikini faqat direktor/o'rinbosar (kontekst-menyudagi kabi) */}
                    {(canModifyMessages || [...selected].every(id => messages.find(m => m.id === id)?.fromUserId === currentUser.id)) && (
                      <button aria-label={tChat('chat.deleteSelectedAria')} onClick={() => { selected.forEach(id=>onDelete(id)); setSelectMode(false); setSelected(new Set()); }} className="w-9 h-9 flex items-center justify-center hover:bg-red-500/10 rounded-full text-red-500"><MorphIcon icon={Trash2} className="w-4 h-4" /></button>
                    )}
                  </>}
                  <button aria-label={tChat('chat.cancelSelectAria')} onClick={() => { setSelectMode(false); setSelected(new Set()); }} className="w-9 h-9 flex items-center justify-center hover:bg-muted rounded-full text-muted-foreground"><MorphIcon icon={X} className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            {/* Qadalgan xabar */}
            {pinned && (
              <div className="bg-card/95 backdrop-blur border-b border-border/60 px-4 py-1.5 flex items-center gap-2.5 flex-shrink-0">
                <div className="w-[3px] h-8 bg-primary rounded-full flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-primary">{tChat("chat.pinnedMessage")}</p>
                  <p className="text-[13px] text-muted-foreground truncate">{msgReplyPreview(tChat, pinned)}</p>
                </div>
                <button aria-label={tChat('chat.closePinnedAria')} onClick={()=>onPin(pinned.id)} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted rounded-full flex-shrink-0"><MorphIcon icon={X} className="w-4 h-4" /></button>
              </div>
            )}

            <MessageList
              wallpaper={wallpaperCss}
              threadKey={selectedKey!}
              thread={thread}
              me={currentUser}
              isGroup={!!selGroup}
              groups={groups}
              firstUnreadId={firstUnread && firstUnread.key === selectedKey ? firstUnread.id : null}
              keyboardInset={keyboardInset}
              userById={userById}
              findMsg={findMsg}
              selectMode={selectMode}
              selected={selected}
              onToggleSelect={toggleSelect}
              onContext={(msgId, x, y) => setCtxMenu({ msgId, x, y })}
              onRetry={(m) => { const { status, ...retry } = m; onSend(retry as Msg); }}
              onStartVideoChat={onStartVideoChat}
              onBackgroundClick={() => setCtxMenu(null)}
            />

            {!selectMode && (
              <Composer
                value={editingId ? editText : text}
                onChange={v => { if (editingId) setEditText(v); else setText(v); }}
                onSubmit={() => { if (editingId) saveEdit(); else doSend(); }}
                editing={!!editingId}
                banner={banner}
                onAttach={onAttach}
                onVoice={blob => sendMedia(blob, 'audio', tChat('chat.voiceMessage'), 'voice.webm')}
                keyboardInset={keyboardInset}
              />
            )}
          </>
        )}
      </div>

      {/* Kontekst menyu — document.body'ga portal: sahifa `.page-enter` (will-change: transform) ichida,
          aks holda position:fixed shu ota-elementga nisbatan joylashib, kesilib qolardi. */}
      {ctxMenu && ctxMsg && createPortal(
        (() => {
          // Telegram'dagidek: matnni faqat yozgan odam tahrirlaydi; o'z xabarini o'zi, boshqanikini rahbar o'chiradi
          const mine = ctxMsg.fromUserId === currentUser.id;
          const canEdit = mine && !ctxMsg.deleted && (!ctxMsg.type || ctxMsg.type === 'text');
          const canDelete = !ctxMsg.deleted && (mine || !!canModifyMessages);
          const canCopy = !ctxMsg.deleted && !!ctxMsg.text;
          const rows = 4 + (canCopy ? 1 : 0) + (canEdit ? 1 : 0) + (canDelete ? 1 : 0);
          const menuW = 200;
          const menuH = rows * 42 + 12 + (canDelete ? 9 : 0);
          const vw = window.innerWidth, vh = window.innerHeight;
          const left = Math.min(Math.max(8, ctxMenu.x), vw - menuW - 8);
          const top = Math.min(Math.max(8, ctxMenu.y), vh - menuH - 8);
          const itemCls = "flex items-center gap-3 px-3 py-2.5 hover:bg-primary/10 rounded-xl cursor-pointer text-sm text-foreground/90 transition-colors";
          return (
            <>
            {/* Butun ekranni qoplovchi fon — qayerga tegilsa ham menyu yopiladi */}
            <div className="fixed inset-0 z-[69]" onClick={()=>setCtxMenu(null)} onContextMenu={e=>{e.preventDefault();setCtxMenu(null);}}/>
            <div role="menu" className="fixed z-[70] glass p-1.5 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-pop-in"
              style={{ top, left, width: menuW }}
              onClick={e=>e.stopPropagation()}>
              <div role="menuitem" onClick={()=>{setReplyTo(ctxMsg);setEditingId(null);setCtxMenu(null);}} className={itemCls}><MorphIcon icon={CornerDownLeft} className="w-4 h-4" />{tChat('chat.reply')}</div>
              {canCopy && (
                <div role="menuitem" onClick={()=>{
                  const txt = ctxMsg.text; setCtxMenu(null);
                  navigator.clipboard?.writeText(txt).then(() => toast.success(tChat('chat.copied'))).catch(() => toast.error(tChat('chat.actionFailed')));
                }} className={itemCls}><MorphIcon icon={CopyIcon} className="w-4 h-4" />{tChat('chat.copy')}</div>
              )}
              {canEdit && (
                <div role="menuitem" onClick={()=>{setEditingId(ctxMsg.id);setEditText(ctxMsg.text);setReplyTo(null);setCtxMenu(null);}} className={itemCls}><MorphIcon icon={Edit} className="w-4 h-4" />{tChat('chat.edit')}</div>
              )}
              <div role="menuitem" onClick={()=>{onPin(ctxMsg.id);setCtxMenu(null);}} className={itemCls}>
                <MorphIcon icon={ctxMsg.pinned ? PinOff : Pin} className="w-4 h-4" />{ctxMsg.pinned?tChat('chat.unpin'):tChat('chat.pin')}
              </div>
              <div role="menuitem" onClick={()=>{setShowForward(ctxMsg);setCtxMenu(null);}} className={itemCls}><MorphIcon icon={Share2} className="w-4 h-4" />{tChat('chat.forward')}</div>
              <div role="menuitem" onClick={()=>{setSelectMode(true);setSelected(new Set([ctxMsg.id]));setCtxMenu(null);}} className={itemCls}><MorphIcon icon={SquareCheck} className="w-4 h-4" />{tChat('chat.select')}</div>
              {canDelete && (
                <>
                  <div className="h-px bg-border/60 my-0.5"/>
                  <div role="menuitem" onClick={()=>{onDelete(ctxMsg.id);setCtxMenu(null);}} className="flex items-center gap-3 px-3 py-2.5 hover:bg-red-500/10 text-red-500 rounded-xl cursor-pointer text-sm transition-colors"><MorphIcon icon={Trash2} className="w-4 h-4" />{tChat('chat.delete')}</div>
                </>
              )}
            </div>
            </>
          );
        })(),
        document.body
      )}

      {/* Yuborish (forward) */}
      {showForward && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 modal-backdrop animate-fade-in" onClick={()=>setShowForward(null)}>
          <EscClose onClose={() => setShowForward(null)} />
          <div className="glass-modal rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm p-4 animate-slide-up-fade max-h-[80dvh] flex flex-col" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }} onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="font-bold text-base">{tChat('chat.forwardTo')}</h3>
              <button aria-label={tChat('common.close')} onClick={()=>setShowForward(null)} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
            </div>
            <div className="space-y-0.5 overflow-y-auto overscroll-contain scrollbar-hide min-h-0">
              {contacts.map(u => (
                <button key={u.id} onClick={()=>{
                  onSend({id:`msg${Date.now()}`,fromUserId:currentUser.id,toUserId:u.id,text:showForward!.text,timestamp:new Date().toISOString(),read:false,type:showForward!.type,mediaUrl:showForward!.mediaUrl,fileName:showForward!.fileName,location:showForward!.location});
                  setShowForward(null);
                }} className="w-full flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-xl transition-colors text-left">
                  <Avatar user={u} size="md"/>
                  <div className="min-w-0"><p className="text-sm font-medium truncate">{u.name}</p><RoleBadge role={u.role}/></div>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Yangi guruh yaratish */}
      {showNewGroup && (
        <GroupCreateModal contacts={contacts} onClose={() => setShowNewGroup(false)}
          onCreate={async (name, ids) => { const g = await onCreateGroup(name, ids); setShowNewGroup(false); if (g) openGroup(g); }}/>
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
