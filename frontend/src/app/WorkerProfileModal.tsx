import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { X, Calendar, Clock, ArrowUpRight, ArrowDownLeft, Wallet, Receipt, MapPin, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppUser, Avatar, Transfer, Expense, fmt, fmtWorkDuration, roleLabel, expLabel } from "./App";
import { API_BASE } from "./api";

interface AttendanceRow { id: string; date: string; checkIn?: string | null; checkOut?: string | null; status: string; workHours?: number | null }
interface GpsPoint { lat: number; lng: number; timestamp: string; accuracy?: number }

// "Kuzatuv" sahifasidagi har bir xodim kartasini bosganda ochiladigan
// TO'LIQ profil — davomat tarixi, yuborgan/qabul qilgan materiallar, olgan
// ish haqi, o'zi yaratgan chiqimlar, va tanlangan kun bo'yicha GPS izi
// (qayerlarga borgani, xaritada chiziq sifatida). Aniq talab: "har bitta
// hodim ro'yxati boladi kirganda uni jami malumotlari... tanlangan kuni ga
// qarap gps joylashuvini... korsatadi".
export default function WorkerProfileModal({ worker, transfers, expenses, onClose }: {
  worker: AppUser; transfers: Transfer[]; expenses: Expense[]; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [attLoading, setAttLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [trail, setTrail] = useState<GpsPoint[]>([]);
  const [trailLoading, setTrailLoading] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Davomat tarixi — oxirgi 90 kun (cheksiz o'sib ketmasligi uchun; ko'p
  // yillik xodim uchun ham ro'yxat oqilg'on bo'lib qoladi).
  useEffect(() => {
    setAttLoading(true);
    const token = localStorage.getItem('token') || '';
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fetch(`${API_BASE}/api/attendance?userId=${worker.id}&from=${from}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setAttendance(Array.isArray(d) ? d : []))
      .catch(() => setAttendance([]))
      .finally(() => setAttLoading(false));
  }, [worker.id]);

  // GPS izi — TANLANGAN kun uchun (kun almashganda qayta so'raladi).
  useEffect(() => {
    setTrailLoading(true);
    const token = localStorage.getItem('token') || '';
    const from = `${selectedDate}T00:00:00`;
    const to = `${selectedDate}T23:59:59`;
    fetch(`${API_BASE}/api/gps/user/${worker.id}?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setTrail(Array.isArray(d) ? d : []))
      .catch(() => setTrail([]))
      .finally(() => setTrailLoading(false));
  }, [worker.id, selectedDate]);

  // Mini xarita — TANLANGAN kunning izi (chiziq + boshlanish/tugash nuqtasi).
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, { zoomControl: true, attributionControl: false }).setView([41.2995, 69.2401], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
    }
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (trail.length === 0) return;
    const pts = trail.map(p => [p.lat, p.lng] as [number, number]);
    L.polyline(pts, { color: 'var(--primary)', weight: 3, opacity: 0.8 }).addTo(layer);
    L.circleMarker(pts[0], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }).bindTooltip(t('gps.trailStart')).addTo(layer);
    if (pts.length > 1) L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).bindTooltip(t('gps.trailEnd')).addTo(layer);
    map.fitBounds(pts.length > 1 ? pts : [pts[0], pts[0]], { padding: [30, 30], maxZoom: 16 });
  }, [trail, t]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  const sent = useMemo(() => transfers.filter(tr => tr.fromUserId === worker.id), [transfers, worker.id]);
  const received = useMemo(() => transfers.filter(tr => tr.toUserId === worker.id), [transfers, worker.id]);
  const salary = useMemo(() => expenses.filter(e => e.type === 'oylik' && e.toUserId === worker.id), [expenses, worker.id]);
  const salaryTotal = useMemo(() => salary.filter(e => e.status === 'confirmed').reduce((s, e) => s + e.amount, 0), [salary]);
  const ownExpenses = useMemo(() => expenses.filter(e => e.createdById === worker.id), [expenses, worker.id]);
  const ownExpensesTotal = useMemo(() => ownExpenses.filter(e => e.status === 'confirmed').reduce((s, e) => s + e.amount, 0), [ownExpenses]);

  const daysWorked = attendance.filter(a => a.checkIn).length;
  const totalHours = attendance.reduce((s, a) => s + (a.workHours || 0), 0);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }) : '—';

  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg h-[92dvh] sm:h-[85vh] surface rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60 flex-shrink-0">
          <Avatar user={worker} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate min-w-0">{worker.name}</p>
            <p className="text-[11px] text-muted-foreground">{roleLabel(t, worker.role)}</p>
          </div>
          <button onClick={onClose} aria-label={t('map.close')} className="p-2 rounded-full hover:bg-muted flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide touch-pan-y p-4 space-y-4">
          {/* Summary chips */}
          <div className="grid grid-cols-2 gap-2">
            <div className="surface rounded-2xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('workerProfile.daysWorked')}</p>
              <p className="text-lg font-bold font-mono mt-0.5">{daysWorked}</p>
            </div>
            <div className="surface rounded-2xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('workerProfile.totalHours')}</p>
              <p className="text-lg font-bold font-mono mt-0.5">{Math.round(totalHours * 10) / 10}</p>
            </div>
            <div className="surface rounded-2xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Wallet className="w-3 h-3" />{t('workerProfile.salaryReceived')}</p>
              <p className="text-sm font-bold font-mono mt-0.5 text-green-700 dark:text-green-400">{fmt(salaryTotal)}</p>
            </div>
            <div className="surface rounded-2xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Receipt className="w-3 h-3" />{t('workerProfile.expensesCreated')}</p>
              <p className="text-sm font-bold font-mono mt-0.5">{fmt(ownExpensesTotal)}</p>
            </div>
          </div>

          {/* Materiallar */}
          <div className="surface rounded-2xl p-3 space-y-2">
            <p className="text-xs font-bold flex items-center gap-1.5"><ArrowUpRight className="w-3.5 h-3.5 text-primary" />{t('workerProfile.materialsSent', { count: sent.length })}</p>
            {sent.length === 0 ? <p className="text-[11px] text-muted-foreground">{t('workerProfile.none')}</p> : (
              <div className="space-y-1 max-h-24 overflow-y-auto scrollbar-hide touch-pan-y">
                {sent.slice(0, 20).map(tr => (
                  <div key={tr.id} className="flex items-center justify-between text-[11px]">
                    <span className="truncate min-w-0 flex-1">{tr.materialName}</span>
                    <span className="text-muted-foreground font-mono flex-shrink-0 ml-2">{tr.quantity} {tr.unit}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs font-bold flex items-center gap-1.5 pt-1 border-t border-border/50"><ArrowDownLeft className="w-3.5 h-3.5 text-accent" />{t('workerProfile.materialsReceived', { count: received.length })}</p>
            {received.length === 0 ? <p className="text-[11px] text-muted-foreground">{t('workerProfile.none')}</p> : (
              <div className="space-y-1 max-h-24 overflow-y-auto scrollbar-hide touch-pan-y">
                {received.slice(0, 20).map(tr => (
                  <div key={tr.id} className="flex items-center justify-between text-[11px]">
                    <span className="truncate min-w-0 flex-1">{tr.materialName}</span>
                    <span className="text-muted-foreground font-mono flex-shrink-0 ml-2">{tr.quantity} {tr.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chiqimlar ro'yxati */}
          {ownExpenses.length > 0 && (
            <div className="surface rounded-2xl p-3 space-y-1.5">
              <p className="text-xs font-bold">{t('workerProfile.expensesList')}</p>
              <div className="space-y-1 max-h-28 overflow-y-auto scrollbar-hide touch-pan-y">
                {ownExpenses.slice(0, 30).map(e => (
                  <div key={e.id} className="flex items-center justify-between text-[11px]">
                    <span className="truncate min-w-0 flex-1">{expLabel(t, e.type)} — {e.description}</span>
                    <span className={`font-mono flex-shrink-0 ml-2 ${e.status === 'confirmed' ? '' : 'text-muted-foreground/60'}`}>{fmt(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Davomat tarixi */}
          <div className="surface rounded-2xl p-3 space-y-1.5">
            <p className="text-xs font-bold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{t('workerProfile.attendanceHistory')}</p>
            {attLoading ? (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin" />{t('gps.loadingAttendance')}</div>
            ) : attendance.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t('workerProfile.none')}</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-hide touch-pan-y">
                {attendance.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-[11px] py-0.5">
                    <span className="text-muted-foreground">{fmtDate(a.date)}</span>
                    <span className="font-mono">{fmtTime(a.checkIn)} – {fmtTime(a.checkOut)}</span>
                    <span className="text-muted-foreground font-mono">{a.checkIn && a.checkOut ? fmtWorkDuration(a.checkIn, a.checkOut, t) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Kun bo'yicha GPS izi */}
          <div className="surface rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{t('workerProfile.dailyTrail')}</p>
              <div className="relative flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="date" value={selectedDate} max={new Date().toISOString().slice(0, 10)}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="text-[11px] bg-input-background border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div className="relative w-full h-[220px] rounded-xl overflow-hidden">
              <div ref={mapContainerRef} className="w-full h-full" />
              {trailLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!trailLoading && trail.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70 pointer-events-none">
                  <p className="text-xs text-muted-foreground">{t('workerProfile.noTrailData')}</p>
                </div>
              )}
            </div>
            {trail.length > 0 && <p className="text-[10px] text-muted-foreground">{t('workerProfile.trailPoints', { count: trail.length })}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
