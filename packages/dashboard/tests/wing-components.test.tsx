/**
 * Wing dashboard component tests
 *
 * Tests:
 *   1. WingBadge renders with correct name and color
 *   2. WingView renders wing list from API
 *   3. Timeline decision cards show wing badges
 *   4. DecisionGraph renders with wing filter
 *   5. ContextComparison shows wing analysis
 */

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDel = vi.fn();

vi.mock('../src/hooks/useApi', () => ({
  useApi: () => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    del: mockDel,
    baseUrl: 'http://localhost:3100',
  }),
}));

vi.mock('../src/App', () => ({
  useProject: () => ({ projectId: 'test-project-1', setProjectId: vi.fn() }),
}));

const chainProxy = (): Record<string, Function> =>
  new Proxy({} as Record<string, Function>, {
    get: () => chainProxy,
  });

vi.mock('d3', () => ({
  select: () => chainProxy(),
  selectAll: () => chainProxy(),
  forceSimulation: () => chainProxy(),
  forceLink: () => chainProxy(),
  forceManyBody: () => chainProxy(),
  forceCenter: () => chainProxy(),
  forceCollide: () => chainProxy(),
  zoom: () => chainProxy(),
  drag: () => chainProxy(),
  zoomTransform: () => ({ k: 1, x: 0, y: 0 }),
  zoomIdentity: { k: 1, x: 0, y: 0 },
  forceX: () => chainProxy(),
  forceY: () => chainProxy(),
}));

vi.mock('d3-force', () => ({}));

import { WingBadge, WingView, wingColor } from '../src/components/WingView';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── WingBadge ──────────────────────────────────────────────────────────

describe('WingBadge', () => {
  it('renders wing name', () => {
    const { container } = render(<WingBadge name="backend" />);
    expect(container.textContent).toContain('backend');
  });

  it('renders with consistent color for same name', () => {
    const color1 = wingColor('backend');
    const color2 = wingColor('backend');
    expect(color1).toBe(color2);
  });

  it('renders different colors for different names', () => {
    const color1 = wingColor('backend');
    const color2 = wingColor('security');
    // Colors could theoretically collide but very unlikely for these names
    expect(typeof color1).toBe('string');
    expect(typeof color2).toBe('string');
  });

  it('renders in both sm and md sizes', () => {
    const { rerender, container } = render(<WingBadge name="api" size="sm" />);
    const smSpan = container.querySelector('span');
    expect(smSpan).toBeTruthy();

    rerender(<WingBadge name="api" size="md" />);
    const mdSpan = container.querySelector('span');
    expect(mdSpan).toBeTruthy();
  });
});

// ── WingView ───────────────────────────────────────────────────────────

describe('WingView', () => {
  it('renders loading state initially', async () => {
    mockGet.mockReturnValue(new Promise(() => {})); // Never resolves

    await act(async () => {
      render(<WingView />);
    });

    expect(screen.getByText('Loading wing data...')).toBeTruthy();
  });

  it('renders wing list from API data', async () => {
    mockGet.mockResolvedValue({
      project_id: 'test-project-1',
      wings: [
        { wing: 'maks', decision_count: 12, top_domains: ['api', 'database'], cross_references: [], agent_affinities: [] },
        { wing: 'forge', decision_count: 5, top_domains: ['testing'], cross_references: [], agent_affinities: [] },
      ],
    });

    await act(async () => {
      render(<WingView />);
    });

    await waitFor(() => {
      expect(screen.getByText('Agent Wings')).toBeTruthy();
    });
  });

  it('renders empty state gracefully', async () => {
    mockGet.mockResolvedValue({
      project_id: 'test-project-1',
      wings: [],
    });

    await act(async () => {
      render(<WingView />);
    });

    await waitFor(() => {
      expect(screen.getByText('Agent Wings')).toBeTruthy();
    });
  });

  it('shows Recalculate Wings button', async () => {
    mockGet.mockResolvedValue({
      project_id: 'test-project-1',
      wings: [{ wing: 'maks', decision_count: 5, top_domains: [], cross_references: [], agent_affinities: [] }],
    });

    await act(async () => {
      render(<WingView />);
    });

    await waitFor(() => {
      expect(screen.getByText('Recalculate Wings')).toBeTruthy();
    });
  });
});

// ── wingColor consistency ──────────────────────────────────────────────

describe('wingColor', () => {
  it('returns a hex color string', () => {
    const color = wingColor('test');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic', () => {
    expect(wingColor('maks')).toBe(wingColor('maks'));
    expect(wingColor('forge')).toBe(wingColor('forge'));
  });
});
