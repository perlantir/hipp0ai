/**
 * Pulse component tests.
 *
 * Mirrors the mocking pattern from hermes-agents.test.tsx:
 *   - useApi and useProject are mocked at module level
 *   - All renders wrapped in act(async () => { ... })
 *   - waitFor for async assertions
 */

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDel = vi.fn();

const mockState = {
  projectId: 'not-a-uuid',
};

// Registry of WS subscriptions so tests can trigger events.
// Keyed by event name → set of callbacks.
const wsSubscribers = new Map<string, Set<(data: unknown) => void>>();
const mockSubscribe = vi.fn((event: string, cb: (data: unknown) => void) => {
  if (!wsSubscribers.has(event)) wsSubscribers.set(event, new Set());
  wsSubscribers.get(event)!.add(cb);
  return () => {
    wsSubscribers.get(event)?.delete(cb);
  };
});

function triggerWsEvent(event: string, data: unknown) {
  const subs = wsSubscribers.get(event);
  if (!subs) return;
  for (const cb of subs) cb(data);
}

vi.mock('../src/hooks/useApi', () => ({
  useApi: () => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    del: mockDel,
    baseUrl: 'http://localhost:3100',
  }),
}));

vi.mock('../src/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connected: 'connected',
    lastEvent: null,
    subscribe: mockSubscribe,
  }),
}));

vi.mock('../src/App', () => ({
  useProject: () => ({ projectId: mockState.projectId, setProjectId: vi.fn() }),
}));

function resetMocks() {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockDel.mockReset();
  mockSubscribe.mockClear();
  wsSubscribers.clear();
  mockGet.mockResolvedValue({ agent_count: 0, active_session_count: 0, recent_sessions: [] });
  mockState.projectId = 'not-a-uuid';
}

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('Pulse', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "Select a project" empty state when projectId is not a UUID', async () => {
    mockState.projectId = 'default';
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Select a project/i)).toBeTruthy();
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('calls /api/hermes/pulse with project_id query on mount', async () => {
    mockState.projectId = VALID_UUID;
    mockGet.mockResolvedValue({
      agent_count: 0,
      active_session_count: 0,
      recent_sessions: [],
    });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        `/api/hermes/pulse?project_id=${encodeURIComponent(VALID_UUID)}&limit=20`,
      );
    });
  });

  it('renders stat cards with counts from the API', async () => {
    mockState.projectId = VALID_UUID;
    mockGet.mockResolvedValue({
      agent_count: 4,
      active_session_count: 2,
      recent_sessions: [
        {
          conversation_id: 'c1',
          session_id: 's1',
          agent_name: 'alice',
          platform: 'telegram',
          external_user_id: '12345',
          external_chat_id: '-100200',
          started_at: new Date(Date.now() - 30_000).toISOString(),
          ended_at: null,
        },
      ],
    });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      expect(screen.getByText('4')).toBeTruthy(); // agent count
      expect(screen.getByText('2')).toBeTruthy(); // active session count
      expect(screen.getByText('alice')).toBeTruthy();
      expect(screen.getByText(/on telegram/i)).toBeTruthy();
      // Badge text is exactly "live" (lowercase span); subtitle contains
      // "Live activity..." which we don't want to match. Use an exact
      // function matcher to pick only the badge span.
      const liveBadges = screen.getAllByText((content, el) =>
        el?.tagName === 'SPAN' && content.trim() === 'live',
      );
      expect(liveBadges).toHaveLength(1);
    });
  });

  it('shows empty-activity card when no sessions exist', async () => {
    mockState.projectId = VALID_UUID;
    mockGet.mockResolvedValue({
      agent_count: 1,
      active_session_count: 0,
      recent_sessions: [],
    });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      expect(screen.getByText(/No sessions yet/i)).toBeTruthy();
    });
  });

  it('renders an error with Retry button on API failure', async () => {
    mockState.projectId = VALID_UUID;
    mockGet.mockRejectedValueOnce({ status: 500, message: 'pulse boom' });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      expect(screen.getByText(/pulse boom/i)).toBeTruthy();
      expect(screen.getByText(/Retry/i)).toBeTruthy();
    });
  });

  it('subscribes to hermes.* WebSocket events on mount', async () => {
    mockState.projectId = VALID_UUID;
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      const subscribed = mockSubscribe.mock.calls.map((c) => c[0]);
      expect(subscribed).toContain('hermes.agent.registered');
      expect(subscribed).toContain('hermes.session.started');
      expect(subscribed).toContain('hermes.session.ended');
    });
  });

  it('refetches pulse when a matching-project WebSocket event fires', async () => {
    mockState.projectId = VALID_UUID;
    mockGet.mockResolvedValue({
      agent_count: 1,
      active_session_count: 0,
      recent_sessions: [],
    });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    // Initial fetch
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    // Fire a session.started event for this project
    await act(async () => {
      triggerWsEvent('hermes.session.started', {
        project_id: VALID_UUID,
        session_id: 's1',
        agent_name: 'alice',
        platform: 'telegram',
      });
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores WebSocket events for a different project', async () => {
    mockState.projectId = VALID_UUID;
    const OTHER_PROJECT = 'b2c3d4e5-f6a7-8901-bcde-f23456789012';
    mockGet.mockResolvedValue({
      agent_count: 1,
      active_session_count: 0,
      recent_sessions: [],
    });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    await act(async () => {
      triggerWsEvent('hermes.session.started', {
        project_id: OTHER_PROJECT,
        session_id: 's1',
        agent_name: 'alice',
        platform: 'telegram',
      });
    });

    // Give any spurious refetch time to land — it should not
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('distinguishes active vs ended sessions', async () => {
    mockState.projectId = VALID_UUID;
    const now = new Date();
    mockGet.mockResolvedValue({
      agent_count: 2,
      active_session_count: 1,
      recent_sessions: [
        {
          conversation_id: 'c1',
          session_id: 's1',
          agent_name: 'alice',
          platform: 'telegram',
          external_user_id: null,
          external_chat_id: null,
          started_at: new Date(now.getTime() - 60_000).toISOString(),
          ended_at: null,
        },
        {
          conversation_id: 'c2',
          session_id: 's2',
          agent_name: 'bob',
          platform: 'web',
          external_user_id: null,
          external_chat_id: null,
          started_at: new Date(now.getTime() - 300_000).toISOString(),
          ended_at: new Date(now.getTime() - 60_000).toISOString(),
        },
      ],
    });
    const { Pulse } = await import('../src/components/Pulse');
    await act(async () => {
      render(<Pulse />);
    });
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
      expect(screen.getByText('bob')).toBeTruthy();
      // Only alice (the active one) should have a "live" badge; the subtitle
      // contains "Live activity..." so we scope the match to exact-text span
      // elements only.
      const liveBadges = screen.getAllByText((content, el) =>
        el?.tagName === 'SPAN' && content.trim() === 'live',
      );
      expect(liveBadges).toHaveLength(1);
    });
  });
});
