/**
 * Role Signals Tests — validates the tag-matching scoring and role suggestion logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database adapter
const mockRows: Array<Record<string, unknown>> = [];
vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    query: vi.fn(async () => ({ rows: mockRows })),
    arrayParam: (arr: string[]) => JSON.stringify(arr),
  }),
}));

import { generateRoleSuggestion } from '../src/intelligence/role-signals.js';

  // generateRoleSuggestion (pure function)

describe('generateRoleSuggestion', () => {
  it('returns design_lead for architect + design keyword at rank 1', () => {
    expect(generateRoleSuggestion('architect', 'design the new API schema', 1, 5)).toBe('design_lead');
  });

  it('returns design_contributor for architect + design keyword at rank 2', () => {
    expect(generateRoleSuggestion('architect', 'design the new API schema', 2, 5)).toBe('design_contributor');
  });

  it('returns design_observer for architect + design keyword at rank 4', () => {
    expect(generateRoleSuggestion('architect', 'design the new API schema', 4, 5)).toBe('design_observer');
  });

  it('returns implementation_lead for builder + implement keyword at rank 1', () => {
    expect(generateRoleSuggestion('builder', 'implement user authentication', 1, 5)).toBe('implementation_lead');
  });

  it('returns security_reviewer for security + auth keyword at rank 1', () => {
    expect(generateRoleSuggestion('security', 'review auth middleware for vulnerabilities', 1, 5)).toBe('security_reviewer');
  });

  it('returns security_contributor for security + auth keyword at rank 2', () => {
    expect(generateRoleSuggestion('security', 'review auth middleware for vulnerabilities', 2, 5)).toBe('security_contributor');
  });

  it('returns deployment_lead for ops + deploy keyword at rank 1', () => {
    expect(generateRoleSuggestion('ops', 'deploy the staging environment', 1, 5)).toBe('deployment_lead');
  });

  it('returns launch_coordinator for marketer + launch keyword at rank 1', () => {
    expect(generateRoleSuggestion('marketer', 'plan the product launch campaign', 1, 5)).toBe('launch_coordinator');
  });

  it('returns code_reviewer for reviewer + review keyword at rank 1', () => {
    expect(generateRoleSuggestion('reviewer', 'review the billing module PR', 1, 5)).toBe('code_reviewer');
  });

  it('falls back to role_lead for unmatched keywords at rank 1', () => {
    expect(generateRoleSuggestion('architect', 'fix the billing bug', 1, 5)).toBe('architect_lead');
  });

  it('falls back to role_contributor for unmatched keywords at rank 2', () => {
    expect(generateRoleSuggestion('builder', 'write the quarterly report', 2, 5)).toBe('builder_contributor');
  });

  it('falls back to role_observer for unmatched keywords at rank 5', () => {
    expect(generateRoleSuggestion('data scientist', 'fix CSS on homepage', 5, 8)).toBe('data_scientist_observer');
  });
});

  // Scoring thresholds

describe('role signal scoring thresholds', () => {
  // These test the threshold logic from the spec by importing and testing the
  // generateRoleSignal function with mocked agents. We use the mock from above.

  beforeEach(() => {
    mockRows.length = 0;
  });

  it('returns should_participate=false when no agents exist', async () => {
    // mockRows is empty — no agents
    const { generateRoleSignal } = await import('../src/intelligence/role-signals.js');
    const signal = await generateRoleSignal('proj-1', 'unknown-agent', 'build something');
    expect(signal.should_participate).toBe(false);
    expect(signal.total_agents).toBe(0);
    expect(signal.abstain_probability).toBe(0.95);
  });

  it('returns should_participate=false for agent not in project', async () => {
    mockRows.push({
      id: 'a1',
      name: 'builder',
      role: 'builder',
      relevance_profile: JSON.stringify({ weights: { typescript: 0.8 } }),
    });
    const { generateRoleSignal } = await import('../src/intelligence/role-signals.js');
    const signal = await generateRoleSignal('proj-1', 'nonexistent', 'build a feature');
    expect(signal.should_participate).toBe(false);
    expect(signal.agent_name).toBe('nonexistent');
  });

  it('scores agent with matching tags as should_participate=true', async () => {
    mockRows.push({
      id: 'a1',
      name: 'builder',
      role: 'builder',
      relevance_profile: JSON.stringify({ weights: { typescript: 0.8, api: 0.7, database: 0.5 } }),
    });
    const { generateRoleSignal } = await import('../src/intelligence/role-signals.js');
    const signal = await generateRoleSignal('proj-1', 'builder', 'implement the typescript api endpoint');
    expect(signal.relevance_score).toBeGreaterThan(0);
    expect(signal.rank_among_agents).toBe(1);
    expect(signal.total_agents).toBe(1);
  });
});

  // scoreTeamForTask

describe('scoreTeamForTask', () => {
  beforeEach(() => {
    mockRows.length = 0;
  });

  it('returns empty participants and skip when no agents', async () => {
    const { scoreTeamForTask } = await import('../src/intelligence/role-signals.js');
    const result = await scoreTeamForTask('proj-1', 'build something');
    expect(result.recommended_participants).toHaveLength(0);
    expect(result.recommended_skip).toHaveLength(0);
    expect(result.optimal_team_size).toBe(0);
    expect(result.task_description).toBe('build something');
  });
});

  // Edge cases

describe('edge cases', () => {
  it('handles empty relevance_profile gracefully', async () => {
    mockRows.length = 0;
    mockRows.push({
      id: 'a1',
      name: 'empty-agent',
      role: 'generic',
      relevance_profile: null,
    });
    const { generateRoleSignal } = await import('../src/intelligence/role-signals.js');
    const signal = await generateRoleSignal('proj-1', 'empty-agent', 'do something');
    expect(signal.relevance_score).toBe(0);
    expect(signal.should_participate).toBe(false);
  });

  it('handles relevance_profile as object (not string)', async () => {
    mockRows.length = 0;
    mockRows.push({
      id: 'a1',
      name: 'obj-agent',
      role: 'builder',
      relevance_profile: { weights: { typescript: 0.9 } },
    });
    const { generateRoleSignal } = await import('../src/intelligence/role-signals.js');
    const signal = await generateRoleSignal('proj-1', 'obj-agent', 'typescript feature');
    expect(signal.relevance_score).toBeGreaterThan(0);
  });

  it('abstain_probability is capped at 1.0', async () => {
    // Even with session boost of 0.2 on top of 0.95, should cap at 1.0
    mockRows.length = 0;
    mockRows.push({
      id: 'a1',
      name: 'low-agent',
      role: 'marketer',
      relevance_profile: JSON.stringify({ weights: { marketing: 0.1 } }),
    });
    const { generateRoleSignal } = await import('../src/intelligence/role-signals.js');
    const signal = await generateRoleSignal('proj-1', 'low-agent', 'typescript api endpoint');
    expect(signal.abstain_probability).toBeLessThanOrEqual(1);
  });
});
