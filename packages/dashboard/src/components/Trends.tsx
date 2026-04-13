import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Loader2,
  BarChart3,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';
import { ExportButton } from './ExportButton';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DailyCount {
  date: string;
  count: number;
}

interface DailyOutcomeCount {
  date: string;
  success: number;
  failure: number;
  partial: number;
}

interface DailyContradictionCount {
  date: string;
  detected: number;
  resolved: number;
}

interface MemoryTrendsData {
  decisions_per_day: DailyCount[];
  outcomes_per_day: DailyOutcomeCount[];
  contradictions_per_day: DailyContradictionCount[];
  active_agents_per_day: DailyCount[];
}

type TimeRange = 7 | 30 | 90;

/* ------------------------------------------------------------------ */
/*  SVG chart primitives                                              */
/* ------------------------------------------------------------------ */

const CHART_W = 680;
const CHART_H = 180;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function xFor(index: number, total: number): number {
  if (total <= 1) return PAD_L;
  const innerW = CHART_W - PAD_L - PAD_R;
  return PAD_L + (index / (total - 1)) * innerW;
}

function yFor(value: number, max: number): number {
  if (max <= 0) return CHART_H - PAD_B;
  const innerH = CHART_H - PAD_T - PAD_B;
  return CHART_H - PAD_B - (value / max) * innerH;
}

