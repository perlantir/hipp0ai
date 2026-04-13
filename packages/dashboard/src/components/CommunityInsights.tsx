import React, { useState, useEffect, useCallback } from 'react';
import { Lightbulb, X, Star } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface Pattern {
  type: string;
  message: string;
  confidence: number;
  tenant_count: number;
  suggested_tag: string | null;
  recommendation_count?: number;
}

export function CommunityInsights() {
  const { get } = useApi();
  const { projectId } = useProject();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchPatterns = useCallback(() => {
    if (projectId === 'default') return;
    setLoading(true);
    get<Pattern[]>(`/api/projects/${projectId}/patterns`)
      .then(setPatterns)
      .catch(() => setPatterns([]))
      .finally(() => setLoading(false));
  }, [get, projectId]);

  useEffect(() => { fetchPatterns(); }, [fetchPatterns]);

  const visible = patterns.filter((_, i) => !dismissed.has(i));

  if (loading || visible.length === 0) return null;

  return (
    <div
      className="rounded-xl p-5 mb-6"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb size={16} style={{ color: 'var(--accent-primary)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Community Insights
        </h3>
      </div>

      <div className="space-y-3">
        {patterns.map((p, i) => {
          if (dismissed.has(i)) return null;
          const isRecommended = (p.recommendation_count ?? 0) > 0;
          return (
            <div
              key={i}
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {p.message}
                  </p>
                  {isRecommended && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium shrink-0"
                      style={{ background: '#eff6ff', color: '#1e40af' }}
                    >
                      <Star size={10} />
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Based on anonymous data from {p.tenant_count} teams
                  {isRecommended && ` \u00B7 Surfaced in ${p.recommendation_count} compile${p.recommendation_count !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setDismissed((s) => new Set(s).add(i))}
                  className="p-1 rounded transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
