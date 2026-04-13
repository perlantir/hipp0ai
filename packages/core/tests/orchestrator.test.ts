/**
 * Smart Orchestrator Tests — validates suggestion logic, task templates, and reasoning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database adapter
const mockQueryResults: Map<string, { rows: Array<Record<string, unknown>> }> = new Map();

vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    query: vi.fn(async (sql: string) => {
      // Return different results based on the query
      if (sql.includes('task_sessions')) {
        return mockQueryResults.get('sessions') ?? { rows: [] };
      }
      if (sql.includes('session_steps')) {
        return mockQueryResults.get('steps') ?? { rows: [] };
      }
      if (sql.includes('agents')) {
        return mockQueryResults.get('agents') ?? { rows: [] };
      }
      return { rows: [] };
    }),
    arrayParam: (arr: string[]) => JSON.stringify(arr),
  }),
}));

// Mock the session manager
vi.mock('../src/memory/session-manager.js', () => ({
  getSessionContext: vi.fn(async () => ({
    session: { id: 'test', title: 'test', status: 'active' },
    previous_steps: [],
    formatted_session_context: '## Test Context',
  })),
}));

import {
  generateTaskSuggestion,
  buildReasoningExplanation,
} from '../src/intelligence/orchestrator.js';

  // generateTaskSuggestion (pure function)

describe('generateTaskSuggestion', () => {
  it('returns security review template for security_reviewer role', () => {
    const result = generateTaskSuggestion('sec-agent', 'security_reviewer', 'Auth System', 1);
    expect(result).toContain('security vulnerabilities');
    expect(result).toContain('Auth System');
  });

  it('returns implementation template for implementation_lead role', () => {
    const result = generateTaskSuggestion('builder', 'implementation_lead', 'API Feature', 0);
    expect(result).toContain('Implement');
    expect(result).toContain('API Feature');
  });

  it('returns design template for design_lead role', () => {
    const result = generateTaskSuggestion('architect', 'design_lead', 'New Module', 0);
    expect(result).toContain('Design');
    expect(result).toContain('New Module');
  });

  it('returns deployment template for deployment_lead role', () => {
    const result = generateTaskSuggestion('ops', 'deployment_lead', 'Release', 2);
    expect(result).toContain('deployment');
    expect(result).toContain('Release');
  });

  it('returns code review template for code_reviewer role', () => {
    const result = generateTaskSuggestion('reviewer', 'code_reviewer', 'PR Review', 1);
    expect(result).toContain('code quality');
    expect(result).toContain('PR Review');
  });

  it('maps contributor suffix back to reviewer/lead template', () => {
    const result = generateTaskSuggestion('sec', 'security_contributor', 'Auth', 1);
    expect(result).toContain('security vulnerabilities');
  });

  it('returns fallback for first step with unknown role', () => {
    const result = generateTaskSuggestion('agent-x', 'unknown_role', 'My Task', 0);
    expect(result).toContain('Begin work');
    expect(result).toContain('My Task');
  });

  it('returns continue fallback for later steps with unknown role', () => {
    const result = generateTaskSuggestion('agent-x', 'unknown_role', 'My Task', 3);
    expect(result).toContain('Continue');
    expect(result).toContain('3 completed steps');
  });

  it('handles singular step count in fallback', () => {
    const result = generateTaskSuggestion('agent-x', 'unknown_role', 'My Task', 1);
    expect(result).toContain('1 completed step');
    expect(result).not.toContain('steps');
  });
});

  // buildReasoningExplanation (pure function)

describe('buildReasoningExplanation', () => {
  it('describes high relevance score correctly', () => {
    const result = buildReasoningExplanation(
      { agent: 'builder', role: 'implementation_lead', score: 0.75 },
      [],
      'Build API',
    );
    expect(result).toContain('High relevance');
    expect(result).toContain('75%');
    expect(result).toContain('First agent');
  });

  it('describes moderate relevance score correctly', () => {
    const result = buildReasoningExplanation(
      { agent: 'reviewer', role: 'code_reviewer', score: 0.45 },
      ['builder'],
      'Review Code',
    );
    expect(result).toContain('Moderate relevance');
    expect(result).toContain('45%');
    expect(result).toContain('Fresh perspective');
  });

  it('describes low relevance score correctly', () => {
    const result = buildReasoningExplanation(
      { agent: 'ops', role: 'deployment_lead', score: 0.2 },
      ['builder', 'reviewer'],
      'Deploy',
    );
    expect(result).toContain('Lower relevance');
    expect(result).toContain('best available');
  });

  it('notes returning participant when agent already participated', () => {
    const result = buildReasoningExplanation(
      { agent: 'builder', role: 'implementation_lead', score: 0.7 },
      ['builder', 'reviewer'],
      'Continue Build',
    );
    expect(result).toContain('Returning participant');
  });

  it('notes fresh perspective when agent is new', () => {
    const result = buildReasoningExplanation(
      { agent: 'security', role: 'security_reviewer', score: 0.6 },
      ['builder'],
      'Security Review',
    );
    expect(result).toContain('Fresh perspective');
    expect(result).toContain('1 agent');
  });
});

  // suggestNextAgent (requires mocked DB)

describe('suggestNextAgent', () => {
  beforeEach(() => {
    mockQueryResults.clear();
  });

  it('returns session complete when no agents in project', async () => {
    mockQueryResults.set('sessions', {
      rows: [{ id: 's1', title: 'Test', status: 'active', agents_involved: '{}', current_step: 0, state_summary: null }],
    });
    mockQueryResults.set('steps', { rows: [] });
    mockQueryResults.set('agents', { rows: [] });

    const { suggestNextAgent } = await import('../src/intelligence/orchestrator.js');
    const result = await suggestNextAgent('s1', 'p1');
    expect(result.is_session_complete).toBe(true);
    expect(result.completion_reason).toContain('No agents');
  });

  it('throws for non-existent session', async () => {
    mockQueryResults.set('sessions', { rows: [] });

    const { suggestNextAgent } = await import('../src/intelligence/orchestrator.js');
    await expect(suggestNextAgent('nonexistent', 'p1')).rejects.toThrow('not found');
  });
});

  // generateSessionPlan (requires mocked DB)

describe('generateSessionPlan', () => {
  beforeEach(() => {
    mockQueryResults.clear();
  });

  it('returns empty plan when no agents', async () => {
    mockQueryResults.set('sessions', {
      rows: [{ id: 's1', title: 'Test Plan', current_step: 0 }],
    });
    mockQueryResults.set('agents', { rows: [] });

    const { generateSessionPlan } = await import('../src/intelligence/orchestrator.js');
    const result = await generateSessionPlan('s1', 'p1');
    expect(result.session_title).toBe('Test Plan');
    expect(result.suggested_plan).toHaveLength(0);
    expect(result.note).toContain('No agents');
  });

  it('throws for non-existent session', async () => {
    mockQueryResults.set('sessions', { rows: [] });

    const { generateSessionPlan } = await import('../src/intelligence/orchestrator.js');
    await expect(generateSessionPlan('nonexistent', 'p1')).rejects.toThrow('not found');
  });
});
