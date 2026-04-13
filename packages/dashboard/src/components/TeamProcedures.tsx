import { useEffect, useState, useCallback } from 'react';
import {
  ClipboardList,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Zap,
  Search,
  CheckCircle,
  Workflow,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Procedure {
  id: string;
  name: string;
  description?: string;
  agent_sequence: string[];
  trigger_tags?: string[];
  domain?: string;
  evidence_count: number;
  success_rate: number;
  total_executions: number;
  created_at?: string;
}

interface ExtractResponse {
  procedures_extracted: number;
  duration_ms?: number;
}

interface SuggestResponse {
  procedure?: Procedure;
  procedures?: Procedure[];
  match_score?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function successRateColor(rate: number): string {
  if (rate >= 0.75) return 'text-green-400';
  if (rate >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({
  message,
  kind,
  onClose,
}: {
  message: string;
  kind: 'success' | 'error';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm z-50"
      style={{
        backgroundColor: kind === 'success' ? '#065f46' : '#7f1d1d',
        color: kind === 'success' ? '#d1fae5' : '#fecaca',
        border: `1px solid ${kind === 'success' ? '#059669' : '#b91c1c'}`,
      }}
    >
      {kind === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent flow                                                         */
/* ------------------------------------------------------------------ */

function AgentFlow({ agents }: { agents: string[] }) {
  if (!agents || agents.length === 0) {
    return (
      <span className="text-xs text-[var(--text-tertiary)] italic">
        No sequence
      </span>
    );
  }

  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {agents.map((agent, idx) => (
        <div key={`${agent}-${idx}`} className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border"
            style={{
              backgroundColor: 'var(--bg-card-hover)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            {agent}
          </span>
          {idx < agents.length - 1 && (
            <ArrowRight
              size={12}
              className="text-[var(--text-tertiary)] shrink-0"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Procedure card                                                     */
/* ------------------------------------------------------------------ */

function ProcedureCard({ procedure }: { procedure: Procedure }) {
  return (
    <div
      className="rounded-xl border p-4 transition-colors"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg-card)';
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            {procedure.name}
          </h3>
          {procedure.description && (
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {procedure.description}
            </p>
          )}
        </div>
        {procedure.domain && (
          <span
            className="px-2 py-0.5 rounded text-2xs font-medium capitalize shrink-0"
            style={{
              backgroundColor: 'var(--bg-card-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            {procedure.domain}
          </span>
        )}
      </div>

      {/* Agent flow */}
      <div className="mb-3">
        <p className="text-2xs uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
          Agent sequence
        </p>
        <AgentFlow agents={procedure.agent_sequence} />
      </div>

      {/* Tags */}
      {procedure.trigger_tags && procedure.trigger_tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {procedure.trigger_tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-2xs font-medium bg-primary/10 text-primary"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div
        className="grid grid-cols-3 gap-2 pt-3 text-2xs"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div>
          <p className="text-[var(--text-tertiary)]">Evidence</p>
          <p className="font-semibold text-[var(--text-primary)]">
            {procedure.evidence_count}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-tertiary)]">Success rate</p>
          <p
            className={`font-semibold ${successRateColor(procedure.success_rate)}`}
          >
            {Math.round((procedure.success_rate ?? 0) * 100)}%
          </p>
        </div>
        <div>
          <p className="text-[var(--text-tertiary)]">Executions</p>
          <p className="font-semibold text-[var(--text-primary)]">
            {procedure.total_executions}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TeamProcedures() {
  const { get, post } = useApi();
  const { projectId } = useProject();

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);

  // Suggest form
  const [suggestTask, setSuggestTask] = useState('');
  const [suggestTags, setSuggestTags] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState<Procedure[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const fetchProcedures = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await get<Procedure[] | { procedures: Procedure[] }>(
        `/api/projects/${projectId}/procedures`,
      );
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { procedures?: Procedure[] })?.procedures)
          ? (data as { procedures: Procedure[] }).procedures
          : [];
      setProcedures(list);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? 'Failed to load procedures'),
      );
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => {
    fetchProcedures();
  }, [fetchProcedures]);

  const handleExtract = async () => {
    if (!projectId || extracting) return;
    setExtracting(true);
    try {
      const result = await post<ExtractResponse>(
        `/api/projects/${projectId}/procedures/extract`,
        {},
      );
      setToast({
        message: `Extracted ${result?.procedures_extracted ?? 0} procedures`,
        kind: 'success',
      });
      await fetchProcedures();
    } catch (err) {
      setToast({
        message:
          err instanceof Error
            ? err.message
            : String((err as { message?: string })?.message ?? 'Extract failed'),
        kind: 'error',
      });
    } finally {
      setExtracting(false);
    }
  };

  const handleSuggest = async () => {
    if (!projectId) return;
    if (!suggestTask.trim()) {
      setSuggestError('Please describe the task');
      return;
    }
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestResult(null);
    try {
      const params = new URLSearchParams();
      params.set('task', suggestTask);
      if (suggestTags.trim()) {
        params.set('tags', suggestTags.trim());
      }
      const data = await get<SuggestResponse | Procedure[] | Procedure>(
        `/api/projects/${projectId}/procedures/suggest?${params.toString()}`,
      );
      let results: Procedure[] = [];
      if (Array.isArray(data)) {
        results = data;
      } else if ((data as SuggestResponse)?.procedures) {
        results = (data as SuggestResponse).procedures ?? [];
      } else if ((data as SuggestResponse)?.procedure) {
        results = [(data as SuggestResponse).procedure as Procedure];
      } else if ((data as Procedure)?.id) {
        results = [data as Procedure];
      }
      setSuggestResult(results);
      if (results.length === 0) {
        setSuggestError('No matching procedures found');
      }
    } catch (err) {
      setSuggestError(
        err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message ?? 'Suggest failed'),
      );
    } finally {
      setSuggestLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            kind={toast.kind}
            onClose={() => setToast(null)}
          />
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <ClipboardList size={18} className="text-primary" />
              Team Procedures
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Auto-extracted workflows showing repeatable agent sequences your
              team uses.
            </p>
          </div>
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {extracting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Zap size={16} />
            )}
            Extract Procedures
          </button>
        </div>

        {/* Procedures list */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary" />
          </div>
        ) : error ? (
          <div
            className="rounded-xl border p-6 max-w-md mx-auto text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <AlertTriangle
              size={22}
              className="mx-auto mb-2 text-status-reverted"
            />
            <p className="text-sm text-status-reverted">{error}</p>
          </div>
        ) : procedures.length === 0 ? (
          <div
            className="rounded-xl border p-10 text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <Workflow
              size={32}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              No procedures yet
            </p>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Click &quot;Extract Procedures&quot; to discover repeatable
              workflows from your decision history.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {procedures.map((p) => (
              <ProcedureCard key={p.id} procedure={p} />
            ))}
          </div>
        )}

        {/* Suggest section */}
        <div
          className="rounded-xl border p-5"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Search size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Suggest a procedure for a task
            </h2>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Describe what you want to do, and we&apos;ll suggest the matching
            procedure based on historical success.
          </p>

          <div className="grid md:grid-cols-[1fr_200px_auto] gap-2 mb-3">
            <input
              type="text"
              value={suggestTask}
              onChange={(e) => setSuggestTask(e.target.value)}
              placeholder="Task description (e.g. 'deploy a new API endpoint')"
              className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-primary/50"
              style={{
                backgroundColor: 'var(--bg-card-hover)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <input
              type="text"
              value={suggestTags}
              onChange={(e) => setSuggestTags(e.target.value)}
              placeholder="Tags (comma separated)"
              className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-primary/50"
              style={{
                backgroundColor: 'var(--bg-card-hover)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={handleSuggest}
              disabled={suggestLoading || !suggestTask.trim()}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {suggestLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              Suggest Procedure
            </button>
          </div>

          {suggestError && (
            <p className="text-xs text-red-400 mb-2">{suggestError}</p>
          )}

          {suggestResult && suggestResult.length > 0 && (
            <div className="space-y-3 mt-4">
              <p className="text-2xs uppercase tracking-wider text-[var(--text-secondary)]">
                Matched procedures
              </p>
              {suggestResult.map((p) => (
                <ProcedureCard key={p.id} procedure={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TeamProcedures;
