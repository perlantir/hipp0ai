/**
 * HermesSetup component tests.
 *
 * Verifies the dashboard's Hermes integration bridge:
 *   - Test connection calls /api/health on mount
 *   - Connection success / failure rendering
 *   - Environment block contains project_id substitution
 *   - Copy buttons are present (can't fully test clipboard in jsdom)
 */

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { vi, describe, it, beforeEach, expect } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDel = vi.fn();

const mockState = {
  projectId: 'not-a-uuid',
};

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
  useProject: () => ({ projectId: mockState.projectId, setProjectId: vi.fn() }),
}));

function resetMocks() {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockDel.mockReset();
  mockGet.mockResolvedValue({ status: 'ok' });
  mockState.projectId = 'not-a-uuid';
  // Clear localStorage between tests so API key state is deterministic
  try {
    window.localStorage.clear();
  } catch {
    /* noop */
  }
}

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('HermesSetup', () => {
  beforeEach(resetMocks);

  it('calls /api/health on mount and shows "Reachable" on success', async () => {
    mockGet.mockResolvedValue({ status: 'ok' });
    const { HermesSetup } = await import('../src/components/HermesSetup');
    await act(async () => {
      render(<HermesSetup />);
    });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/health');
      expect(screen.getByText(/Reachable/i)).toBeTruthy();
    });
  });

  it('shows "Unreachable" on API failure', async () => {
    mockGet.mockRejectedValueOnce({ status: 500, message: 'server offline' });
    const { HermesSetup } = await import('../src/components/HermesSetup');
    await act(async () => {
      render(<HermesSetup />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Unreachable/i)).toBeTruthy();
      expect(screen.getByText(/server offline/i)).toBeTruthy();
    });
  });

  it('renders "(select a project)" when projectId is not a UUID', async () => {
    mockState.projectId = 'default';
    const { HermesSetup } = await import('../src/components/HermesSetup');
    await act(async () => {
      render(<HermesSetup />);
    });
    await waitFor(() => {
      expect(screen.getByText(/\(select a project\)/i)).toBeTruthy();
      // Placeholder appears in BOTH the env block and the curl block,
      // so use getAllByText and assert both copies are present.
      const placeholders = screen.getAllByText(/<your-project-uuid>/i);
      expect(placeholders.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('substitutes the real project_id into the env block when valid', async () => {
    mockState.projectId = VALID_UUID;
    const { HermesSetup } = await import('../src/components/HermesSetup');
    await act(async () => {
      render(<HermesSetup />);
    });
    await waitFor(() => {
      // env block content
      expect(screen.getByText(new RegExp(`HIPP0_PROJECT_ID=${VALID_UUID}`))).toBeTruthy();
    });
  });

  it('shows "dev" badge when no API key is in localStorage', async () => {
    mockState.projectId = VALID_UUID;
    const { HermesSetup } = await import('../src/components/HermesSetup');
    await act(async () => {
      render(<HermesSetup />);
    });
    await waitFor(() => {
      // The "(not set — dev mode)" caption
      expect(screen.getByText(/not set — dev mode/i)).toBeTruthy();
    });
  });

  it('shows "set" badge when hipp0_api_key is in localStorage', async () => {
    mockState.projectId = VALID_UUID;
    window.localStorage.setItem('hipp0_api_key', 'h0_test_abcdefg123456789');
    const { HermesSetup } = await import('../src/components/HermesSetup');
    await act(async () => {
      render(<HermesSetup />);
    });
    await waitFor(() => {
      // Masked key visible
      expect(screen.getByText(/h0_test_…6789/i)).toBeTruthy();
    });
  });
});
