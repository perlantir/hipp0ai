import { useState, useEffect, useCallback } from 'react';
import {
  Radio,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CaptureEntry {
  id: string;
  project_id: string;
  agent_name: string;
  session_id: string | null;
  source: string;
  status: 'processing' | 'completed' | 'failed';
  extracted_decision_count: number;
  extracted_decision_ids: string[];
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
          <Loader2 size={10} className="animate-spin" />
          Processing
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
          <CheckCircle2 size={10} />
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
          <XCircle size={10} />
          Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-500/15 text-gray-400">
          {status}
        </span>
      );
  }
}

function SourceBadge({ source }: { source: string }) {
  const colorMap: Record<string, string> = {
    openclaw: 'bg-purple-500/15 text-purple-400',
    telegram: 'bg-sky-500/15 text-sky-400',
    slack: 'bg-amber-500/15 text-amber-400',
    api: 'bg-gray-500/15 text-gray-400',
  };
  const cls = colorMap[source] ?? 'bg-gray-500/15 text-gray-400';
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {source}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function CaptureHistory() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCaptures = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await get<CaptureEntry[]>(`/api/projects/${projectId}/captures?limit=50`);
      setCaptures(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to load captures');
    } finally {
      setLoading(false);
    }
  }, [projectId, get]);

  useEffect(() => {
    fetchCaptures();
  }, [fetchCaptures]);

  // Auto-refresh while any captures are processing
  useEffect(() => {
    const hasProcessing = captures.some((c) => c.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(fetchCaptures, 5000);
    return () => clearInterval(interval);
  }, [captures, fetchCaptures]);

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">Capture History</h2>
          <span className="text-xs text-[var(--text-secondary)]">
            ({captures.length})
          </span>
        </div>
        <button
          onClick={fetchCaptures}
          disabled={loading}
          className="btn-ghost p-1.5"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && captures.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-[var(--text-secondary)]" />
        </div>
      )}

      {/* Empty state */}
      {!loading && captures.length === 0 && !error && (
        <div className="text-center py-12">
          <Radio size={28} className="mx-auto mb-3 text-[var(--text-secondary)] opacity-50" />
          <p className="text-sm text-[var(--text-secondary)]">
            No captures yet. Use the API or MCP tool to submit conversations for extraction.
          </p>
        </div>
      )}

      {/* Capture list */}
      {captures.length > 0 && (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_100px_80px_100px_80px] gap-4 px-4 py-2.5 border-b border-[var(--border-light)]">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              Agent / Source
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              Status
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              Decisions
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              Time
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              Review
            </span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-[var(--border-light)]">
            {captures.map((capture) => (
              <div
                key={capture.id}
                className="grid grid-cols-[1fr_100px_80px_100px_80px] gap-4 px-4 py-3 items-center hover:bg-[var(--bg-secondary)] transition-colors"
              >
                {/* Agent + source */}
                <div>
                  <p className="text-sm font-medium">{capture.agent_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <SourceBadge source={capture.source} />
                    {capture.session_id && (
                      <span className="text-xs text-[var(--text-secondary)]">
                        session: {capture.session_id.slice(0, 8)}...
                      </span>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <StatusBadge status={capture.status} />
                </div>

                {/* Decision count */}
                <div>
                  <span className="text-sm font-medium">
                    {capture.extracted_decision_count}
                  </span>
                </div>

                {/* Time */}
                <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <Clock size={11} />
                  {timeAgo(capture.created_at)}
                </div>

                {/* Review link */}
                <div>
                  {capture.status === 'completed' && capture.extracted_decision_count > 0 && (
                    <a
                      href="#review"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Review
                      <ChevronRight size={12} />
                    </a>
                  )}
                  {capture.status === 'failed' && capture.error_message && (
                    <span
                      className="text-xs text-red-400 cursor-help"
                      title={capture.error_message}
                    >
                      Error
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
