import { useEffect, useState, useCallback } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  X,
  User,
  Target,
  Key,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import { ExportButton } from './ExportButton';
import { AgentKeysModal } from './AgentKeysModal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SkillScore {
  success_rate: number;
  sample_size: number;
  avg_quality?: number;
}

interface AgentSkillRow {
  agent: string;
  domains: Record<string, SkillScore>;
  overall_success_rate?: number;
  total_outcomes?: number;
}

interface SkillMatrixResponse {
  agents: AgentSkillRow[];
  domains: string[];
}

interface AgentProfile {
  agent: string;
  domains: Record<string, SkillScore>;
  overall_success_rate: number;
  total_outcomes: number;
  strengths?: string[];
  weaknesses?: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scoreColor(rate: number): { bg: string; text: string; ring: string } {
  if (rate >= 0.75) {
    return {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      ring: 'ring-green-500/40',
    };
  }
  if (rate >= 0.5) {
    return {
      bg: 'bg-yellow-500/20',
      text: 'text-yellow-400',
      ring: 'ring-yellow-500/40',
    };
  }
  return {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    ring: 'ring-red-500/40',
  };
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AgentSkills() {
  const { get } = useApi();
  const { projectId } = useProject();

  const [matrix, setMatrix] = useState<SkillMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Map of agent name -> agent UUID, used by the Keys modal.
  const [agentIdMap, setAgentIdMap] = useState<Record<string, string>>({});
  const [keysAgent, setKeysAgent] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    get<SkillMatrixResponse>(`/api/projects/${projectId}/agent-skills`)
      .then((data) => {
        if (cancelled) return;
        // Normalize shape in case API returns differently
        const normalized: SkillMatrixResponse = {
          agents: Array.isArray(data?.agents) ? data.agents : [],
          domains: Array.isArray(data?.domains) ? data.domains : [],
        };
        setMatrix(normalized);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : String(err?.message ?? 'Failed to load agent skills'),
          );
          setLoading(false);
        }
      });

