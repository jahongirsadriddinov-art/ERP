import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { MorphIcon } from "morphicons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import Megaphone from "@hugeicons/core-free-icons/Megaphone01Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import LocationIcon from "@hugeicons/core-free-icons/Location01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import { API_BASE, uploadChatMedia } from "./api";
import { getSocket } from "./socket";
import { openMediaViewer } from "./MediaViewer";

const LocationPicker = lazy(() => import("./LocationPicker"));

export interface AnnouncementData {
  id: string; title: string; body: string;
  mediaUrl?: string; mediaType?: 'image' | 'video';
  location?: { lat: number; lng: number; label?: string };
  minViewSeconds?: number; isGlobal?: boolean; seen?: boolean;
  postedBy?: { name?: string; role?: string }; createdAt: string;
}

// E'lon mazmuni (matn + rasm/video + lokatsiya) — ro'yxatda ham, avtomatik
// ochiladigan oynada ham bir xil ko'rinadi.
export function AnnouncementContent({ a }: { a: AnnouncementData }) {
  return (
    <div className="min-w-0">
      {a.mediaUrl && a.mediaType === 'image' && (
        <img src={a.mediaUrl} alt="" onClick={() => openMediaViewer(a.mediaUrl!, 'image')} className="w-full max-h-64 object-contain rounded-xl bg-black/5 mb-2 cursor-zoom-in" />
      )}
      {a.mediaUrl && a.mediaType === 'video' && (
        <video src={a.mediaUrl} controls playsInline preload="metadata" className="w-full max-h-64 rounded-xl bg-black mb-2" />
      )}
      <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words">{a.body}</p>
      {a.location && (
        <a href={`https://maps.google.com/?q=${a.location.lat},${a.location.lng}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-primary hover:underline">
          <MorphIcon icon={LocationIcon} className="w-3.5 h-3.5" />
          {a.location.label || `${a.location.lat.toFixed(5)}, ${a.location.lng.toFixed(5)}`}
        </a>
      )}
    </div>
  );
}

// Yangi e'lon yozish formasi — firma admini (/api/announcements) ham,
// dasturchi paneli (/api/dev-announcements, hamma firmalarga) ham shu
// komponentdan foydalanadi.
export function AnnouncementComposer({ endpoint, onPosted, onCancel }: { endpoint: string; onPosted: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geoHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  // Koordinatani o'qiladigan manzilga aylantiradi (xato bo'lsa manzilsiz qoladi)
  const reverseLabel = async (lat: number, lng: number) => {
    try {
      const r = await fetch(`${API_BASE}/api/geocode/reverse?lat=${lat}&lng=${lng}`, { headers: geoHeaders() });
      if (r.ok) { const d = await r.json(); return String(d.label || ''); }
    } catch {}
    return '';
  };
  const searchAddress = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/geocode/search?q=${encodeURIComponent(q)}`, { headers: geoHeaders() });
        if (r.ok) setSuggestions(await r.json());
      } catch {}
    }, 450);
  };
  const pickSuggestion = (s: { label: string; lat: number; lng: number }) => {
    setLocation({ lat: s.lat, lng: s.lng, label: s.label });
    setQuery(s.label); setSuggestions([]);
  };
  const pickOnMap = async (lat: number, lng: number) => {
    setLocation({ lat, lng });
    const label = await reverseLabel(lat, lng);
    if (label) { setLocation({ lat, lng, label }); setQuery(label); }
  };
  const [minView, setMinView] = useState(2);
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
    if (!type) { toast.error(t('announcements.mediaTypeError')); return; }
    setUploading(true);
    try {
      const { url } = await uploadChatMedia(file, file.name);
      setMedia({ url, type });
    } catch { toast.error(t('announcements.uploadError')); }
    setUploading(false);
  };

  const detectLocation = () => {
    if (!navigator.geolocation) { toast.error(t('addObject.geoUnsupported')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setLocation({ lat, lng }); setLocating(false);
        const label = await reverseLabel(lat, lng);
        if (label) { setLocation({ lat, lng, label }); setQuery(label); }
      },
      () => { toast.error(t('addObject.geoDenied')); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const post = async () => {
    if (!title.trim() || !body.trim()) return;
    setPosting(true);
    try {
      const r = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), body: body.trim(), minViewSeconds: minView,
          ...(media && { mediaUrl: media.url, mediaType: media.type }),
          ...(location && { location }),
        }),
      });
      if (r.ok) {
        setTitle(""); setBody(""); setMedia(null); setLocation(null); setQuery(""); setShowMap(false); setMinView(2);
        toast.success(t('announcements.posted'));
        onPosted();
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || t('common.error'));
      }
    } catch { toast.error(t('common.error')); }
    setPosting(false);
  };

  return (
    <div className="space-y-2 mb-4">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('announcements.titlePlaceholder') as string} maxLength={200}
        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none" autoFocus />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={t('announcements.bodyPlaceholder') as string} rows={3} maxLength={4000}
        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none resize-none" />

      {media && (
        <div className="relative rounded-xl overflow-hidden bg-muted">
          {media.type === 'image'
            ? <img src={media.url} alt="" className="w-full max-h-44 object-contain" />
            : <video src={media.url} controls playsInline preload="metadata" className="w-full max-h-44 bg-black" />}
          <button type="button" onClick={() => setMedia(null)} aria-label={t('announcements.removeAttachment')}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><MorphIcon icon={X} className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {location && (
        <div className="flex items-center gap-2 text-xs bg-primary/10 text-primary rounded-lg px-3 py-2">
          <MorphIcon icon={LocationIcon} className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 truncate">{location.label || `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}</span>
          <button type="button" onClick={() => { setLocation(null); setQuery(""); }} aria-label={t('announcements.removeAttachment')}><MorphIcon icon={X} className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Manzil: qo'lda yozib qidirish (takliflar chiqadi) yoki kartadan tanlash */}
      <div className="relative">
        <input value={query} onChange={e => searchAddress(e.target.value)} placeholder={t('announcements.addressPlaceholder') as string}
          className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-input-background focus:outline-none focus:ring-1 focus:ring-primary" />
        {suggestions.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto scrollbar-hide">
            {suggestions.map((sg, i) => (
              <button key={i} type="button" onClick={() => pickSuggestion(sg)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted liquid-transition border-b border-border/30 last:border-0">{sg.label}</button>
            ))}
          </div>
        )}
      </div>
      {showMap && (
        <div className="space-y-1">
          <Suspense fallback={<div className="w-full h-[260px] rounded-xl border border-border bg-muted/40 flex items-center justify-center"><MorphIcon icon={Loader2} className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
            <LocationPicker value={location ? { lat: location.lat, lng: location.lng } : null} onPick={pickOnMap} />
          </Suspense>
          <p className="text-[10px] text-muted-foreground">{t('announcements.mapHint')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={pickFile} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-full px-3 py-1.5 hover:bg-muted liquid-transition disabled:opacity-50">
          {uploading ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={ImageIcon} className="w-3.5 h-3.5" />}
          {t('announcements.attachMedia')}
        </button>
        <button type="button" onClick={detectLocation} disabled={locating}
          className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-full px-3 py-1.5 hover:bg-muted liquid-transition disabled:opacity-50">
          {locating ? <MorphIcon icon={Loader2} className="w-3.5 h-3.5 animate-spin" /> : <MorphIcon icon={LocationIcon} className="w-3.5 h-3.5" />}
          {t('announcements.attachLocation')}
        </button>
        <button type="button" aria-pressed={showMap}
          onClick={async () => {
            const next = !showMap;
            setShowMap(next);
            // Manzil yozilgan-u, joy tanlanmagan bo'lsa — yozilgan manzilning o'rnini topib, xaritani shu yerga olib boramiz
            if (next && !location && query.trim().length >= 2) {
              try {
                const r = await fetch(`${API_BASE}/api/geocode/search?q=${encodeURIComponent(query.trim())}`, { headers: geoHeaders() });
                const hits = r.ok ? await r.json() : [];
                if (hits[0]) setLocation({ lat: hits[0].lat, lng: hits[0].lng, label: hits[0].label });
              } catch {}
            }
          }}
          className={`flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 liquid-transition ${showMap ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
          <MorphIcon icon={LocationIcon} className="w-3.5 h-3.5" />
          {showMap ? t('announcements.hideMap') : t('announcements.pickOnMap')}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
          {t('announcements.minViewLabel')}
          <select value={minView} onChange={e => setMinView(Number(e.target.value))}
            className="text-xs border border-border rounded-lg px-1.5 py-1 bg-input-background focus:outline-none">
            {[2, 5, 10, 15, 30, 60].map(s => <option key={s} value={s}>{s} {t('announcements.secShort')}</option>)}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        {onCancel && <button onClick={onCancel} className="btn btn-outline flex-1 py-2 text-sm">{t('common.cancel')}</button>}
        <button onClick={post} disabled={posting || uploading || !title.trim() || !body.trim()} className="btn btn-primary flex-1 py-2 text-sm disabled:opacity-50">{t('announcements.postBtn')}</button>
      </div>
    </div>
  );
}

// Foydalanuvchi tizimga kirganda (yoki ochiq sessiyaga yangi e'lon kelganda)
// hali ko'rilmagan e'lonlar BIR MARTA avtomatik oyna sifatida chiqadi. Yopish
// tugmasi e'lon muallifi belgilagan vaqt (minViewSeconds, kamida 2s) o'tguncha
// bloklangan. Yopilgach server'ga "ko'rildi" yoziladi — qayta chiqmaydi.
export function AnnouncementPopup() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<AnnouncementData[]>([]);
  const [remaining, setRemaining] = useState(0);
  const shownIds = useRef<Set<string>>(new Set());
  const current = queue[0];

  const loadUnseen = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/announcements`);
      if (!r.ok) return;
      const list: AnnouncementData[] = await r.json();
      const fresh = list.filter(a => !a.seen && !shownIds.current.has(a.id)).reverse(); // eskisidan yangisiga
      if (fresh.length) {
        fresh.forEach(a => shownIds.current.add(a.id));
        setQueue(q => [...q, ...fresh]);
      }
    } catch {}
  };

  useEffect(() => {
    loadUnseen();
    const socket = getSocket();
    const onNew = () => loadUnseen();
    socket?.on('announcement:new', onNew);
    return () => { socket?.off('announcement:new', onNew); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!current) return;
    setRemaining(Math.max(2, current.minViewSeconds || 2));
    const id = setInterval(() => setRemaining(r => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [current?.id]);

  const close = () => {
    if (!current || remaining > 0) return;
    fetch(`${API_BASE}/api/announcements/${current.id}/seen`, { method: 'POST' }).catch(() => {});
    setQueue(q => q.slice(1));
  };

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card rounded-3xl w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col shadow-2xl border border-border/40 animate-slide-up-fade">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/40 flex-shrink-0">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)' }}>
            <MorphIcon icon={Megaphone} className="w-[18px] h-[18px]" style={{ color: 'var(--primary)' }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{current.isGlobal ? t('announcements.globalBadge') : t('announcements.title')}</p>
            <p className="text-base font-bold break-words leading-snug">{current.title}</p>
          </div>
          {queue.length > 1 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">+{queue.length - 1}</span>}
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          <AnnouncementContent a={current} />
          <p className="text-[10px] text-muted-foreground mt-3">{current.postedBy?.name} · {new Date(current.createdAt).toLocaleDateString('uz-UZ')}</p>
        </div>
        <div className="px-5 pb-5 pt-2 flex-shrink-0">
          <button onClick={close} disabled={remaining > 0}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}>
            {remaining > 0 ? t('announcements.closeIn', { count: remaining }) : t('announcements.closeBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dasturchi paneli uchun — global e'lonlar ro'yxati (o'chirish bilan).
export function GlobalAnnouncementList({ reloadKey }: { reloadKey: number }) {
  const { t } = useTranslation();
  const [list, setList] = useState<AnnouncementData[]>([]);
  const load = async () => {
    try { const r = await fetch(`${API_BASE}/api/dev-announcements`); if (r.ok) setList(await r.json()); } catch {}
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadKey]);
  const remove = async (id: string) => {
    if (!window.confirm(t('common.confirmDelete') as string)) return;
    try { const r = await fetch(`${API_BASE}/api/dev-announcements/${id}`, { method: 'DELETE' }); if (r.ok) load(); } catch {}
  };
  if (list.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">{t('announcements.empty')}</p>;
  return (
    <div className="space-y-2.5">
      {list.map(a => (
        <div key={a.id} className="glass-card rounded-2xl p-3.5 border border-border/40">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold break-words min-w-0">{a.title}</p>
            <button onClick={() => remove(a.id)} aria-label={t('common.delete')} className="p-1 text-muted-foreground hover:text-destructive flex-shrink-0"><MorphIcon icon={Trash} className="w-3.5 h-3.5" /></button>
          </div>
          <div className="mt-1"><AnnouncementContent a={a} /></div>
          <p className="text-[10px] text-muted-foreground mt-1.5">{new Date(a.createdAt).toLocaleDateString('uz-UZ')}</p>
        </div>
      ))}
    </div>
  );
}
