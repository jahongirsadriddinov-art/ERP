import { useEffect, useMemo, useRef, useState } from "react";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import Users2 from "@hugeicons/core-free-icons/UserGroup02Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
import Navigation from "@hugeicons/core-free-icons/Navigation01Icon";
import ChevronRight from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { MorphIcon } from "morphicons/react";
import { useTranslation } from "react-i18next";
import { AppUser, Avatar, Transfer, Expense, roleLabel } from "./App";
import { API_BASE } from "./api";
import WorkerMap, { NavigateChoiceModal, type TrackPoint, type MapObject } from "./WorkerMap";
import WorkerProfileModal from "./WorkerProfileModal";

interface AttendanceEntry {
  userId: string;
  status: 'NOT_STARTED' | 'WORKING' | 'FINISHED';
  checkIn: string | null;
  checkOut: string | null;
  workHours: number | null;
  minutesWorking: number | null;
}
type Loc = { userId: string; lat: number; lng: number; accuracy?: number; timestamp: string; source?: 'site' | 'bot_live' | 'bot_once'; speed?: number; battery?: number; charging?: boolean; network?: string };
type Summary = { points: number; distanceM: number; firstAt: string | null; lastAt: string | null; lastBattery: number | null };
type Filter = 'all' | 'working' | 'live' | 'nosignal';
type Snap = 'peek' | 'half' | 'full';

const FRESH_MIN = 15; // daqiqa — shundan yangi bo'lsa "jonli"
const tashkentToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

