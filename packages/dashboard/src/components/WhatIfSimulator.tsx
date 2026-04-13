import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import {
  Loader2,
  Zap,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Minus,
  Check,
  Info,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DecisionSummary {
  id: string;
  title: string;
  description: string;
  tags: string[];
  affects: string[];
  status: string;
}

interface AgentImpact {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  original_rank: number;
  proposed_rank: number;
  original_score: number;
  proposed_score: number;
  score_delta: number;
  rank_delta: number;
}

interface SimulationWarning {
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

interface SimulationResult {
  simulation_id: string;
  original_decision: DecisionSummary;
  proposed_decision: DecisionSummary;
  agent_impacts: AgentImpact[];
  summary: {
    total_agents: number;
    agents_affected: number;
    agents_improved: number;
    agents_degraded: number;
    agents_unchanged: number;
    newly_reached: string[];
    lost: string[];
  };
  warnings: SimulationWarning[];
  cascade_edges: Array<{ source_id: string; target_id: string; relationship: string }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function severityStyle(severity: string): { bg: string; border: string; text: string } {
  switch (severity) {
    case 'critical': return { bg: 'rgba(239,68,68,0.1)', border: 'var(--accent-danger)', text: 'var(--accent-danger)' };
    case 'warning': return { bg: 'rgba(234,179,8,0.1)', border: '#EAB308', text: '#EAB308' };
    default: return { bg: 'rgba(59,130,246,0.1)', border: 'var(--accent-primary)', text: 'var(--accent-primary)' };
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function WhatIfSimulator() {
  const { projectId } = useProject();
  const { get, post } = useApi();

  const [decisions, setDecisions] = useState<DecisionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Proposed changes
  const [propTitle, setPropTitle] = useState('');
  const [propDescription, setPropDescription] = useState('');
  const [propTags, setPropTags] = useState('');
  const [propAffects, setPropAffects] = useState('');

  // Simulation state
  const [simulating, setSimulating] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  /* ---- Fetch decisions -------------------------------------------- */
  useEffect(() => {
    if (projectId === 'default') return;
    let cancelled = false;
    setLoading(true);

    get<DecisionSummary[]>(`/api/projects/${projectId}/decisions`)
      .then((data) => {
        if (!cancelled) {
          const active = (data ?? []).filter((d) => d.status === 'active');
          setDecisions(active);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to load decisions'));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [projectId, get]);

  /* ---- Select decision -------------------------------------------- */
  const handleSelect = (id: string) => {
    setSelectedId(id);
    setResult(null);
    setApplied(false);
    const dec = decisions.find((d) => d.id === id);
    if (dec) {
      setPropTitle(dec.title);
      setPropDescription(dec.description ?? '');
      setPropTags(Array.isArray(dec.tags) ? dec.tags.join(', ') : '');
      setPropAffects(Array.isArray(dec.affects) ? dec.affects.join(', ') : '');
    }
  };

  /* ---- Run simulation --------------------------------------------- */
  const runSimulation = async () => {
    if (!selectedId) return;
    setSimulating(true);
    setError(null);
    setResult(null);
    setApplied(false);

    const original = decisions.find((d) => d.id === selectedId);
    if (!original) return;

    const proposed_changes: Record<string, unknown> = {};
    if (propTitle !== original.title) proposed_changes.title = propTitle;
    if (propDescription !== (original.description ?? '')) proposed_changes.description = propDescription;
    const newTags = propTags.split(',').map((t) => t.trim()).filter(Boolean);
    const origTags = Array.isArray(original.tags) ? original.tags : [];
    if (JSON.stringify(newTags) !== JSON.stringify(origTags)) proposed_changes.tags = newTags;
    const newAffects = propAffects.split(',').map((a) => a.trim()).filter(Boolean);
    const origAffects = Array.isArray(original.affects) ? original.affects : [];
    if (JSON.stringify(newAffects) !== JSON.stringify(origAffects)) proposed_changes.affects = newAffects;

    if (Object.keys(proposed_changes).length === 0) {
      setError('No changes detected — modify at least one field');
      setSimulating(false);
      return;
    }

    try {
      const sim = await post<SimulationResult>('/api/simulation/preview', {
        decision_id: selectedId,
        proposed_changes,
        project_id: projectId,
      });
      setResult(sim);
    } catch (err) {
      setError(err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Simulation failed'));
    } finally {
      setSimulating(false);
    }
  };

  /* ---- Apply change ----------------------------------------------- */
  const applyChange = async () => {
    if (!selectedId || !result) return;
    setApplying(true);
    setError(null);

    const original = decisions.find((d) => d.id === selectedId);
    if (!original) return;

    const proposed_changes: Record<string, unknown> = {};
    if (propTitle !== original.title) proposed_changes.title = propTitle;
    if (propDescription !== (original.description ?? '')) proposed_changes.description = propDescription;
    const newTags = propTags.split(',').map((t) => t.trim()).filter(Boolean);
    if (JSON.stringify(newTags) !== JSON.stringify(original.tags)) proposed_changes.tags = newTags;
    const newAffects = propAffects.split(',').map((a) => a.trim()).filter(Boolean);
    if (JSON.stringify(newAffects) !== JSON.stringify(original.affects)) proposed_changes.affects = newAffects;

    try {
      await post('/api/simulation/apply', {
        decision_id: selectedId,
        proposed_changes,
        project_id: projectId,
      });
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Apply failed'));
    } finally {
      setApplying(false);
    }
  };

  /* ---- Reset ------------------------------------------------------ */
  const handleReset = () => {
    const dec = decisions.find((d) => d.id === selectedId);
    if (dec) {
      setPropTitle(dec.title);
      setPropDescription(dec.description ?? '');
      setPropTags(Array.isArray(dec.tags) ? dec.tags.join(', ') : '');
      setPropAffects(Array.isArray(dec.affects) ? dec.affects.join(', ') : '');
    }
    setResult(null);
    setApplied(false);
    setError(null);
  };

  /* ---- Render ----------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-secondary)' }}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading decisions...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(6,63,249,0.12)', border: '1px solid rgba(6,63,249,0.2)' }}>
          <Zap className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>What-If Simulator</h1>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Preview how decision changes affect agent context rankings
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 rounded-xl text-sm font-medium" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--accent-danger)', border: '1px solid rgba(239,68,68,0.2)', backdropFilter: 'blur(12px)' }}>
          {error}
        </div>
      )}

      {/* Decision selector */}
      <div className="card rounded-2xl p-5 mb-5">
        <label className="block text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Select Decision
        </label>
        <select
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
          className="w-full p-3 rounded-xl text-sm font-medium"
          style={{ background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)' }}
        >
          <option value="">-- Choose a decision --</option>
          {decisions.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      </div>

      {/* Empty state */}
      {!selectedId && (
        <div className="text-center py-20" style={{ color: 'var(--text-tertiary)' }}>
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(6,63,249,0.06)', border: '1px solid rgba(6,63,249,0.1)' }}>
            <Zap className="w-8 h-8 opacity-40" />
          </div>
          <p className="text-lg font-semibold mb-2">Select a decision and modify it to preview the impact on agent context packages.</p>
        </div>
      )}

      {/* Edit fields */}
      {selectedId && (
        <>
          <div className="card rounded-2xl p-6 mb-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Proposed Changes</h3>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2 ml-1" style={{ color: 'var(--text-tertiary)' }}>Title</label>
              <input
                type="text"
                value={propTitle}
                onChange={(e) => setPropTitle(e.target.value)}
                className="w-full p-3 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.4)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2 ml-1" style={{ color: 'var(--text-tertiary)' }}>Description</label>
              <textarea
                value={propDescription}
                onChange={(e) => setPropDescription(e.target.value)}
                rows={3}
                className="w-full p-3 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.4)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2 ml-1" style={{ color: 'var(--text-tertiary)' }}>Tags (comma-separated)</label>
              <input
                type="text"
                value={propTags}
                onChange={(e) => setPropTags(e.target.value)}
                className="w-full p-3 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.4)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2 ml-1" style={{ color: 'var(--text-tertiary)' }}>Affects (comma-separated)</label>
              <input
                type="text"
                value={propAffects}
                onChange={(e) => setPropAffects(e.target.value)}
                className="w-full p-3 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.5)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.4)' }}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-3">
              <button
                onClick={runSimulation}
                disabled={simulating}
                className="px-6 py-3 rounded-xl text-sm font-bold text-white flex items-center gap-2 transition-all hover:-translate-y-0.5"
                style={{ background: simulating ? '#6B7280' : 'var(--accent-primary)', boxShadow: simulating ? 'none' : '0 0 20px rgba(6,63,249,0.4)' }}
              >
                {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {simulating ? 'Simulating...' : 'Run Simulation'}
              </button>

              <button
                onClick={handleReset}
                className="px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all hover:bg-white/80"
                style={{ background: 'rgba(255,255,255,0.5)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.4)', backdropFilter: 'blur(12px)' }}
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="space-y-2">
                  {result.warnings.map((w, i) => {
                    const style = severityStyle(w.severity);
                    return (
                      <div
                        key={i}
                        className="p-3 rounded-lg text-sm flex items-start gap-2"
                        style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.text }}
                      >
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{w.message}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <SummaryCard label="Total Agents" value={result.summary.total_agents} />
                <SummaryCard label="Affected" value={result.summary.agents_affected} color="#EAB308" />
                <SummaryCard label="Improved" value={result.summary.agents_improved} color="#22C55E" />
                <SummaryCard label="Degraded" value={result.summary.agents_degraded} color="#EF4444" />
              </div>

              {/* Newly reached / lost */}
              {(result.summary.newly_reached.length > 0 || result.summary.lost.length > 0) && (
                <div className="flex gap-4 text-sm">
                  {result.summary.newly_reached.length > 0 && (
                    <div className="flex items-center gap-1" style={{ color: '#22C55E' }}>
                      <ArrowUp className="w-4 h-4" />
                      Newly reached: {result.summary.newly_reached.join(', ')}
                    </div>
                  )}
                  {result.summary.lost.length > 0 && (
                    <div className="flex items-center gap-1" style={{ color: '#EF4444' }}>
                      <ArrowDown className="w-4 h-4" />
                      Lost: {result.summary.lost.join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Agent impact table */}
              <div className="card rounded-2xl overflow-hidden" style={{ padding: 0 }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.3)' }}>
                      <th className="text-left px-6 py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Agent</th>
                      <th className="text-center px-6 py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Now (rank)</th>
                      <th className="text-center px-6 py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Proposed (rank)</th>
                      <th className="text-center px-6 py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Score Delta</th>
                      <th className="text-center px-6 py-4 font-bold text-xs uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.agent_impacts.map((impact) => (
                      <tr key={impact.agent_id} className="hover:bg-white/30 transition-colors" style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }}>
                        <td className="px-6 py-4" style={{ color: 'var(--text-primary)' }}>
                          <div className="font-bold">{impact.agent_name}</div>
                          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{impact.agent_role}</div>
                        </td>
                        <td className="text-center px-6 py-4" style={{ color: 'var(--text-secondary)' }}>
                          #{impact.original_rank} ({impact.original_score.toFixed(3)})
                        </td>
                        <td className="text-center px-6 py-4" style={{ color: 'var(--text-secondary)' }}>
                          #{impact.proposed_rank} ({impact.proposed_score.toFixed(3)})
                        </td>
                        <td className="text-center px-6 py-4 font-mono">
                          <span style={{ color: impact.score_delta > 0 ? '#22C55E' : impact.score_delta < 0 ? '#EF4444' : 'var(--text-tertiary)' }}>
                            {impact.score_delta > 0 ? '+' : ''}{impact.score_delta.toFixed(3)}
                          </span>
                        </td>
                        <td className="text-center px-6 py-4">
                          {impact.rank_delta > 0 && <ArrowUp className="w-4 h-4 mx-auto" style={{ color: '#22C55E' }} />}
                          {impact.rank_delta < 0 && <ArrowDown className="w-4 h-4 mx-auto" style={{ color: '#EF4444' }} />}
                          {impact.rank_delta === 0 && <Minus className="w-4 h-4 mx-auto" style={{ color: 'var(--text-tertiary)' }} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cascade info */}
              {result.cascade_edges.length > 0 && (
                <div className="card p-4 rounded-xl text-sm flex items-start gap-3" style={{ background: 'rgba(6,63,249,0.06)', border: '1px solid rgba(6,63,249,0.2)', color: 'var(--accent-primary)' }}>
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="font-medium">{result.cascade_edges.length} connected edge(s) may be affected by this change.</span>
                </div>
              )}

              {/* Apply button */}
              <div className="flex gap-3">
                {!applied ? (
                  <button
                    onClick={applyChange}
                    disabled={applying}
                    className="px-6 py-3 rounded-xl text-sm font-bold text-white flex items-center gap-2 transition-all hover:-translate-y-0.5"
                    style={{ background: applying ? '#6B7280' : '#22C55E', boxShadow: applying ? 'none' : '0 0 20px rgba(34,197,94,0.4)' }}
                  >
                    {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {applying ? 'Applying...' : 'Apply This Change'}
                  </button>
                ) : (
                  <div className="card flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold" style={{ background: 'rgba(34,197,94,0.08)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <Check className="w-4 h-4" />
                    Change applied successfully
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary Card                                                       */
/* ------------------------------------------------------------------ */

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card rounded-2xl p-5 hover:-translate-y-1 transition-all duration-300">
      <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="text-3xl font-bold" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
