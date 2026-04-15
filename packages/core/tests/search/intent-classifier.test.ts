import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../src/search/intent-classifier.js';

describe('classifyIntent', () => {
  it('classifies temporal queries', () => {
    expect(classifyIntent('what did we decide last month')).toBe('temporal');
    expect(classifyIntent('decisions from this sprint')).toBe('temporal');
    expect(classifyIntent('what changed since March')).toBe('temporal');
  });

  it('classifies entity queries', () => {
    expect(classifyIntent('tell me about Jane Doe')).toBe('entity');
    expect(classifyIntent('who is John Smith')).toBe('entity');
  });

  it('classifies decision queries', () => {
    expect(classifyIntent('what was decided about the database')).toBe('decision');
    expect(classifyIntent('why did we choose PostgreSQL')).toBe('decision');
    expect(classifyIntent('rationale for using Redis')).toBe('decision');
  });

  it('defaults to general', () => {
    expect(classifyIntent('authentication')).toBe('general');
    expect(classifyIntent('setup')).toBe('general');
  });
});
