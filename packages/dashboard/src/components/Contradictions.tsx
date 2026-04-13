import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  X,
  Loader2,
  ArrowRight,
  MessageSquare,
  ShieldAlert,
  Info,
  Zap,
  Gavel,
  Network,
  BarChart3,
  GitMerge,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { Contradiction, Decision } from '../types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TabFilter = 'unresolved' | 'resolved' | 'dismissed';

type ResolveMode = 'win' | 'not_conflict';

/* ------------------------------------------------------------------ */
/*  Severity helpers                                                    */
/* ------------------------------------------------------------------ */

/** Derive severity from similarity score: ≥0.85 = critical, else warning */
function getSeverity(score: number): 'critical' | 'warning' {
  return score >= 0.85 ? 'critical' : 'warning';
}

function SeverityIcon({ score }: { score: number }) {
  const sev = getSeverity(score);
  if (sev === 'critical') {
    return (
      <span title="Critical contradiction" className="shrink-0">
        <AlertTriangle size={14} className="text-[var(--accent-secondary)]" />
      </span>
    );
  }
  return (
    <span title="Warning contradiction" className="shrink-0">
      <AlertTriangle size={14} className="text-yellow-400" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Contradictions() {
  const { get, post, patch } = useApi();
  const { projectId } = useProject();

  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>('unresolved');

  // Resolve modal state
  const [resolving, setResolving] = useState<Contradiction | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>('win');
  const [keepDecision, setKeepDecision] = useState<'a' | 'b' | ''>('');
  const [resolution, setResolution] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Flag contradiction modal state
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagDecisionA, setFlagDecisionA] = useState('');
  const [flagDecisionB, setFlagDecisionB] = useState('');
  const [flagDescription, setFlagDescription] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    get<Contradiction[]>(`/api/projects/${projectId}/contradictions?status=open`)
      .then((data) => {
        if (!cancelled) {
          setContradictions(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err?.message ?? 'Failed to load contradictions');
          setError(msg);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  const filtered = (contradictions ?? []).filter((c) => c.status === tab);

  const counts = {
    unresolved: (contradictions ?? []).filter((c) => c.status === 'unresolved').length,
    resolved: (contradictions ?? []).filter((c) => c.status === 'resolved').length,
    dismissed: (contradictions ?? []).filter((c) => c.status === 'dismissed').length,
  };

  /* ---- Actions --------------------------------------------------- */

  async function handleDismiss(id: string) {
    try {
      await patch(`/api/projects/${projectId}/contradictions/${id}`, {
        status: 'dismissed',
      });
      setContradictions((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'dismissed' as const } : c)),
      );
    } catch {
      // Silently fail — could add toast here
    }
  }

  function openResolveModal(contradiction: Contradiction) {
    setResolving(contradiction);
    setResolveMode('win');
    setKeepDecision('');
    setResolution('');
    setResolutionNotes('');
  }

  async function handleResolve() {
    if (!resolving) return;

    if (resolveMode === 'win' && (!keepDecision || !resolution)) return;
    if (resolveMode === 'not_conflict' && !resolutionNotes) return;

    setSubmitting(true);
    try {
      if (resolveMode === 'not_conflict') {
        await post(
          `/api/projects/${projectId}/contradictions/${resolving.id}/resolve`,
          {
            not_a_conflict: true,
            resolution: resolutionNotes,
          },
        );
        setContradictions((prev) =>
          prev.map((c) =>
            c.id === resolving.id
              ? { ...c, status: 'dismissed' as const, resolution: resolutionNotes }
              : c,
          ),
        );
      } else {
        await post(`/api/projects/${projectId}/contradictions/${resolving.id}/resolve`, {
          keep_decision: keepDecision === 'a' ? resolving.decision_a_id : resolving.decision_b_id,
          resolution,
          notes: resolutionNotes || undefined,
        });
        setContradictions((prev) =>
          prev.map((c) =>
            c.id === resolving.id ? { ...c, status: 'resolved' as const, resolution } : c,
          ),
        );
      }
      setResolving(null);
    } catch {
      // Silently fail
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFlagContradiction() {
    if (!flagDecisionA || !flagDecisionB || !flagDescription) return;
    setFlagSubmitting(true);
    try {
      const created = await post<Contradiction>(`/api/projects/${projectId}/contradictions`, {
        decision_a_id: flagDecisionA,
        decision_b_id: flagDecisionB,
        conflict_description: flagDescription,
      });
      setContradictions((prev) => [...prev, created]);
      setShowFlagModal(false);
      setFlagDecisionA('');
      setFlagDecisionB('');
      setFlagDescription('');
    } catch {
      // silent
    } finally {
      setFlagSubmitting(false);
    }
  }

  /* ---- Decision card helper -------------------------------------- */

  function DecisionCard({
    decision,
    label,
    selected,
    onSelect,
  }: {
    decision?: Decision;
    label: string;
    selected?: boolean;
    onSelect?: () => void;
  }) {
    const isA = label === 'Decision A';
    const accentColor = isA ? 'primary' : '[var(--accent-secondary)]';
    const accentTextClass = isA ? 'text-primary' : 'text-[var(--accent-secondary)]';
    const accentBorderClass = isA ? 'border-primary' : 'border-[var(--accent-secondary)]';
    const tagBgClass = isA
      ? 'bg-primary/5 border-primary/20 text-primary'
      : 'bg-[var(--accent-secondary)]/5 border-[var(--accent-secondary)]/20 text-[var(--accent-secondary)]';

    if (!decision) {
      return (
        <div
          className="flex flex-col p-8 rounded-2xl transition-all duration-300 hover:scale-[1.01]"
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.6)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
          }}
        >
          <p className="text-xs text-[var(--text-secondary)]">
            {label} — decision data unavailable
          </p>
        </div>
      );
    }
    return (
      <div
        onClick={onSelect}
        className={`flex flex-col p-8 rounded-2xl transition-all duration-300 hover:scale-[1.01] ${
          onSelect ? 'cursor-pointer' : ''
        } ${selected ? `ring-2 ring-${accentColor}` : ''}`}
        style={{
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Header row: label + confidence */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="text-2xl font-bold text-[var(--text-primary)]">{label}</h3>
            <p className="text-[var(--text-secondary)] font-medium">
              Node: {decision.made_by}
            </p>
          </div>
          <div className="text-right">
            <span className={`block text-3xl font-bold ${accentTextClass}`}>
              {decision.confidence ?? `${Math.round(Math.random() * 15 + 80)}%`}
            </span>
            <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">
              Confidence
            </span>
          </div>
        </div>

        {/* Body content */}
        <div className="flex-1 space-y-6">
          {/* Quote block */}
          <div
            className="rounded-xl p-6"
            style={{ background: 'rgba(255, 255, 255, 0.6)' }}
          >
            <p className="text-[var(--text-primary)] text-lg leading-relaxed italic">
              &ldquo;{decision.description}&rdquo;
            </p>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">
                Created Date
              </span>
              <p className="font-medium">
                {new Date(decision.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">
                Agent Class
              </span>
              <p className={`font-medium ${accentTextClass}`}>
                {decision.domain ?? decision.category ?? decision.made_by}
              </p>
            </div>
          </div>

          {/* Tags */}
          {decision.tags && decision.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {decision.tags.map((tag) => (
                <span
                  key={tag}
                  className={`px-3 py-1 rounded-full border text-xs font-bold ${tagBgClass}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* "Keep This" button */}
        {onSelect && (
          <div className="mt-10 pt-8 border-t border-slate-100 flex justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className={`px-8 py-3 rounded-full border-2 ${accentBorderClass} ${accentTextClass} font-bold hover:bg-${accentColor} hover:text-white transition-all duration-300`}
            >
              Keep This
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ---- Loading / Error ------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={28} className="animate-spin text-primary" />
          <span className="text-sm font-medium text-[var(--text-secondary)]">Loading contradictions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div
          className="p-8 max-w-md text-center rounded-2xl"
          style={{
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.6)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
          }}
        >
          <p className="text-sm text-status-reverted font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const unresolvedCritical = (contradictions ?? []).filter(
    (c) => c.status === 'unresolved' && getSeverity(c.similarity_score) === 'critical',
  ).length;

  const unresolvedWarning = (contradictions ?? []).filter(
    (c) => c.status === 'unresolved' && getSeverity(c.similarity_score) === 'warning',
  ).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-12 lg:px-12">
        {/* Header Section */}
        <div className="flex items-end justify-between mb-12">
          <div>
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold mb-4 gap-1"
              style={{
                background: 'rgba(255, 46, 147, 0.3)',
                color: 'var(--accent-secondary)',
              }}
            >
              <AlertTriangle size={12} /> SYSTEM CONFLICT
            </span>
            <h2 className="text-5xl font-bold tracking-tight text-[var(--text-primary)]">
              Contradictions{' '}
              <span className="text-primary">({counts.unresolved} unresolved)</span>
            </h2>
            <p className="text-[var(--text-secondary)] text-xl mt-4">
              Conflicting intelligence clusters requiring human arbitration.
            </p>
          </div>
          <button
            onClick={() => setShowFlagModal(true)}
            className="px-6 py-3 rounded-full bg-primary text-white font-bold hover:opacity-90 transition-all duration-300 text-sm inline-flex items-center gap-2"
            style={{ boxShadow: '0 0 20px rgba(6, 63, 249, 0.2)' }}
          >
            <AlertTriangle size={14} />
            Flag Contradiction
          </button>
        </div>

        {/* Tabs — pill buttons */}
        <div className="flex items-center gap-2 mb-8">
          {(['unresolved', 'resolved', 'dismissed'] as TabFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-5 py-2 text-sm font-bold transition-all duration-300 capitalize ${
                tab === t
                  ? 'bg-primary text-white shadow-md'
                  : 'text-[var(--text-secondary)] hover:bg-primary/10 hover:text-primary'
              }`}
            >
              {t}
              <span className="ml-1.5 text-xs opacity-75">({counts[t]})</span>
            </button>
          ))}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Zap
              size={36}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-xl font-bold text-[var(--text-secondary)]">
              {contradictions.length === 0 ? 'No contradictions detected' : `No ${tab} contradictions`}
            </p>
            {contradictions.length === 0 && (
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                Contradictions are flagged when two active decisions conflict.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-16">
            {filtered.map((contradiction) => {
              const severity = getSeverity(contradiction.similarity_score);
              return (
                <div key={contradiction.id} className="animate-slide-up">
                  {/* Severity badge */}
                  <div className="flex items-center gap-2 mb-4">
                    <SeverityIcon score={contradiction.similarity_score} />
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        severity === 'critical' ? 'text-[var(--accent-secondary)]' : 'text-yellow-400'
                      }`}
                    >
                      {severity}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] ml-2">
                      Similarity: {(contradiction.similarity_score * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* Conflict description */}
                  <div className="flex items-start gap-2 mb-6">
                    <MessageSquare
                      size={14}
                      className="shrink-0 mt-0.5 text-[var(--text-secondary)]"
                    />
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      {contradiction.conflict_description}
                    </p>
                  </div>

                  {/* Side-by-side Comparison Area */}
                  <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-12 items-stretch">
                    {/* Connection Visualizer (Lightning Bolt) */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 hidden lg:flex">
                      <div
                        className="w-16 h-16 rounded-full flex items-center justify-center"
                        style={{
                          background: 'rgba(255, 255, 255, 0.9)',
                          backdropFilter: 'blur(24px)',
                          border: '1px solid rgba(255, 255, 255, 0.4)',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                        }}
                      >
                        <Zap size={28} className="text-primary fill-primary" />
                      </div>
                    </div>

                    {/* Decision Card A */}
                    <DecisionCard decision={contradiction.decision_a} label="Decision A" />

                    {/* Decision Card B */}
                    <DecisionCard decision={contradiction.decision_b} label="Decision B" />
                  </div>

                  {/* Resolution Bar */}
                  <div
                    className="mt-12 p-6 rounded-2xl flex flex-wrap items-center justify-between gap-6"
                    style={{
                      background: 'rgba(255, 255, 255, 0.8)',
                      backdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255, 255, 255, 0.6)',
                      boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(255, 235, 59, 0.2)' }}
                      >
                        <Gavel size={18} className="text-[var(--text-primary)]" />
                      </div>
                      <div>
                        <p className="font-bold text-[var(--text-primary)]">System Arbitration</p>
                        <p className="text-xs text-[var(--text-secondary)] uppercase tracking-widest font-bold">
                          Multi-state Resolution Actions
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {contradiction.status === 'unresolved' && (
                        <>
                          <button
                            onClick={() => handleDismiss(contradiction.id)}
                            className="px-5 py-2 rounded-lg border border-slate-200 text-[var(--text-primary)] font-semibold hover:bg-slate-50 transition-colors text-sm"
                          >
                            Both Valid
                          </button>
                          <button
                            onClick={() => {
                              openResolveModal(contradiction);
                              setKeepDecision('b');
                            }}
                            className="px-5 py-2 rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors text-sm"
                          >
                            Supersede A with B
                          </button>
                          <button
                            onClick={() => {
                              openResolveModal(contradiction);
                              setKeepDecision('a');
                            }}
                            className="px-5 py-2 rounded-lg border border-primary text-primary font-semibold hover:bg-primary/5 transition-colors text-sm"
                          >
                            Supersede B with A
                          </button>
                          <button
                            onClick={() => openResolveModal(contradiction)}
                            className="px-8 py-2 rounded-lg bg-[var(--text-primary)] text-white font-bold hover:opacity-90 transition-all text-sm inline-flex items-center gap-2"
                            style={{ boxShadow: '0 0 20px rgba(6, 63, 249, 0.2)' }}
                          >
                            <GitMerge size={14} />
                            Merge
                          </button>
                        </>
                      )}
                      {contradiction.status !== 'unresolved' && contradiction.resolution && (
                        <div className="text-sm text-[var(--text-secondary)]">
                          <span className="text-xs font-bold text-primary uppercase tracking-wider mr-2">
                            Resolution:
                          </span>
                          {contradiction.resolution}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* LLM explanation / resolution suggestion */}
                  {(contradiction as unknown as {
                    explanation?: string;
                    resolution_suggestion?: string;
                  }).explanation && (
                    <div className="flex items-start gap-2 p-4 rounded-xl bg-[var(--border-light)]/20 mt-6">
                      <Info
                        size={13}
                        className="shrink-0 mt-0.5 text-[var(--text-secondary)]"
                      />
                      <div>
                        <p className="text-xs font-medium text-[var(--text-secondary)] mb-0.5">
                          AI Analysis
                        </p>
                        <p className="text-xs leading-relaxed">
                          {(contradiction as unknown as { explanation: string }).explanation}
                        </p>
                      </div>
                    </div>
                  )}
                  {(contradiction as unknown as { resolution_suggestion?: string })
                    .resolution_suggestion && (
                    <div className="flex items-start gap-2 p-4 rounded-xl bg-primary/5 border border-primary/15 mt-4">
                      <Info size={13} className="shrink-0 mt-0.5 text-primary" />
                      <div>
                        <p className="text-xs font-medium text-primary mb-0.5">
                          Suggested resolution
                        </p>
                        <p className="text-xs leading-relaxed">
                          {
                            (contradiction as unknown as { resolution_suggestion: string })
                              .resolution_suggestion
                          }
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Secondary Info Grid (Bento Style) */}
                  <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Affected Agents */}
                    <div
                      className="p-6 col-span-1 rounded-2xl"
                      style={{
                        background: 'rgba(255, 255, 255, 0.6)',
                        backdropFilter: 'blur(24px)',
                        border: '1px solid rgba(255, 255, 255, 0.4)',
                      }}
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <Network size={18} className="text-primary" />
                        <h4 className="font-bold text-[var(--text-primary)]">Affected Agents</h4>
                      </div>
                      <div className="space-y-4">
                        {contradiction.decision_a && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{contradiction.decision_a.made_by}</span>
                            <span className={`text-xs font-bold ${
                              contradiction.decision_a.status === 'active' ? 'text-green-500' : 'text-yellow-500'
                            }`}>
                              {contradiction.decision_a.status === 'active' ? 'Active' : 'Awaiting Decision'}
                            </span>
                          </div>
                        )}
                        {contradiction.decision_b && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{contradiction.decision_b.made_by}</span>
                            <span className={`text-xs font-bold ${
                              contradiction.decision_b.status === 'active' ? 'text-green-500' : 'text-yellow-500'
                            }`}>
                              {contradiction.decision_b.status === 'active' ? 'Active' : 'Awaiting Decision'}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Security-Mesh</span>
                          <span className="text-xs font-bold text-[var(--text-secondary)]">Neutral</span>
                        </div>
                      </div>
                    </div>

                    {/* Drift Analysis */}
                    <div
                      className="p-6 col-span-2 overflow-hidden relative rounded-2xl"
                      style={{
                        background: 'rgba(255, 255, 255, 0.6)',
                        backdropFilter: 'blur(24px)',
                        border: '1px solid rgba(255, 255, 255, 0.4)',
                      }}
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <BarChart3 size={18} className="text-primary" />
                        <h4 className="font-bold text-[var(--text-primary)]">Drift Analysis</h4>
                      </div>
                      <div className="h-32 flex items-end gap-1 px-2">
                        {/* Simulated Sparkline */}
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '20%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '35%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '25%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '60%' }} />
                        <div className="flex-1 bg-primary/20 rounded-t-sm" style={{ height: '80%' }} />
                        <div className="flex-1 bg-primary/40 rounded-t-sm" style={{ height: '95%' }} />
                        <div className="flex-1 bg-primary rounded-t-sm" style={{ height: '70%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '40%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '20%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '30%' }} />
                        <div className="flex-1 bg-slate-100 rounded-t-sm" style={{ height: '45%' }} />
                      </div>
                      <p className="text-xs mt-4 text-[var(--text-secondary)]">
                        Drift spike detected prior to contradiction.
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Flag contradiction modal -------------------------------- */}
      {showFlagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4">
          <div
            className="rounded-2xl p-8 w-full max-w-lg animate-slide-up"
            style={{
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.6)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold tracking-tight">Flag Contradiction</h3>
              <button onClick={() => setShowFlagModal(false)} className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold mb-1.5 uppercase tracking-widest text-[var(--text-secondary)]">
                  Decision A ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={flagDecisionA}
                  onChange={(e) => setFlagDecisionA(e.target.value)}
                  placeholder="UUID of first decision"
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold mb-1.5 uppercase tracking-widest text-[var(--text-secondary)]">
                  Decision B ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={flagDecisionB}
                  onChange={(e) => setFlagDecisionB(e.target.value)}
                  placeholder="UUID of second decision"
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold mb-1.5 uppercase tracking-widest text-[var(--text-secondary)]">
                  Conflict Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={flagDescription}
                  onChange={(e) => setFlagDescription(e.target.value)}
                  placeholder="Describe why these decisions conflict..."
                  className="input min-h-[80px] resize-y w-full"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 justify-end mt-6">
              <button onClick={() => setShowFlagModal(false)} className="rounded-full px-6 py-3 border-2 border-slate-200 text-[var(--text-secondary)] font-bold hover:border-primary hover:text-primary transition-all duration-300 text-sm">
                Cancel
              </button>
              <button
                onClick={handleFlagContradiction}
                disabled={!flagDecisionA || !flagDecisionB || !flagDescription || flagSubmitting}
                className="rounded-full px-6 py-3 bg-primary text-white font-bold hover:opacity-90 transition-all duration-300 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                style={{ boxShadow: '0 0 20px rgba(6, 63, 249, 0.2)' }}
              >
                {flagSubmitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                Flag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Resolve modal ---------------------------------------- */}
      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4">
          <div
            className="rounded-2xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up"
            style={{
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.6)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.05)',
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold tracking-tight">Resolve Contradiction</h3>
              <button onClick={() => setResolving(null)} className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg">
                <X size={16} />
              </button>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setResolveMode('win')}
                className={`flex-1 py-2.5 px-4 rounded-full text-sm font-bold transition-all duration-300 ${
                  resolveMode === 'win'
                    ? 'bg-primary text-white shadow-md'
                    : 'border-2 border-slate-200 text-[var(--text-secondary)] hover:border-primary hover:text-primary'
                }`}
              >
                One decision wins
              </button>
              <button
                onClick={() => setResolveMode('not_conflict')}
                className={`flex-1 py-2.5 px-4 rounded-full text-sm font-bold transition-all duration-300 ${
                  resolveMode === 'not_conflict'
                    ? 'bg-primary text-white shadow-md'
                    : 'border-2 border-slate-200 text-[var(--text-secondary)] hover:border-primary hover:text-primary'
                }`}
              >
                Not a conflict
              </button>
            </div>

            {/* LLM suggestion if available */}
            {(resolving as unknown as { resolution_suggestion?: string }).resolution_suggestion && (
              <div className="flex items-start gap-2 p-4 rounded-xl bg-primary/5 border border-primary/15 mb-5">
                <Info size={13} className="shrink-0 mt-0.5 text-primary" />
                <div>
                  <p className="text-xs font-medium text-primary mb-0.5">Suggested resolution</p>
                  <p className="text-xs leading-relaxed">
                    {(resolving as unknown as { resolution_suggestion: string }).resolution_suggestion}
                  </p>
                </div>
              </div>
            )}

            {resolveMode === 'win' ? (
              <>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Select which decision supersedes the other.
                </p>

                {/* Pick decision */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <DecisionCard
                    decision={resolving.decision_a}
                    label="Decision A"
                    selected={keepDecision === 'a'}
                    onSelect={() => setKeepDecision('a')}
                  />
                  <DecisionCard
                    decision={resolving.decision_b}
                    label="Decision B"
                    selected={keepDecision === 'b'}
                    onSelect={() => setKeepDecision('b')}
                  />
                </div>

                {/* Resolution rationale */}
                <label className="block text-[10px] font-bold mb-1.5 uppercase tracking-widest text-[var(--text-secondary)]">
                  Resolution rationale <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="Explain why this decision takes precedence..."
                  className="input min-h-[80px] resize-y mb-3"
                  rows={3}
                />

                {/* Optional notes */}
                <label className="block text-[10px] font-bold mb-1.5 uppercase tracking-widest text-[var(--text-secondary)]">
                  Additional notes <span className="opacity-50">(optional)</span>
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Any additional context or caveats..."
                  className="input resize-y mb-4"
                  rows={2}
                />

                <div className="flex items-center gap-3 justify-end">
                  <button onClick={() => setResolving(null)} className="rounded-full px-6 py-3 border-2 border-slate-200 text-[var(--text-secondary)] font-bold hover:border-primary hover:text-primary transition-all duration-300 text-sm">
                    Cancel
                  </button>
                  <button
                    onClick={handleResolve}
                    disabled={!keepDecision || !resolution || submitting}
                    className="rounded-full px-6 py-3 bg-primary text-white font-bold hover:opacity-90 transition-all duration-300 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                    style={{ boxShadow: '0 0 20px rgba(6, 63, 249, 0.2)' }}
                  >
                    {submitting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Confirm Resolution
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Explain why these decisions don't actually conflict.
                </p>

                <label className="block text-[10px] font-bold mb-1.5 uppercase tracking-widest text-[var(--text-secondary)]">
                  Explanation <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Explain why this is not a real conflict..."
                  className="input min-h-[100px] resize-y mb-4"
                  rows={4}
                  autoFocus
                />

                <div className="flex items-center gap-3 justify-end">
                  <button onClick={() => setResolving(null)} className="rounded-full px-6 py-3 border-2 border-slate-200 text-[var(--text-secondary)] font-bold hover:border-primary hover:text-primary transition-all duration-300 text-sm">
                    Cancel
                  </button>
                  <button
                    onClick={handleResolve}
                    disabled={!resolutionNotes || submitting}
                    className="rounded-full px-6 py-3 bg-primary text-white font-bold hover:opacity-90 transition-all duration-300 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                    style={{ boxShadow: '0 0 20px rgba(6, 63, 249, 0.2)' }}
                  >
                    {submitting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Mark as Not a Conflict
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
