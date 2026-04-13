import { useState, useEffect } from 'react';
import { Columns2, Loader2, ArrowRight, Eye, EyeOff, Search, ChevronDown } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { ContextResult, Decision } from '../types';
import { WingBadge, wingColor } from './WingView';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-status-active';
  if (score >= 0.5) return 'text-status-superseded';
  return 'text-[var(--text-secondary)]';
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-[var(--border-light)] overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <span className={`text-xs font-medium tabular-nums ${scoreColor(score)}`}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Wing Analysis after comparison                                     */
/* ------------------------------------------------------------------ */

function WingAnalysis({
  agentA,
  agentB,
  decisionsA,
  decisionsB,
  wingSrcA,
  wingSrcB,
}: {
  agentA: string;
  agentB: string;
  decisionsA: Array<{ wing?: string | null; [key: string]: unknown }>;
  decisionsB: Array<{ wing?: string | null; [key: string]: unknown }>;
  wingSrcA?: Record<string, number>;
  wingSrcB?: Record<string, number>;
}) {
  // Compute wing distribution from decisions
  function computeWingDist(decisions: Array<{ wing?: string | null; [key: string]: unknown }>): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const d of decisions) {
      const wing = (d.wing as string) ?? 'unknown';
      dist[wing] = (dist[wing] ?? 0) + 1;
    }
    return dist;
  }

  const distA = wingSrcA ?? computeWingDist(decisionsA);
  const distB = wingSrcB ?? computeWingDist(decisionsB);
  const totalA = Object.values(distA).reduce((s, v) => s + v, 0) || 1;
  const totalB = Object.values(distB).reduce((s, v) => s + v, 0) || 1;
  const allWings = Array.from(new Set([...Object.keys(distA), ...Object.keys(distB)]));

  if (allWings.length === 0) return null;

  return (
    <div className="card p-5 mt-6">
      <h3 className="text-sm font-semibold mb-3">Wing Analysis</h3>
      <p className="text-xs text-[var(--text-secondary)] mb-4">
        Which wings each agent pulled decisions from
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Agent A */}
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary" />
            {agentA}
          </h4>
          <div className="space-y-1">
            {allWings.map((w) => {
              const count = distA[w] ?? 0;
              const pct = Math.round((count / totalA) * 100);
              return (
                <div key={w} className="flex items-center gap-2">
                  <WingBadge name={w} />
                  <div className="flex-1 h-4 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div
                      className="h-full rounded"
                      style={{ width: `${pct}%`, backgroundColor: wingColor(w) + '88', transition: 'width 0.4s ease' }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] min-w-[36px] text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Agent B */}
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-superseded" />
            {agentB}
          </h4>
          <div className="space-y-1">
            {allWings.map((w) => {
              const count = distB[w] ?? 0;
              const pct = Math.round((count / totalB) * 100);
              return (
                <div key={w} className="flex items-center gap-2">
                  <WingBadge name={w} />
                  <div className="flex-1 h-4 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div
                      className="h-full rounded"
                      style={{ width: `${pct}%`, backgroundColor: wingColor(w) + '88', transition: 'width 0.4s ease' }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] min-w-[36px] text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContextComparison() {
  const { post } = useApi();
  const { projectId } = useProject();

  const { get } = useApi();
  const [agentA, setAgentA] = useState('');
  const [agentB, setAgentB] = useState('');
  const [agents, setAgents] = useState<Array<{ name: string }>>([]);
  const [task, setTask] = useState('design the authentication flow');
  const [namespace, setNamespace] = useState('');
  const [namespaces, setNamespaces] = useState<Array<{ namespace: string; count: number }>>([]);

  const [resultA, setResultA] = useState<ContextResult | null>(null);
  const [resultB, setResultB] = useState<ContextResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShared, setShowShared] = useState(true);

  useEffect(() => {
    get<Array<{ namespace: string; count: number }>>(`/api/projects/${projectId}/namespaces`)
      .then((data) => {
        if (Array.isArray(data)) setNamespaces(data);
      })
      .catch(() => {});
  }, [get, projectId]);

  // Load project agents so the Agent A/B dropdowns are populated with real names
  useEffect(() => {
    get<Array<{ id: string; name: string }>>(`/api/projects/${projectId}/agents`)
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(data);
          // Default to the first two agents so the form is usable immediately
          if (data.length > 0 && !agentA) setAgentA(data[0].name);
          if (data.length > 1 && !agentB) setAgentB(data[1].name);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, projectId]);

  async function handleCompare() {
    if (!agentA || !agentB || !task) return;
    setLoading(true);
    setError(null);
    setResultA(null);
    setResultB(null);

    try {
      const [resA, resB] = await Promise.all([
        post<ContextResult>('/api/compile?format=json', {
          agent_name: agentA,
          project_id: projectId,
          task_description: task,
          ...(namespace ? { namespace } : {}),
        }),
        post<ContextResult>('/api/compile?format=json', {
          agent_name: agentB,
          project_id: projectId,
          task_description: task,
          ...(namespace ? { namespace } : {}),
        }),
      ]);
      setResultA(resA);
      setResultB(resB);
      // Mark the "See role differentiation" onboarding step complete.
      try {
        localStorage.setItem('hipp0_onboarding_role_diff_tried', 'true');
      } catch { /* storage unavailable — non-fatal */ }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch context');
    } finally {
      setLoading(false);
    }
  }

  /* ---- Compute shared / unique ----------------------------------- */

  const idsA = new Set((resultA?.decisions ?? []).map((d) => d.id) ?? []);
  const idsB = new Set((resultB?.decisions ?? []).map((d) => d.id) ?? []);

  const sharedIds = new Set([...idsA].filter((id) => idsB.has(id)));
  const uniqueA = (resultA?.decisions ?? []).filter((d) => !idsB.has(d.id)) ?? [];
  const uniqueB = (resultB?.decisions ?? []).filter((d) => !idsA.has(d.id)) ?? [];
  const shared = (resultA?.decisions ?? []).filter((d) => sharedIds.has(d.id)) ?? [];

  /* ---- Decision row ---------------------------------------------- */

  function DecisionRow({
    decision,
    score,
    highlight,
  }: {
    decision: { title?: string; status?: string; [key: string]: unknown };
    score: number;
    highlight?: 'a' | 'b' | 'shared';
  }) {
    const borderColor =
      highlight === 'a'
        ? 'border-l-primary'
        : highlight === 'b'
          ? 'border-l-status-superseded'
          : 'border-l-transparent';

    return (
      <div className={`p-3 rounded-md border-l-2 ${borderColor} card text-sm`}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h4 className="font-medium leading-snug flex-1">{decision.title}</h4>
          <span className={`badge badge-${decision.status}`}>{decision.status}</span>
        </div>
        <ScoreBar score={score} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold mb-1">Context Comparison</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Compare what two agents would see for a given task
          </p>
        </div>

        {/* Inputs */}
        <div className="card p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                Agent A
              </label>
              <div className="relative">
                <select
                  value={agentA}
                  onChange={(e) => setAgentA(e.target.value)}
                  className="input w-full appearance-none pr-8"
                >
                  {agents.length === 0 && <option value="">Loading agents...</option>}
                  {agents.length > 0 && !agentA && <option value="">Select an agent...</option>}
                  {agents.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                Agent B
              </label>
              <div className="relative">
                <select
                  value={agentB}
                  onChange={(e) => setAgentB(e.target.value)}
                  className="input w-full appearance-none pr-8"
                >
                  {agents.length === 0 && <option value="">Loading agents...</option>}
                  {agents.length > 0 && !agentB && <option value="">Select an agent...</option>}
                  {agents.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                Task Description
              </label>
              <input
                type="text"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="e.g. design the authentication flow"
                className="input"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                Namespace
              </label>
              <div className="relative">
                <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="input w-full appearance-none pr-8">
                  <option value="">All</option>
                  {namespaces.map((ns) => <option key={ns.namespace} value={ns.namespace}>{ns.namespace} ({ns.count})</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]" />
              </div>
            </div>
          </div>

          <button
            onClick={handleCompare}
            disabled={!agentA || !agentB || !task || loading}
            className="btn-primary text-sm"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Compare
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="card p-4 mb-6 border-status-reverted/40">
            <p className="text-sm text-status-reverted">{error}</p>
          </div>
        )}

        {/* Results */}
        {resultA && resultB && (
          <div className="animate-fade-in">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="card p-4 text-center">
                <p className="text-2xl font-bold text-primary tabular-nums">{uniqueA.length}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Unique to {agentA}
                </p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-2xl font-bold tabular-nums">{shared.length}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Shared
                </p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-2xl font-bold text-status-superseded tabular-nums">
                  {uniqueB.length}
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Unique to {agentB}
                </p>
              </div>
            </div>

            {/* Toggle shared */}
            <button onClick={() => setShowShared(!showShared)} className="btn-ghost text-xs mb-4">
              {showShared ? <EyeOff size={14} /> : <Eye size={14} />}
              {showShared ? 'Hide' : 'Show'} shared decisions
            </button>

            {/* Side-by-side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Agent A */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  {agentA}
                  <span className="text-xs text-[var(--text-secondary)] font-normal">
                    ({(resultA?.decisions ?? []).length} decisions)
                  </span>
                </h3>
                <div className="space-y-2">
                  {uniqueA.map((d) => (
                    <DecisionRow
                      key={d.id}
                      decision={d as any}
                      score={d.combined_score}
                      highlight="a"
                    />
                  ))}
                  {showShared &&
                    shared.map((d) => (
                      <DecisionRow
                        key={d.id}
                        decision={d as any}
                        score={d.combined_score}
                        highlight="shared"
                      />
                    ))}
                </div>
              </div>

              {/* Agent B */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-status-superseded" />
                  {agentB}
                  <span className="text-xs text-[var(--text-secondary)] font-normal">
                    ({(resultB?.decisions ?? []).length} decisions)
                  </span>
                </h3>
                <div className="space-y-2">
                  {uniqueB.map((d) => (
                    <DecisionRow
                      key={d.id}
                      decision={d as any}
                      score={d.combined_score}
                      highlight="b"
                    />
                  ))}
                  {showShared &&
                    shared.map((d) => {
                      const bEntry = (resultB?.decisions ?? []).find(
                        (bd) => bd.id === d.id,
                      );
                      return (
                        <DecisionRow
                          key={d.id}
                          decision={d as any}
                          score={bEntry?.combined_score ?? d.combined_score}
                          highlight="shared"
                        />
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Wing Analysis */}
            <WingAnalysis
              agentA={agentA}
              agentB={agentB}
              decisionsA={resultA?.decisions ?? []}
              decisionsB={resultB?.decisions ?? []}
              wingSrcA={resultA?.wing_sources}
              wingSrcB={resultB?.wing_sources}
            />
          </div>
        )}

        {/* Empty state */}
        {!resultA && !resultB && !loading && !error && (
          <div className="text-center py-16">
            <Columns2
              size={32}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-sm text-[var(--text-secondary)]">
              Enter two agent names and a task to compare their contexts
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
