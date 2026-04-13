import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Waypoints,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Sparkles,
  X,
  FileText,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TraceType =
  | 'tool_call'
  | 'api_response'
  | 'error'
  | 'observation'
  | 'artifact_created'
  | 'code_change';

interface TraceRecord {
  id: string;
  project_id: string;
  agent_name: string;
  trace_type: TraceType;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
  created_at: string;
}

interface DistilledCandidate {
  suggested_title: string;
  suggested_description: string;
  evidence_type: 'repeated_tool' | 'error_correction' | 'recurring_observation';
  evidence_count: number;
  agent_name: string;
  related_trace_ids: string[];
  confidence: 'high' | 'medium' | 'low';
}

const TRACE_TYPES: TraceType[] = [
  'tool_call',
  'api_response',
  'error',
  'observation',
  'artifact_created',
  'code_change',
];

const TRACE_TYPE_COLORS: Record<TraceType, string> = {
  tool_call: '#6B8AE5',
  api_response: '#059669',
  error: '#DC2626',
  observation: '#D97706',
  artifact_created: '#8B5CF6',
  code_change: '#0891B2',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function truncate(s: string, n = 120): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 50;

export function Traces() {
  const { get, post } = useApi();
  const { projectId } = useProject();
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'' | TraceType>('');
  const [limit, setLimit] = useState<number>(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Distill modal
  const [distillOpen, setDistillOpen] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [candidates, setCandidates] = useState<DistilledCandidate[] | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);

  const fetchTraces = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (agentFilter) params.set('agent_name', agentFilter);
    if (typeFilter) params.set('trace_type', typeFilter);

    get<{ traces: TraceRecord[] }>(
      `/api/projects/${projectId}/traces?${params.toString()}`,
    )
      .then((data) => setTraces(data.traces ?? []))
      .catch((err) => setError(err?.message ?? 'Failed to load traces'))
      .finally(() => setLoading(false));
  }, [get, projectId, limit, agentFilter, typeFilter]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  const handleDistill = useCallback(async () => {
    setDistillOpen(true);
    setDistilling(true);
    setDistillError(null);
    setCandidates(null);
    try {
      const result = await post<{ candidates: DistilledCandidate[] }>(
        `/api/projects/${projectId}/traces/distill`,
        {},
      );
      setCandidates(result.candidates ?? []);
    } catch (err) {
      const e = err as { message?: string };
      setDistillError(e?.message ?? 'Distillation failed');
    } finally {
      setDistilling(false);
    }
  }, [post, projectId]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build unique agent list for filter dropdown
  const uniqueAgents = useMemo(() => {
    const set = new Set<string>();
    traces.forEach((t) => {
      if (t.agent_name) set.add(t.agent_name);
    });
    return Array.from(set).sort();
  }, [traces]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-xl font-bold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Waypoints size={20} style={{ color: '#D97706' }} /> Agent Traces
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Raw stigmergic trace log from every agent
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDistill}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all"
              style={{ background: '#D97706' }}
            >
              <Sparkles size={12} /> Distill Traces
            </button>
            <button
              onClick={fetchTraces}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border)',
                opacity: loading ? 0.7 : 1,
              }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border outline-none"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              borderColor: 'var(--border)',
            }}
          >
            <option value="">All agents</option>
            {uniqueAgents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as '' | TraceType);
              setLimit(PAGE_SIZE);
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border outline-none"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              borderColor: 'var(--border)',
            }}
          >
            <option value="">All trace types</option>
            {TRACE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          <span
            className="ml-auto text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            {traces.length} trace{traces.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Loading */}
        {loading && traces.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <Loader2
                size={24}
                className="animate-spin"
                style={{ color: '#D97706' }}
              />
              <span
                className="text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                Loading traces…
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && traces.length === 0 && (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: 'var(--bg-card)', borderColor: '#DC2626' }}
          >
            <AlertTriangle size={24} className="mx-auto mb-2 text-red-600" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && traces.length === 0 && (
          <div
            className="rounded-xl border p-10 text-center"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <FileText
              size={32}
              className="mx-auto mb-3 opacity-40"
              style={{ color: 'var(--text-secondary)' }}
            />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No traces found for the current filters.
            </p>
          </div>
        )}

        {/* Table */}
        {traces.length > 0 && (
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="grid grid-cols-12 gap-2 px-4 py-2 text-2xs font-medium uppercase tracking-wide border-b"
              style={{
                color: 'var(--text-secondary)',
                borderColor: 'var(--border-light)',
                background: 'var(--bg-secondary)',
              }}
            >
              <div className="col-span-2">Timestamp</div>
              <div className="col-span-2">Agent</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-5">Content</div>
              <div className="col-span-1">Source</div>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
              {traces.map((t) => {
                const isOpen = expanded.has(t.id);
                const color = TRACE_TYPE_COLORS[t.trace_type] ?? '#6B7280';
                return (
                  <div
                    key={t.id}
                    className="grid grid-cols-12 gap-2 px-4 py-2.5 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border-light)',
                    }}
                    onClick={() => toggleExpand(t.id)}
                  >
                    <div
                      className="col-span-2 text-xs tabular-nums"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {formatTimestamp(t.created_at)}
                    </div>
                    <div
                      className="col-span-2 text-xs font-medium truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t.agent_name}
                    </div>
                    <div className="col-span-2">
                      <span
                        className="inline-block text-2xs font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: `${color}15`,
                          color,
                          border: `1px solid ${color}40`,
                        }}
                      >
                        {t.trace_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="col-span-5 text-xs min-w-0">
                      <div
                        className={
                          isOpen
                            ? 'whitespace-pre-wrap break-words'
                            : 'truncate'
                        }
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {isOpen ? t.content : truncate(t.content)}
                      </div>
                      {isOpen &&
                        t.metadata &&
                        Object.keys(t.metadata).length > 0 && (
                          <pre
                            className="text-2xs mt-2 p-2 rounded overflow-x-auto"
                            style={{
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {JSON.stringify(t.metadata, null, 2)}
                          </pre>
                        )}
                    </div>
                    <div
                      className="col-span-1 text-2xs truncate"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {t.source}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Load more */}
        {traces.length >= limit && (
          <div className="flex justify-center">
            <button
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg border"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border)',
              }}
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              Load more
            </button>
          </div>
        )}
      </div>

      {/* Distill modal */}
      {distillOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setDistillOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border shadow-xl"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b sticky top-0 z-10"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border-light)',
              }}
            >
              <h2
                className="text-sm font-semibold flex items-center gap-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <Sparkles size={16} style={{ color: '#D97706' }} />
                Distilled Decision Candidates
              </h2>
              <button
                onClick={() => setDistillOpen(false)}
                className="p-1 rounded hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              {distilling && (
                <div className="flex flex-col items-center py-10 gap-3">
                  <Loader2
                    size={24}
                    className="animate-spin"
                    style={{ color: '#D97706' }}
                  />
                  <span
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Analyzing traces…
                  </span>
                </div>
              )}

              {distillError && !distilling && (
                <div className="text-center py-6">
                  <AlertTriangle
                    size={24}
                    className="mx-auto mb-2 text-red-600"
                  />
                  <p className="text-sm text-red-600">{distillError}</p>
                </div>
              )}

              {!distilling && !distillError && candidates && candidates.length === 0 && (
                <div className="text-center py-10">
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    No implicit decisions could be distilled from recent traces.
                  </p>
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Try again after more agent activity.
                  </p>
                </div>
              )}

              {!distilling && candidates && candidates.length > 0 && (
                <div className="space-y-3">
                  {candidates.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-lg border p-4"
                      style={{
                        background: 'var(--bg-secondary)',
                        borderColor: 'var(--border-light)',
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {c.suggested_title}
                        </p>
                        <span
                          className="text-2xs font-medium px-2 py-0.5 rounded-full ml-2 shrink-0"
                          style={{
                            background:
                              c.confidence === 'high'
                                ? '#05966915'
                                : c.confidence === 'medium'
                                  ? '#D9770615'
                                  : '#6B728015',
                            color:
                              c.confidence === 'high'
                                ? '#059669'
                                : c.confidence === 'medium'
                                  ? '#D97706'
                                  : '#6B7280',
                          }}
                        >
                          {c.confidence}
                        </span>
                      </div>
                      <p
                        className="text-xs mb-2"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {c.suggested_description}
                      </p>
                      <div
                        className="flex items-center gap-3 text-2xs"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        <span>agent: {c.agent_name}</span>
                        <span>evidence: {c.evidence_type.replace(/_/g, ' ')}</span>
                        <span>
                          {c.evidence_count} trace
                          {c.evidence_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
