/**
 * Hierarchy Tests — validates auto-classification, layered loading,
 * domain-aware scoring boost, and backward compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agentPersonas module (same pattern as scoring.test.ts)
vi.mock('../src/config/agentPersonas.js', () => ({
  getPersona: (name: string) => {
    const personas: Record<string, { name: string; role: string; description: string; primaryTags: string[]; excludeTags: string[]; keywords: string[]; boostFactor: number }> = {
      builder: { name: 'builder', role: 'builder', description: 'Full-stack engineering', primaryTags: ['architecture', 'api', 'database', 'hono', 'typescript'], excludeTags: ['legal', 'compliance', 'marketing'], keywords: ['build'], boostFactor: 0.25 },
      forge: { name: 'forge', role: 'reviewer', description: 'Code review', primaryTags: ['code-review', 'ci-cd', 'testing', 'security', 'quality'], excludeTags: ['marketing', 'legal'], keywords: ['review', 'test'], boostFactor: 0.25 },
    };
    return personas[name.toLowerCase()];
  },
  AGENT_PERSONAS: {},
}));

import { classifyDecision, inferDomainFromTask } from '../src/hierarchy/classifier.js';
import { scoreDecision } from '../src/context-compiler/index.js';
import type { Decision, Agent, RelevanceProfile } from '../src/types.js';

/*  Test helpers  */

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    project_id: 'proj-1',
    title: 'Use JWT for auth',
    description: 'Token-based auth',
    reasoning: 'Stateless, scalable',
    made_by: 'alice',
    source: 'manual',
    confidence: 'high',
    status: 'active',
    tags: ['auth', 'architecture'],
    affects: ['builder'],
    alternatives_considered: [],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {},
    priority_level: 1,
    domain: null,
    category: null,
    ...overrides,
  } as Decision;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const profile: RelevanceProfile = {
    weights: { auth: 0.8, architecture: 1.0, api: 0.9 },
    decision_depth: 2,
    freshness_preference: 'balanced',
    include_superseded: false,
  };
  return {
    id: 'agent-1',
    project_id: 'proj-1',
    name: 'builder',
    role: 'builder',
    relevance_profile: profile,
    context_budget_tokens: 50000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const ZERO_VECTOR: number[] = new Array(1536).fill(0);

/*  classifyDecision tests  */

describe('classifyDecision', () => {
  it('assigns "authentication" domain for tags ["jwt", "auth"]', () => {
    const result = classifyDecision('Implement JWT auth', 'Token auth system', ['jwt', 'auth']);
    expect(result.domain).toBe('authentication');
  });

  it('assigns "database" domain for title "Switch from MySQL to PostgreSQL"', () => {
    const result = classifyDecision(
      'Switch from MySQL to PostgreSQL',
      'Migrate the database to PostgreSQL for better JSON support',
      [],
    );
    expect(result.domain).toBe('database');
  });

  it('falls back to "general" for unrecognizable content', () => {
    const result = classifyDecision(
      'Quarterly review process',
      'How we do quarterly reviews',
      ['process', 'team'],
    );
    expect(result.domain).toBe('general');
  });

  it('assigns "infrastructure" for deploy-related tags', () => {
    const result = classifyDecision('Docker compose setup', 'Container orchestration', ['docker', 'deploy']);
    expect(result.domain).toBe('infrastructure');
  });

  it('assigns "frontend" for UI-related tags', () => {
    const result = classifyDecision('Use Tailwind CSS', 'Utility-first CSS', ['tailwind', 'css', 'ui']);
    expect(result.domain).toBe('frontend');
  });

  it('assigns "testing" for test-related tags', () => {
    const result = classifyDecision('Add vitest', 'Unit testing framework', ['vitest', 'testing']);
    expect(result.domain).toBe('testing');
  });

  it('assigns "security" domain for security tags', () => {
    const result = classifyDecision('CORS policy', 'Configure CORS headers', ['cors', 'security']);
    expect(result.domain).toBe('security');
  });

  it('assigns "api" domain for API-related content', () => {
    const result = classifyDecision('REST API design', 'Use RESTful endpoints', ['api', 'rest']);
    expect(result.domain).toBe('api');
  });

  it('assigns "collaboration" domain for websocket tags', () => {
    const result = classifyDecision('Real-time collab', 'WebSocket presence', ['websocket', 'collab']);
    expect(result.domain).toBe('collaboration');
  });

  // Category tests
  it('assigns "architecture" category for imported decisions', () => {
    const result = classifyDecision('Use microservices', 'Service mesh architecture', ['architecture'], { source: 'imported' });
    expect(result.category).toBe('architecture');
  });

  it('assigns "tool-choice" category when tags contain "tool"', () => {
    const result = classifyDecision('Use Prettier', 'Code formatter', ['tool', 'formatting']);
    expect(result.category).toBe('tool-choice');
  });

  it('assigns "rejected-alternative" for rejection patterns', () => {
    const result = classifyDecision('Rejected: Use GraphQL', 'Considered but rejected', []);
    expect(result.category).toBe('rejected-alternative');
  });

  it('assigns "convention" for convention patterns', () => {
    const result = classifyDecision('Naming convention for APIs', 'Standard naming rules', ['api']);
    expect(result.category).toBe('convention');
  });

  it('assigns "security-policy" for high-confidence security decisions', () => {
    const result = classifyDecision('Encryption at rest', 'All data encrypted', ['security', 'encryption'], { confidence: 'high' });
    expect(result.category).toBe('security-policy');
  });

  it('defaults to "decision" category when no pattern matches', () => {
    const result = classifyDecision('Quarterly team sync', 'Regular meetings', ['process']);
    expect(result.category).toBe('decision');
  });
});

/*  inferDomainFromTask tests  */

describe('inferDomainFromTask', () => {
  it('returns "authentication" for auth-related task', () => {
    expect(inferDomainFromTask('Implement OAuth2 login flow')).toBe('authentication');
  });

  it('returns "database" for db-related task', () => {
    expect(inferDomainFromTask('Optimize PostgreSQL query performance')).toBe('database');
  });

  it('returns null for generic task', () => {
    expect(inferDomainFromTask('Prepare quarterly report')).toBeNull();
  });
});

/*  Domain-aware scoring boost tests  */

describe('Domain-aware scoring boost', () => {
  it('applies domain boost to scoring breakdown', () => {
    // Verify domain_boost signal is applied — use the breakdown instead of combined_score
    // which gets clamped to [0, 1.0]
    const decision = makeDecision({
      domain: 'authentication' as any,
      tags: ['auth'],
      affects: [],
      made_by: 'other',
      confidence: 'medium',
    });
    const agent = makeAgent();

    // Verify the decision has the domain property
    expect(decision.domain).toBe('authentication');

    const scoreWithDomain = scoreDecision(decision, agent, ZERO_VECTOR, {
      taskDomain: 'authentication',
      agentDomain: null,
    });
    const scoreWithoutDomain = scoreDecision(decision, agent, ZERO_VECTOR);

    // domain_boost should be applied when domainContext matches
    expect((scoreWithDomain.scoring_breakdown as any).domain_boost).toBe(0.12);
    expect((scoreWithoutDomain.scoring_breakdown as any).domain_boost).toBe(0);
  });

  it('caps domain boost at 0.15', () => {
    const decision = makeDecision({
      domain: 'authentication',
      tags: ['auth'],
      affects: [],
      made_by: 'other',
    });
    const agent = makeAgent();

    const scored = scoreDecision(decision, agent, ZERO_VECTOR, {
      taskDomain: 'authentication',
      agentDomain: 'authentication',
    });

    // Task match (0.12) + agent match (0.08) = 0.20, but capped at 0.15
    expect((scored.scoring_breakdown as any).domain_boost).toBeLessThanOrEqual(0.15);
  });

  it('does not boost when domain does not match', () => {
    const decision = makeDecision({ domain: 'frontend', tags: ['ui'] });
    const agent = makeAgent();

    const scored = scoreDecision(decision, agent, ZERO_VECTOR, {
      taskDomain: 'authentication',
      agentDomain: 'database',
    });

    expect((scored.scoring_breakdown as any).domain_boost).toBe(0);
  });
});

/*  Backward compatibility tests  */

describe('Backward compatibility', () => {
  it('treats NULL domain/category as general with priority_level=1', () => {
    const decision = makeDecision({ domain: null, category: null, priority_level: 1 });
    expect(decision.domain).toBeNull();
    expect(decision.category).toBeNull();
    expect(decision.priority_level).toBe(1);
  });

  it('scoreDecision works without domainContext parameter', () => {
    const decision = makeDecision({ domain: null });
    const agent = makeAgent();

    // Should not throw — domainContext is optional
    const scored = scoreDecision(decision, agent, ZERO_VECTOR);
    expect(scored.combined_score).toBeGreaterThanOrEqual(0);
    expect((scored.scoring_breakdown as any).domain_boost).toBe(0);
  });
});
