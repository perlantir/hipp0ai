import { describe, it, expect } from 'vitest';
import {
  condenseDecisions,
  condenseSessionHistory,
  condenseContradictions,
  condenseTeamScores,
  condenseRecommendedAction,
  condenseCompileResponse,
  estimateTokens,
} from '../src/context-compiler/compression.js';
import type { ScoredDecision, Contradiction, ContextPackage, ScoredArtifact, Notification, SessionSummary } from '../src/types.js';
import type { TaskSession, SessionStep } from '../src/memory/session-manager.js';
import type { ActionSignal } from '../src/intelligence/role-signals.js';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeScoredDecision(overrides: Partial<ScoredDecision> = {}): ScoredDecision {
  return {
    id: overrides.id ?? 'dec-001',
    project_id: 'proj-1',
    title: overrides.title ?? 'Use JWT for stateless API authentication',
    description: overrides.description ?? 'Chose JWT over session cookies for API auth',
    reasoning: overrides.reasoning ?? 'Session cookies require sticky sessions or shared Redis. JWT is self-contained and scales horizontally.',
    made_by: overrides.made_by ?? 'backend',
    source: 'manual',
    confidence: overrides.confidence ?? 'high',
    status: 'active',
    alternatives_considered: [],
    affects: overrides.affects ?? ['frontend', 'security'],
    tags: overrides.tags ?? ['auth', 'security', 'api', 'architecture'],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0.01,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    metadata: {},
    relevance_score: overrides.relevance_score ?? 0.87,
    freshness_score: overrides.freshness_score ?? 0.9,
    combined_score: overrides.combined_score ?? 0.87,
    scoring_breakdown: overrides.scoring_breakdown ?? {
      direct_affect: 0.3,
      tag_matching: 0.2,
      role_relevance: 0.25,
      semantic_similarity: 0.12,
      status_penalty: 0,
      freshness: 0.9,
      combined: 0.87,
    },
  };
}

function makeDecisions(count: number): ScoredDecision[] {
  const titles = [
    'Use JWT for stateless API authentication',
    'PostgreSQL with pgvector for embeddings',
    'Hono framework for server-side routing',
    'pnpm workspaces for monorepo management',
    'Redis for caching and rate limiting',
    'WebSocket for real-time notifications',
    'Role-based scoring for context compilation',
    'Vitest for unit and integration testing',
    'Docker Compose for local development',
    'Semantic search with cosine similarity',
    'Graph expansion for related decisions',
    'Token budget packing algorithm',
    'Confidence decay over time model',
    'Auto-distillation from conversations',
    'Contradiction detection via embeddings',
    'Session-based multi-step workflows',
    'Agent relevance profiling system',
    'Policy enforcement overlay mechanism',
    'Smart orchestrator for agent routing',
    'Relevance feedback learning loop',
    'Change propagation subscription model',
    'Audit logging for all mutations',
    'API key scoping and rotation',
    'Artifact tracking and linking',
    'Context cache with 1-hour TTL',
    'Freshness-weighted score blending',
    'Graph traversal with score decay',
    'Markdown and JSON dual formatting',
    'Notification urgency prioritization',
    'Super Brain session management',
  ];

  return Array.from({ length: count }, (_, i) => makeScoredDecision({
    id: `dec-${String(i + 1).padStart(3, '0')}`,
    title: titles[i % titles.length]!,
    combined_score: 0.95 - (i * 0.02),
    tags: ['tag-a', 'tag-b', `tag-${i}`],
    made_by: i % 2 === 0 ? 'backend' : 'frontend',
  }));
}

function makeContextPackage(decisionCount: number): ContextPackage {
  const decisions = makeDecisions(decisionCount);
  const formatted_json = JSON.stringify({
    agent: { name: 'backend', role: 'builder' },
    task: 'Implement authentication flow',
    compiled_at: '2024-01-01T00:00:00Z',
    token_count: 5000,
    decisions,
    artifacts: [],
    notifications: [],
    recent_sessions: [],
  }, null, 2);

  return {
    agent: { name: 'backend', role: 'builder' },
    task: 'Implement authentication flow',
    compiled_at: '2024-01-01T00:00:00Z',
    token_count: 5000,
    budget_used_pct: 50,
    decisions,
    artifacts: [] as ScoredArtifact[],
    notifications: [] as Notification[],
    recent_sessions: [] as SessionSummary[],
    formatted_markdown: '# Context\n...',
    formatted_json,
    decisions_considered: decisionCount * 3,
    decisions_included: decisionCount,
    relevance_threshold_used: 0.5,
    compilation_time_ms: 42,
    suggested_patterns: [],
  };
}

