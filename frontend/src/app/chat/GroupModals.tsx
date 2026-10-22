// Guruh oynalari (yaratish, sozlamalar, a'zo qo'shish) — ChatPage'dan ajratilgan, mantiq o'zgarmagan.
// document.body'ga portal: sahifa animatsiyasi (will-change: transform) ichida fixed joylashuv buzilmasin.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Users2 from "@hugeicons/core-free-icons/UserGroup02Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Edit from "@hugeicons/core-free-icons/Edit02Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import { confirmDialog } from "../lib/confirmDialog";
import { Avatar, useModalPresence, EscClose } from "../App";
import type { AppUser, Group } from "../App";

// ─── Guruh sozlamalari modal ────────────────────────────────────────────────────
export function GroupSettingsModal({ group, users, currentUser, contacts, onClose, onRename, onAddMembers, onRemoveMember, onLeave, onDelete }: {
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

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop animate-fade-in p-4" >
      <EscClose onClose={onClose} />
      <div className="glass-modal rounded-2xl w-full max-w-sm p-5 animate-slide-up-fade max-h-[80vh] supports-[height:1dvh]:max-h-[80dvh] overflow-y-auto scrollbar-hide" onClick={e => e.stopPropagation()}>
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
            <button onClick={async () => { if (await confirmDialog(t('groupSettings.confirmDelete') as string)) onDelete(); }}
              className="w-full text-sm font-semibold text-destructive hover:bg-destructive/10 rounded-xl py-2.5">{t('groupSettings.deleteGroup')}</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
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
export function GroupCreateModal({ contacts, onClose, onCreate }:
  { contacts: AppUser[]; onClose: () => void; onCreate: (name: string, memberIds: string[]) => void }) {
  const { t } = useTranslation();
  useModalPresence();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const toggle = (id: string) => setSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const filtered = contacts.filter(u => u.name.toLowerCase().includes(q.trim().toLowerCase()));
  return createPortal(
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
    </div>,
    document.body,
  );
}
