import { useEffect, useState } from 'react';
import {
  History,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  FileText,
  HelpCircle,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import type { Session } from '../types';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function confidenceLabel(score: number): { label: string; color: string } {
  if (score >= 0.8) return { label: 'High', color: 'text-status-active' };
  if (score >= 0.5) return { label: 'Medium', color: 'text-status-superseded' };
  return { label: 'Low', color: 'text-status-reverted' };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SessionHistory() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    get<Session[]>(`/api/projects/${projectId}/sessions`)
      .then((data) => {
        if (!cancelled) {
          setSessions(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load sessions');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ---- Loading / Error ------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">Loading sessions…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card p-6 max-w-md text-center">
          <p className="text-sm text-status-reverted">{error}</p>
        </div>
      </div>
    );
  }

  /* ---- Derived data for sidebar ----------------------------------- */
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );

  const activeSession = sortedSessions[0] ?? null;
  const completedCount = sortedSessions.filter((s) => s.ended_at).length;

  // Aggregate agent relevance scores from sessions (confidence * decisions)
  const agentScores: Record<string, { total: number; count: number }> = {};
  for (const s of sessions) {
    const name = s.agent_name;
    if (!agentScores[name]) agentScores[name] = { total: 0, count: 0 };
    agentScores[name].total += (s.extraction_confidence ?? 0.5) * (s.decisions_extracted || 1);
    agentScores[name].count += 1;
  }
  const agentRanking = Object.entries(agentScores)
    .map(([name, { total, count }]) => ({
      name,
      score: Math.min(100, Math.round((total / Math.max(count, 1)) * 100)),
    }))
    .sort((a, b) => b.score - a.score);

  const agentColors = ['green', 'blue', 'blue', 'yellow', 'slate'] as const;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-8 flex gap-8">
        {/* -- Content Area (flex-1) ----------------------------- */}
        <div className="flex-1 space-y-8 min-w-0">
          {/* -- Active Session Header --------------------------- */}
          {activeSession && (
            <section
              className="p-8 rounded-[2rem] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
              style={{
                background: 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.4)',
              }}
            >
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-status-active ring-4 ring-green-500/20" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                    Active Session
                  </span>
                </div>
                <h1 className="text-4xl font-bold tracking-tight mb-4">
                  {activeSession.topic}
                </h1>
                <div className="flex gap-6 text-sm text-[var(--text-secondary)]">
                  <span className="flex items-center gap-2">
                    <Clock size={14} />
                    Started {new Date(activeSession.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    {completedCount} steps completed
                  </span>
                  <span className="flex items-center gap-2">
                    <User size={14} />
                    {agentRanking.length} agents active
                  </span>
                </div>
              </div>

              {/* Confidence as progress bar */}
              {activeSession.extraction_confidence !== undefined && (
                <div className="w-full md:w-48 shrink-0">
                  <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${activeSession.extraction_confidence * 100}%`,
                        backgroundColor:
                          activeSession.extraction_confidence >= 0.8
                            ? '#063ff9'
                            : activeSession.extraction_confidence >= 0.5
                              ? '#063ff9aa'
                              : '#A13544',
                      }}
                    />
                  </div>
                  <span className="text-2xs text-[var(--text-tertiary)] mt-1 block text-right">
                    {(activeSession.extraction_confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
              )}
            </section>
          )}

          {/* -- Vertical Step Timeline -------------------------- */}
          {sessions.length === 0 ? (
            <div className="text-center py-12">
              <History
                size={28}
                className="mx-auto mb-2 text-[var(--text-tertiary)]"
              />
              <p className="text-lg font-medium text-[var(--text-secondary)]">
                No sessions yet
              </p>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">
                Sessions appear when agents report summaries via the API.
              </p>
            </div>
          ) : (
            <div className="space-y-6 relative">
              {/* Gradient vertical connector line */}
              <div className="absolute left-10 top-0 bottom-0 w-px bg-gradient-to-b from-[#063ff9]/50 via-[#063ff9]/20 to-transparent z-0" />

              {sortedSessions.map((session, idx) => {
                const isExpanded = expanded.has(session.id);
                const isActive = !session.ended_at;
                const conf = session.extraction_confidence
                  ? confidenceLabel(session.extraction_confidence)
                  : null;
                const stepNum = String(idx + 1).padStart(2, '0');

                return (
                  <div key={session.id} className="relative z-10 flex gap-6 group animate-slide-up">
                    {/* -- Step circle + label -- */}
                    <div className="w-20 flex flex-col items-center shrink-0">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${
                          isActive
                            ? 'bg-[#063ff9] shadow-lg animate-pulse-soft'
                            : 'bg-white border border-[#063ff9]/20'
                        }`}
                      >
                        <User size={20} className={isActive ? 'text-white' : 'text-[#063ff9]'} />
                      </div>
                      <div
                        className={`mt-2 text-[10px] font-bold uppercase ${
                          isActive ? 'text-[#063ff9]' : 'text-[#063ff9]/60'
                        }`}
                      >
                        {isActive ? 'Active' : `Step ${stepNum}`}
                      </div>
                    </div>

                    {/* -- Step card (glass panel) -- */}
                    <div
                      className={`flex-1 p-6 rounded-3xl transition-all overflow-hidden ${
                        isActive
                          ? 'border-[#063ff9]/40 group-hover:-translate-y-1'
                          : 'hover:border-[#063ff9]/40 group-hover:-translate-y-1'
                      }`}
                      style={{
                        background: isActive ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.6)',
                        backdropFilter: 'blur(24px)',
                        border: '1px solid rgba(255,255,255,0.4)',
                      }}
                    >
                      {/* Card header row */}
                      <button
                        onClick={() => toggleExpand(session.id)}
                        className="w-full text-left"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-lg font-bold">
                              {session.agent_name}: {session.topic}
                            </h3>
                            <p className="text-sm text-[var(--text-secondary)]">
                              {session.summary
                                ? session.summary.length > 100
                                  ? session.summary.slice(0, 100) + '...'
                                  : session.summary
                                : 'Processing...'}
                            </p>
                          </div>

                          {/* Status badge */}
                          {isActive ? (
                            <div className="flex gap-1 shrink-0 ml-3">
                              <div className="w-2 h-2 bg-[#063ff9] rounded-full animate-bounce" />
                              <div className="w-2 h-2 bg-[#063ff9] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                              <div className="w-2 h-2 bg-[#063ff9] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                            </div>
                          ) : (
                            <span
                              className={`px-3 py-1 text-[10px] font-black rounded-full uppercase shrink-0 ml-3 ${
                                conf && conf.label === 'High'
                                  ? 'bg-green-100 text-green-700'
                                  : conf && conf.label === 'Medium'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {conf ? conf.label : 'Pending'}
                            </span>
                          )}
                        </div>

                        {/* Stats row */}
                        <div className="flex gap-4">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-[#063ff9]">
                            <CheckCircle2 size={14} />
                            {session.decisions_extracted} Decision{session.decisions_extracted !== 1 ? 's' : ''} created
                          </span>
                          <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                            <Clock size={14} />
                            {formatDate(session.started_at)}
                          </span>

                          {/* Expand toggle */}
                          <span className="ml-auto">
                            {isExpanded ? (
                              <ChevronUp size={14} className="text-[var(--text-secondary)]" />
                            ) : (
                              <ChevronDown size={14} className="text-[var(--text-secondary)]" />
                            )}
                          </span>
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-[var(--border-light)] animate-fade-in">
                          <div className="space-y-4 text-sm">
                            {/* Summary */}
                            {session.summary && (
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1 block flex items-center gap-1.5">
                                  <FileText size={12} />
                                  Summary
                                </label>
                                <div className="bg-slate-900/5 rounded-xl p-4 font-mono text-xs text-[var(--text-secondary)] border border-white/50">
                                  <span className="text-[#063ff9] italic">// Result snippet</span>
                                  <br />
                                  {session.summary}
                                </div>
                              </div>
                            )}

                            {/* Decision IDs */}
                            {session.decision_ids && session.decision_ids.length > 0 && (
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1 block flex items-center gap-1.5">
                                  <CheckCircle2 size={12} />
                                  Extracted Decisions
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {session.decision_ids.map((id) => (
                                    <span
                                      key={id}
                                      className="px-2 py-0.5 text-xs rounded-full bg-[#063ff9]/10 text-[#063ff9] font-mono"
                                    >
                                      {id.length > 12 ? id.slice(0, 10) + '...' : id}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Assumptions */}
                            {session.assumptions && session.assumptions.length > 0 && (
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1 block flex items-center gap-1.5">
                                  <AlertCircle size={12} />
                                  Assumptions
                                </label>
                                <ul className="list-disc pl-4 space-y-1">
                                  {session.assumptions.map((a, i) => (
                                    <li key={i}>{a}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Open questions */}
                            {session.open_questions && session.open_questions.length > 0 && (
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1 block flex items-center gap-1.5">
                                  <HelpCircle size={12} />
                                  Open Questions
                                </label>
                                <ul className="list-disc pl-4 space-y-1">
                                  {session.open_questions.map((q, i) => (
                                    <li key={i}>{q}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Lessons learned */}
                            {session.lessons_learned && session.lessons_learned.length > 0 && (
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1 block flex items-center gap-1.5">
                                  <Lightbulb size={12} />
                                  Lessons Learned
                                </label>
                                <ul className="list-disc pl-4 space-y-1">
                                  {session.lessons_learned.map((l, i) => (
                                    <li key={i}>{l}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* -- Right Sidebar (w-80) ----------------------------- */}
        {sessions.length > 0 && (
          <aside className="w-80 space-y-6 shrink-0 hidden lg:block">
            {/* Team Relevance Card */}
            <div
              className="p-6 rounded-[2rem] shadow-sm sticky top-24"
              style={{
                background: 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.4)',
              }}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold tracking-tight">Team Relevance</h2>
                <HelpCircle size={14} className="text-[var(--text-secondary)]" />
              </div>

              <div className="space-y-6">
                {agentRanking.map((agent, i) => {
                  const colorKey = agentColors[i % agentColors.length];
                  const opacity = agent.score < 30 ? 'opacity-40' : agent.score < 50 ? 'opacity-70' : '';
                  const colorMap: Record<string, { iconBg: string; barBg: string; textColor: string }> = {
                    green: { iconBg: 'bg-green-500/10', barBg: 'bg-green-500', textColor: 'text-green-600' },
                    blue: { iconBg: 'bg-blue-500/10', barBg: 'bg-blue-500', textColor: 'text-blue-600' },
                    yellow: { iconBg: 'bg-yellow-500/10', barBg: 'bg-yellow-500', textColor: 'text-yellow-600' },
                    slate: { iconBg: 'bg-slate-200', barBg: 'bg-slate-400', textColor: 'text-slate-500' },
                  };
                  const colors = colorMap[colorKey] || colorMap.blue;

                  return (
                    <div key={agent.name} className={opacity}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg ${colors.iconBg} flex items-center justify-center`}>
                            <User size={16} className={colors.textColor} />
                          </div>
                          <span className="font-bold text-sm">{agent.name}</span>
                        </div>
                        <span className={`text-xs font-black ${colors.textColor}`}>
                          {agent.score}% {agent.score >= 60 ? '✅' : agent.score >= 30 ? '⚠️' : '⏭️'}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${colors.barBg} rounded-full transition-all duration-500`}
                          style={{ width: `${agent.score}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-10 pt-6 border-t border-white/40">
                <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
                  Agent scores based on current task tokens and history relevance. Low scores may result in hibernation.
                </p>
              </div>
            </div>

            {/* Context Card */}
            <div className="bg-gradient-to-br from-[#063ff9] to-blue-800 p-6 rounded-[2rem] text-white shadow-lg overflow-hidden relative">
              <div className="relative z-10">
                <h4 className="font-bold mb-2">Session Analytics</h4>
                <p className="text-xs opacity-80 mb-4 leading-relaxed">
                  {sessions.length} total sessions tracked with {sessions.reduce((sum, s) => sum + s.decisions_extracted, 0)} decisions extracted across all agents.
                </p>
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Live Sync Enabled</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
