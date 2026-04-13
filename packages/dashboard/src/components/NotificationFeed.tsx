import { useEffect, useState } from 'react';
import {
  Bell,
  Loader2,
  Check,
  AlertTriangle,
  ArrowRight,
  FileText,
  RefreshCw,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { Notification } from '../types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const URGENCY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  critical: {
    bg: 'bg-status-reverted/10',
    text: 'text-status-reverted',
    dot: 'bg-status-reverted',
  },
  high: {
    bg: 'bg-[#DA7101]/10',
    text: 'text-[#DA7101]',
    dot: 'bg-[#DA7101]',
  },
  medium: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    dot: 'bg-primary',
  },
  low: {
    bg: 'bg-gray-200',
    text: 'text-[var(--text-secondary)]',
    dot: 'bg-gray-400',
  },
};

const TYPE_ICONS: Record<string, typeof Bell> = {
  contradiction: AlertTriangle,
  supersession: ArrowRight,
  new_decision: FileText,
  status_change: RefreshCw,
  session_complete: CheckCircle2,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NotificationFeed() {
  const { get, patch } = useApi();
  const { projectId } = useProject();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    get<Notification[]>(`/api/projects/${projectId}/notifications`)
      .then((data) => {
        if (!cancelled) {
          setNotifications(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err?.message ?? 'Failed to load notifications');
          setError(msg);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markAsRead(id: string) {
    try {
      await patch(`/api/projects/${projectId}/notifications/${id}`, {
        read: true,
      });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      // Silently fail
    }
  }

  async function markAllAsRead() {
    const unread = notifications.filter((n) => !n.read);
    try {
      await Promise.all(
        unread.map((n) =>
          patch(`/api/projects/${projectId}/notifications/${n.id}`, {
            read: true,
          }),
        ),
      );
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Silently fail
    }
  }

  function formatTime(iso: string) {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ---- Loading / Error ------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">Loading notifications…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center">
          <p className="text-sm text-status-reverted">{error}</p>
        </div>
      </div>
    );
  }

  /* ---- Derived data ------------------------------------------------ */
  const sortedFiltered = [...filtered].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // Separate the first critical/high notification for the hero card, rest go to grid
  const heroNotification = sortedFiltered.find(
    (n) => n.urgency === 'critical' || n.urgency === 'high',
  );
  const remainingNotifications = sortedFiltered.filter((n) => n !== heroNotification);

  // Severity counts for the swarm health section
  const criticalCount = notifications.filter((n) => n.urgency === 'critical').length;
  const highCount = notifications.filter((n) => n.urgency === 'high').length;
  const mediumCount = notifications.filter((n) => n.urgency === 'medium').length;

  const ACCENT_BAR_COLORS: Record<string, string> = {
    critical: '#DC2626',
    high: '#D97706',
    medium: '#063ff9',
    low: '#9B9B9B',
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        {/* -- Page Header --------------------------------------- */}
        <div className="mb-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-5xl font-bold tracking-tight mb-4 flex items-center gap-3">
                Alerts &amp; Notifications
                {unreadCount > 0 && (
                  <span className="px-3 py-1 text-sm font-bold rounded-full bg-[#063ff9] text-white">
                    {unreadCount}
                  </span>
                )}
              </h2>
              <p className="text-xl text-[var(--text-secondary)] max-w-2xl font-light">
                Real-time oversight of cross-agent logic flows, policy adherence, and system health events.
              </p>
            </div>

            {/* Filter pill tabs */}
            <div
              className="flex gap-1 p-1.5 rounded-2xl shrink-0"
              style={{
                background: 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.4)',
              }}
            >
              <button
                onClick={() => setFilter('all')}
                className={`px-6 py-2 rounded-xl font-bold text-sm transition-all ${
                  filter === 'all'
                    ? 'bg-[#063ff9] text-white shadow-lg'
                    : 'text-[var(--text-secondary)] hover:bg-white/40'
                }`}
              >
                All Events
                <span className="ml-1.5 text-xs opacity-60">({notifications.length})</span>
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`px-6 py-2 rounded-xl font-medium text-sm transition-all ${
                  filter === 'unread'
                    ? 'bg-[#063ff9] text-white shadow-lg'
                    : 'text-[var(--text-secondary)] hover:bg-white/40'
                }`}
              >
                Unread
                <span className="ml-1.5 text-xs opacity-60">({unreadCount})</span>
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="px-6 py-2 rounded-xl text-[var(--text-secondary)] font-medium text-sm hover:bg-white/40 transition-all flex items-center gap-2"
                >
                  <Check size={14} />
                  Mark all read
                </button>
              )}
            </div>
          </div>
        </div>

        {/* -- Bento Grid ---------------------------------------- */}
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Bell
              size={28}
              className="mx-auto mb-2 text-[var(--text-tertiary)]"
            />
            <p className="text-sm text-[var(--text-secondary)]">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* -- Hero Alert Card (col-span-8) ------------------ */}
            {heroNotification && (() => {
              const urgency = URGENCY_COLORS[heroNotification.urgency] || URGENCY_COLORS.low;
              const IconComponent = TYPE_ICONS[heroNotification.type] || Bell;
              const accentColor = ACCENT_BAR_COLORS[heroNotification.urgency] || '#9B9B9B';

              return (
                <div className="col-span-12 lg:col-span-8">
                  <div
                    className="p-8 rounded-3xl relative overflow-hidden group hover:shadow-[0_25px_50px_rgba(0,0,0,0.08)] transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.6)',
                      backdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255,255,255,0.4)',
                    }}
                  >
                    {/* Left accent bar */}
                    <div
                      className="absolute top-0 left-0 w-2 h-full"
                      style={{ backgroundColor: accentColor }}
                    />

                    <div className="flex justify-between items-start mb-6">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl ${urgency.bg} flex items-center justify-center`}>
                          <IconComponent size={24} className={urgency.text} />
                        </div>
                        <div>
                          <span className={`text-xs font-bold uppercase tracking-widest ${urgency.text}`}>
                            {(heroNotification.type ?? '').replace(/_/g, ' ')}
                          </span>
                          <h3 className="text-2xl font-bold mt-1">{heroNotification.message}</h3>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-[var(--text-secondary)]">
                        {formatTime(heroNotification.created_at)}
                      </span>
                    </div>

                    {heroNotification.role_context && (
                      <p className="text-[var(--text-secondary)] mb-8 text-lg leading-relaxed">
                        {heroNotification.role_context}
                      </p>
                    )}

                    <div className="flex gap-4">
                      {!heroNotification.read && (
                        <button
                          onClick={() => markAsRead(heroNotification.id)}
                          className="px-6 py-2.5 rounded-xl font-bold hover:scale-105 transition-transform flex items-center gap-2 text-white"
                          style={{ backgroundColor: accentColor }}
                        >
                          <Eye size={16} />
                          Mark as Read
                        </button>
                      )}
                      <button
                        className="px-6 py-2.5 rounded-xl font-bold hover:bg-white/80 transition-all"
                        style={{
                          background: 'rgba(255,255,255,0.6)',
                          backdropFilter: 'blur(24px)',
                          border: '1px solid rgba(255,255,255,0.4)',
                        }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* -- Side Digest Card (col-span-4) ----------------- */}
            {heroNotification && (
              <div className="col-span-12 lg:col-span-4">
                <div
                  className="p-8 rounded-3xl h-full border-[#063ff9]/20 hover:shadow-[0_25px_50px_rgba(6,63,249,0.1)] transition-all"
                  style={{
                    background: 'rgba(6, 63, 249, 0.05)',
                    backdropFilter: 'blur(24px)',
                    border: '1px solid rgba(6, 63, 249, 0.2)',
                  }}
                >
                  <div className="w-12 h-12 rounded-2xl bg-[#063ff9] flex items-center justify-center text-white mb-6">
                    <FileText size={24} />
                  </div>
                  <span className="text-xs font-bold text-[#063ff9] uppercase tracking-widest">System Report</span>
                  <h3 className="text-2xl font-bold mt-2 mb-4">
                    {notifications.length} total alerts
                  </h3>
                  <p className="text-[var(--text-secondary)] mb-8">
                    {unreadCount} unread notifications requiring attention. {criticalCount > 0 ? `${criticalCount} critical alerts detected.` : 'No critical issues.'}
                  </p>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="text-[#063ff9] font-bold flex items-center gap-2 group"
                    >
                      <Check size={16} />
                      Mark All Read
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* -- Remaining Alert Cards ------------------------- */}
            {remainingNotifications.map((notification, idx) => {
              const urgency = URGENCY_COLORS[notification.urgency] || URGENCY_COLORS.low;
              const IconComponent = TYPE_ICONS[notification.type] || Bell;
              const accentColor = ACCENT_BAR_COLORS[notification.urgency] || '#9B9B9B';

              // Vary column spans: first two get 6 cols, then 4 cols
              const colSpan = idx < 2 ? 'col-span-12 md:col-span-6 lg:col-span-4' : 'col-span-12 md:col-span-6 lg:col-span-4';

              return (
                <div key={notification.id} className={`${colSpan} animate-slide-up`}>
                  <div
                    className={`p-6 rounded-3xl relative overflow-hidden group hover:shadow-xl transition-all h-full ${
                      notification.urgency === 'critical' ? 'bg-red-50/30' : ''
                    }`}
                    style={{
                      background:
                        notification.urgency === 'critical'
                          ? 'rgba(220, 38, 38, 0.05)'
                          : 'rgba(255,255,255,0.6)',
                      backdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255,255,255,0.4)',
                    }}
                  >
                    {/* Left accent bar */}
                    <div
                      className="absolute top-0 left-0 w-1.5 h-full"
                      style={{ backgroundColor: accentColor }}
                    />

                    {/* Card header */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-10 h-10 rounded-xl ${urgency.bg} flex items-center justify-center`}>
                        <IconComponent size={18} className={urgency.text} />
                      </div>
                      <span className={`text-xs font-bold uppercase tracking-widest ${urgency.text}`}>
                        {(notification.type ?? '').replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Title / message */}
                    <h4 className="text-xl font-bold mb-3">{notification.message}</h4>

                    {notification.role_context && (
                      <p className="text-sm text-[var(--text-secondary)] mb-6">
                        {notification.role_context}
                      </p>
                    )}

                    {/* Bottom row */}
                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-xs text-[var(--text-secondary)]">
                        {formatTime(notification.created_at)}
                      </span>
                      {!notification.read ? (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className={`text-sm font-bold ${urgency.text} flex items-center gap-1.5`}
                        >
                          <Eye size={14} />
                          Mark read
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)]">Read</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* -- Swarm Health Visualization (col-span-12) ------ */}
            <div className="col-span-12">
              <div
                className="p-8 rounded-[2rem] flex flex-col md:flex-row gap-12 items-center"
                style={{
                  background: 'rgba(255,255,255,0.6)',
                  backdropFilter: 'blur(24px)',
                  border: '1px solid rgba(255,255,255,0.4)',
                }}
              >
                <div className="md:w-1/3">
                  <h3 className="text-3xl font-bold mb-4">Swarm Health Monitor</h3>
                  <p className="text-[var(--text-secondary)] mb-6">
                    Visualizing current notification density across clusters.
                  </p>
                  <ul className="space-y-4">
                    <li className="flex items-center gap-4 text-sm font-medium">
                      <span className="w-3 h-3 rounded-full bg-status-reverted" />
                      {criticalCount} Active Contradictions
                    </li>
                    <li className="flex items-center gap-4 text-sm font-medium">
                      <span className="w-3 h-3 rounded-full bg-[#D97706]" />
                      {highCount} High Priority
                    </li>
                    <li className="flex items-center gap-4 text-sm font-medium">
                      <span className="w-3 h-3 rounded-full bg-[#063ff9]" />
                      {mediumCount + notifications.filter((n) => n.urgency === 'low').length} System Events Logged
                    </li>
                  </ul>
                </div>

                {/* Dark visualization area */}
                <div className="md:w-2/3 w-full h-[300px] rounded-2xl bg-slate-900 overflow-hidden relative">
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      background: 'radial-gradient(circle at center, #063ff9 0%, transparent 70%)',
                      transform: 'scale(1.5)',
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative w-full h-full p-8 flex flex-wrap gap-4 items-center justify-center">
                      {/* Simulated swarm nodes */}
                      {criticalCount > 0 && (
                        <div className="w-4 h-4 bg-status-reverted rounded-full animate-pulse shadow-[0_0_15px_#DC2626]" />
                      )}
                      <div className="w-2 h-2 bg-white/20 rounded-full" />
                      <div className="w-3 h-3 bg-[#063ff9] rounded-full shadow-[0_0_10px_#063ff9]" />
                      <div className="w-2 h-2 bg-white/20 rounded-full" />
                      <div className="w-6 h-6 border-2 border-[#D97706] rounded-full flex items-center justify-center">
                        <div className="w-2 h-2 bg-[#D97706] rounded-full" />
                      </div>
                      <div className="w-3 h-3 bg-white/40 rounded-full" />
                      {criticalCount > 1 && (
                        <div className="w-4 h-4 bg-status-reverted rounded-full shadow-[0_0_15px_#DC2626]" />
                      )}
                      <div className="w-2 h-2 bg-white/20 rounded-full" />
                      <div className="w-5 h-5 bg-[#063ff9]/50 rounded-full blur-sm" />
                      <div className="w-2 h-2 bg-white/20 rounded-full" />
                      <div className="w-3 h-3 bg-[#D97706] rounded-full" />
                      <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center">
                        <div className="w-4 h-4 bg-white/20 rounded-full" />
                      </div>
                      <div className="w-2 h-2 bg-white/20 rounded-full" />
                      <div className="w-4 h-4 bg-[#063ff9] rounded-full shadow-[0_0_15px_#063ff9]" />
                      <div className="w-3 h-3 bg-white/40 rounded-full" />
                    </div>
                  </div>
                  <div
                    className="absolute bottom-4 right-6 px-4 py-2 rounded-lg text-[10px] font-bold text-white uppercase tracking-widest"
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    Live Visualization: active_swarm_node_v8
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
