import React, { useState, useEffect, useCallback } from 'react';
import { AlertOctagon, CheckCircle, Eye, ArrowUp } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface Violation {
  id: string;
  decision_title: string;
  violation_type: string;
  description: string;
  severity: string;
  evidence: string | null;
  agent_name: string | null;
  status: string;
  created_at: string;
}

const SEVERITY_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  critical: { border: '#DC2626', bg: '#FEE2E2', text: '#991B1B' },
  high: { border: '#D97706', bg: '#FEF3C7', text: '#92400E' },
  medium: { border: '#EAB308', bg: '#FEF9C3', text: '#854D0E' },
  low: { border: '#6B7280', bg: '#F3F4F6', text: '#374151' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Violations() {
  const { get, patch } = useApi();
  const { projectId } = useProject();
  const [violations, setViolations] = useState<Violation[]>([]);
  const [filter, setFilter] = useState<string>('open');
  const [loading, setLoading] = useState(true);

  const fetchViolations = useCallback(() => {
    if (projectId === 'default') return;
    setLoading(true);
    const path = filter
      ? `/api/projects/${projectId}/violations?status=${filter}`
      : `/api/projects/${projectId}/violations`;
    get<Violation[]>(path)
      .then(setViolations)
      .catch(() => setViolations([]))
      .finally(() => setLoading(false));
  }, [get, projectId, filter]);

  useEffect(() => { fetchViolations(); }, [fetchViolations]);

  const handleAction = async (id: string, status: string) => {
    try {
      await patch(`/api/violations/${id}`, { status, resolved_by: 'dashboard' });
      fetchViolations();
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-7xl mx-auto px-8 py-8 space-y-10">
      <div className="flex justify-between items-end">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Violations</h1>
          <p className="text-[var(--text-secondary)] text-lg">Active policy violations and incident tracking.</p>
        </div>
        <div className="flex gap-2 p-1 card rounded-2xl">
          {['open', 'acknowledged', 'resolved', ''].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-6 py-2 rounded-xl font-bold text-sm transition-all capitalize ${
                filter === f
                  ? 'bg-primary text-white shadow-lg'
                  : 'text-[var(--text-secondary)] hover:bg-white/50'
              }`}
            >
              {f || 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-3xl animate-pulse" style={{ background: 'var(--bg-hover)' }} />
          ))}
        </div>
      ) : violations.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">
          <CheckCircle size={32} className="mx-auto mb-3 opacity-40 text-green-500" />
          <p className="text-sm">No {filter || ''} violations.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {violations.map((v) => {
            const sev = SEVERITY_COLORS[v.severity] || SEVERITY_COLORS.low;
            return (
              <div
                key={v.id}
                className="card rounded-3xl p-6 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
                style={{
                  borderLeft: `6px solid ${sev.border}`,
                }}
              >
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Metadata */}
                  <div className="lg:w-1/4">
                    <div className="flex items-center gap-2 mb-3" style={{ color: sev.border }}>
                      <AlertOctagon size={16} />
                      <span className="text-xs font-bold tracking-widest uppercase">{v.severity}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <span
                        className="text-[10px] font-extrabold px-3 py-1 rounded-full uppercase"
                        style={{ background: sev.bg, color: sev.text }}
                      >
                        {v.severity}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                        {v.violation_type}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {timeAgo(v.created_at)}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="lg:w-2/4">
                    <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-primary)' }}>
                      {v.description}
                    </p>

                    {v.evidence && (
                      <div className="bg-white/40 rounded-2xl p-4 border border-white/60 mb-3">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Evidence</p>
                        <code className="text-xs text-blue-700 font-mono block">{v.evidence}</code>
                      </div>
                    )}

                    {v.agent_name && (
                      <div className="flex items-center gap-2 text-rose-500 bg-rose-50/30 p-2 rounded-lg">
                        <AlertOctagon size={14} />
                        <p className="text-[11px] font-bold">Agent: {v.agent_name}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="lg:w-1/4 flex flex-col justify-center gap-3">
                    <div className="text-right mb-2">
                      <span className="text-xs text-[var(--text-tertiary)] capitalize">{v.status}</span>
                    </div>
                    {v.status === 'open' && (
                      <>
                        <button
                          onClick={() => handleAction(v.id, 'resolved')}
                          className="w-full bg-primary text-white py-2.5 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 active:scale-95 transition-all"
                        >
                          Resolve
                        </button>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={() => handleAction(v.id, 'acknowledged')}
                            className="bg-white/80 border border-slate-200 py-2.5 rounded-xl font-bold text-[11px] hover:bg-white transition-all"
                          >
                            Acknowledge
                          </button>
                          <button
                            onClick={() => handleAction(v.id, 'dismissed')}
                            className="bg-slate-100 text-slate-600 py-2.5 rounded-xl font-bold text-[11px] hover:bg-slate-200 transition-all"
                          >
                            Dismiss
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