function Axes({ maxValue, labels }: { maxValue: number; labels: string[] }) {
  const gridlineCount = 4;
  const gridlines = Array.from({ length: gridlineCount + 1 }, (_, i) => {
    const v = Math.round((maxValue / gridlineCount) * i);
    const y = yFor(v, maxValue);
    return { v, y };
  });

  // Show first, middle, last x-axis labels
  const showIndices =
    labels.length <= 1
      ? [0]
      : labels.length === 2
        ? [0, labels.length - 1]
        : [0, Math.floor(labels.length / 2), labels.length - 1];

  return (
    <>
      {/* Y gridlines and labels */}
      {gridlines.map(({ v, y }) => (
        <g key={`grid-${v}-${y}`}>
          <line
            x1={PAD_L}
            y1={y}
            x2={CHART_W - PAD_R}
            y2={y}
            stroke="var(--border-light)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <text
            x={PAD_L - 6}
            y={y + 3}
            fontSize={10}
            textAnchor="end"
            fill="var(--text-secondary)"
          >
            {v}
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {showIndices.map((idx) => (
        <text
          key={`x-${idx}`}
          x={xFor(idx, labels.length)}
          y={CHART_H - 8}
          fontSize={10}
          textAnchor="middle"
          fill="var(--text-secondary)"
        >
          {formatShortDate(labels[idx])}
        </text>
      ))}
    </>
  );
}

/* --------- Simple line chart with hover tooltip --------------------- */

interface LinePoint {
  date: string;
  value: number;
}

function LineChart({
  points,
  color = '#D97706',
  title,
}: {
  points: LinePoint[];
  color?: string;
  title: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const labels = points.map((p) => p.date);

  const polyline = points
    .map((p, i) => `${xFor(i, points.length)},${yFor(p.value, max)}`)
    .join(' ');

  const fillPath =
    points.length > 0
      ? `M ${xFor(0, points.length)},${CHART_H - PAD_B} L ${polyline} L ${xFor(
          points.length - 1,
          points.length,
        )},${CHART_H - PAD_B} Z`
      : '';

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      <h3
        className="text-sm font-semibold mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      {points.length === 0 ? (
        <div
          className="flex items-center justify-center h-[180px] text-xs italic"
          style={{ color: 'var(--text-secondary)' }}
        >
          No data for this period.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <Axes maxValue={max} labels={labels} />

          <path d={fillPath} fill={color} opacity={0.1} />
          <polyline
            points={polyline}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Hover hit areas */}
          {points.map((p, i) => (
            <rect
              key={`hit-${i}`}
              x={xFor(i, points.length) - 8}
              y={PAD_T}
              width={16}
              height={CHART_H - PAD_T - PAD_B}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}

          {/* Hover marker */}
          {hoverIdx !== null && points[hoverIdx] && (
            <g>
              <line
                x1={xFor(hoverIdx, points.length)}
                y1={PAD_T}
                x2={xFor(hoverIdx, points.length)}
                y2={CHART_H - PAD_B}
                stroke={color}
                strokeDasharray="2 2"
                strokeWidth={1}
              />
              <circle
                cx={xFor(hoverIdx, points.length)}
                cy={yFor(points[hoverIdx].value, max)}
                r={4}
                fill={color}
              />
              <g
                transform={`translate(${Math.min(
                  xFor(hoverIdx, points.length) + 8,
                  CHART_W - 120,
                )}, ${Math.max(yFor(points[hoverIdx].value, max) - 26, PAD_T + 4)})`}
              >
                <rect
                  width={110}
                  height={32}
                  rx={4}
                  fill="var(--bg-card)"
                  stroke="var(--border)"
                />
                <text x={6} y={13} fontSize={10} fill="var(--text-secondary)">
                  {formatShortDate(points[hoverIdx].date)}
                </text>
                <text
                  x={6}
                  y={26}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--text-primary)"
                >
                  {points[hoverIdx].value}
                </text>
              </g>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/* --------- Stacked bar chart for outcomes -------------------------- */

function StackedBarChart({
  points,
  title,
}: {
  points: DailyOutcomeCount[];
  title: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(
    1,
    ...points.map((p) => p.success + p.failure + p.partial),
  );
  const labels = points.map((p) => p.date);
  const innerW = CHART_W - PAD_L - PAD_R;
  const barWidth = Math.max(
    2,
    Math.min(16, (innerW / Math.max(points.length, 1)) * 0.7),
  );

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>
        <div className="flex items-center gap-3 text-2xs">
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-2 h-2 rounded-sm" style={{ background: '#059669' }} />
            Success
          </span>
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-2 h-2 rounded-sm" style={{ background: '#D97706' }} />
            Partial
          </span>
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-2 h-2 rounded-sm" style={{ background: '#DC2626' }} />
            Failure
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <div
          className="flex items-center justify-center h-[180px] text-xs italic"
          style={{ color: 'var(--text-secondary)' }}
        >
          No outcome data for this period.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <Axes maxValue={max} labels={labels} />

          {points.map((p, i) => {
            const cx = xFor(i, points.length);
            const sBottom = CHART_H - PAD_B;
            const successH =
              ((p.success || 0) / max) * (CHART_H - PAD_T - PAD_B);
            const partialH =
              ((p.partial || 0) / max) * (CHART_H - PAD_T - PAD_B);
            const failureH =
              ((p.failure || 0) / max) * (CHART_H - PAD_T - PAD_B);
            return (
              <g key={`bar-${i}`}>
                {/* Success on bottom */}
                <rect
                  x={cx - barWidth / 2}
                  y={sBottom - successH}
                  width={barWidth}
                  height={successH}
                  fill="#059669"
                />
                {/* Partial middle */}
                <rect
                  x={cx - barWidth / 2}
                  y={sBottom - successH - partialH}
                  width={barWidth}
                  height={partialH}
                  fill="#D97706"
                />
                {/* Failure top */}
                <rect
                  x={cx - barWidth / 2}
                  y={sBottom - successH - partialH - failureH}
                  width={barWidth}
                  height={failureH}
                  fill="#DC2626"
                />
                {/* Hover hit */}
                <rect
                  x={cx - 8}
                  y={PAD_T}
                  width={16}
                  height={CHART_H - PAD_T - PAD_B}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                />
              </g>
            );
          })}

          {hoverIdx !== null && points[hoverIdx] && (
            <g
              transform={`translate(${Math.min(
                xFor(hoverIdx, points.length) + 8,
                CHART_W - 130,
              )}, ${PAD_T + 4})`}
            >
              <rect
                width={124}
                height={58}
                rx={4}
                fill="var(--bg-card)"
                stroke="var(--border)"
              />
              <text x={6} y={13} fontSize={10} fill="var(--text-secondary)">
                {formatShortDate(points[hoverIdx].date)}
              </text>
              <text x={6} y={26} fontSize={10} fill="#059669">
                ● {points[hoverIdx].success} success
              </text>
              <text x={6} y={38} fontSize={10} fill="#D97706">
                ● {points[hoverIdx].partial} partial
              </text>
              <text x={6} y={50} fontSize={10} fill="#DC2626">
                ● {points[hoverIdx].failure} failure
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/* --------- Dual line chart for contradictions --------------------- */

function DualLineChart({
  points,
  title,
}: {
  points: DailyContradictionCount[];
  title: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.detected, p.resolved)),
  );
  const labels = points.map((p) => p.date);

  const detectedLine = points
    .map((p, i) => `${xFor(i, points.length)},${yFor(p.detected, max)}`)
    .join(' ');
  const resolvedLine = points
    .map((p, i) => `${xFor(i, points.length)},${yFor(p.resolved, max)}`)
    .join(' ');

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </h3>
        <div className="flex items-center gap-3 text-2xs">
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-3 h-0.5" style={{ background: '#DC2626' }} />
            Detected
          </span>
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-3 h-0.5" style={{ background: '#059669' }} />
            Resolved
          </span>
        </div>
      </div>
      {points.length === 0 ? (
        <div
          className="flex items-center justify-center h-[180px] text-xs italic"
          style={{ color: 'var(--text-secondary)' }}
        >
          No contradictions in this period.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <Axes maxValue={max} labels={labels} />

          <polyline
            points={detectedLine}
            fill="none"
            stroke="#DC2626"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={resolvedLine}
            fill="none"
            stroke="#059669"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {points.map((_p, i) => (
            <rect
              key={`hit-${i}`}
              x={xFor(i, points.length) - 8}
              y={PAD_T}
              width={16}
              height={CHART_H - PAD_T - PAD_B}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}

          {hoverIdx !== null && points[hoverIdx] && (
            <g>
              <line
                x1={xFor(hoverIdx, points.length)}
                y1={PAD_T}
                x2={xFor(hoverIdx, points.length)}
                y2={CHART_H - PAD_B}
                stroke="var(--text-secondary)"
                strokeDasharray="2 2"
                strokeWidth={1}
              />
              <circle
                cx={xFor(hoverIdx, points.length)}
                cy={yFor(points[hoverIdx].detected, max)}
                r={3}
                fill="#DC2626"
              />
              <circle
                cx={xFor(hoverIdx, points.length)}
                cy={yFor(points[hoverIdx].resolved, max)}
                r={3}
                fill="#059669"
              />
              <g
                transform={`translate(${Math.min(
                  xFor(hoverIdx, points.length) + 8,
                  CHART_W - 130,
                )}, ${PAD_T + 4})`}
              >
                <rect
                  width={124}
                  height={46}
                  rx={4}
                  fill="var(--bg-card)"
                  stroke="var(--border)"
                />
                <text x={6} y={13} fontSize={10} fill="var(--text-secondary)">
                  {formatShortDate(points[hoverIdx].date)}
                </text>
                <text x={6} y={26} fontSize={10} fill="#DC2626">
                  ● {points[hoverIdx].detected} detected
                </text>
                <text x={6} y={38} fontSize={10} fill="#059669">
                  ● {points[hoverIdx].resolved} resolved
                </text>
              </g>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Trends() {
  const { get } = useApi();
  const { projectId } = useProject();
  const [range, setRange] = useState<TimeRange>(30);
  const [data, setData] = useState<MemoryTrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = useCallback(() => {
    setLoading(true);
    setError(null);
    get<MemoryTrendsData>(
      `/api/projects/${projectId}/analytics/trends?days=${range}`,
    )
      .then(setData)
      .catch((err) => setError(err?.message ?? 'Failed to load trends'))
      .finally(() => setLoading(false));
  }, [get, projectId, range]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  const decisionPoints = useMemo<LinePoint[]>(
    () =>
      (data?.decisions_per_day ?? []).map((d) => ({
        date: d.date,
        value: d.count,
      })),
    [data],
  );

  const agentPoints = useMemo<LinePoint[]>(
    () =>
      (data?.active_agents_per_day ?? []).map((d) => ({
        date: d.date,
        value: d.count,
      })),
    [data],
  );

  const hasAnyData =
    data &&
    (decisionPoints.some((p) => p.value > 0) ||
      (data.outcomes_per_day ?? []).some(
        (p) => p.success + p.partial + p.failure > 0,
      ) ||
      (data.contradictions_per_day ?? []).some(
        (p) => p.detected + p.resolved > 0,
      ) ||
      agentPoints.some((p) => p.value > 0));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-xl font-bold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <TrendingUp size={20} style={{ color: '#D97706' }} /> Memory Trends
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              How your memory evolves over time
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Range selector */}
            <div
              className="flex items-center gap-0 rounded-lg overflow-hidden border"
              style={{ borderColor: 'var(--border)' }}
            >
              {([7, 30, 90] as TimeRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className="text-xs font-medium px-3 py-1.5 transition-all"
                  style={{
                    background: range === r ? '#D97706' : 'var(--bg-card)',
                    color: range === r ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {r} days
                </button>
              ))}
            </div>
            <button
              onClick={fetchTrends}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all"
              style={{
                background: loading ? '#92400E' : '#D97706',
                opacity: loading ? 0.7 : 1,
              }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <ExportButton
              data={
                data
                  ? [
                      ...(data.decisions_per_day ?? []).map((d) => ({
                        metric: 'decisions',
                        ...d,
                      })),
                      ...(data.outcomes_per_day ?? []).map((d) => ({
                        metric: 'outcomes',
                        ...d,
                      })),
                      ...(data.contradictions_per_day ?? []).map((d) => ({
                        metric: 'contradictions',
                        ...d,
                      })),
                      ...(data.active_agents_per_day ?? []).map((d) => ({
                        metric: 'active_agents',
                        ...d,
                      })),
                    ]
                  : []
              }
              filename={`hipp0-trends-${range}d`}
              disabled={loading}
            />
          </div>
        </div>

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={24} className="animate-spin" style={{ color: '#D97706' }} />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Loading trends…
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !data && (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: 'var(--bg-card)', borderColor: '#DC2626' }}
          >
            <AlertTriangle size={24} className="mx-auto mb-2 text-red-600" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Empty */}
        {data && !hasAnyData && (
          <div
            className="rounded-xl border p-10 text-center"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <BarChart3
              size={32}
              className="mx-auto mb-3 opacity-40"
              style={{ color: 'var(--text-secondary)' }}
            />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No trend data yet for the last {range} days.
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Data will populate as decisions and outcomes accumulate.
            </p>
          </div>
        )}

        {/* Charts */}
        {data && hasAnyData && (
          <div className="grid gap-4 md:grid-cols-2">
            <LineChart
              title="Decisions per day"
              points={decisionPoints}
              color="#D97706"
            />
            <StackedBarChart
              title="Outcomes per day"
              points={data.outcomes_per_day ?? []}
            />
            <DualLineChart
              title="Contradictions per day"
              points={data.contradictions_per_day ?? []}
            />
            <LineChart
              title="Active agents per day"
              points={agentPoints}
              color="#6B8AE5"
            />
          </div>
        )}
      </div>
    </div>
  );
}