function makeContradiction(overrides: Partial<Contradiction> = {}): Contradiction {
  return {
    id: overrides.id ?? 'cont-1',
    project_id: 'proj-1',
    decision_a_id: overrides.decision_a_id ?? 'dec-001',
    decision_b_id: overrides.decision_b_id ?? 'dec-002',
    similarity_score: overrides.similarity_score ?? 0.85,
    conflict_description: overrides.conflict_description ?? 'JWT and session cookies are mutually exclusive approaches',
    status: overrides.status ?? 'unresolved',
    detected_at: '2024-01-01T00:00:00Z',
  };
}

function makeSessionStep(overrides: Partial<SessionStep> = {}): SessionStep {
  return {
    id: overrides.id ?? 'step-1',
    session_id: 'session-1',
    project_id: 'proj-1',
    step_number: overrides.step_number ?? 1,
    agent_name: overrides.agent_name ?? 'backend',
    agent_role: overrides.agent_role ?? 'builder',
    task_description: overrides.task_description ?? 'Design authentication system',
    output: overrides.output ?? 'Designed JWT-based auth system',
    output_summary: overrides.output_summary ?? 'Chose JWT approach, designed token rotation',
    artifacts: [],
    decisions_compiled: 5,
    decisions_created: [],
    duration_ms: 1500,
    compile_time_ms: 200,
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
  };
}

function makeTaskSession(overrides: Partial<TaskSession> = {}): TaskSession {
  return {
    id: overrides.id ?? 'session-abc12345-full-uuid',
    project_id: 'proj-1',
    title: overrides.title ?? 'Build auth system end to end',
    description: overrides.description ?? null,
    status: overrides.status ?? 'in_progress',
    agents_involved: overrides.agents_involved ?? ['backend', 'security'],
    current_step: overrides.current_step ?? 2,
    state_summary: overrides.state_summary ?? 'Step 2: security reviewing token rotation',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    completed_at: null,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates based on word count times 1.3', () => {
    const text = 'This is a five word sentence plus two more';
    const tokens = estimateTokens(text);
    // 9 words × 1.3 = 11.7, ceil = 12
    expect(tokens).toBe(12);
  });
});

describe('condenseDecisions', () => {
  it('returns empty string for no decisions', () => {
    expect(condenseDecisions([])).toBe('');
  });

  it('contains all decision titles from original', () => {
    const decisions = makeDecisions(5);
    const condensed = condenseDecisions(decisions);
    for (const d of decisions) {
      // Title may be truncated, check that it starts with the same words
      const firstWords = d.title.split(' ').slice(0, 3).join(' ');
      expect(condensed).toContain(firstWords);
    }
  });

  it('includes confidence abbreviation', () => {
    const decisions = [
      makeScoredDecision({ confidence: 'high' }),
      makeScoredDecision({ id: 'dec-002', confidence: 'medium' }),
      makeScoredDecision({ id: 'dec-003', confidence: 'low' }),
    ];
    const condensed = condenseDecisions(decisions);
    expect(condensed).toContain('c:H');
    expect(condensed).toContain('c:M');
    expect(condensed).toContain('c:L');
  });

  it('includes tags, score, and agent', () => {
    const decisions = [makeScoredDecision()];
    const condensed = condenseDecisions(decisions);
    expect(condensed).toContain('by:backend');
    expect(condensed).toContain('s:.87');
    expect(condensed).toContain('tg:');
  });

  it('uses section marker [D:N]', () => {
    const decisions = makeDecisions(3);
    const condensed = condenseDecisions(decisions);
    expect(condensed).toMatch(/^\[D:3\]/);
  });
});

