/**
 * Playground — public interactive demo page at /playground.
 * No auth required. Side-by-side agent context comparison.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Loader2, ArrowRight, BookOpen, Sparkles } from 'lucide-react';

/* -- Types --------------------------------------------------------- */

interface DemoAgent {
  name: string;
  role: string;
  description: string;
}

interface DemoDecision {
  title: string;
  tags: string[];
  affects: string[];
  confidence: string;
}

interface CompileResultDecision {
  title: string;
  score: number;
  tags: string[];
  affects: string[];
  confidence: string;
  loading_layer?: 'L0' | 'L1' | 'L2';
  domain?: string;
  category?: string;
}

interface CompileResult {
  agent_name: string;
  decisions_included: number;
  decisions_considered: number;
  compilation_time_ms: number;
  decisions: CompileResultDecision[];
  loading_layers?: { l0_count: number; l1_count: number; l2_available: number };
}

interface DemoStats {
  decisions: number;
  agents: number;
  edges: number;
  contradictions: number;
}

/* -- API helper ---------------------------------------------------- */

const BASE = import.meta.env.VITE_API_URL || '';

async function demoFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }
  return res.json();
}

/* -- Category colors for tag pills --------------------------------- */

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  architecture: { bg: '#eff6ff', text: '#1e40af' },
  scalability: { bg: '#DBEAFE', text: '#1E40AF' },
  infrastructure: { bg: '#E0E7FF', text: '#3730A3' },
  security: { bg: '#FEE2E2', text: '#991B1B' },
  auth: { bg: '#FCE7F3', text: '#9D174D' },
  frontend: { bg: '#D1FAE5', text: '#065F46' },
  ui: { bg: '#D1FAE5', text: '#065F46' },
  backend: { bg: '#FEF9C3', text: '#854D0E' },
  api: { bg: '#FEF9C3', text: '#854D0E' },
  devops: { bg: '#E0E7FF', text: '#3730A3' },
  deployment: { bg: '#E0E7FF', text: '#3730A3' },
  marketing: { bg: '#FCE7F3', text: '#9D174D' },
  pricing: { bg: '#dbeafe', text: '#1e40af' },
  testing: { bg: '#CFFAFE', text: '#155E75' },
  performance: { bg: '#CFFAFE', text: '#155E75' },
};

function tagColor(tag: string): { bg: string; text: string } {
  return TAG_COLORS[tag] || { bg: '#F3F4F6', text: '#374151' };
}

/* -- Skeleton loader ----------------------------------------------- */

function Skeleton({ width, height }: { width: string; height: string }) {
  return (
    <div
      className="rounded animate-pulse"
      style={{ width, height, background: 'var(--bg-hover)' }}
    />
  );
}

/* -- Agent dropdown ------------------------------------------------ */

function AgentSelect({
  agents,
  value,
  onChange,
  label,
}: {
  agents: DemoAgent[];
  value: string;
  onChange: (name: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none px-3 py-2.5 pr-9 rounded-lg text-sm font-medium cursor-pointer transition-colors"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            color: 'var(--text-primary)',
          }}
        >
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} — {a.role}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-tertiary)' }}
        />
      </div>
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {agents.find((a) => a.name === value)?.description || ''}
      </span>
    </div>
  );
}

/* -- Decision card ------------------------------------------------- */

