import React, { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import {
  Loader2,
  Check,
  X,
  Zap,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Edit3,
  History,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EvolutionProposal {
  id: string;
  project_id: string;
  trigger_type: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'accepted' | 'rejected' | 'overridden';
  affected_decision_ids: string[];
  reasoning: string;
  suggested_action: string;
  llm_explanation?: string;
  confidence: number;
  impact_score: number;
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  scan_id?: string;
  created_at: string;
}

interface ScanResult {
  scan_id: string;
  proposals_generated: number;
  scan_duration_ms: number;
  mode: string;
}

interface ScanHistory {
  id: string;
  project_id: string;
  mode: string;
  proposals_generated: number;
  scan_duration_ms: number;
  created_at: string;
}

type EvolutionMode = 'rule' | 'llm' | 'hybrid';

/* ------------------------------------------------------------------ */
/*  Urgency helpers                                                    */
/* ------------------------------------------------------------------ */

const URGENCY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#6b7280',
  low: '#9ca3af',
};

const URGENCY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function UrgencyBadge({ urgency }: { urgency: string }) {
  const bgColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-amber-100 text-amber-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase ${bgColors[urgency] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {URGENCY_LABELS[urgency] ?? urgency}
    </span>
  );
}

function TriggerBadge({ trigger }: { trigger: string }) {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase">
      {trigger.replace(/_/g, ' ')}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Proposal Card                                                      */
/* ------------------------------------------------------------------ */

function ProposalCard({
  proposal,
  onAccept,
  onReject,
  onOverride,
}: {
  proposal: EvolutionProposal;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onOverride: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = URGENCY_COLORS[proposal.urgency] ?? '#6b7280';

  return (
    <div
      className="card rounded-3xl p-6 mb-4 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
      style={{
        borderLeft: `6px solid ${borderColor}`,
      }}
    >
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Metadata */}
        <div className="lg:w-1/4">
          <div className="flex items-center gap-2 mb-3" style={{ color: borderColor }}>
            <AlertTriangle size={16} />
            <span className="text-xs font-bold tracking-widest uppercase">
              {URGENCY_LABELS[proposal.urgency] ?? proposal.urgency}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <TriggerBadge trigger={proposal.trigger_type} />
            <UrgencyBadge urgency={proposal.urgency} />
          </div>
          <div className="space-y-2 text-xs text-[var(--text-secondary)]">
            <p>{(proposal.confidence * 100).toFixed(0)}% confidence</p>
            <p>Impact: {(proposal.impact_score * 100).toFixed(0)}%</p>
          </div>
        </div>

        {/* Content */}
        <div className="lg:w-2/4">
          <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-primary)' }}>
            {proposal.reasoning}
          </p>
          {proposal.suggested_action && (
            <div className="bg-white/40 rounded-2xl p-4 border border-white/60">
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Suggested Action</p>
              <code className="text-xs text-blue-700 font-mono block">
                {proposal.suggested_action.replace(/_/g, ' ')}
              </code>
            </div>
          )}
          {expanded && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-[var(--text-secondary)]">
                Affected decisions: {proposal.affected_decision_ids.length > 0 ? proposal.affected_decision_ids.map((id) => id.slice(0, 8)).join(', ') : 'None'}
              </p>
              {proposal.llm_explanation && (
                <p className="text-xs text-[var(--text-secondary)]">
                  LLM: {proposal.llm_explanation}
                </p>
              )}
            </div>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 text-primary text-xs font-bold hover:underline transition-all"
          >
            {expanded ? 'Collapse' : 'View Details'}
          </button>
        </div>

        {/* Actions */}
        <div className="lg:w-1/4 flex flex-col justify-center gap-3">
          {proposal.status === 'pending' && (
            <>
              <button
                onClick={() => onAccept(proposal.id)}
                className="w-full bg-primary text-white py-2.5 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-[0_0_20px_rgba(6,63,249,0.3)]"
              >
                <Check size={14} /> Accept
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => onReject(proposal.id)}
                  className="bg-rose-50 text-rose-600 py-2.5 rounded-xl font-bold text-[11px] hover:bg-rose-100 transition-all uppercase tracking-tight flex items-center justify-center gap-1"
                >
                  <X size={12} /> Reject
                </button>
                <button
                  onClick={() => onOverride(proposal.id)}
                  className="bg-slate-100 text-slate-600 py-2.5 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-all uppercase tracking-tight flex items-center justify-center gap-1"
                >
                  <Edit3 size={12} /> Override
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function EvolutionProposals() {
  const api = useApi();
  const { projectId } = useProject();

  const [tab, setTab] = useState<'proposals' | 'history'>('proposals');
  const [proposals, setProposals] = useState<EvolutionProposal[]>([]);
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<EvolutionMode>('rule');
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);

  const fetchProposals = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await api.get<EvolutionProposal[]>(`/api/evolution/proposals?status=pending`);
      setProposals(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  const fetchHistory = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.get<ScanHistory[]>(`/api/evolution/history?project_id=${projectId}`);
      setHistory(data);
    } catch {
      // ignore
    }
  }, [api, projectId]);

  useEffect(() => {
    fetchProposals();
    fetchHistory();
  }, [fetchProposals, fetchHistory]);

  const handleScan = async () => {
    if (!projectId) return;
    setScanning(true);
    try {
      const result = await api.post<ScanResult>('/api/evolution/scan', { project_id: projectId, mode });
      setLastScan(result);
      await fetchProposals();
      await fetchHistory();
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  const handleAccept = async (id: string) => {
    await api.post(`/api/evolution/proposals/${id}/accept`, {});
    setProposals((prev) => prev.filter((p) => p.id !== id));
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('Rejection reason (optional):') ?? '';
    await api.post(`/api/evolution/proposals/${id}/reject`, { reason });
    setProposals((prev) => prev.filter((p) => p.id !== id));
  };

  const handleOverride = async (id: string) => {
    const overrideAction = window.prompt('Override action:');
    if (!overrideAction) return;
    const notes = window.prompt('Notes (optional):') ?? '';
    await api.post(`/api/evolution/proposals/${id}/override`, { override_action: overrideAction, notes });
    setProposals((prev) => prev.filter((p) => p.id !== id));
  };

  const criticalCount = proposals.filter((p) => p.urgency === 'critical').length;
  const highCount = proposals.filter((p) => p.urgency === 'high').length;

  return (
    <div className="max-w-7xl mx-auto px-8 py-8 space-y-10">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Evolution Engine
          </h1>
          <p className="text-lg text-[var(--text-secondary)]">
            Autonomous rule-based decision evolution
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode toggle */}
          <div className="flex gap-2 p-1 card rounded-2xl">
            {(['rule', 'llm', 'hybrid'] as EvolutionMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-6 py-2 rounded-xl font-bold text-sm transition-all capitalize ${
                  mode === m
                    ? 'bg-primary text-white shadow-lg'
                    : 'text-[var(--text-secondary)] hover:bg-white/50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {/* Scan button */}
          <button
            onClick={handleScan}
            disabled={scanning || !projectId}
            className="bg-primary text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(6,63,249,0.4)] hover:-translate-y-1 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {scanning ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Scan Now
          </button>
        </div>
      </div>

      {/* Last scan stats */}
      {lastScan && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="card p-6 rounded-3xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Proposals</p>
            <p className="text-3xl font-bold">{lastScan.proposals_generated}</p>
          </div>
          <div className="card p-6 rounded-3xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Critical</p>
            <p className="text-3xl font-bold text-red-600">{criticalCount}</p>
          </div>
          <div className="card p-6 rounded-3xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">High Priority</p>
            <p className="text-3xl font-bold text-amber-600">{highCount}</p>
          </div>
          <div className="card p-6 rounded-3xl bg-primary/5" style={{ borderColor: 'rgba(6,63,249,0.2)' }}>
            <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Scan Time</p>
            <p className="text-3xl font-bold text-primary">{lastScan.scan_duration_ms}ms</p>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-6 border-b border-[var(--border-light)]">
        <button
          onClick={() => setTab('proposals')}
          className={`flex items-center gap-1.5 pb-3 text-sm font-bold transition-all ${
            tab === 'proposals'
              ? 'text-primary border-b-2 border-primary'
              : 'text-[var(--text-secondary)] border-b-2 border-transparent'
          }`}
        >
          <AlertTriangle size={14} /> Proposals ({proposals.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex items-center gap-1.5 pb-3 text-sm font-bold transition-all ${
            tab === 'history'
              ? 'text-primary border-b-2 border-primary'
              : 'text-[var(--text-secondary)] border-b-2 border-transparent'
          }`}
        >
          <History size={14} /> History
        </button>
      </div>

      {/* Content */}
      {tab === 'proposals' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-primary" size={24} />
            </div>
          ) : proposals.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-secondary)]">
              <RefreshCw size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No pending proposals. Run a scan to detect evolution opportunities.</p>
            </div>
          ) : (
            proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                onAccept={handleAccept}
                onReject={handleReject}
                onOverride={handleOverride}
              />
            ))
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <p className="text-sm text-center py-8 text-[var(--text-secondary)]">
              No scan history yet.
            </p>
          ) : (
            <div className="card rounded-[2rem] p-8 overflow-hidden">
              <h4 className="text-xl font-bold mb-8">Scan History</h4>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest font-bold border-b border-[var(--border-light)] text-[var(--text-secondary)]">
                    <th className="pb-4 px-4">Date</th>
                    <th className="pb-4 px-4">Mode</th>
                    <th className="pb-4 px-4 text-right">Proposals</th>
                    <th className="pb-4 px-4 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-light)]">
                  {history.map((scan) => (
                    <tr key={scan.id} className="hover:bg-white/40 transition-colors">
                      <td className="py-6 px-4 flex items-center gap-1.5 text-sm">
                        <Clock size={12} />
                        {new Date(scan.created_at).toLocaleString()}
                      </td>
                      <td className="py-6 px-4 capitalize text-sm">{scan.mode}</td>
                      <td className="py-6 px-4 text-right text-sm font-bold">{scan.proposals_generated}</td>
                      <td className="py-6 px-4 text-right text-sm text-[var(--text-secondary)]">{scan.scan_duration_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default EvolutionProposals;
