/**
 * Auto-classification for decisions — assigns domain, category based on
 * keyword matching against tags, title, and description. No LLM calls.
 */
import type { DecisionDomain, DecisionCategory, DecisionSource, ConfidenceLevel } from '../types.js';

  // Domain keyword map

const DOMAIN_KEYWORDS: Record<DecisionDomain, string[]> = {
  authentication: ['auth', 'jwt', 'oauth', 'session', 'login', 'password', 'token'],
  database: ['db', 'postgres', 'sql', 'migration', 'schema', 'query', 'index', 'mysql', 'sqlite', 'pgvector'],
  frontend: ['ui', 'css', 'react', 'component', 'layout', 'design', 'tailwind', 'frontend', 'vite', 'jsx', 'tsx'],
  infrastructure: ['deploy', 'docker', 'ci', 'cd', 'nginx', 'ssl', 'server', 'vps', 'kubernetes', 'k8s', 'helm'],
  testing: ['test', 'e2e', 'unit', 'coverage', 'vitest', 'jest', 'playwright', 'cypress'],
  security: ['security', 'encryption', 'rbac', 'cors', 'xss', 'csrf', 'audit', 'vulnerability'],
  api: ['api', 'endpoint', 'rest', 'graphql', 'route', 'middleware', 'hono'],
  collaboration: ['websocket', 'collab', 'real-time', 'presence', 'realtime'],
  general: [],
};

  // Category patterns

const REJECTED_PATTERNS = ['rejected', 'considered', 'alternative', 'instead of'];
const TOOL_CHOICE_PATTERNS = ['use', 'switch to', 'adopt', 'migrate to'];
const CONVENTION_PATTERNS = ['convention', 'standard', 'rule', 'policy', 'guideline'];
const ARCHITECTURE_PATTERNS = ['architecture', 'chose', 'decided', 'approach', 'design pattern'];

  // Public API

export interface ClassificationResult {
  domain: DecisionDomain;
  category: DecisionCategory;
}

/**
 * Classify a decision into domain + category based on keywords.
 * Checks tags first (exact match), then title/description (substring).
 * Pure function — no LLM calls, instant and free.
 */
export function classifyDecision(
  title: string,
  description: string,
  tags: string[],
  options?: {
    source?: DecisionSource;
    confidence?: ConfidenceLevel;
  },
): ClassificationResult {
  const domain = classifyDomain(title, description, tags);
  const category = classifyCategory(title, description, tags, domain, options);
  return { domain, category };
}

/**
 * Infer the domain from a task description (for compile-time domain boosting).
 * Returns null if no clear match.
 */
export function inferDomainFromTask(taskDescription: string): DecisionDomain | null {
  const textLower = taskDescription.toLowerCase();
  let bestDomain: DecisionDomain | null = null;
  let bestCount = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[DecisionDomain, string[]]>) {
    if (domain === 'general') continue;
    const hits = keywords.filter((kw) => textLower.includes(kw)).length;
    if (hits > bestCount) {
      bestCount = hits;
      bestDomain = domain;
    }
  }

  return bestCount > 0 ? bestDomain : null;
}

  // Internal helpers

function classifyDomain(title: string, description: string, tags: string[]): DecisionDomain {
  const tagsLower = tags.map((t) => t.toLowerCase());
  const textLower = `${title} ${description}`.toLowerCase();

  // Check tags first (higher signal)
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[DecisionDomain, string[]]>) {
    if (domain === 'general') continue;
    if (keywords.some((kw) => tagsLower.includes(kw))) {
      return domain;
    }
  }

  // Fall back to title/description substring match
  let bestDomain: DecisionDomain = 'general';
  let bestCount = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[DecisionDomain, string[]]>) {
    if (domain === 'general') continue;
    const hits = keywords.filter((kw) => textLower.includes(kw)).length;
    if (hits > bestCount) {
      bestCount = hits;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

function classifyCategory(
  title: string,
  description: string,
  tags: string[],
  domain: DecisionDomain,
  options?: { source?: DecisionSource; confidence?: ConfidenceLevel },
): DecisionCategory {
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const tagsLower = tags.map((t) => t.toLowerCase());
  const combined = `${titleLower} ${descLower}`;

  // Check rejected-alternative first (most specific)
  if (REJECTED_PATTERNS.some((p) => titleLower.includes(p))) {
    return 'rejected-alternative';
  }

  // Architecture: imported source or architecture keywords
  if (options?.source === 'imported' || ARCHITECTURE_PATTERNS.some((p) => combined.includes(p))) {
    return 'architecture';
  }

  // Tool-choice: tags contain "tool" or title contains tool-choice patterns
  if (tagsLower.includes('tool') || TOOL_CHOICE_PATTERNS.some((p) => titleLower.includes(p))) {
    return 'tool-choice';
  }

  // Convention
  if (CONVENTION_PATTERNS.some((p) => combined.includes(p))) {
    return 'convention';
  }

  // Security-policy: high confidence + security domain
  if (options?.confidence === 'high' && domain === 'security') {
    return 'security-policy';
  }

  return 'decision';
}
