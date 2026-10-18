// Chat ro'yxati (chap ustun / telefonda butun ekran): sarlavha, qidiruv, jildlar, suhbatlar.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Users2 from "@hugeicons/core-free-icons/UserGroup02Icon";
import MoreVertical from "@hugeicons/core-free-icons/MoreVerticalIcon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import type { AppUser } from "../App";
import { msgTypePreview, roleLabel } from "../App";
import { AiChatListItem } from "../aiVoice/chat/AiChatContact";
import { ChatAvatar } from "./ChatAvatar";
import { ChatRow, avatarSize } from "./ChatRow";
import { ChatSettingsSheet } from "./ChatSettingsSheet";
import { FOLDER_IDS, folderUnreadChats, inFolder, listTime, matchesQuery, sortEntries, type ChatEntry, type FolderId } from "./chatModel";
import { toggleIn, type ChatPrefs } from "./chatPrefs";

const FOLDER_KEY = "erp_chatFolder";

export function ChatList({ me, entries, onlineUsers, selectedKey, aiOpen, prefs, update, userById, onOpen, onOpenAi, onNewGroup, onMarkAllRead, onMarkChatRead, devSupportVirtual }: {
  me: AppUser;
  entries: ChatEntry[];
  onlineUsers: Set<string>;
  selectedKey: string | null;
  aiOpen: boolean;
  prefs: ChatPrefs;
  update: (fn: (p: ChatPrefs) => ChatPrefs) => void;
  userById: (id: string) => AppUser | undefined;
  onOpen: (e: ChatEntry) => void;
  onOpenAi: () => void;
  onNewGroup: () => void;
  onMarkAllRead: () => void;
  onMarkChatRead: (e: ChatEntry) => void;
  devSupportVirtual?: { onOpen: () => void } | null;
}) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<FolderId>(() => { try { return (sessionStorage.getItem(FOLDER_KEY) as FolderId) || "all"; } catch { return "all"; } });
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [swiped, setSwiped] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const muted = useMemo(() => new Set(prefs.muted), [prefs.muted]);
  const pinned = useMemo(() => new Set(prefs.pinned), [prefs.pinned]);

  // Ko'rinadigan jildlar: "Hammasi" doim; qolganlari — sozlamada yoqilgan va (rol/guruh jildlari) bo'sh bo'lmasa
  const folders = useMemo(() => FOLDER_IDS.filter((f) => {
    if (f === "all") return true;
    if (prefs.hiddenFolders.includes(f)) return false;
    if (f === "unread") return true;
    return entries.some((e) => inFolder(e, f));
  }), [entries, prefs.hiddenFolders]);
  const activeFolder: FolderId = folders.includes(folder) ? folder : "all";
  useEffect(() => { try { sessionStorage.setItem(FOLDER_KEY, activeFolder); } catch { /* */ } }, [activeFolder]);
  // Tanlangan jild yorlig'i ko'rinadigan joyga suriladi (telefonda gorizontal skroll)
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-folder="${activeFolder}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeFolder]);

  const shown = useMemo(() => sortEntries(
    entries.filter((e) => inFolder(e, activeFolder) && matchesQuery(e, q)),
    prefs.sort, prefs.pinned,
  ), [entries, activeFolder, q, prefs.sort, prefs.pinned]);
  const totalUnread = useMemo(() => entries.reduce((n, e) => n + e.unread, 0), [entries]);

  const sz = avatarSize(prefs.compact);
  const searching = q.trim().length > 0;

  const previewOf = (e: ChatEntry) => {
    const last = e.last;
    if (!last) {
      if (e.kind === "group") return t("chat.memberCount", { count: e.group?.memberIds?.length || 0 });
      if (e.kind === "support") return t("chat.devSupportSubtitle");
      return onlineUsers.has(e.user!.id) ? <span className="text-primary">{t("chatUi.online")}</span> : roleLabel(t, e.user!.role);
    }
    const text = msgTypePreview(t, last);
    if (e.kind === "group" && last.type !== "video_event") {
      const who = last.fromUserId === me.id ? t("chat.you") : (userById(last.fromUserId)?.name?.split(" ")[0] || "");
      return <><span className="text-foreground/85">{who}: </span>{text}</>;
    }
    return text;
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-card" data-testid="chat-list">
      {/* Sarlavha */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2 relative z-20">
        <div className="flex items-center gap-2 mb-2.5">
          <h1 className="text-xl font-bold flex-1 min-w-0 truncate pl-1">{t("chat.messages")}</h1>
          <button type="button" onClick={onNewGroup} title={t("chat.newGroup")} aria-label={t("chat.newGroup")}
            className="w-9 h-9 rounded-full flex items-center justify-center text-primary hover:bg-primary/10"><MorphIcon icon={Users2} className="w-5 h-5" /></button>
          <div className="relative">
            <button type="button" data-testid="chat-more" aria-label={t("chatUi.more")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
              <MorphIcon icon={MoreVertical} className="w-5 h-5" />
              {totalUnread > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />}
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <div role="menu" className="absolute right-0 top-10 z-40 min-w-[240px] glass p-1.5 rounded-2xl border border-white/20 shadow-2xl animate-pop-in">
                  <button role="menuitem" type="button" data-testid="chat-mark-all-read" disabled={totalUnread === 0}
                    onClick={() => { setMenu(false); onMarkAllRead(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-primary/10 disabled:opacity-45 disabled:hover:bg-transparent text-left">
                    <MorphIcon icon={CheckCheck} className="w-4 h-4 text-primary" />
                    <span className="flex-1">{t("chatUi.markAllRead")}</span>
                    {totalUnread > 0 && <span className="text-xs text-muted-foreground tabular-nums">{totalUnread}</span>}
                  </button>
                  <button role="menuitem" type="button" data-testid="chat-open-settings" onClick={() => { setMenu(false); setSettings(true); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-primary/10 text-left">
                    <MorphIcon icon={Settings} className="w-4 h-4 text-muted-foreground" />{t("chatUi.settings")}
                  </button>
                  <button role="menuitem" type="button" onClick={() => { setMenu(false); onNewGroup(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-primary/10 text-left">
                    <MorphIcon icon={Users2} className="w-4 h-4 text-muted-foreground" />{t("chatUi.newGroup")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {/* Qidiruv */}
        <div className="relative">
          <MorphIcon icon={Search} className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("chatUi.search")} aria-label={t("chatUi.search")} data-testid="chat-search"
            type="search" enterKeyHint="search"
            className="w-full h-9 rounded-full bg-muted/80 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-search-cancel-button]:hidden" />
          {searching && (
            <button type="button" aria-label={t("chatUi.clearSearch")} onClick={() => setQ("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"><MorphIcon icon={X} className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>

      {/* Jildlar (Telegram kabi tablar) */}
      {folders.length > 1 && (
        <div ref={tabsRef} role="tablist" aria-label={t("chatUi.foldersAria")} data-testid="chat-folders"
          className="flex-shrink-0 flex gap-1 overflow-x-auto scrollbar-hide px-2 border-b border-border/60">
          {folders.map((f) => {
            const n = f === "all" ? folderUnreadChats(entries, "all", muted) : folderUnreadChats(entries, f, muted);
            const on = f === activeFolder;
            return (
              <button key={f} type="button" role="tab" aria-selected={on} data-folder={f} data-testid={`chat-folder-${f}`}
                onClick={() => { setFolder(f); setSwiped(null); }}
                className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap font-medium transition-colors ${on ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {t(`chatUi.folders.${f}`)}
                {n > 0 && <span data-testid={`chat-folder-count-${f}`} className={`min-w-[18px] h-[18px] px-1 rounded-full text-[11px] leading-none flex items-center justify-center font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-muted-foreground/25 text-foreground/80"}`}>{n}</span>}
                <span aria-hidden className={`absolute left-2 right-2 bottom-0 h-[3px] rounded-t-full bg-primary transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
              </button>
            );
          })}
        </div>
      )}

      {/* Ro'yxat — main-pb-safe pastki menyu uchun joy qoldiradi, oxirigacha skroll qilinadi */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide" data-testid="chat-list-scroll" onScroll={() => swiped && setSwiped(null)}>
        {activeFolder === "all" && !searching && (
          // AI kontakti o'z komponenti (aiVoice) — o'zgarmaydi, faqat tepada ko'rsatiladi
          <div className="pr-4 pt-1"><AiChatListItem userId={me.id} active={aiOpen} onOpen={onOpenAi} /></div>
        )}
        {shown.map((e) => {
          const mine = e.last && e.last.fromUserId === me.id && !e.last.groupId;
          return (
            <ChatRow key={e.key} rowKey={e.key}
              title={e.name}
              avatar={<ChatAvatar name={e.name} src={e.user?.avatar || e.group?.avatar} seed={e.key} size={sz}
                online={e.kind === "dm" && onlineUsers.has(e.user!.id)} group={e.kind === "group"} support={e.kind === "support"} />}
              preview={previewOf(e)}
              time={listTime(e.lastTs, i18n.language)}
              unread={e.unread}
              tick={mine ? (e.last!.read ? "read" : "sent") : null}
              active={selectedKey === e.key}
              compact={prefs.compact}
              pinned={pinned.has(e.key)}
              muted={muted.has(e.key)}
              swiped={swiped === e.key}
              onSwipe={(open) => setSwiped(open ? e.key : null)}
              onOpen={() => { setSwiped(null); onOpen(e); }}
              onTogglePin={() => update((p) => ({ ...p, pinned: toggleIn(p.pinned, e.key, true) }))}
              onToggleMute={() => update((p) => ({ ...p, muted: toggleIn(p.muted, e.key) }))}
              onMarkRead={() => onMarkChatRead(e)}
            />
          );
        })}
        {/* Texnik yordam (hali ochilmagan) — ro'yxat oxirida */}
        {activeFolder === "all" && !searching && devSupportVirtual && (
          <ChatRow rowKey="support-virtual" title={t("common.roles.dasturchi")} preview={t("chat.devSupportSubtitle")} time="" unread={0}
            avatar={<ChatAvatar name="" seed="support" size={sz} support />} active={false} compact={prefs.compact}
            pinned={false} muted={false} swiped={false} onSwipe={() => {}} onOpen={devSupportVirtual.onOpen} />
        )}
        {shown.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10 px-6" data-testid="chat-list-empty">
            {searching ? t("chatUi.searchEmpty") : activeFolder === "unread" ? t("chatUi.unreadEmpty") : entries.length === 0 ? t("chat.noContacts") : t("chatUi.folderEmpty")}
          </p>
        )}
        <div className="h-3" />
      </div>

      {settings && <ChatSettingsSheet uid={me.id} prefs={prefs} update={update} onClose={() => setSettings(false)} />}
    </div>
  );
}
