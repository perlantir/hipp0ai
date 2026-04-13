import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Radio,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Zap,
  FlaskConical,
  Sparkles,
  Lightbulb,
  Camera,
  GitBranch,
  Trash2,
  Play,
  Pause,
} from 'lucide-react';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MemoryEvent {
  type: string;
  project_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface FeedEvent extends MemoryEvent {
  localId: string;
  receivedAt: number;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

type FilterValue =
  | 'all'
  | 'decisions'
  | 'contradictions'
  | 'outcomes'
  | 'compiles'
  | 'experiments'
  | 'reflections';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_FEED = 100;

const EVENT_META: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  'decision.created': {
    label: 'Decision created',
    icon: <FileText size={14} />,
    color: '#D97706',
  },
  'decision.updated': {
    label: 'Decision updated',
    icon: <FileText size={14} />,
    color: '#D97706',
  },
  'decision.superseded': {
    label: 'Decision superseded',
    icon: <FileText size={14} />,
    color: '#6B8AE5',
  },
  'contradiction.detected': {
    label: 'Contradiction detected',
    icon: <AlertTriangle size={14} />,
    color: '#DC2626',
  },
  'contradiction.resolved': {
    label: 'Contradiction resolved',
    icon: <CheckCircle2 size={14} />,
    color: '#059669',
  },
  'outcome.recorded': {
    label: 'Outcome recorded',
    icon: <CheckCircle2 size={14} />,
    color: '#059669',
  },
  'compile.completed': {
    label: 'Compile completed',
    icon: <Zap size={14} />,
    color: '#6B8AE5',
  },
  'experiment.started': {
    label: 'Experiment started',
    icon: <FlaskConical size={14} />,
    color: '#6B8AE5',
  },
  'experiment.resolved': {
    label: 'Experiment resolved',
    icon: <FlaskConical size={14} />,
    color: '#059669',
  },
  'reflection.completed': {
    label: 'Reflection completed',
    icon: <Sparkles size={14} />,
    color: '#D97706',
  },
  'pattern.detected': {
    label: 'Pattern detected',
    icon: <Lightbulb size={14} />,
    color: '#D97706',
  },
  'capture.started': {
    label: 'Capture started',
    icon: <Camera size={14} />,
    color: '#6B8AE5',
  },
  'capture.completed': {
    label: 'Capture completed',
    icon: <Camera size={14} />,
    color: '#059669',
  },
  'skill.updated': {
    label: 'Skill updated',
    icon: <GitBranch size={14} />,
    color: '#D97706',
  },
};

function getMeta(type: string): { label: string; icon: React.ReactNode; color: string } {
  if (EVENT_META[type]) return EVENT_META[type];
  return {
    label: type,
    icon: <Radio size={14} />,
    color: '#6B8AE5',
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 1000) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function matchesFilter(type: string, filter: FilterValue): boolean {
  if (filter === 'all') return true;
  if (filter === 'decisions') return type.startsWith('decision.');
  if (filter === 'contradictions') return type.startsWith('contradiction.');
  if (filter === 'outcomes') return type.startsWith('outcome.');
  if (filter === 'compiles') return type.startsWith('compile.');
  if (filter === 'experiments') return type.startsWith('experiment.');
  if (filter === 'reflections')
    return (
      type.startsWith('reflection.') ||
      type === 'pattern.detected'
    );
  return true;
}

/**
 * Extract the API key from the environment — tries (in order):
 *  1. VITE_API_KEY env var
 *  2. localStorage `hipp0_api_key`
 *  3. window.__HIPP0_CONFIG__.apiKey
 */
function getApiKey(): string {
  const fromEnv = (import.meta as unknown as {
    env?: Record<string, string>;
  }).env?.VITE_API_KEY;
  if (fromEnv) return fromEnv;

  try {
    const fromStorage = localStorage.getItem('hipp0_api_key');
    if (fromStorage) return fromStorage;
  } catch {
    /* ignore */
  }

  const fromWindow = (window as unknown as {
    __HIPP0_CONFIG__?: { apiKey?: string };
  }).__HIPP0_CONFIG__?.apiKey;
  if (fromWindow) return fromWindow;

  return '';
}

function buildEventsWsUrl(projectId: string, apiKey: string): string {
  const apiBase =
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_API_URL || window.location.origin;
  const base = apiBase.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/ws/events?project_id=${encodeURIComponent(
    projectId,
  )}&api_key=${encodeURIComponent(apiKey)}`;
}

/* ------------------------------------------------------------------ */
/*  Event-stream hook                                                  */
/* ------------------------------------------------------------------ */

function useEventStream(
  projectId: string,
  onEvent: (evt: MemoryEvent) => void,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!projectId || projectId === 'default') {
      setState('disconnected');
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const apiKey = getApiKey();
      if (!apiKey) {
        setState('disconnected');
        return;
      }

      setState('connecting');
      try {
        const url = buildEventsWsUrl(projectId, apiKey);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          attemptRef.current = 0;
          setState('connected');
        };

        ws.onmessage = (msg) => {
          if (cancelled) return;
          try {
            const parsed = JSON.parse(String(msg.data)) as MemoryEvent;
            if (parsed && typeof parsed.type === 'string' && parsed.type !== 'connected') {
              onEventRef.current(parsed);
            }
          } catch {
            /* ignore malformed */
          }
        };

        ws.onclose = () => {
          if (cancelled) return;
          wsRef.current = null;
          setState('disconnected');

          // Exponential backoff — 1s, 2s, 4s, 8s, max 30s
          const attempt = attemptRef.current;
          const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
          attemptRef.current = attempt + 1;
          timerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => {
          // onclose will fire after
        };
      } catch {
        setState('disconnected');
        const attempt = attemptRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        attemptRef.current = attempt + 1;
        timerRef.current = setTimeout(connect, delay);
      }
    };

    connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [projectId, cleanup]);

  return state;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LiveEvents() {
  const { projectId } = useProject();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [, setTick] = useState(0);
  const [showDevHint, setShowDevHint] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const handleEvent = useCallback((evt: MemoryEvent) => {
    idRef.current += 1;
    const next: FeedEvent = {
      ...evt,
      localId: `${Date.now()}-${idRef.current}`,
      receivedAt: Date.now(),
    };
    setEvents((prev) => {
      const combined = [next, ...prev];
      return combined.slice(0, MAX_FEED);
    });
  }, []);

  const connection = useEventStream(projectId, handleEvent);

  // Tick timer so the "2s ago" timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Dev hint: if no events arrive within 10s, show a helper badge.
  // Reset whenever events arrive.
  useEffect(() => {
    if (events.length > 0) {
      setShowDevHint(false);
      return;
    }
    const t = setTimeout(() => setShowDevHint(true), 10_000);
    return () => clearTimeout(t);
  }, [events.length]);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  const filtered = useMemo(
    () => events.filter((e) => matchesFilter(e.type, filter)),
    [events, filter],
  );

  const dot =
    connection === 'connected'
      ? '#059669'
      : connection === 'connecting'
        ? '#D97706'
        : '#DC2626';

  return (
    <div className="h-full flex flex-col">
      <div className="max-w-5xl w-full mx-auto px-6 py-8 flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1
              className="text-xl font-bold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Radio size={20} style={{ color: '#D97706' }} /> Live Events
              <span
                className="inline-flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  background: `${dot}15`,
                  color: dot,
                  border: `1px solid ${dot}40`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: dot,
                    animation:
                      connection === 'connected'
                        ? 'pulse 2s infinite'
                        : undefined,
                  }}
                />
                {connection === 'connected'
                  ? 'Connected'
                  : connection === 'connecting'
                    ? 'Connecting…'
                    : 'Disconnected'}
              </span>
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Real-time memory events streamed from the server
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterValue)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border outline-none"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              borderColor: 'var(--border)',
            }}
          >
            <option value="all">All events</option>
            <option value="decisions">Decisions</option>
            <option value="contradictions">Contradictions</option>
            <option value="outcomes">Outcomes</option>
            <option value="compiles">Compiles</option>
            <option value="experiments">Experiments</option>
            <option value="reflections">Reflections</option>
          </select>

          <button
            onClick={() => setAutoScroll((x) => !x)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border"
            style={{
              background: 'var(--bg-card)',
              color: autoScroll ? '#D97706' : 'var(--text-secondary)',
              borderColor: 'var(--border)',
            }}
          >
            {autoScroll ? <Pause size={12} /> : <Play size={12} />}
            Auto-scroll: {autoScroll ? 'On' : 'Off'}
          </button>

          <button
            onClick={() => setEvents([])}
            disabled={events.length === 0}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border"
            style={{
              background: 'var(--bg-card)',
              color: events.length === 0 ? 'var(--text-tertiary)' : '#DC2626',
              borderColor: 'var(--border)',
              opacity: events.length === 0 ? 0.5 : 1,
            }}
          >
            <Trash2 size={12} /> Clear feed
          </button>

          <span
            className="ml-auto text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            {filtered.length < events.length
              ? ` (of ${events.length})`
              : ''}
          </span>
        </div>

        {/* Feed */}
        <div
          ref={feedRef}
          className="flex-1 min-h-0 overflow-y-auto rounded-xl border"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
              <Radio
                size={32}
                className="mb-3 opacity-40"
                style={{ color: 'var(--text-secondary)' }}
              />
              <p
                className="text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                {connection === 'connected'
                  ? 'Waiting for events…'
                  : connection === 'connecting'
                    ? 'Connecting to event stream…'
                    : 'Event stream disconnected. Retrying with backoff.'}
              </p>
              {events.length > 0 && (
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  No events match the current filter.
                </p>
              )}
              {showDevHint && events.length === 0 && (
                <div
                  className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg border"
                  style={{
                    background: '#D9770610',
                    borderColor: '#D9770640',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span
                    className="text-2xs font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: '#D97706',
                      color: 'white',
                      letterSpacing: '0.05em',
                    }}
                  >
                    DEV
                  </span>
                  <span className="text-xs">
                    Open a new tab and create a decision to see events flow
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
              {filtered.map((evt) => {
                const meta = getMeta(evt.type);
                return (
                  <div
                    key={evt.localId}
                    className="p-3 flex items-start gap-3"
                    style={{ borderBottom: '1px solid var(--border-light)' }}
                  >
                    <div
                      className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5"
                      style={{
                        background: `${meta.color}15`,
                        color: meta.color,
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {meta.label}
                        </span>
                        <span
                          className="text-2xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {timeAgo(evt.receivedAt)}
                        </span>
                      </div>
                      <EventPayload data={evt.data} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event payload renderer                                             */
/* ------------------------------------------------------------------ */

function EventPayload({ data }: { data: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) return null;

  // Prefer showing a few key fields rather than the raw blob
  const preferred: Array<[string, unknown]> = [];
  const pickKeys = [
    'title',
    'name',
    'description',
    'decision_id',
    'agent',
    'agent_name',
    'domain',
    'outcome_type',
    'status',
    'count',
    'confidence',
    'reason',
  ];

  for (const k of pickKeys) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== '') {
      preferred.push([k, data[k]]);
    }
    if (preferred.length >= 3) break;
  }

  if (preferred.length === 0) {
    const first = Object.entries(data).slice(0, 3);
    for (const [k, v] of first) {
      if (v !== undefined && v !== null && v !== '') preferred.push([k, v]);
    }
  }

  if (preferred.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
      {preferred.map(([k, v]) => (
        <span
          key={k}
          className="text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>{k}:</span>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </span>
      ))}
    </div>
  );
}
