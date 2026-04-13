import { useState } from 'react';
import {
  Target,
  Loader2,
  AlertTriangle,
  Users,
  TrendingUp,
  RefreshCw,
  Info,
  Sparkles,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Confidence = 'high' | 'medium' | 'low';

interface ImpactPredictionResult {
  predicted_success_rate: number;
  confidence_interval?: [number, number] | { lower: number; upper: number };
  similar_decisions_count: number;
  risk_factors: string[];
  affected_agents: string[];
  estimated_reach: number;
  explanation?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCI(result: ImpactPredictionResult): [number, number] | null {
  const ci = result.confidence_interval;
  if (!ci) return null;
  if (Array.isArray(ci)) return ci;
  if (typeof ci === 'object' && 'lower' in ci && 'upper' in ci) {
    return [ci.lower, ci.upper];
  }
  return null;
}

function formatPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ImpactPrediction() {
  const { post } = useApi();
  const { projectId } = useProject();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [confidence, setConfidence] = useState<Confidence>('medium');
  const [madeBy, setMadeBy] = useState('');
  const [affects, setAffects] = useState('');

  // Prediction state
  const [predicting, setPredicting] = useState(false);
  const [result, setResult] = useState<ImpactPredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPredict = title.trim().length > 0 && description.trim().length > 0;

  /* ---- Predict ----------------------------------------------------- */
  const handlePredict = async () => {
    if (!canPredict) return;
    setPredicting(true);
    setError(null);
    setResult(null);

    const tagsList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const affectsList = affects
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    try {
      const data = await post<ImpactPredictionResult>('/api/simulation/predict-impact', {
        project_id: projectId,
        title: title.trim(),
        description: description.trim(),
        tags: tagsList,
        confidence,
        made_by: madeBy.trim() || undefined,
        affects: affectsList,
      });
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>)?.message ?? 'Failed to predict impact');
      setError(msg);
    } finally {
      setPredicting(false);
    }
  };

  /* ---- Reset ------------------------------------------------------- */
  const handleReset = () => {
    setTitle('');
    setDescription('');
    setTags('');
    setConfidence('medium');
    setMadeBy('');
    setAffects('');
    setResult(null);
    setError(null);
  };

  const ci = result ? getCI(result) : null;

  /* ---- Render ------------------------------------------------------ */
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(217,119,6,0.15)' }}
        >
          <Target className="w-5 h-5" style={{ color: '#D97706' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Impact Prediction
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Forecast a decision's success and reach before you commit to it
          </p>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Form */}
        <div
          className="rounded-xl border p-4"
          style={{
            background: 'var(--bg-card)',
            borderColor: 'var(--border, #374151)',
          }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Proposed Decision
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Title <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Use cached embeddings for search queries"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Description <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Describe what the decision does and why..."
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="performance, caching, search"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
              {tags.trim() && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-xs"
                        style={{
                          background: 'rgba(217,119,6,0.15)',
                          color: '#D97706',
                          border: '1px solid rgba(217,119,6,0.4)',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Confidence
              </label>
              <select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as Confidence)}
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Made by
              </label>
              <input
                type="text"
                value={madeBy}
                onChange={(e) => setMadeBy(e.target.value)}
                placeholder="e.g. alice@example.com"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Affects (agent names, comma-separated)
              </label>
              <input
                type="text"
                value={affects}
                onChange={(e) => setAffects(e.target.value)}
                placeholder="search-agent, embedder, ranker"
                className="w-full p-2 rounded-md text-sm"
                style={{
                  background: 'var(--bg-secondary, #1F2937)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border, #374151)',
                }}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handlePredict}
                disabled={!canPredict || predicting}
                className="flex items-center gap-2 bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {predicting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                Predict Impact
              </button>
              <button
                onClick={handleReset}
                className="border border-slate-300 hover:bg-slate-100 rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                <RefreshCw size={14} /> Reset
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div>
          {!result && !predicting && (
            <div
              className="rounded-xl border p-8 text-center h-full flex flex-col items-center justify-center"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border, #374151)',
                borderStyle: 'dashed',
              }}
            >
              <Target className="w-12 h-12 mb-4 opacity-30" style={{ color: 'var(--text-tertiary, #6B7280)' }} />
              <p
                className="text-lg font-medium mb-2"
                style={{ color: 'var(--text-tertiary, #9CA3AF)' }}
              >
                Fill in decision details to predict its impact
              </p>
              <p className="text-sm" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                Title and description are required.
              </p>
            </div>
          )}

          {predicting && (
            <div
              className="rounded-xl border p-8 text-center h-full flex flex-col items-center justify-center"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border, #374151)',
              }}
            >
              <Loader2
                className="w-8 h-8 animate-spin mb-3"
                style={{ color: '#D97706' }}
              />
              <p style={{ color: 'var(--text-secondary)' }}>Analyzing similar decisions...</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {/* Predicted success rate */}
              <div
                className="rounded-xl border p-4"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: 'var(--border, #374151)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} style={{ color: '#22C55E' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                    Predicted Success Rate
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold" style={{ color: '#22C55E' }}>
                    {formatPercent(result.predicted_success_rate)}
                  </span>
                  {ci && (
                    <span className="text-xs" style={{ color: 'var(--text-tertiary, #6B7280)' }}>
                      CI: {formatPercent(ci[0])} – {formatPercent(ci[1])}
                    </span>
                  )}
                </div>
              </div>

              {/* Similar decisions + reach */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className="rounded-xl border p-3"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border, #374151)',
                  }}
                >
                  <div
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary, #6B7280)' }}
                  >
                    Similar decisions
                  </div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {result.similar_decisions_count}
                  </div>
                </div>
                <div
                  className="rounded-xl border p-3"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border, #374151)',
                  }}
                >
                  <div
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary, #6B7280)' }}
                  >
                    Estimated reach
                  </div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {result.estimated_reach}
                  </div>
                </div>
              </div>

              {/* Risk factors */}
              {result.risk_factors && result.risk_factors.length > 0 && (
                <div
                  className="rounded-xl border p-4"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border, #374151)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} style={{ color: '#EF4444' }} />
                    <span
                      className="text-xs font-medium"
                      style={{ color: 'var(--text-tertiary, #6B7280)' }}
                    >
                      Risk factors
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.risk_factors.map((r, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          background: 'rgba(239,68,68,0.12)',
                          color: '#EF4444',
                          border: '1px solid rgba(239,68,68,0.4)',
                        }}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Affected agents */}
              {result.affected_agents && result.affected_agents.length > 0 && (
                <div
                  className="rounded-xl border p-4"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border, #374151)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Users size={14} style={{ color: '#3B82F6' }} />
                    <span
                      className="text-xs font-medium"
                      style={{ color: 'var(--text-tertiary, #6B7280)' }}
                    >
                      Affected agents ({result.affected_agents.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.affected_agents.map((a, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          background: 'rgba(59,130,246,0.12)',
                          color: '#3B82F6',
                          border: '1px solid rgba(59,130,246,0.4)',
                        }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Explanation */}
              {result.explanation && (
                <div
                  className="rounded-xl border p-4 flex items-start gap-2"
                  style={{
                    background: 'rgba(59,130,246,0.08)',
                    borderColor: 'rgba(59,130,246,0.4)',
                  }}
                >
                  <Info
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: '#3B82F6' }}
                  />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {result.explanation}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImpactPrediction;
