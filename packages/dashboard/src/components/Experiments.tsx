import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Play,
  Loader2,
  Plus,
  X,
  Trophy,
  Activity,
  CheckCircle2,
  XCircle,
  BarChart3,
  Flag,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DecisionSummary {
  id: string;
  title: string;
  description?: string;
  status?: string;
}

type ExperimentStatus = 'running' | 'completed' | 'cancelled';
type ExperimentWinner = 'a' | 'b' | 'inconclusive' | null;

interface Experiment {
  id: string;
  project_id: string;
  name: string;
  decision_a_id: string;
  decision_b_id: string;
  decision_a_title?: string;
  decision_b_title?: string;
  status: ExperimentStatus;
  winner?: ExperimentWinner;
  compiles_a?: number;
  compiles_b?: number;
  outcomes_a?: number;
  outcomes_b?: number;
  success_rate_a?: number;
  success_rate_b?: number;
  z_score?: number;
  p_value?: number;
  significant?: boolean;
  created_at: string;
  resolved_at?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusColor(status: ExperimentStatus): { bg: string; text: string; border: string } {
  switch (status) {
    case 'running':
      return { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6', border: '#3B82F6' };
    case 'completed':
      return { bg: 'rgba(34,197,94,0.12)', text: '#22C55E', border: '#22C55E' };
    case 'cancelled':
      return { bg: 'rgba(107,114,128,0.12)', text: '#9CA3AF', border: '#6B7280' };
  }
}

function StatusBadge({ status }: { status: ExperimentStatus }) {
  const colors = statusColor(status);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}40`,
      }}
    >
      {status === 'running' && <Activity size={10} className="animate-pulse" />}
      {status === 'completed' && <CheckCircle2 size={10} />}
      {status === 'cancelled' && <XCircle size={10} />}
      {status}
    </span>
  );
}

function formatRate(v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function formatNumber(v: number | undefined): string {
  if (v === undefined || v === null) return '0';
  return String(v);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Experiments() {
  const { get, post } = useApi();
  const { projectId } = useProject();

  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [decisions, setDecisions] = useState<DecisionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New experiment modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAId, setNewAId] = useState('');
  const [newBId, setNewBId] = useState('');
  const [newAFilter, setNewAFilter] = useState('');
  const [newBFilter, setNewBFilter] = useState('');
  const [creating, setCreating] = useState(false);

  // Resolve modal
  const [resolving, setResolving] = useState<Experiment | null>(null);
  const [resolveWinner, setResolveWinner] = useState<'a' | 'b' | 'inconclusive'>('a');
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  /* ---- Fetch experiments and decisions ---------------------------- */
  const fetchAll = useCallback(async () => {
    if (!projectId || projectId === 'default') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [exps, decs] = await Promise.all([
        get<Experiment[]>(`/api/projects/${projectId}/experiments`),
        get<DecisionSummary[]>(`/api/projects/${projectId}/decisions`),
      ]);
      setExperiments(Array.isArray(exps) ? exps : []);
      setDecisions(Array.isArray(decs) ? decs : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to load experiments');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [get, projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ---- Poll for running experiments ------------------------------- */
  useEffect(() => {
    const hasRunning = experiments.some((e) => e.status === 'running');
    if (!hasRunning || !projectId || projectId === 'default') return;

    const interval = setInterval(async () => {
      try {
        const updated = await Promise.all(
          experiments
            .filter((e) => e.status === 'running')
            .map((e) =>
              get<Experiment>(`/api/projects/${projectId}/experiments/${e.id}`).catch(() => null),
            ),
        );
        setExperiments((prev) =>
          prev.map((e) => {
            const match = updated.find((u) => u && u.id === e.id);
            return match ?? e;
          }),
        );
      } catch {
        // ignore
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [experiments, get, projectId]);

  /* ---- Decision lookup -------------------------------------------- */
  const decisionMap = useMemo(() => {
    const map: Record<string, DecisionSummary> = {};
    for (const d of decisions) map[d.id] = d;
    return map;
  }, [decisions]);

  const filteredA = useMemo(() => {
    const q = newAFilter.toLowerCase().trim();
    if (!q) return decisions.slice(0, 50);
    return decisions.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 50);
  }, [decisions, newAFilter]);

  const filteredB = useMemo(() => {
    const q = newBFilter.toLowerCase().trim();
    if (!q) return decisions.slice(0, 50);
    return decisions.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 50);
  }, [decisions, newBFilter]);

  /* ---- Create experiment ------------------------------------------ */
  const handleCreate = async () => {
    if (!newName.trim() || !newAId || !newBId) return;
    if (newAId === newBId) {
      setError('Decision A and B must be different');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await post<Experiment>(`/api/projects/${projectId}/experiments`, {
        name: newName.trim(),
        decision_a_id: newAId,
        decision_b_id: newBId,
      });
      setExperiments((prev) => [created, ...prev]);
      setShowNewModal(false);
      setNewName('');
      setNewAId('');
      setNewBId('');
      setNewAFilter('');
      setNewBFilter('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to create experiment');
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  /* ---- Resolve experiment ----------------------------------------- */
  const handleResolve = async () => {
    if (!resolving) return;
    setResolveSubmitting(true);
    setError(null);
    try {
      const updated = await post<Experiment>(
        `/api/projects/${projectId}/experiments/${resolving.id}/resolve`,
        { winner: resolveWinner },
      );
      setExperiments((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setResolving(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to resolve experiment');
      setError(msg);
    } finally {
      setResolveSubmitting(false);
    }
  };

  /* ---- Render ----------------------------------------------------- */
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(217,119,6,0.15)' }}
          >
            <Play className="w-5 h-5" style={{ color: '#D97706' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Decision Experiments
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              A/B test decisions to measure which one performs better in practice
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium"
        >
          <Plus size={16} /> New Experiment
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-sm"
          style={{
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--accent-danger, #EF4444)',
            border: '1px solid rgba(239,68,68,0.4)',
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          className="flex items-center justify-center py-16"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading experiments...
        </div>
      )}

      {/* Empty state */}
      {!loading && experiments.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--text-tertiary, #9CA3AF)' }}>
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium mb-2">No experiments yet</p>
          <p className="text-sm">Create your first experiment to start A/B testing decisions.</p>
        </div>
      )}

      {/* Experiments list */}
      {!loading && experiments.length > 0 && (
        <div className="space-y-3">
          {experiments.map((exp) => {
            const aTitle =
              exp.decision_a_title ?? decisionMap[exp.decision_a_id]?.title ?? exp.decision_a_id.slice(0, 8);
            const bTitle =
              exp.decision_b_title ?? decisionMap[exp.decision_b_id]?.title ?? exp.decision_b_id.slice(0, 8);

            return (
              <div
                key={exp.id}
                className="rounded-xl border p-4"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: 'var(--border, #374151)',
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {exp.name}
                      </h3>
                      <StatusBadge status={exp.status} />
                      {exp.status === 'completed' && exp.winner && exp.winner !== 'inconclusive' && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: 'rgba(234,179,8,0.15)',
                            color: '#EAB308',
                            border: '1px solid rgba(234,179,8,0.4)',
                          }}
                        >
                          <Trophy size={10} /> Winner: {exp.winner.toUpperCase()}
                        </span>
                      )}
                      {exp.status === 'completed' && exp.winner === 'inconclusive' && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: 'rgba(107,114,128,0.15)',
                            color: '#9CA3AF',
                          }}
                        >
                          Inconclusive
                        </span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                      Started {new Date(exp.created_at).toLocaleString()}
                    </p>
                  </div>
                  {exp.status === 'running' && (
                    <button
                      onClick={() => {
                        setResolving(exp);
                        setResolveWinner('a');
                      }}
                      className="flex items-center gap-1 border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-1.5 text-xs font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Flag size={12} /> Resolve
                    </button>
                  )}
                </div>

                {/* Variants */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <VariantCard
                    label="A"
                    title={aTitle}
                    compiles={exp.compiles_a}
                    outcomes={exp.outcomes_a}
                    successRate={exp.success_rate_a}
                    isWinner={exp.winner === 'a'}
                  />
                  <VariantCard
                    label="B"
                    title={bTitle}
                    compiles={exp.compiles_b}
                    outcomes={exp.outcomes_b}
                    successRate={exp.success_rate_b}
                    isWinner={exp.winner === 'b'}
                  />
                </div>

                {/* Statistics (completed experiments) */}
                {exp.status === 'completed' && (exp.z_score !== undefined || exp.p_value !== undefined) && (
                  <div
                    className="mt-3 pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs"
                    style={{ borderTop: '1px solid var(--border, #374151)' }}
                  >
                    <div>
                      <div style={{ color: 'var(--text-tertiary, #6B7280)' }}>Z-score</div>
                      <div className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {exp.z_score !== undefined ? exp.z_score.toFixed(3) : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-tertiary, #6B7280)' }}>P-value</div>
                      <div className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {exp.p_value !== undefined ? exp.p_value.toFixed(4) : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-tertiary, #6B7280)' }}>Significant</div>
                      <div
                        className="font-semibold"
                        style={{ color: exp.significant ? '#22C55E' : '#EF4444' }}
                      >
                        {exp.significant ? 'Yes (p < 0.05)' : 'No'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New experiment modal */}
      {showNewModal && (
        <Modal onClose={() => setShowNewModal(false)} title="New Experiment">
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Experiment Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Prompt tone comparison"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>

            <DecisionPicker
              label="Decision A"
              filter={newAFilter}
              onFilterChange={setNewAFilter}
              selectedId={newAId}
              onSelect={setNewAId}
              decisions={filteredA}
            />
            <DecisionPicker
              label="Decision B"
              filter={newBFilter}
              onFilterChange={setNewBFilter}
              selectedId={newBId}
              onSelect={setNewBId}
              decisions={filteredB}
            />

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newAId || !newBId}
                className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create
              </button>
              <button
                onClick={() => setShowNewModal(false)}
                className="border border-slate-300 hover:bg-slate-100 rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Resolve experiment modal */}
      {resolving && (
        <Modal onClose={() => setResolving(null)} title={`Resolve: ${resolving.name}`}>
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Declare the winner of this experiment. This will stop the A/B test.
            </p>
            <div className="space-y-2">
              {(['a', 'b', 'inconclusive'] as const).map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 p-3 rounded-md cursor-pointer"
                  style={{
                    background: resolveWinner === opt ? 'rgba(217,119,6,0.1)' : 'var(--bg-secondary, #1F2937)',
                    border: `1px solid ${
                      resolveWinner === opt ? '#D97706' : 'var(--border, #374151)'
                    }`,
                  }}
                >
                  <input
                    type="radio"
                    name="winner"
                    checked={resolveWinner === opt}
                    onChange={() => setResolveWinner(opt)}
                  />
                  <span className="text-sm capitalize" style={{ color: 'var(--text-primary)' }}>
                    {opt === 'a'
                      ? `Decision A wins: ${
                          resolving.decision_a_title ?? decisionMap[resolving.decision_a_id]?.title ?? 'A'
                        }`
                      : opt === 'b'
                        ? `Decision B wins: ${
                            resolving.decision_b_title ?? decisionMap[resolving.decision_b_id]?.title ?? 'B'
                          }`
                        : 'Inconclusive'}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleResolve}
                disabled={resolveSubmitting}
                className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {resolveSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Flag size={14} />
                )}
                Confirm
              </button>
              <button
                onClick={() => setResolving(null)}
                className="border border-slate-300 hover:bg-slate-100 rounded-lg px-4 py-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Variant card                                                        */
/* ------------------------------------------------------------------ */

function VariantCard({
  label,
  title,
  compiles,
  outcomes,
  successRate,
  isWinner,
}: {
  label: string;
  title: string;
  compiles?: number;
  outcomes?: number;
  successRate?: number;
  isWinner?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'var(--bg-secondary, #1F2937)',
        border: `1px solid ${isWinner ? '#EAB308' : 'var(--border, #374151)'}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
          style={{
            background: isWinner ? '#EAB308' : 'rgba(217,119,6,0.2)',
            color: isWinner ? '#000' : '#D97706',
          }}
        >
          {label}
        </span>
        {isWinner && <Trophy size={14} style={{ color: '#EAB308' }} />}
      </div>
      <div
        className="text-sm font-medium mb-2 line-clamp-2"
        style={{ color: 'var(--text-primary)' }}
        title={title}
      >
        {title}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div style={{ color: 'var(--text-tertiary, #6B7280)' }}>Compiles</div>
          <div className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(compiles)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary, #6B7280)' }}>Outcomes</div>
          <div className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(outcomes)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-tertiary, #6B7280)' }}>Success</div>
          <div className="font-mono font-semibold" style={{ color: '#22C55E' }}>
            {formatRate(successRate)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Decision picker                                                     */
/* ------------------------------------------------------------------ */

function DecisionPicker({
  label,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  decisions,
}: {
  label: string;
  filter: string;
  onFilterChange: (v: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  decisions: DecisionSummary[];
}) {
  return (
    <div>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
        {label}
      </label>
      <input
        type="text"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Search decisions..."
        className="w-full p-2 rounded-md text-sm mb-1"
        style={{
          background: 'var(--bg-secondary, #1F2937)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border, #374151)',
        }}
      />
      <div
        className="max-h-32 overflow-y-auto rounded-md"
        style={{
          background: 'var(--bg-secondary, #1F2937)',
          border: '1px solid var(--border, #374151)',
        }}
      >
        {decisions.length === 0 ? (
          <div className="p-2 text-xs" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
            No decisions found
          </div>
        ) : (
          decisions.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              className="w-full text-left px-2 py-1.5 text-xs block truncate"
              style={{
                background: selectedId === d.id ? 'rgba(217,119,6,0.2)' : 'transparent',
                color: selectedId === d.id ? '#D97706' : 'var(--text-primary)',
              }}
              title={d.title}
            >
              {d.title}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                               */
/* ------------------------------------------------------------------ */

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto"
        style={{
          background: 'var(--bg-card, #1F2937)',
          border: '1px solid var(--border, #374151)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-700"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Experiments;