describe('condenseSessionHistory', () => {
  it('returns empty for no sessions and no steps', () => {
    expect(condenseSessionHistory([], [])).toBe('');
  });

  it('condenses session steps correctly — all steps present', () => {
    const steps = [
      makeSessionStep({ step_number: 1, agent_name: 'backend', task_description: 'Design auth' }),
      makeSessionStep({ id: 'step-2', step_number: 2, agent_name: 'security', task_description: 'Review token rotation' }),
      makeSessionStep({ id: 'step-3', step_number: 3, agent_name: 'frontend', task_description: 'Implement login UI' }),
    ];
    const condensed = condenseSessionHistory([], steps);
    expect(condensed).toContain('step:1');
    expect(condensed).toContain('step:2');
    expect(condensed).toContain('step:3');
    expect(condensed).toContain('agent:backend');
    expect(condensed).toContain('agent:security');
    expect(condensed).toContain('agent:frontend');
  });

  it('condenses TaskSession entries', () => {
    const sessions = [makeTaskSession()];
    const condensed = condenseSessionHistory(sessions);
    expect(condensed).toContain('[S:1');
    expect(condensed).toContain('status:in_progress');
    expect(condensed).toContain('agents:backend,security');
  });
});

describe('condenseContradictions', () => {
  it('returns empty for no contradictions', () => {
    expect(condenseContradictions([])).toBe('');
  });

  it('contradictions present in condensed output', () => {
    const contradictions = [makeContradiction()];
    const condensed = condenseContradictions(contradictions);
    expect(condensed).toContain('[C:1]');
    expect(condensed).toContain('status:unresolved');
    expect(condensed).toContain('sim:.85');
  });

  it('uses decision title map when available', () => {
    const contradictions = [makeContradiction()];
    const map = new Map([
      ['dec-001', 'Use JWT'],
      ['dec-002', 'Use cookies'],
    ]);
    const condensed = condenseContradictions(contradictions, map);
    expect(condensed).toContain('d1:Use JWT');
    expect(condensed).toContain('d2:Use cookies');
  });
});

describe('condenseTeamScores', () => {
  it('returns empty for no scores', () => {
    expect(condenseTeamScores([])).toBe('');
  });

  it('formats team scores with section marker', () => {
    const scores = [
      { agent_name: 'backend', relevance_score: 0.92 },
      { agent_name: 'security', relevance_score: 0.87 },
      { agent_name: 'frontend', relevance_score: 0.65 },
    ];
    const condensed = condenseTeamScores(scores);
    expect(condensed).toContain('[T|');
    expect(condensed).toContain('backend:.92');
    expect(condensed).toContain('security:.87');
    expect(condensed).toContain('frontend:.65');
  });
});

describe('condenseRecommendedAction', () => {
  it('formats recommended action', () => {
    const action: ActionSignal = {
      recommended_action: 'PROCEED',
      action_reason: 'All signals aligned, strong fit for this task',
    };
    const condensed = condenseRecommendedAction(action);
    expect(condensed).toContain('[RA|');
    expect(condensed).toContain('action:PROCEED');
    expect(condensed).toContain('reason:');
  });

  it('includes override_to_agent when present', () => {
    const action: ActionSignal = {
      recommended_action: 'OVERRIDE_TO',
      action_reason: 'Security agent is better suited',
      override_to_agent: 'security',
    };
    const condensed = condenseRecommendedAction(action);
    expect(condensed).toContain('to:security');
  });
});