function DecisionCard({
  decision,
  isUnique,
  index,
}: {
  decision: CompileResultDecision;
  isUnique: boolean;
  index: number;
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-lg transition-all"
      style={{
        background: isUnique ? 'rgba(6, 63, 249, 0.06)' : 'var(--bg-card)',
        border: `1px solid ${isUnique ? 'rgba(6, 63, 249, 0.15)' : 'var(--border-light)'}`,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Rank dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0 mt-1.5"
        style={{ background: '#16A34A' }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
            {decision.title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {decision.loading_layer && (
              <span
                className="text-2xs font-mono px-1 py-0.5 rounded"
                style={{
                  background: decision.loading_layer === 'L0' ? '#FEE2E2' : decision.loading_layer === 'L2' ? '#E0E7FF' : '#F3F4F6',
                  color: decision.loading_layer === 'L0' ? '#991B1B' : decision.loading_layer === 'L2' ? '#3730A3' : '#6B7280',
                }}
              >
                {decision.loading_layer}
              </span>
            )}
            <span
              className="text-xs font-mono tabular-nums px-1.5 py-0.5 rounded"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
            >
              {typeof decision.score === 'number' ? decision.score.toFixed(2) : '—'}
            </span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {decision.tags?.slice(0, 4).map((tag) => {
            const c = tagColor(tag);
            return (
              <span
                key={tag}
                className="text-2xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: c.bg, color: c.text }}
              >
                {tag}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -- Result panel (one per agent) ---------------------------------- */

function ResultPanel({
  label,
  result,
  otherTitles,
  loading,
}: {
  label: string;
  result: CompileResult | null;
  otherTitles: Set<string>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Compiling context for {label}...
          </span>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width="100%" height="56px" />
        ))}
      </div>
    );
  }

  if (!result) return null;

  const myTitles = new Set(result.decisions.map((d) => d.title));
  const uniqueCount = result.decisions.filter((d) => !otherTitles.has(d.title)).length;
  const sharedCount = result.decisions.length - uniqueCount;

  return (
    <div>
      {/* Stats row */}
      <div
        className="flex items-center gap-4 text-xs mb-4 px-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <span>{result.decisions_included} decisions compiled</span>
        <span className="font-medium" style={{ color: 'var(--accent-primary)' }}>
          {uniqueCount} unique
        </span>
        <span>{sharedCount} shared</span>
        {result.loading_layers && (
          <span style={{ color: 'var(--text-tertiary)' }}>
            L0:{result.loading_layers.l0_count} L1:{result.loading_layers.l1_count} L2:{result.loading_layers.l2_available}avail
          </span>
        )}
      </div>

      {/* Decision list */}
      <div className="space-y-2">
        {result.decisions.slice(0, 10).map((d, i) => (
          <DecisionCard
            key={d.title}
            decision={d}
            isUnique={!otherTitles.has(d.title)}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

/* -- Pre-compile: grouped decision cloud --------------------------- */

function DecisionCloud({ decisions }: { decisions: DemoDecision[] }) {
  // Group by first tag
  const groups: Record<string, DemoDecision[]> = {};
  for (const d of decisions) {
    const cat = d.tags[0] || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(d);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
        50 decisions across {Object.keys(groups).length} categories, ready to compile.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(groups).map(([cat, items]) => {
          const c = tagColor(cat);
          return (
            <div
              key={cat}
              className="rounded-xl p-4"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: c.bg, color: c.text }}
                >
                  {cat}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {items.length} decisions
                </span>
              </div>
              <div className="space-y-1.5">
                {items.slice(0, 5).map((d) => (
                  <p
                    key={d.title}
                    className="text-xs leading-relaxed truncate"
                    style={{ color: 'var(--text-secondary)' }}
                    title={d.title}
                  >
                    {d.title}
                  </p>
                ))}
                {items.length > 5 && (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    +{items.length - 5} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -- Mobile tab switcher ------------------------------------------- */

function TabSwitcher({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: number;
  onChange: (i: number) => void;
}) {
  return (
    <div
      className="flex rounded-lg p-0.5 md:hidden"
      style={{ background: 'var(--bg-secondary)' }}
    >
      {tabs.map((tab, i) => (
        <button
          key={tab}
          onClick={() => onChange(i)}
          className="flex-1 text-sm font-medium py-2 px-3 rounded-md transition-all"
          style={{
            background: active === i ? 'var(--bg-card)' : 'transparent',
            color: active === i ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: active === i ? 'var(--shadow-sm)' : 'none',
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/* -- Main Playground component ------------------------------------- */

export function Playground() {
  const [agents, setAgents] = useState<DemoAgent[]>([]);
  const [decisions, setDecisions] = useState<DemoDecision[]>([]);
  const [stats, setStats] = useState<DemoStats | null>(null);
  const [agentA, setAgentA] = useState('backend');
  const [agentB, setAgentB] = useState('marketer');
  const [task, setTask] = useState('Review the current system architecture and plan next steps');
  const [resultA, setResultA] = useState<CompileResult | null>(null);
  const [resultB, setResultB] = useState<CompileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState(0);
  const [initError, setInitError] = useState(false);

  // Load initial data
  useEffect(() => {
    Promise.all([
      demoFetch<DemoAgent[]>('/api/demo/agents'),
      demoFetch<DemoDecision[]>('/api/demo/decisions'),
      demoFetch<DemoStats>('/api/demo/stats'),
    ])
      .then(([a, d, s]) => {
        setAgents(a);
        setDecisions(d);
        setStats(s);
        if (a.length > 0) {
          setAgentA(a.find((x) => x.name === 'backend')?.name || a[0].name);
          setAgentB(a.find((x) => x.name === 'marketer')?.name || a[a.length > 1 ? 1 : 0].name);
        }
      })
      .catch(() => setInitError(true));
  }, []);

  // Compare handler
  const handleCompare = useCallback(async () => {
    setError(null);
    setLoading(true);
    setResultA(null);
    setResultB(null);

    try {
      const [a, b] = await Promise.all([
        demoFetch<CompileResult>('/api/demo/compile', {
          method: 'POST',
          body: JSON.stringify({ agent_name: agentA, task_description: task }),
        }),
        demoFetch<CompileResult>('/api/demo/compile', {
          method: 'POST',
          body: JSON.stringify({ agent_name: agentB, task_description: task }),
        }),
      ]);
      setResultA(a);
      setResultB(b);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Rate limited')) {
        setError("You've explored a lot! Sign up for unlimited access.");
      } else {
        setError('Demo temporarily unavailable. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [agentA, agentB, task]);

  // Title sets for highlighting unique decisions
  const titlesA = new Set(resultA?.decisions.map((d) => d.title) || []);
  const titlesB = new Set(resultB?.decisions.map((d) => d.title) || []);

  // Overlap stats
  const overlapCount = resultA && resultB
    ? resultA.decisions.filter((d) => titlesB.has(d.title)).length
    : 0;
  const onlyA = resultA ? resultA.decisions.length - overlapCount : 0;
  const onlyB = resultB ? resultB.decisions.length - overlapCount : 0;

  if (initError) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-primary)', fontFamily: "'DM Sans', sans-serif" }}
      >
        <div className="text-center p-8">
          <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            Demo temporarily unavailable
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            The demo project hasn't been seeded yet. Please check back soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--bg-primary)', fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* -- Header --------------------------------------------------- */}
      <header
        className="border-b"
        style={{
          background: '#1A1A1A',
          borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Hipp0</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Playground
          </h1>
          <p className="text-sm sm:text-base" style={{ color: 'rgba(255,255,255,0.6)' }}>
            See how AI agents get personalized context from the same decisions.
          </p>
          {stats && (
            <div className="flex gap-4 mt-4 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span>{stats.decisions} decisions</span>
              <span>{stats.agents} agents</span>
              <span>{stats.edges} edges</span>
              <span>{stats.contradictions} contradictions</span>
            </div>
          )}
        </div>
      </header>

      {/* -- Controls ------------------------------------------------- */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div
          className="rounded-xl p-4 sm:p-6"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <AgentSelect agents={agents} value={agentA} onChange={setAgentA} label="Agent A" />
            <AgentSelect agents={agents} value={agentB} onChange={setAgentB} label="Agent B" />
          </div>

          {/* Task input */}
          <div className="mb-4">
            <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
              Task Description
            </label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={2}
              maxLength={2000}
              className="w-full px-3 py-2.5 rounded-lg text-sm resize-none transition-colors"
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
              }}
              placeholder="Describe the task or question these agents are working on..."
            />
          </div>

          {/* Compare button */}
          <button
            onClick={handleCompare}
            disabled={loading || !task.trim() || agents.length === 0}
            className="w-full sm:w-auto px-6 py-3 rounded-lg text-sm font-semibold text-white transition-all flex items-center justify-center gap-2"
            style={{
              background: loading ? '#0534d4' : 'var(--accent-primary)',
              opacity: (loading || !task.trim()) ? 0.7 : 1,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Compiling...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Compare Context
              </>
            )}
          </button>

          {error && (
            <p className="text-sm mt-3" style={{ color: 'var(--accent-danger)' }}>
              {error}
            </p>
          )}
        </div>
      </div>

      {/* -- Results -------------------------------------------------- */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-8">
        {(resultA || resultB || loading) && (
          <>
            {/* Difference summary bar */}
            {resultA && resultB && !loading && (
              <div
                className="rounded-lg px-4 py-3 mb-6 flex items-center justify-center gap-6 text-sm"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  Overlap: <strong style={{ color: 'var(--text-primary)' }}>{overlapCount}</strong>
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Only {agentA}: <strong style={{ color: 'var(--accent-primary)' }}>{onlyA}</strong>
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Only {agentB}: <strong style={{ color: 'var(--accent-primary)' }}>{onlyB}</strong>
                </span>
              </div>
            )}

            {/* Mobile tab switcher */}
            {(resultA || resultB || loading) && (
              <div className="mb-4">
                <TabSwitcher
                  tabs={[agentA, agentB]}
                  active={mobileTab}
                  onChange={setMobileTab}
                />
              </div>
            )}

            {/* Side-by-side on desktop, tabbed on mobile */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className={`${mobileTab !== 0 ? 'hidden md:block' : ''}`}>
                <h3
                  className="text-sm font-semibold mb-3 uppercase tracking-wider"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {agentA}
                </h3>
                <ResultPanel
                  label={agentA}
                  result={resultA}
                  otherTitles={titlesB}
                  loading={loading}
                />
              </div>
              <div className={`${mobileTab !== 1 ? 'hidden md:block' : ''}`}>
                <h3
                  className="text-sm font-semibold mb-3 uppercase tracking-wider"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {agentB}
                </h3>
                <ResultPanel
                  label={agentB}
                  result={resultB}
                  otherTitles={titlesA}
                  loading={loading}
                />
              </div>
            </div>
          </>
        )}

        {/* Pre-compile: decision cloud */}
        {!resultA && !resultB && !loading && decisions.length > 0 && (
          <DecisionCloud decisions={decisions} />
        )}
      </div>

      {/* -- CTA section ---------------------------------------------- */}
      <div
        className="border-t"
        style={{ borderColor: 'var(--border-light)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 text-center">
          <h2
            className="text-xl sm:text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Same 50 decisions. Different views. That's Hipp0.
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            Every agent sees what matters to them. No noise. No missed context.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: 'var(--accent-primary)' }}
            >
              Get Started Free <ArrowRight size={16} />
            </a>
            <a
              href="https://github.com/perlantir/Hipp0"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-secondary)',
              }}
            >
              <BookOpen size={16} /> Read the Docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
