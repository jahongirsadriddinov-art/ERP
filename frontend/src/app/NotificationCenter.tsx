import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bell, X, Check, CheckCheck, MessageCircle, Package, Wallet, Clock, Info, QrCode, MapPin, Trash2 } from "lucide-react";
import { API_BASE } from "./api";
import { motion, AnimatePresence } from "motion/react";

interface Notif {
  _id: string;
  type: string;
  title: string;
  body: string;
  entity?: string;
  entityId?: string;
  url?: string;
  read: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, any> = {
  message: MessageCircle,
  transfer: Package,
  expense: Wallet,
  approval_request: Clock,
  approval_result: Check,
  qr_scan: QrCode,
  gps: MapPin,
  system: Info,
};

interface Props {
  token: string;
  onOpenPage?: (url: string) => void;
}

export default function NotificationCenter({ token, onOpenPage }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return t("notifications.justNow");
    if (m < 60) return t("notifications.minutesAgo", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("notifications.hoursAgo", { count: h });
    return t("notifications.daysAgo", { count: Math.floor(h / 24) });
  }

  const fetchNotifications = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/notifications?limit=30`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    const fetchCount = async () => {
      try {
        const res = await fetch(`${API_BASE}/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.count || 0);
        }
      } catch {}
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await fetch(`${API_BASE}/notifications/${id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  };

  const deleteNotif = async (id: string, wasUnread: boolean) => {
    try {
      await fetch(`${API_BASE}/notifications/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications(prev => prev.filter(n => n._id !== id));
      if (wasUnread) setUnreadCount(c => Math.max(0, c - 1));
    } catch {}
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} title={t("notifications.title")}
        className="btn btn-ghost w-9 h-9 p-0 rounded-full relative">
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="badge-pulse absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-accent text-accent-foreground rounded-full text-[9px] flex items-center justify-center font-bold shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden z-50 shadow-2xl border border-white/10"
            style={{ background: "var(--glass-bg, rgba(15,20,40,0.95))", backdropFilter: "blur(20px)" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <p className="text-sm font-bold text-white">{t("notifications.title")}</p>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} title={t("notifications.markAllRead")}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
                    <CheckCheck className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto scrollbar-hide">
              {loading && notifications.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              )}
              {!loading && notifications.length === 0 && (
                <div className="text-center py-10">
                  <Bell className="w-8 h-8 text-white/20 mx-auto mb-2" />
                  <p className="text-xs text-white/40">{t("notifications.empty")}</p>
                </div>
              )}
              {notifications.map(n => {
                const Icon = TYPE_ICONS[n.type] || Info;
                return (
                  <div key={n._id}
                    className={`group flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${!n.read ? "bg-primary/5" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${!n.read ? "bg-primary/25 text-primary" : "bg-white/10 text-white/40"}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                      if (!n.read) markRead(n._id);
                      if (n.url && onOpenPage) onOpenPage(n.url);
                    }}>
                      <p className={`text-xs font-semibold truncate ${!n.read ? "text-white" : "text-white/70"}`}>{n.title}</p>
                      <p className="text-[11px] text-white/50 line-clamp-2 mt-0.5">{n.body}</p>
                      <p className="text-[10px] text-white/30 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!n.read && (
                        <button onClick={() => markRead(n._id)}
                          className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white">
                          <Check className="w-3 h-3" />
                        </button>
                      )}
                      <button onClick={() => deleteNotif(n._id, !n.read)}
                        className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