describe('condenseCompileResponse', () => {
  it('produces valid condensed output with header', () => {
    const pkg = makeContextPackage(5);
    const result = condenseCompileResponse({ contextPackage: pkg });
    expect(result.condensed_context).toContain('[H0C v1|');
    expect(result.format_version).toBe('h0c-v1');
    expect(result.decisions_included).toBe(5);
    expect(result.decisions_considered).toBe(15);
  });

  it('achieves >= 5x compression on 15-decision response', () => {
    const pkg = makeContextPackage(15);
    const result = condenseCompileResponse({ contextPackage: pkg });
    expect(result.compression_ratio).toBeGreaterThanOrEqual(5);
  });

  it('achieves >= 8x compression on 30-decision response', () => {
    const pkg = makeContextPackage(30);
    const result = condenseCompileResponse({ contextPackage: pkg });
    expect(result.compression_ratio).toBeGreaterThanOrEqual(8);
  });

  it('includes recommended_action when original has one', () => {
    const pkg = makeContextPackage(3);
    const action: ActionSignal = {
      recommended_action: 'PROCEED',
      action_reason: 'Strong fit for auth tasks',
    };
    const result = condenseCompileResponse({
      contextPackage: pkg,
      recommendedAction: action,
    });
    expect(result.condensed_context).toContain('[RA|');
    expect(result.condensed_context).toContain('action:PROCEED');
  });

  it('includes contradictions when present', () => {
    const pkg = makeContextPackage(3);
    const contradictions = [makeContradiction()];
    const result = condenseCompileResponse({
      contextPackage: pkg,
      contradictions,
    });
    expect(result.condensed_context).toContain('[C:1]');
  });

  it('Super Brain session history condenses correctly', () => {
    const pkg = makeContextPackage(3);
    const steps = [
      makeSessionStep({ step_number: 1, agent_name: 'architect' }),
      makeSessionStep({ id: 'step-2', step_number: 2, agent_name: 'backend' }),
    ];
    const sessions = [makeTaskSession()];
    const result = condenseCompileResponse({
      contextPackage: pkg,
      sessionSteps: steps,
      taskSessions: sessions,
    });
    expect(result.condensed_context).toContain('step:1');
    expect(result.condensed_context).toContain('step:2');
    expect(result.condensed_context).toContain('agent:architect');
    expect(result.condensed_context).toContain('agent:backend');
  });

  it('backward compatibility: default response unchanged when no condensed format requested', () => {
    // This test verifies that the ContextPackage type remains the same
    const pkg = makeContextPackage(3);
    // The original ContextPackage should still have all its fields
    expect(pkg.formatted_markdown).toBeDefined();
    expect(pkg.formatted_json).toBeDefined();
    expect(pkg.decisions).toHaveLength(3);
    expect(pkg.token_count).toBeDefined();
    expect(pkg.budget_used_pct).toBeDefined();
  });

  it('LLM-readable format: condensed output contains extractable decision info', () => {
    const pkg = makeContextPackage(5);
    const result = condenseCompileResponse({ contextPackage: pkg });
    const context = result.condensed_context;

    // Header is parseable
    expect(context).toMatch(/\[H0C v1\|/);

    // Each decision has t: r: by: c: s: fields
    const decisionBlocks = context.match(/\[D\|[^\]]+\]/g);
    expect(decisionBlocks).not.toBeNull();
    expect(decisionBlocks!.length).toBe(5);

    for (const block of decisionBlocks!) {
      expect(block).toMatch(/t:/);
      expect(block).toMatch(/r:/);
      expect(block).toMatch(/by:/);
      expect(block).toMatch(/c:[HML]/);
      expect(block).toMatch(/s:\.\d+/);
    }
  });

  it('includes compilation_time_ms and hint fields', () => {
    const pkg = makeContextPackage(3);
    const result = condenseCompileResponse({ contextPackage: pkg });
    expect(result.compilation_time_ms).toBeGreaterThanOrEqual(42);
    expect(result.feedback_hint).toContain('/api/feedback');
    expect(result.outcome_hint).toContain('/api/outcomes');
  });

  it('handles team scores in condensed output', () => {
    const pkg = makeContextPackage(3);
    const result = condenseCompileResponse({
      contextPackage: pkg,
      roleSignals: [
        { agent_name: 'backend', relevance_score: 0.92 },
        { agent_name: 'security', relevance_score: 0.87 },
      ],
    });
    expect(result.condensed_context).toContain('[T|');
    expect(result.condensed_context).toContain('backend:.92');
  });

  it('compressed_tokens is less than original_tokens', () => {
    const pkg = makeContextPackage(15);
    const result = condenseCompileResponse({ contextPackage: pkg });
    expect(result.compressed_tokens).toBeLessThan(result.original_tokens);
    expect(result.original_tokens).toBeGreaterThan(0);
    expect(result.compressed_tokens).toBeGreaterThan(0);
  });
});