    // Also fetch the full agents list so we can resolve name -> id when the
    // user clicks the Keys button. Best-effort; an empty map just disables
    // the button.
    get<Array<{ id: string; name: string }>>(`/api/projects/${projectId}/agents`)
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data)) return;
        const map: Record<string, string> = {};
        for (const a of data) {
          if (a?.id && a?.name) map[a.name] = a.id;
        }
        setAgentIdMap(map);
      })
      .catch(() => {
        /* ignore — keys button just won't resolve */
      });

    return () => {
      cancelled = true;
    };
  }, [get, projectId]);

  const openProfile = useCallback(
    async (agent: string) => {
      setSelectedAgent(agent);
      setProfile(null);
      setProfileLoading(true);
      try {
        const data = await get<AgentProfile>(
          `/api/projects/${projectId}/agent-skills/${encodeURIComponent(agent)}`,
        );
        setProfile(data);
      } catch {
        setProfile(null);
      } finally {
        setProfileLoading(false);
      }
    },
    [get, projectId],
  );

  /* ---- Loading ---------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="text-sm text-[var(--text-secondary)]">
            Loading agent skills…
          </span>
        </div>
      </div>
    );
  }

  /* ---- Error ------------------------------------------------------ */
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="card p-6 max-w-md text-center"
          style={{ backgroundColor: 'var(--bg-card)' }}
        >
          <AlertTriangle
            size={24}
            className="mx-auto mb-2 text-status-reverted"
          />
          <p className="text-sm text-status-reverted">{error}</p>
        </div>
      </div>
    );
  }

  const agents = matrix?.agents ?? [];
  const domains = matrix?.domains ?? [];
  const hasData = agents.length > 0 && domains.length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              Agent Skills
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Skill profiles showing how well each agent performs across domains,
              based on recorded decision outcomes.
            </p>
          </div>
          <ExportButton
            data={agents.map((row) => {
              const flat: Record<string, unknown> = {
                agent: row.agent,
                overall_success_rate: row.overall_success_rate ?? null,
                total_outcomes: row.total_outcomes ?? null,
              };
              for (const domain of domains) {
                const cell = row.domains?.[domain];
                flat[`${domain}_success_rate`] = cell?.success_rate ?? null;
                flat[`${domain}_sample_size`] = cell?.sample_size ?? 0;
              }
              return flat;
            })}
            filename="hipp0-agent-skills"
          />
        </div>

        {/* Legend */}
        {hasData && (
          <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-green-500/40 ring-1 ring-green-500/60" />
              &ge; 75%
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-yellow-500/40 ring-1 ring-yellow-500/60" />
              50–75%
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-red-500/40 ring-1 ring-red-500/60" />
              &lt; 50%
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasData ? (
          <div
            className="rounded-xl border p-10 text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <Target
              size={32}
              className="mx-auto mb-3 text-[var(--text-tertiary)]"
            />
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              No outcome data yet
            </p>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Record outcomes on your decisions to build agent skill profiles.
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border overflow-x-auto"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr
                  className="text-xs uppercase tracking-wider"
                  style={{
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <th className="text-left sticky left-0 z-10 px-4 py-3 font-medium"
                      style={{ backgroundColor: 'var(--bg-card)' }}>
                    Agent
                  </th>
                  {domains.map((domain) => (
                    <th
                      key={domain}
                      className="px-3 py-3 font-medium text-center capitalize min-w-[110px]"
                    >
                      {domain}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-medium text-center min-w-[90px]">
                    Keys
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((row) => (
                  <tr
                    key={row.agent}
                    onClick={() => openProfile(row.agent)}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        'var(--bg-card-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td
                      className="px-4 py-3 sticky left-0 z-10"
                      style={{ backgroundColor: 'var(--bg-card)' }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
                          <User size={13} className="text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {row.agent}
                          </p>
                          {row.total_outcomes !== undefined && (
                            <p className="text-2xs text-[var(--text-tertiary)]">
                              {row.total_outcomes} outcomes
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    {domains.map((domain) => {
                      const cell = row.domains?.[domain];
                      if (!cell || cell.sample_size === 0) {
                        return (
                          <td
                            key={domain}
                            className="px-3 py-3 text-center text-[var(--text-tertiary)]"
                          >
                            <span className="text-xs">—</span>
                          </td>
                        );
                      }
                      const colors = scoreColor(cell.success_rate);
                      return (
                        <td key={domain} className="px-3 py-3 text-center">
                          <div
                            className={`inline-flex flex-col items-center justify-center min-w-[80px] rounded-md px-2 py-1.5 ring-1 ${colors.bg} ${colors.ring}`}
                          >
                            <span
                              className={`text-xs font-semibold ${colors.text}`}
                            >
                              {formatPct(cell.success_rate)}
                            </span>
                            <span className="text-2xs text-[var(--text-tertiary)]">
                              ({cell.sample_size})
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center">
                      {agentIdMap[row.agent] ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setKeysAgent({ id: agentIdMap[row.agent], name: row.agent });
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors hover:bg-primary/10"
                          style={{
                            borderColor: 'var(--border)',
                            color: 'var(--text-secondary)',
                          }}
                          title="Manage API keys for this agent"
                        >
                          <Key size={12} />
                          Keys
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Profile modal ---------------------------------------- */}
      {selectedAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedAgent(null)}
        >
          <div
            className="rounded-xl border p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                  <User size={18} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    {selectedAgent}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Agent skill profile
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="p-1 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
              >
                <X size={18} />
              </button>
            </div>

            {profileLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  size={22}
                  className="animate-spin text-primary"
                />
              </div>
            ) : profile ? (
              <div className="space-y-5">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div
                    className="rounded-lg p-3 border"
                    style={{
                      backgroundColor: 'var(--bg-card-hover)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <p className="text-2xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                      Overall Success
                    </p>
                    <p
                      className={`text-xl font-semibold ${
                        scoreColor(profile.overall_success_rate ?? 0).text
                      }`}
                    >
                      {formatPct(profile.overall_success_rate ?? 0)}
                    </p>
                  </div>
                  <div
                    className="rounded-lg p-3 border"
                    style={{
                      backgroundColor: 'var(--bg-card-hover)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <p className="text-2xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                      Total Outcomes
                    </p>
                    <p className="text-xl font-semibold text-[var(--text-primary)]">
                      {profile.total_outcomes ?? 0}
                    </p>
                  </div>
                </div>

                {/* All domains */}
                <div>
                  <h4 className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
                    All Domains
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(profile.domains ?? {}).map(
                      ([domain, score]) => {
                        const colors = scoreColor(score.success_rate);
                        return (
                          <div
                            key={domain}
                            className="flex items-center gap-3 p-3 rounded-lg border"
                            style={{
                              backgroundColor: 'var(--bg-card-hover)',
                              borderColor: 'var(--border)',
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium capitalize text-[var(--text-primary)]">
                                {domain}
                              </p>
                              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    score.success_rate >= 0.75
                                      ? 'bg-green-500'
                                      : score.success_rate >= 0.5
                                        ? 'bg-yellow-500'
                                        : 'bg-red-500'
                                  }`}
                                  style={{
                                    width: `${Math.max(score.success_rate * 100, 4)}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={`text-sm font-semibold ${colors.text}`}
                              >
                                {formatPct(score.success_rate)}
                              </p>
                              <p className="text-2xs text-[var(--text-tertiary)]">
                                {score.sample_size} outcomes
                              </p>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>

                {/* Strengths / Weaknesses */}
                {(profile.strengths?.length || profile.weaknesses?.length) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {profile.strengths && profile.strengths.length > 0 && (
                      <div
                        className="rounded-lg p-3 border"
                        style={{
                          backgroundColor: 'var(--bg-card-hover)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <p className="text-xs font-semibold text-green-400 mb-2">
                          Strengths
                        </p>
                        <ul className="space-y-1">
                          {profile.strengths.map((s) => (
                            <li
                              key={s}
                              className="text-xs text-[var(--text-secondary)] capitalize"
                            >
                              • {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {profile.weaknesses && profile.weaknesses.length > 0 && (
                      <div
                        className="rounded-lg p-3 border"
                        style={{
                          backgroundColor: 'var(--bg-card-hover)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <p className="text-xs font-semibold text-red-400 mb-2">
                          Weaknesses
                        </p>
                        <ul className="space-y-1">
                          {profile.weaknesses.map((w) => (
                            <li
                              key={w}
                              className="text-xs text-[var(--text-secondary)] capitalize"
                            >
                              • {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-center py-8 text-[var(--text-secondary)]">
                Unable to load profile.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Agent API keys modal ---------------------------------- */}
      {keysAgent && (
        <AgentKeysModal
          projectId={projectId}
          agentId={keysAgent.id}
          agentName={keysAgent.name}
          onClose={() => setKeysAgent(null)}
        />
      )}
    </div>
  );
}

export default AgentSkills;
