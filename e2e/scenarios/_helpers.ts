/**
 * Shared helpers for E2E scenarios.
 * Not matched by the vitest include glob (only *.e2e.ts are picked up).
 */
import { readFileSync, existsSync } from 'node:fs';

export const BASE = process.env.HIPP0_BASE_URL ?? 'http://localhost:3001';

export interface SeedShape {
  base_url: string;
  project_id: string;
  agents: Record<string, string>;
  decisions: string[];
  entities: string[];
  outcomes: string[];
  contradictions: string[];
}

export function loadSeed(): SeedShape | null {
  const path = process.env.HIPP0_SEED_FILE;
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SeedShape;
}

export async function fetchJson<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function serverReachable(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) throw new Error(`health returned ${res.status}`);
  } catch (err) {
    throw new Error(
      `Server not reachable at ${BASE}: ${(err as Error).message}. Run e2e/run-e2e.sh first.`,
    );
  }
}

export function requireSeed(): SeedShape {
  const seed = loadSeed();
  if (!seed) {
    throw new Error(
      `HIPP0_SEED_FILE not set or file missing. Run e2e/seed.ts first.`,
    );
  }
  return seed;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
