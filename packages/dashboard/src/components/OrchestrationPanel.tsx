import React, { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import {
  Loader2,
  Zap,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  ArrowRight,
  ListOrdered,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  PROCEED: '#10b981',
  PROCEED_WITH_NOTE: '#f59e0b',
  SKIP: '#6b7280',
  OVERRIDE_TO: '#3b82f6',
  ASK_FOR_CLARIFICATION: '#eab308',
};

function ActionBadge({ action, reason }: { action?: string; reason?: string }) {
  if (!action) return null;
  const color = ACTION_COLORS[action] || '#6b7280';
  return (
    <div style={{ marginTop: 8 }}>
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
        backgroundColor: color + '22', color, fontWeight: 600, fontSize: 12,
        border: `1px solid ${color}44`,
      }}>
        {action}
      </span>
      {reason && <div style={{ color: '#d1d5db', fontSize: 13, marginTop: 4 }}>{reason}</div>}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NextAgentSuggestion {
  recommended_agent: string;
  recommended_role: string;
  confidence: number;
  task_suggestion: string;
  pre_compiled_context: string | null;
  reasoning: string;
  alternatives: Array<{
    agent: string;
    role: string;
    score: number;
    task_suggestion: string;
  }>;
  is_session_complete: boolean;
  completion_reason?: string;
  estimated_remaining_steps: number;
  session_progress: number;
}

interface SessionPlan {
  session_title: string;
  suggested_plan: Array<{
    step: number;
    agent: string;
    role: string;
    task: string;
    relevance: number;
  }>;
  estimated_agents: number;
  note: string;
}

interface OrchestrationPanelProps {
  sessionId: string;
  sessionStatus: string;
  onRefresh?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Confidence badge                                                   */
/* ------------------------------------------------------------------ */

function confidenceColor(confidence: number): string {
  if (confidence >= 0.6) return '#22C55E';
  if (confidence >= 0.3) return '#EAB308';
  return '#EF4444';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OrchestrationPanel({ sessionId, sessionStatus, onRefresh }: OrchestrationPanelProps) {
  const { post } = useApi();

  const [suggestion, setSuggestion] = useState<NextAgentSuggestion | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [overrideAgent, setOverrideAgent] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = sessionStatus === 'active';

  /* ---- Fetch suggestion --------------------------------------------- */
  const fetchSuggestion = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await post<NextAgentSuggestion>(
        `/api/tasks/session/${sessionId}/suggest-next`,
        {},
      );
      setSuggestion(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get suggestion');
    } finally {
      setLoading(false);
    }
  };

  /* ---- Fetch plan --------------------------------------------------- */
  const fetchPlan = async () => {
    setPlanLoading(true);
    try {
      const data = await post<SessionPlan>(
        `/api/tasks/session/${sessionId}/plan`,
        {},
      );
      setPlan(data);
      setShowPlan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get plan');
    } finally {
      setPlanLoading(false);
    }
  };

  /* ---- Accept suggestion -------------------------------------------- */
  const handleAccept = async (agent: string, isOverride: boolean) => {
    setAccepting(true);
    try {
      await post(`/api/tasks/session/${sessionId}/accept-suggestion`, {
        accepted_agent: agent,
        override: isOverride,
        override_reason: isOverride ? overrideReason : undefined,
      });
      setShowOverride(false);
      setOverrideAgent('');
      setOverrideReason('');
      onRefresh?.();
      await fetchSuggestion();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept suggestion');
    } finally {
      setAccepting(false);
    }
  };

  /* ---- Auto-fetch on mount ----------------------------------------- */
  useEffect(() => {
    if (isActive) {
      fetchSuggestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!isActive) return null;

  return (
    <div className="mt-4 rounded-lg p-4" style={{ background: 'rgba(6,63,249,0.08)', border: '1px solid rgba(6,63,249,0.3)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--accent-primary)' }}>Smart Orchestrator</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchPlan}
            disabled={planLoading}
            className="px-2 py-1 rounded text-xs flex items-center gap-1"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
          >
            {planLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListOrdered className="w-3 h-3" />}
            Plan
          </button>
          <button
            onClick={fetchSuggestion}
            disabled={loading}
            className="px-2 py-1 rounded text-xs flex items-center gap-1"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Progress bar + remaining steps */}
      {suggestion && !suggestion.is_session_complete && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Session progress
            </span>
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              {suggestion.session_progress}%
              {suggestion.estimated_remaining_steps > 0 && (
                <span style={{ color: 'var(--text-tertiary)' }}> — {suggestion.estimated_remaining_steps} step{suggestion.estimated_remaining_steps !== 1 ? 's' : ''} remaining</span>
              )}
            </span>
          </div>
          <div className="w-full rounded-full h-1.5" style={{ background: 'var(--bg-secondary)' }}>
            <div
              className="h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${suggestion.session_progress}%`, background: 'var(--accent-primary)' }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444' }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !suggestion && (
        <div className="flex items-center gap-2 py-4 justify-center" style={{ color: 'var(--text-tertiary)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Analyzing agent relevance...</span>
        </div>
      )}

      {/* Suggestion */}
      {suggestion && !suggestion.is_session_complete && (
        <>
          <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4" style={{ color: '#22C55E' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {suggestion.recommended_agent}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                  {suggestion.recommended_role}
                </span>
              </div>
              <span
                className="text-xs font-mono px-2 py-0.5 rounded"
                style={{
                  background: `${confidenceColor(suggestion.confidence)}20`,
                  color: confidenceColor(suggestion.confidence),
                }}
              >
                {(suggestion.confidence * 100).toFixed(0)}%
              </span>
            </div>

            <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
              <ArrowRight className="w-3 h-3 inline mr-1" />
              {suggestion.task_suggestion}
            </p>

            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {suggestion.reasoning}
            </p>

            {/* Accept/Override buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => handleAccept(suggestion.recommended_agent, false)}
                disabled={accepting}
                className="px-3 py-1.5 rounded text-xs font-medium text-white flex items-center gap-1"
                style={{ background: '#22C55E' }}
              >
                {accepting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                Accept
              </button>
              <button
                onClick={() => setShowOverride(!showOverride)}
                className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
              >
                Override
              </button>
            </div>
          </div>

          {/* Override form */}
          {showOverride && (
            <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Agent name</label>
              <input
                type="text"
                value={overrideAgent}
                onChange={(e) => setOverrideAgent(e.target.value)}
                placeholder="e.g., builder"
                className="w-full p-2 rounded text-xs mb-2"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
              />
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Reason (optional)</label>
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why override?"
                className="w-full p-2 rounded text-xs mb-2"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
              />
              <button
                onClick={() => handleAccept(overrideAgent, true)}
                disabled={accepting || !overrideAgent.trim()}
                className="px-3 py-1.5 rounded text-xs font-medium text-white"
                style={{ background: 'var(--accent-primary)' }}
              >
                Confirm Override
              </button>
            </div>
          )}

          {/* Alternatives */}
          {suggestion.alternatives.length > 0 && (
            <div>
              <button
                onClick={() => setShowAlternatives(!showAlternatives)}
                className="flex items-center gap-1 text-xs mb-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {showAlternatives ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {suggestion.alternatives.length} alternative{suggestion.alternatives.length !== 1 ? 's' : ''}
              </button>
              {showAlternatives && (
                <div className="space-y-2">
                  {suggestion.alternatives.map((alt) => (
                    <div
                      key={alt.agent}
                      className="rounded p-2 flex items-center justify-between"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
                    >
                      <div>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {alt.agent}
                        </span>
                        <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>
                          ({alt.role})
                        </span>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          {alt.task_suggestion}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs font-mono" style={{ color: confidenceColor(alt.score) }}>
                          {(alt.score * 100).toFixed(0)}%
                        </span>
                        <button
                          onClick={() => handleAccept(alt.agent, true)}
                          disabled={accepting}
                          className="px-2 py-1 rounded text-xs"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                        >
                          Select
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Session complete */}
      {suggestion?.is_session_complete && (
        <div className="text-center py-4">
          <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#22C55E' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Session Ready to Complete</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {suggestion.completion_reason ?? 'All relevant agents have contributed'}
          </p>
        </div>
      )}

      {/* Plan view */}
      {showPlan && plan && (
        <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Session Plan ({plan.estimated_agents} agent{plan.estimated_agents !== 1 ? 's' : ''})
            </span>
            <button onClick={() => setShowPlan(false)} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              close
            </button>
          </div>
          {plan.suggested_plan.map((step) => (
            <div key={step.step} className="flex items-start gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border-light)' }}>
              <span className="text-xs font-mono shrink-0 w-5 text-right" style={{ color: 'var(--text-tertiary)' }}>
                {step.step}.
              </span>
              <div className="flex-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {step.agent}
                </span>
                <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>
                  ({step.role}) — {(step.relevance * 100).toFixed(0)}%
                </span>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{step.task}</p>
              </div>
            </div>
          ))}
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{plan.note}</p>
        </div>
      )}
    </div>
  );
}
