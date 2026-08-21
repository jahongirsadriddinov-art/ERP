import { useEffect, useState } from "react";
import { MapPin, Users2, Clock } from "lucide-react";
import { AppUser, Avatar, fmtWorkDuration } from "./App";
import { API_BASE } from "./api";
import WorkerMap, { NavigateChoiceModal } from "./WorkerMap";

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
export default function GpsTrackingPage({ users, gpsLocations, refreshing, onRefresh }: {
  users: AppUser[];
  gpsLocations: Array<{userId: string; lat: number; lng: number; accuracy?: number; timestamp: string; source?: 'site'|'bot_live'|'bot_once'}>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [attLoading, setAttLoading] = useState(true);
  const [navTarget, setNavTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);

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
  const statusLabel = (min: number) => min < 10 ? `${min} daq. oldin` : min < 60 ? `${min} daq. oldin` : `${Math.floor(min/60)}s ${min%60}d oldin`;
  const roleLabel: Record<string, string> = { ishchi: 'Ishchi', prorab: 'Prorab', brigadir: 'Brigadir', orinbosar: "O'rinbosar", direktor: 'Direktor' };
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  const attendanceById = new Map(attendance.map(a => [a.userId, a]));

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="max-w-lg md:max-w-2xl mx-auto w-full px-4 pb-10 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Xodimlar joylashuvi va yo'qlamasi</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Real-vaqt GPS kuzatuv + bugungi ish holati</p>
          </div>
          <button onClick={refreshAll} disabled={refreshing || attLoading}
            className="btn btn-outline text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 flex-shrink-0">
            <MapPin className={`w-3.5 h-3.5 ${refreshing || attLoading ? 'animate-pulse' : ''}`}/>
            {refreshing || attLoading ? 'Yangilanmoqda...' : 'Yangilash'}
          </button>
        </div>

        {workers.length > 0 && <WorkerMap users={workers} gpsLocations={gpsLocations} />}

        {workers.length === 0 && (
          <div className="surface rounded-2xl p-8 text-center">
            <Users2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2"/>
            <p className="text-sm text-muted-foreground">Xodimlar topilmadi</p>
          </div>
        )}

        {workers.map(u => {
          const loc = gpsLocations.find(g => g.userId === u.id);
          const min = loc ? minutesAgo(loc.timestamp) : null;
          const att = attendanceById.get(u.id);
          return (
            <div key={u.id} className="surface rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <Avatar user={u} size="md"/>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${loc ? statusColor(min!) : 'bg-muted-foreground/30'}`}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{u.name}</p>
                  <p className="text-[11px] text-muted-foreground">{roleLabel[u.role] || u.role}</p>
                  {loc ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <MapPin className="w-3 h-3 text-muted-foreground/60 flex-shrink-0"/>
                      <span className="text-[10px] text-muted-foreground">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground mt-1">GPS ma'lumoti yo'q</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  {loc ? (
                    <div className="space-y-1">
                      <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${min! < 10 ? 'bg-green-500/15 text-green-700 dark:text-green-400' : min! < 30 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
                        {statusLabel(min!)}
                      </div>
                      <button onClick={() => setNavTarget({ lat: loc.lat, lng: loc.lng, name: u.name })}
                        className="text-[10px] text-primary underline block ml-auto">Xarita</button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/50">Offline</span>
                  )}
                </div>
              </div>
              {/* Yo'qlama — bugungi kirish/chiqish/ishlagan vaqt */}
              <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"/>
                {attLoading ? (
                  <span className="text-[11px] text-muted-foreground">Yuklanmoqda...</span>
                ) : !att || att.status === 'NOT_STARTED' ? (
                  <span className="text-[11px] font-medium text-muted-foreground">Hali ishga kelmagan</span>
                ) : att.status === 'WORKING' ? (
                  <span className="text-[11px] font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0"/>
                    Hozir ishlayapti — {att.checkIn && fmtTime(att.checkIn)} dan beri
                    {att.minutesWorking != null && ` (${att.minutesWorking < 60 ? `${att.minutesWorking} daq` : `${Math.floor(att.minutesWorking/60)}s ${att.minutesWorking%60}d`})`}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    <span className="text-foreground font-medium">{att.checkIn && fmtTime(att.checkIn)} – {att.checkOut && fmtTime(att.checkOut)}</span>
                    {att.checkIn && att.checkOut && ` · ${fmtWorkDuration(att.checkIn, att.checkOut)} ishladi`}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {workers.length > 0 && gpsLocations.length === 0 && !refreshing && (
          <div className="surface rounded-2xl p-6 text-center">
            <p className="text-sm text-muted-foreground">GPS ma'lumotlar yo'q. Xodimlar ishga kelmagan yoki GPS yoqilmagan.</p>
          </div>
        )}
      </div>
      {navTarget && <NavigateChoiceModal target={navTarget} onClose={() => setNavTarget(null)} />}
    </div>
  );
}
