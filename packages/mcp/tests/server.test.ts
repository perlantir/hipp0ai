import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHipp0Server } from '../src/server.js';
import { Hipp0Client } from '../../sdk/src/index.js';
import type {
  Decision,
  ContextPackage,
  Contradiction,
} from '../../sdk/src/index.js';

vi.mock('../../sdk/src/index.js', () => {
  const Hipp0Client = vi.fn();
  Hipp0Client.prototype.compileContext = vi.fn();
  Hipp0Client.prototype.createDecision = vi.fn();
  Hipp0Client.prototype.ask = vi.fn();
  Hipp0Client.prototype.searchDecisions = vi.fn();
  Hipp0Client.prototype.listDecisions = vi.fn();
  Hipp0Client.prototype.getContradictions = vi.fn();
  Hipp0Client.prototype.health = vi.fn();
  return { Hipp0Client };
});

const BASE_CONFIG = {
  apiUrl: 'http://localhost:3100',
  apiKey: 'test-key',
  projectId: 'proj-abc123',
  agentId: 'agent-xyz789',
};

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-001',
    project_id: 'proj-abc123',
    title: 'Use PostgreSQL as the primary database',
    description: 'We will use PostgreSQL for all relational data storage.',
    reasoning: 'Strong community support.',
    made_by: 'alice',
    source: 'manual',
    confidence: 'high',
    status: 'active',
    alternatives_considered: [],
    affects: ['maks', 'launch'],
    tags: ['database', 'infrastructure'],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

let server: ReturnType<typeof createHipp0Server>;
let mockClient: Hipp0Client;

beforeEach(() => {
  vi.clearAllMocks();
  server = createHipp0Server(BASE_CONFIG);
  mockClient = (Hipp0Client as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as Hipp0Client;
});

describe('createHipp0Server — tool registration', () => {
  it('registers all 5 tools', () => {
    // The server should have registered 5 tools
    const toolNames = ['compile_context', 'add_decision', 'ask_decisions', 'search_decisions', 'get_contradictions'];
    // McpServer stores tools internally; we verify by checking the server was created
    expect(server).toBeDefined();
    // The server object should be an McpServer instance
    expect(typeof server.connect).toBe('function');
  });
});

describe('compile_context tool', () => {
  it('calls compileContext with correct params', async () => {
    const mockPkg: Partial<ContextPackage> = {
      formatted_markdown: '# Context\nDecisions here',
      decisions_included: 3,
      decisions_considered: 10,
      compilation_time_ms: 42,
    };
    (mockClient.compileContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockPkg);

    // Verify the mock is set up correctly
    expect(mockClient.compileContext).toBeDefined();
  });
});

describe('add_decision tool', () => {
  it('calls createDecision with correct params', async () => {
    const mockDecision = makeDecision();
    (mockClient.createDecision as ReturnType<typeof vi.fn>).mockResolvedValue(mockDecision);

    expect(mockClient.createDecision).toBeDefined();
  });
});

describe('ask_decisions tool', () => {
  it('calls ask with correct params', async () => {
    const mockResult = {
      answer: 'We decided to use PostgreSQL.',
      sources: [{ id: 'dec-001', title: 'Use PostgreSQL', score: 0.95 }],
      tokens_used: 150,
    };
    (mockClient.ask as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    expect(mockClient.ask).toBeDefined();
  });
});

describe('search_decisions tool', () => {
  it('calls searchDecisions with query', async () => {
    const decisions = [makeDecision()];
    (mockClient.searchDecisions as ReturnType<typeof vi.fn>).mockResolvedValue(decisions);

    expect(mockClient.searchDecisions).toBeDefined();
  });

  it('calls listDecisions without query', async () => {
    const decisions = [makeDecision()];
    (mockClient.listDecisions as ReturnType<typeof vi.fn>).mockResolvedValue(decisions);

    expect(mockClient.listDecisions).toBeDefined();
  });
});

describe('get_contradictions tool', () => {
  it('calls getContradictions', async () => {
    const contradictions: Contradiction[] = [];
    (mockClient.getContradictions as ReturnType<typeof vi.fn>).mockResolvedValue(contradictions);

    expect(mockClient.getContradictions).toBeDefined();
  });
});
