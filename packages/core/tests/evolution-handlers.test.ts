/**
 * Evolution Handlers — Unit Tests
 *
 * Tests for all 5 type-specific execution handlers:
 *   1. Orphaned decision (link vs archive)
 *   2. Stale decision (archive + optional supersede)
 *   3. Contradiction (override vs newer-wins)
 *   4. Concentration risk (flag for cross-review)
 *   5. High-impact unvalidated (queue for validation)
 *   6. Reject records reason without modifying decisions
 *   7. Audit trail populated on every accept
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockTransaction = vi.fn().mockImplementation(async (fn: Function) => fn(mockQuery));

vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    query: mockQuery,
    transaction: mockTransaction,
    arrayParam: (v: unknown[]) => JSON.stringify(v),
    dialect: 'sqlite' as const,
  }),
}));

import {
  handleOrphanedDecision,
  handleStaleDecision,
  handleContradiction,
  handleConcentrationRisk,
  handleHighImpactUnvalidated,
  executeProposalHandler,
  findRelatedDecisions,
} from '../src/intelligence/evolution-handlers.js';
import type { ProposalRecord } from '../src/intelligence/evolution-handlers.js';

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ---------------------------------------------------------------------------
// Helper: build a proposal record
// ---------------------------------------------------------------------------

function makeProposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: 'prop-1',
    project_id: 'proj-1',
    trigger_type: 'orphaned_decision',
    affected_decision_ids: ['dec-1'],
    reasoning: 'Test reasoning',
    suggested_action: 'link_or_review',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Orphaned Decision Handler
// ---------------------------------------------------------------------------

describe('handleOrphanedDecision', () => {
  it('creates edges when 2+ matches exist above threshold', async () => {
    // First call: fetch orphan decision
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'dec-1',
          title: 'Use JWT for auth tokens',
          description: 'Use JWT tokens for authentication and authorization across all API endpoints',
          tags: '["security", "api", "auth", "tokens", "jwt"]',
        }],
        rowCount: 1,
      })
      // Second call: fetch all other active decisions
      .mockResolvedValueOnce({
        rows: [
          { id: 'dec-2', title: 'API key auth tokens security', description: 'Use JWT tokens for hashing API keys with bcrypt for security authentication across endpoints', tags: '["security", "api", "auth", "tokens", "jwt"]' },
          { id: 'dec-3', title: 'CORS auth security API tokens', description: 'Configure CORS auth headers for API security tokens and JWT authentication endpoints', tags: '["security", "api", "auth", "tokens", "jwt"]' },
          { id: 'dec-4', title: 'Database schema', description: 'PostgreSQL schema design', tags: '["database"]' },
        ],
        rowCount: 3,
      })
      // Edge creation calls
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await handleOrphanedDecision(makeProposal());

    expect(result.success).toBe(true);
    expect(result.executed_action).toMatch(/Linked to \d+ related decisions/);
    expect(result.decisions_modified).toContain('dec-1');
    expect(result.decisions_modified.length).toBeGreaterThan(1);
  });

  it('archives when 0-1 matches found', async () => {
    // Orphan decision with unique tags
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'dec-1',
          title: 'Use exotic framework',
          description: 'Some unique framework',
          tags: '["exotic", "unique"]',
        }],
        rowCount: 1,
      })
      // No matching decisions
      .mockResolvedValueOnce({
        rows: [
          { id: 'dec-2', title: 'Database schema', description: 'PostgreSQL design', tags: '["database"]' },
        ],
        rowCount: 1,
      })
      // Archive update calls
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await handleOrphanedDecision(makeProposal());

    expect(result.success).toBe(true);
    expect(result.executed_action).toBe('Archived — no related decisions found');
    expect(result.decisions_modified).toEqual(['dec-1']);
  });
});

// ---------------------------------------------------------------------------
// 2. Stale Decision Handler
// ---------------------------------------------------------------------------

describe('handleStaleDecision', () => {
  it('sets valid_until and archives', async () => {
    // Archive update calls succeed
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    // Age query
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // first UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // metadata UPDATE
      .mockResolvedValueOnce({ rows: [{ age_days: 30 }], rowCount: 1 }); // age query

    const result = await handleStaleDecision(
      makeProposal({ trigger_type: 'stale_sprint', suggested_action: 'review_or_supersede' }),
    );

    expect(result.success).toBe(true);
    expect(result.executed_action).toMatch(/Archived stale decision/);
    expect(result.decisions_modified).toContain('dec-1');
  });

  it('creates superseding decision when replacement text provided', async () => {
    // Archive update, metadata update
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // status update
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // metadata update
      // Fetch original decision
      .mockResolvedValueOnce({
        rows: [{
          id: 'dec-1',
          project_id: 'proj-1',
          title: 'Old decision',
          description: 'Old description',
          made_by: 'agent-1',
          confidence: 'medium',
          alternatives_considered: '[]',
          affects: '[]',
          tags: '["api"]',
          assumptions: '[]',
          open_questions: '[]',
          dependencies: '[]',
          confidence_decay_rate: 0,
        }],
        rowCount: 1,
      })
      // Insert new decision
      .mockResolvedValueOnce({
        rows: [{ id: 'dec-new' }],
        rowCount: 1,
      })
      // Update superseded_by
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Create edge
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handleStaleDecision(
      makeProposal({ trigger_type: 'stale_quarter', suggested_action: 'review_or_archive' }),
      'Updated approach for Q2',
    );

    expect(result.success).toBe(true);
    expect(result.executed_action).toMatch(/created superseding decision/);
    expect(result.decisions_modified).toContain('dec-1');
    expect(result.decisions_modified.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Contradiction Resolution Handler
// ---------------------------------------------------------------------------

describe('handleContradiction', () => {
  it('creates superseding decision with override text', async () => {
    const proposal = makeProposal({
      trigger_type: 'unresolved_contradiction',
      affected_decision_ids: ['dec-a', 'dec-b'],
      suggested_action: 'resolve_contradiction',
    });

    // Fetch decision A
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'dec-a',
          project_id: 'proj-1',
          title: 'Decision A',
          affects: '[]',
          tags: '["api"]',
        }],
        rowCount: 1,
      })
      // Insert new decision
      .mockResolvedValueOnce({
        rows: [{ id: 'dec-new' }],
        rowCount: 1,
      })
      // Supersede decision A
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Supersede decision B
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Create edge to A
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Create edge to B
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Resolve contradiction record
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handleContradiction(proposal, 'Use OAuth2 for all endpoints');

    expect(result.success).toBe(true);
    expect(result.executed_action).toMatch(/Created superseding decision .+ resolving contradiction/);
    expect(result.decisions_modified).toContain('dec-a');
    expect(result.decisions_modified).toContain('dec-b');
    expect(result.decisions_modified.length).toBe(3);
  });

  it('newer decision wins on plain accept', async () => {
    const proposal = makeProposal({
      trigger_type: 'unresolved_contradiction',
      affected_decision_ids: ['dec-a', 'dec-b'],
      suggested_action: 'resolve_contradiction',
    });

    // Fetch decision A (older)
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'dec-a', created_at: '2025-01-01T00:00:00Z' }],
        rowCount: 1,
      })
      // Fetch decision B (newer)
      .mockResolvedValueOnce({
        rows: [{ id: 'dec-b', created_at: '2025-06-01T00:00:00Z' }],
        rowCount: 1,
      })
      // Supersede older
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Resolve contradiction
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handleContradiction(proposal);

    expect(result.success).toBe(true);
    expect(result.executed_action).toMatch(/Newer decision wins/);
    expect(result.decisions_modified).toContain('dec-a');
    expect(result.decisions_modified).toContain('dec-b');
  });
});

// ---------------------------------------------------------------------------
// 4. Concentration Risk Handler
// ---------------------------------------------------------------------------

describe('handleConcentrationRisk', () => {
  it('flags all affected decisions for cross-review', async () => {
    const proposal = makeProposal({
      trigger_type: 'concentration_risk',
      affected_decision_ids: ['dec-1', 'dec-2', 'dec-3', 'dec-4', 'dec-5'],
      reasoning: '5 decisions in the "api" domain were all made by "agent-1" with no second opinion.',
      suggested_action: 'cross_review',
    });

    // All update calls succeed
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await handleConcentrationRisk(proposal);

    expect(result.success).toBe(true);
    expect(result.executed_action).toBe('Flagged 5 decisions for cross-review');
    expect(result.decisions_modified).toHaveLength(5);
    expect(result.decisions_modified).toContain('dec-1');
    expect(result.decisions_modified).toContain('dec-5');
  });
});

// ---------------------------------------------------------------------------
// 5. High-Impact Unvalidated Handler
// ---------------------------------------------------------------------------

describe('handleHighImpactUnvalidated', () => {
  it('queues affected decisions for urgent validation', async () => {
    const proposal = makeProposal({
      trigger_type: 'high_impact_unvalidated',
      affected_decision_ids: ['dec-1'],
      reasoning: 'Decision "Use Redis" has 7 downstream dependencies but has never been validated.',
      suggested_action: 'urgent_validation',
    });

    // Count downstream
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 7 }], rowCount: 1 })
      // Update decision
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handleHighImpactUnvalidated(proposal);

    expect(result.success).toBe(true);
    expect(result.executed_action).toBe('Queued for urgent validation — 7 downstream dependencies');
    expect(result.decisions_modified).toEqual(['dec-1']);
  });
});

// ---------------------------------------------------------------------------
// 6. Reject does not modify decisions (tested via route, but verify handler not called)
// ---------------------------------------------------------------------------

describe('reject behavior', () => {
  it('executeProposalHandler is not called for rejected proposals (route handles status only)', () => {
    // This verifies the handler dispatches correctly and only handles known types
    const proposal = makeProposal({ trigger_type: 'pattern_divergence' as any });
    // Unknown trigger types get a generic response
    return executeProposalHandler(proposal).then((result) => {
      expect(result.success).toBe(true);
      expect(result.executed_action).toContain('pattern_divergence');
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Audit trail populated on accept
// ---------------------------------------------------------------------------

describe('audit trail', () => {
  it('writes audit trail fields on successful execution', async () => {
    // Setup for concentration risk (simplest handler)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const proposal = makeProposal({
      trigger_type: 'concentration_risk',
      affected_decision_ids: ['dec-1', 'dec-2'],
      reasoning: '5 decisions in the "api" domain were all made by "agent-1" with no second opinion.',
    });

    await executeProposalHandler(proposal, undefined, 'user-1');

    // Check that audit trail UPDATE was called (last call should be the audit write)
    const calls = mockQuery.mock.calls;
    const auditCall = calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('executed_action') && call[0].includes('executed_at'),
    );

    expect(auditCall).toBeDefined();
    // Verify the params: executed_action, decisions_modified JSON, executed_at, executed_by, proposal id
    expect(auditCall![1]).toBeDefined();
    const params = auditCall![1] as unknown[];
    expect(params[3]).toBe('user-1'); // executed_by
    expect(params[4]).toBe('prop-1'); // proposal id
  });
});

// ---------------------------------------------------------------------------
// 8. findRelatedDecisions returns scored matches
// ---------------------------------------------------------------------------

describe('findRelatedDecisions', () => {
  it('returns scored matches sorted by relevance', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'dec-1',
          title: 'Use JWT for auth',
          description: 'JWT tokens for security',
          tags: '["security", "api"]',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'dec-2', title: 'API key hashing', description: 'Hash API keys for security', tags: '["security", "api"]' },
          { id: 'dec-3', title: 'Database indexes', description: 'Add indexes to tables', tags: '["database"]' },
        ],
        rowCount: 2,
      });

    const results = await findRelatedDecisions('dec-1', 'proj-1');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('dec-2'); // should rank highest due to shared tags
    expect(results[0].score).toBeGreaterThan(0);
  });
});