// Telefon (≤767px) — xarita butun ekran, xodimlar pastki panelda (bottom sheet).
function useNarrow() {
  const q = "(max-width: 767px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

// Direktor/o'rinbosarning "Kuzatuv" sahifasi (owner 2026-10-22: "Kuzatuvni yaxshila").
// Telefonda: butun ekran xarita + pastdan tortiladigan xodimlar paneli (qidiruv, filtr: ishda/jonli/signal yo'q),
// har qatorda — oxirgi ko'rilgan vaqt, bugungi ish holati (yo'qlama), batareya. Xodimni bosish — xarita unga
// suziladi va BUGUNGI izi chiziladi (bosib o'tgan yo'l, nuqtalar soni). Kompyuterda — xarita + o'ng ustunda ro'yxat.
// To'liq profil (davomat tarixi, materiallar, chiqimlar, istalgan kun izi) — "Profil" tugmasi orqali, avvalgidek.
export default function GpsTrackingPage({ users, gpsLocations, projects, refreshing, onRefresh, transfers, expenses }: {
  users: AppUser[];
  gpsLocations: Loc[];
  /** Koordinatasi belgilangan obyektlar — xaritada ko'rsatiladi (owner 2026-10-27) */
  projects?: { id: string; name: string; lat?: number; lng?: number; geofenceRadius?: number }[];
  refreshing: boolean;
  onRefresh: () => void;
  transfers: Transfer[];
  expenses: Expense[];
}) {
  const { t } = useTranslation();
  const narrow = useNarrow();
  // Xaritaga tushadigan obyektlar va ishchining eng yaqin obyektgacha masofasi
  const mapObjects: MapObject[] = useMemo(() => (projects || [])
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({ id: p.id, name: p.name, lat: Number(p.lat), lng: Number(p.lng), radius: Number(p.geofenceRadius) || 300 })),
    [projects]);
  /** Ikki nuqta orasidagi masofa (metr) — haversine. */
  const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  /** Ishchi qaysi obyektda (geozona ichida) yoki eng yaqini qancha uzoqda. */
  const nearestObject = (l?: Loc | null) => {
    if (!l || !mapObjects.length) return null;
    let best: { o: MapObject; d: number } | null = null;
    for (const o of mapObjects) {
      const d = distM(l.lat, l.lng, o.lat, o.lng);
      if (!best || d < best.d) best = { o, d };
    }
    if (!best) return null;
    return { name: best.o.name, meters: Math.round(best.d), inside: best.d <= (best.o.radius || 300) };
  };
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [attLoading, setAttLoading] = useState(true);
  const [navTarget, setNavTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [profileWorker, setProfileWorker] = useState<AppUser | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>('all');
  const [snap, setSnap] = useState<Snap>('half');
  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trackState, setTrackState] = useState<'idle' | 'loading' | 'ok' | 'empty' | 'denied' | 'error'>('idle');
  const [now, setNow] = useState(() => Date.now());

  const loadAttendance = () => {
    setAttLoading(true);
    const token = localStorage.getItem('token') || '';
    fetch(`${API_BASE}/api/attendance/list`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setAttendance(Array.isArray(d) ? d : []))
      .catch(() => setAttendance([]))
      .finally(() => setAttLoading(false));
  };
  const refreshAll = () => { onRefresh(); loadAttendance(); setNow(Date.now()); };

  useEffect(() => {
    refreshAll();
    // Avtomatik yangilanish — har 2 daqiqada; "N daqiqa oldin" yozuvlari har daqiqada yangilanadi.
    const interval = setInterval(refreshAll, 2 * 60 * 1000);
    const tick = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => { clearInterval(interval); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tanlangan xodimning bugungi izi va xulosasi
  useEffect(() => {
    if (!selectedId) { setTrack(null); setSummary(null); setTrackState('idle'); return; }
    const token = localStorage.getItem('token') || '';
    const day = tashkentToday();
    const qs = `from=${encodeURIComponent(`${day}T00:00:00+05:00`)}&to=${encodeURIComponent(`${day}T23:59:59+05:00`)}`;
    const h = { headers: { Authorization: `Bearer ${token}` } };
    let alive = true;
    setTrackState('loading'); setTrack(null); setSummary(null);
    fetch(`${API_BASE}/api/gps/user/${selectedId}?${qs}`, h)
      .then(async r => {
        if (!alive) return;
        if (r.status === 403) { setTrackState('denied'); return; }
        if (!r.ok) { setTrackState('error'); return; }
        const d = await r.json();
        const pts: TrackPoint[] = Array.isArray(d) ? d : [];
        setTrack(pts); setTrackState(pts.length ? 'ok' : 'empty');
      })
      .catch(() => { if (alive) setTrackState('error'); });
    fetch(`${API_BASE}/api/gps/user/${selectedId}/summary?${qs}`, h)
      .then(r => r.ok ? r.json() : null).then(d => { if (alive) setSummary(d); }).catch(() => {});
    return () => { alive = false; };
  }, [selectedId]);

  const workerRoles = ['ishchi', 'prorab', 'brigadir'];
  const workers = users.filter(u => workerRoles.includes(u.role));
  const locById = useMemo(() => new Map(gpsLocations.map(g => [g.userId, g])), [gpsLocations]);
  const attById = useMemo(() => new Map(attendance.map(a => [a.userId, a])), [attendance]);
  const minutesAgo = (iso: string) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  const agoLabel = (min: number) => min < 1 ? t('gps.justNow', { defaultValue: "hozirgina" }) : min < 60 ? t('gps.minutesAgo', { min }) : min < 24 * 60 ? t('gps.hoursMinutesAgo', { h: Math.floor(min / 60), m: min % 60 }) : t('gps.daysAgo', { defaultValue: "{{d}} kun oldin", d: Math.floor(min / 1440) });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  const isLive = (u: AppUser) => { const l = locById.get(u.id); return !!l && minutesAgo(l.timestamp) <= FRESH_MIN; };
  const isWorking = (u: AppUser) => attById.get(u.id)?.status === 'WORKING';

  const counts = {
    all: workers.length,
    working: workers.filter(isWorking).length,
    live: workers.filter(isLive).length,
    nosignal: workers.filter(u => !locById.has(u.id)).length,
  };
  const q = query.trim().toLowerCase();
  const list = workers
    .filter(u => !q || u.name.toLowerCase().includes(q) || (u.phone || '').includes(q) || roleLabel(t, u.role).toLowerCase().includes(q))
    .filter(u => filter === 'all' || (filter === 'working' ? isWorking(u) : filter === 'live' ? isLive(u) : !locById.has(u.id)))
    .sort((a, b) => {
      const rank = (u: AppUser) => (isWorking(u) ? 0 : 2) + (isLive(u) ? 0 : 1);
      const la = locById.get(a.id), lb = locById.get(b.id);
      return rank(a) - rank(b) || (lb ? +new Date(lb.timestamp) : 0) - (la ? +new Date(la.timestamp) : 0) || a.name.localeCompare(b.name);
    });
  const selected = selectedId ? workers.find(u => u.id === selectedId) || null : null;
  const selLoc = selected ? locById.get(selected.id) : undefined;

  const select = (id: string) => {
    setSelectedId(prev => prev === id ? prev : id);
    if (narrow) setSnap('peek'); // xarita va iz ko'rinsin
  };

  // ── Pastki panelni tortish (telefon): yuqoriga — kattalashadi, pastga — kichrayadi, bosish — almashadi ──
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const order: Snap[] = ['peek', 'half', 'full'];
  const onHandleDown = (e: React.PointerEvent) => { drag.current = { y: e.clientY, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onHandleUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    const i = order.indexOf(snap);
    if (dy < -30) setSnap(order[Math.min(2, i + 1)]);
    else if (dy > 30) setSnap(order[Math.max(0, i - 1)]);
    else setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
  };
  const sheetHeight = snap === 'peek' ? (selected ? '214px' : '150px') : snap === 'half' ? '52%' : 'calc(100% - 76px)';

  const filters: [Filter, string][] = [
    ['all', t('gps.fAll', { defaultValue: "Hammasi" })],
    ['working', t('gps.fWorking', { defaultValue: "Ishda" })],
    ['live', t('gps.fLive', { defaultValue: "Jonli" })],
    ['nosignal', t('gps.fNoSignal', { defaultValue: "Signal yo'q" })],
  ];

  const attChip = (u: AppUser) => {
    const a = attById.get(u.id);
    if (attLoading && !a) return <span className="text-muted-foreground">…</span>;
    if (!a || a.status === 'NOT_STARTED') return <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">{t('gps.notCame', { defaultValue: "Kelmagan" })}</span>;
    if (a.status === 'WORKING') return <span className="px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 font-semibold whitespace-nowrap">{t('gps.atWork', { defaultValue: "Ishda" })}{a.checkIn ? ` · ${fmtTime(a.checkIn)}` : ''}</span>;
    return <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold whitespace-nowrap">{t('gps.left', { defaultValue: "Ketgan" })}{a.checkOut ? ` · ${fmtTime(a.checkOut)}` : ''}</span>;
  };

  const row = (u: AppUser) => {
    const loc = locById.get(u.id);
    const min = loc ? minutesAgo(loc.timestamp) : null;
    const dot = min == null ? 'bg-muted-foreground/30' : min <= FRESH_MIN ? 'bg-green-500' : min <= 60 ? 'bg-amber-400' : 'bg-red-400';
    const active = u.id === selectedId;
    return (
      <div key={u.id} role="button" tabIndex={0} data-testid="gps-worker-row" aria-pressed={active}
        onClick={() => select(u.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(u.id); } }}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer liquid-transition min-w-0 ${active ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/40'}`}>
        <div className="relative flex-shrink-0">
          <Avatar user={u} size="sm" />
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${dot}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold truncate min-w-0">{u.name}</p>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{roleLabel(t, u.role)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] min-w-0">
            {attChip(u)}
            <span className={min != null && min <= FRESH_MIN ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>
              {min == null ? t('gps.noGpsData') : agoLabel(min)}
            </span>
            {(() => {
              const n = nearestObject(loc);
              if (!n) return null;
              return (
                <span className={n.inside ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-muted-foreground'}
                  title={n.inside ? t('gps.atObject', { defaultValue: 'Obyekt hududida' }) : t('gps.nearObject', { defaultValue: 'Eng yaqin obyekt' })}>
                  🏗 {n.name}{n.inside ? '' : ` · ${n.meters >= 1000 ? (n.meters / 1000).toFixed(1) + ' km' : n.meters + ' m'}`}
                </span>
              );
            })()}
            {loc?.battery != null && (
              <span className={loc.battery <= 20 && !loc.charging ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}>
                🔋{Math.round(loc.battery)}%{loc.charging ? '⚡' : ''}
              </span>
            )}
          </div>
        </div>
        <button type="button" onClick={e => { e.stopPropagation(); setProfileWorker(u); }} aria-label={t('gps.profile', { defaultValue: "Profil" })}
          className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:bg-muted">
          <MorphIcon icon={ChevronRight} className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const selectedCard = selected && (
    <div data-testid="gps-selected" className="rounded-2xl border border-primary/30 bg-primary/5 p-3 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar user={selected} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{selected.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {selLoc ? `${t('gps.lastSeenShort', { defaultValue: "Oxirgi" })}: ${agoLabel(minutesAgo(selLoc.timestamp))}${selLoc.accuracy != null ? ` · ±${Math.round(selLoc.accuracy)} m` : ''}` : t('gps.noGpsData')}
          </p>
        </div>
        <button type="button" onClick={() => setSelectedId(null)} aria-label={t('map.close')} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
          <MorphIcon icon={XIcon} className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] mt-2 text-muted-foreground" data-testid="gps-track-info">
        {trackState === 'loading' ? t('gps.trackLoading', { defaultValue: "Bugungi iz yuklanmoqda…" })
          : trackState === 'denied' ? t('gps.trackDenied', { defaultValue: "Izni ko'rishga ruxsat yo'q" })
          : trackState === 'error' ? t('gps.trackError', { defaultValue: "Izni yuklab bo'lmadi — internetni tekshiring" })
          : trackState === 'empty' ? t('gps.trackEmpty', { defaultValue: "Bugun GPS nuqtasi kelmagan" })
          : trackState === 'ok' ? (
            <span className="text-foreground">
              {t('gps.todayTrack', { defaultValue: "Bugun" })}: <b>{summary ? (summary.distanceM >= 1000 ? `${(summary.distanceM / 1000).toFixed(1)} km` : `${summary.distanceM} m`) : '…'}</b>
              {' · '}{t('gps.pointsN', { defaultValue: "{{n}} nuqta", n: track?.length || 0 })}
              {track && track.length > 0 && ` · ${fmtTime(track[0].timestamp)}–${fmtTime(track[track.length - 1].timestamp)}`}
            </span>
          ) : null}
      </p>
      <div className="flex gap-2 mt-2">
        {selLoc && (
          <button type="button" onClick={() => setNavTarget({ lat: selLoc.lat, lng: selLoc.lng, name: selected.name })}
            className="btn btn-outline flex-1 text-xs py-1.5 rounded-xl flex items-center justify-center gap-1.5">
            <MorphIcon icon={Navigation} className="w-3.5 h-3.5" />{t('gps.navigate', { defaultValue: "Yo'l ko'rsatish" })}
          </button>
        )}
        <button type="button" onClick={() => setProfileWorker(selected)} className="btn btn-primary flex-1 text-xs py-1.5 rounded-xl">
          {t('gps.fullProfile', { defaultValue: "To'liq profil" })}
        </button>
      </div>
    </div>
  );

  const listPanel = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative flex-1 min-w-0">
          <MorphIcon icon={Search} className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input data-testid="gps-search" type="search" value={query} onChange={e => setQuery(e.target.value)} onFocus={() => narrow && snap === 'peek' && setSnap('half')}
            placeholder={t('gps.searchPh', { defaultValue: "Xodimni qidirish" })} aria-label={t('gps.searchPh', { defaultValue: "Xodimni qidirish" })}
            className="w-full min-w-0 text-sm border border-border rounded-full pl-8 pr-3 py-1.5 bg-input-background focus:outline-none" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${filter === k ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground'}`}>
            {l} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>
      {selectedCard}
      {gpsLocations.length === 0 && !refreshing && workers.length > 0 && (
        <div data-testid="gps-empty" className="rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs px-3 py-2">
          <b>{t('gps.noGpsYet', { defaultValue: "Hali joylashuv kelmagan." })}</b> {t('gps.noGpsHelp', { defaultValue: "Xodim ilovada joylashuvga ruxsat berishi yoki Telegram botda \"Jonli joylashuv\" yuborishi kerak. Ishga kelganda avtomatik boshlanadi." })}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1 space-y-1" data-testid="gps-list">
        {workers.length === 0 ? (
          <div className="py-8 text-center">
            <MorphIcon icon={Users2} className="w-9 h-9 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t('gps.noWorkers')}</p>
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t('gps.notFound', { defaultValue: "Hech kim topilmadi" })}</p>
        ) : list.map(row)}
      </div>
    </>
  );

  const summaryChip = (
    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
      <b className="text-green-600 dark:text-green-400">{counts.live}</b> {t('gps.fLive', { defaultValue: "Jonli" }).toLowerCase()} · <b className="text-foreground">{counts.working}</b> {t('gps.fWorking', { defaultValue: "Ishda" }).toLowerCase()} · {counts.all}
    </span>
  );
  const refreshBtn = (
    <button type="button" onClick={refreshAll} disabled={refreshing || attLoading} aria-label={t('gps.refreshBtn')} title={t('gps.refreshBtn')}
      className="p-2 rounded-full border border-border bg-card hover:bg-muted flex-shrink-0 disabled:opacity-60">
      <MorphIcon icon={Refresh} className={`w-4 h-4 ${refreshing || attLoading ? 'animate-spin' : ''}`} />
    </button>
  );

  const map = (
    <WorkerMap users={workers} gpsLocations={gpsLocations} objects={mapObjects} focusUserId={selectedId} track={track} onSelect={select}
      className={narrow ? 'absolute inset-0 h-full' : 'h-full rounded-2xl'} />
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 relative flex flex-col md:flex-row md:gap-3 md:p-3 overflow-hidden" data-testid="gps-page">
      {narrow ? (
        <>
          {map}
          {/* Tepada suzuvchi sarlavha */}
          <div className="absolute top-2 left-2 right-2 z-[1001] surface border border-border/70 rounded-2xl px-3 py-2 flex items-center gap-2 shadow-lg min-w-0">
            <MorphIcon icon={MapPin} className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">{t('gps.title')}</p>
              {summaryChip}
            </div>
            {refreshBtn}
          </div>
          {/* Pastki panel */}
          <div data-testid="gps-sheet" data-snap={snap}
            className="absolute left-0 right-0 bottom-0 z-[1001] surface border-t border-border rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.18)] flex flex-col px-3 pb-2 gap-2 min-w-0"
            style={{ height: sheetHeight, transition: 'height 220ms cubic-bezier(.2,.8,.2,1)' }}>
            <button type="button" data-testid="gps-sheet-handle" aria-label={t('gps.toggleList', { defaultValue: "Ro'yxatni ochish/yopish" })}
              onPointerDown={onHandleDown} onPointerUp={onHandleUp} onPointerCancel={() => { drag.current = null; }}
              className="w-full pt-2 pb-1 flex flex-col items-center gap-1 touch-none flex-shrink-0">
              <span className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
              <span className="text-[11px] font-semibold text-muted-foreground">{t('gps.tabList')} · {counts.all}</span>
            </button>
            {listPanel}
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0 min-h-[320px] relative">{map}</div>
          <aside className="w-[360px] lg:w-[400px] flex-shrink-0 surface border border-border rounded-2xl p-3 flex flex-col gap-2 min-h-0" data-testid="gps-sheet">
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold truncate">{t('gps.title')}</h2>
                {summaryChip}
              </div>
              {refreshBtn}
            </div>
            {listPanel}
          </aside>
        </>
      )}
      {navTarget && <NavigateChoiceModal target={navTarget} onClose={() => setNavTarget(null)} />}
      {profileWorker && (
        <WorkerProfileModal worker={profileWorker} transfers={transfers} expenses={expenses} onClose={() => setProfileWorker(null)} />
      )}
    </div>
  );
}
