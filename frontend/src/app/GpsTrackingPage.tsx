import { useEffect, useState } from "react";
import { MapPin, Users2, Clock, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppUser, Avatar, Transfer, Expense, fmtWorkDuration, roleLabel } from "./App";
import { API_BASE } from "./api";
import WorkerMap, { NavigateChoiceModal } from "./WorkerMap";
import WorkerProfileModal from "./WorkerProfileModal";

interface AttendanceEntry {
  userId: string;
  status: 'NOT_STARTED' | 'WORKING' | 'FINISHED';
  checkIn: string | null;
  checkOut: string | null;
  workHours: number | null;
  minutesWorking: number | null;
}

// Direktor/o'rinbosarning "Kuzatuv" sahifasi — App.tsx'dan ajratildi va
// lazy-load qilinadigan bo'ldi (boshqa og'ir sahifalar — ReportsPage,
// DeveloperPanel va h.k. — bilan bir xil pattern), chunki xarita/joylashuv
// ro'yxati faqat ushbu 2 rolga kerak, boshqa hamma uchun ilk yuklashda
// keraksiz kod bo'lardi.
//
// Yo'qlama (attendance) ham shu sahifaga qo'shildi — alohida nav band
// ochish o'rniga, "xodim qayerda + bugun ishga keldimi" bir joyda ko'rinadi
// (GET /api/attendance/list, faqat direktor/orinbosar/dasturchi).
export default function GpsTrackingPage({ users, gpsLocations, refreshing, onRefresh, transfers, expenses }: {
  users: AppUser[];
  gpsLocations: Array<{userId: string; lat: number; lng: number; accuracy?: number; timestamp: string; source?: 'site'|'bot_live'|'bot_once'}>;
  refreshing: boolean;
  onRefresh: () => void;
  transfers: Transfer[];
  expenses: Expense[];
}) {
  const { t } = useTranslation();
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [attLoading, setAttLoading] = useState(true);
  const [navTarget, setNavTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);
  // "Kuzatuv"ga qo'shilgan yangi bo'lim: xodim kartasini bosganda uning
  // TO'LIQ profili (davomat tarixi, yuborgan/qabul qilgan materiallar,
  // olgan ish haqi, chiqimlari, tanlangan kun bo'yicha GPS izi) ochiladi.
  const [profileWorker, setProfileWorker] = useState<AppUser | null>(null);
  // Aniq talab: "alohida bolim yarat... ichida asosiy jonli gps kuzatuv
  // turadi, ikkinchi bolimda ishchilar royxati" — bitta uzun sahifa
  // o'rniga IKKI ALOHIDA yorliq (ObjectDetailPage'dagi tab pattern'i bilan
  // bir xil): "map" = faqat jonli xarita, "list" = ishchilar ro'yxati
  // (bosilganda batafsil profil ochiladi).
  const [tab, setTab] = useState<'map' | 'list'>('map');

  const loadAttendance = () => {
    setAttLoading(true);
    const token = localStorage.getItem('token') || '';
    fetch(`${API_BASE}/api/attendance/list`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setAttendance(Array.isArray(d) ? d : []))
      .catch(() => setAttendance([]))
      .finally(() => setAttLoading(false));
  };

  const refreshAll = () => { onRefresh(); loadAttendance(); };

  useEffect(() => {
    refreshAll();
    // Avtomatik yangilanish — har 2 daqiqada (aniq talab qilingan), qo'lda
    // "Yangilash" tugmasidan tashqari. Sahifadan chiqqanda tozalanadi.
    const interval = setInterval(refreshAll, 2 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workerRoles = ['ishchi', 'prorab', 'brigadir'];
  const workers = users.filter(u => workerRoles.includes(u.role));
  const now = Date.now();
  const minutesAgo = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 60000);
  const statusColor = (min: number) => min < 10 ? 'bg-green-500' : min < 30 ? 'bg-amber-400' : 'bg-red-400';
  const statusLabel = (min: number) => min < 60 ? t('gps.minutesAgo', { min }) : t('gps.hoursMinutesAgo', { h: Math.floor(min / 60), m: min % 60 });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  const attendanceById = new Map(attendance.map(a => [a.userId, a]));

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="max-w-lg md:max-w-2xl mx-auto w-full px-4 pb-10 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{t('gps.pageTitle')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('gps.pageSubtitle')}</p>
          </div>
          <button onClick={refreshAll} disabled={refreshing || attLoading}
            className="btn btn-outline text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 flex-shrink-0">
            <MapPin className={`w-3.5 h-3.5 ${refreshing || attLoading ? 'animate-pulse' : ''}`}/>
            {refreshing || attLoading ? t('gps.refreshing') : t('gps.refreshBtn')}
          </button>
        </div>

        {/* Yorliqlar — "Jonli xarita" (asosiy jonli GPS kuzatuv) va "Ishchilar
            ro'yxati" (bosilganda batafsil profil) ikki ALOHIDA bo'lim. */}
        <div className="flex gap-1.5 surface rounded-full p-1">
          <button onClick={() => setTab('map')}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-full liquid-transition ${tab === 'map' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted/50'}`}>
            <MapPin className="w-3.5 h-3.5"/>{t('gps.tabMap')}
          </button>
          <button onClick={() => setTab('list')}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-full liquid-transition ${tab === 'list' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted/50'}`}>
            <Users2 className="w-3.5 h-3.5"/>{t('gps.tabList')}
          </button>
        </div>

        {tab === 'map' && workers.length > 0 && <WorkerMap users={workers} gpsLocations={gpsLocations} />}

        {workers.length === 0 && (
          <div className="surface rounded-2xl p-8 text-center">
            <Users2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2"/>
            <p className="text-sm text-muted-foreground">{t('gps.noWorkers')}</p>
          </div>
        )}

        {tab === 'list' && workers.map(u => {
          const loc = gpsLocations.find(g => g.userId === u.id);
          const min = loc ? minutesAgo(loc.timestamp) : null;
          const att = attendanceById.get(u.id);
          return (
            // XATO TUZATILDI: bu ichida allaqachon o'zining <button>i ("Xarita"
            // havolasi) bor edi — <button> ichida <button> HTML'da yaroqsiz
            // (va bosilganda ikkalasi ham ishga tushib, ikkita modal birdan
            // ochilardi). Shu sabab tashqi element div + role="button" (klaviatura
            // uchun tabIndex/onKeyDown bilan), ichkarisi esa stopPropagation bilan.
            <div key={u.id} role="button" tabIndex={0}
              onClick={() => setProfileWorker(u)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProfileWorker(u); } }}
              className="surface rounded-2xl p-4 space-y-3 w-full text-left hover:bg-muted/20 liquid-transition cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <Avatar user={u} size="md"/>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${loc ? statusColor(min!) : 'bg-muted-foreground/30'}`}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{u.name}</p>
                  <p className="text-[11px] text-muted-foreground">{roleLabel(t, u.role)}</p>
                  {loc ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <MapPin className="w-3 h-3 text-muted-foreground/60 flex-shrink-0"/>
                      <span className="text-[10px] text-muted-foreground">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span>
                      {/* Aniqlik (±metr) — avval bazada saqlanardi, lekin bu ro'yxatda
                          hech qachon KO'RSATILMASDI (faqat xaritadagi doira/tooltipda
                          bor edi) — foydalanuvchi koordinata qanchalik ishonchli
                          ekanini bilmasdi. >300m — odatda GPS chip emas, tarmoq/IP-
                          asosli taxminiy joylashuv, shu sabab alohida rangda ajratiladi. */}
                      {loc.accuracy != null && (
                        <span className={`text-[9px] font-mono flex-shrink-0 ${loc.accuracy > 300 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70'}`}>
                          ±{Math.round(loc.accuracy)}m
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground mt-1">{t('gps.noGpsData')}</p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" aria-hidden="true"/>
                <div className="flex-shrink-0 text-right">
                  {loc ? (
                    <div className="space-y-1">
                      <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${min! < 10 ? 'bg-green-500/15 text-green-700 dark:text-green-400' : min! < 30 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
                        {statusLabel(min!)}
                      </div>
                      <button onClick={e => { e.stopPropagation(); setNavTarget({ lat: loc.lat, lng: loc.lng, name: u.name }); }}
                        className="text-[10px] text-primary underline block ml-auto">{t('gps.mapLink')}</button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/50">{t('gps.offline')}</span>
                  )}
                </div>
              </div>
              {/* Yo'qlama — bugungi kirish/chiqish/ishlagan vaqt */}
              <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"/>
                {attLoading ? (
                  <span className="text-[11px] text-muted-foreground">{t('gps.loadingAttendance')}</span>
                ) : !att || att.status === 'NOT_STARTED' ? (
                  <span className="text-[11px] font-medium text-muted-foreground">{t('gps.notStartedYet')}</span>
                ) : att.status === 'WORKING' ? (
                  <span className="text-[11px] font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0"/>
                    {t('gps.workingSince', { time: att.checkIn ? fmtTime(att.checkIn) : '' })}
                    {att.minutesWorking != null && ` (${att.minutesWorking < 60 ? t('gps.minutesShort', { min: att.minutesWorking }) : t('gps.hoursMinutesShort', { h: Math.floor(att.minutesWorking / 60), m: att.minutesWorking % 60 })})`}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    <span className="text-foreground font-medium">{att.checkIn && fmtTime(att.checkIn)} – {att.checkOut && fmtTime(att.checkOut)}</span>
                    {att.checkIn && att.checkOut && ` · ${t('gps.workedDuration', { duration: fmtWorkDuration(att.checkIn, att.checkOut, t) })}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {tab === 'list' && workers.length > 0 && gpsLocations.length === 0 && !refreshing && (
          <div className="surface rounded-2xl p-6 text-center">
            <p className="text-sm text-muted-foreground">{t('gps.noGpsInfo')}</p>
          </div>
        )}
      </div>
      {navTarget && <NavigateChoiceModal target={navTarget} onClose={() => setNavTarget(null)} />}
      {profileWorker && (
        <WorkerProfileModal worker={profileWorker} transfers={transfers} expenses={expenses} onClose={() => setProfileWorker(null)} />
      )}
    </div>
  );
}
