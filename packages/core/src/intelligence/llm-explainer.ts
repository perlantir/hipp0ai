/**
 * LLM Explanation Layer — rewrites deterministic contrastive explanations
 * into human-friendly prose. The deterministic output from
 * `contrastive-explainer.ts` is correct but terse ("Direct Affect (0.30 vs
 * 0.00) - you're in the affects list"). This module wraps an LLM call
 * around that text to produce something more readable, like:
 *
 *   "It ranked higher because builder is in the affects list and the tags
 *    line up more closely with the task you asked about."
 *
 * Design goals:
 *   - ALWAYS deterministic fallback — if the LLM call fails, we return
 *     the input text unchanged. Callers never have to handle errors.
 *   - In-memory LRU cache keyed by (text, decisionA.title, decisionB.title)
 *     to avoid re-billing the exact same rewrite twice.
 *   - Lightweight model by default (gpt-4o-mini / claude-3-5-haiku).
 *   - Budget check before each call; cost tracking after.
 *
 * This module is called opt-in from the compile route (only when the
 * client passes ?explain=true&pretty=true) and must never run in the
 * hot path for plain compile requests.
 */

import crypto from 'node:crypto';
import { resolveLLMConfig, createLLMClient, type LLMEndpoint } from '../config/llm.js';
import { recordLLMCall, checkBudget } from './cost-tracker.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LLMExplainerOptions {
  /** Override the auto-detected provider. Usually left unset. */
  provider?: 'openai' | 'anthropic';
  /** Override the configured model. Defaults to gpt-4o-mini / claude-3-5-haiku. */
  model?: string;
  /** Whether to read/write the in-memory cache. Default true. */
  cache?: boolean;
  /**
   * Project id for budget + cost tracking. When omitted, the LLM call
   * still happens but won't be tracked against a project's budget.
   */
  projectId?: string;
}

export interface ExplanationContext {
  decisionA: { title: string };
  decisionB: { title: string };
  agentName: string;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/* ------------------------------------------------------------------ */
/*  In-memory LRU cache                                                */
/* ------------------------------------------------------------------ */

const CACHE_MAX = 512;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const cache = new Map<string, CacheEntry>();

function cacheKey(text: string, ctx: ExplanationContext): string {
  const h = crypto
    .createHash('sha256')
    .update(text)
    .update('|')
    .update(ctx.decisionA.title ?? '')
    .update('|')
    .update(ctx.decisionB.title ?? '')
    .update('|')
    .update(ctx.agentName ?? '')
    .digest('hex');
  return h.slice(0, 32);
}

function getCached(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // LRU bump: delete & reinsert so iteration order tracks recency.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCached(key: string, value: string): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

/** Exposed for tests. */
export function __clearLLMExplainerCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT =
  'You rewrite terse algorithmic explanations into friendly, one-sentence ' +
  'prose for developers. Never add new facts, never contradict the input, ' +
  'never mention scores or numbers unless they appeared in the input. ' +
  'Keep replies under 40 words, conversational, and confident.';

function buildUserPrompt(text: string, ctx: ExplanationContext): string {
  const agent = ctx.agentName || 'the agent';
  const a = ctx.decisionA.title || 'decision A';
  const b = ctx.decisionB.title || 'decision B';
  return [
    `Explain in one sentence why decision A ranked higher than B for agent ${agent}.`,
    `Decision A: "${a}"`,
    `Decision B: "${b}"`,
    `Facts: ${text}`,
    'Keep under 40 words, conversational.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/*  Model selection                                                    */
/* ------------------------------------------------------------------ */

/** Map a provider to a lightweight default model. */
function defaultModelFor(provider: 'openai' | 'anthropic' | string): string {
  if (provider === 'anthropic') return 'claude-3-5-haiku-latest';
  return 'gpt-4o-mini';
}

/** Approximate token count for usage fallback. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface LLMCallResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  provider: string;
  model: string;
}

const LLM_TIMEOUT_MS = 15_000;

async function callLLM(
  endpoint: LLMEndpoint,
  modelOverride: string | undefined,
  system: string,
  user: string,
): Promise<LLMCallResult> {
  const model = modelOverride || endpoint.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    if (endpoint.url === '__anthropic_sdk__') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: endpoint.key });
      const response = await client.messages.create(
        {
          model,
          max_tokens: 200,
          system,
          messages: [{ role: 'user', content: user }],
        },
        { signal: controller.signal },
      );
      const block = response.content[0];
      const text = block?.type === 'text' ? block.text : '';
      const usage = response.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      return {
        text,
        input_tokens: usage?.input_tokens ?? estimateTokens(system + user),
        output_tokens: usage?.output_tokens ?? estimateTokens(text),
        provider: 'anthropic',
        model,
      };
    }

    // OpenAI-compatible (OpenRouter, OpenAI, Groq, Ollama, etc.)
    const client = createLLMClient(endpoint);
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 200,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { signal: controller.signal },
    );
    const text = response.choices[0]?.message?.content ?? '';
    const usage = response.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    const normalizedProvider = endpoint.url.includes('openrouter.ai')
      ? 'openrouter'
      : endpoint.url.includes('openai.com')
        ? 'openai'
        : endpoint.provider;
    return {
      text,
      input_tokens: usage?.prompt_tokens ?? estimateTokens(system + user),
      output_tokens: usage?.completion_tokens ?? estimateTokens(text),
      provider: normalizedProvider,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

function cleanupLLMText(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Public API: rewriteExplanation                                     */
/* ------------------------------------------------------------------ */

/**
 * Rewrite a deterministic contrastive explanation into one friendly
 * sentence. Returns the original text unchanged when:
 *   - No LLM provider is configured
 *   - The project is over its daily budget
 *   - The LLM call fails or returns empty output
 *
 * This function never throws.
 */
export async function rewriteExplanation(
  deterministicText: string,
  context: ExplanationContext,
  options: LLMExplainerOptions = {},
): Promise<string> {
  const input = (deterministicText ?? '').trim();
  if (!input) return input;

  const useCache = options.cache !== false;
  const key = cacheKey(input, context);

  if (useCache) {
    const hit = getCached(key);
    if (hit) return hit;
  }

  try {
    const endpoint = resolveLLMConfig().distillery;
    if (!endpoint) {
      // No LLM configured — fall back silently.
      return input;
    }

    // Budget check (fails open on tracker errors).
    if (options.projectId) {
      try {
        const budget = await checkBudget(options.projectId);
        if (!budget.allowed) {
          console.warn(
            '[hipp0:llm-explainer] Skipping LLM call: budget exhausted',
            { project: options.projectId, reason: budget.reason },
          );
          return input;
        }
      } catch {
        /* ignore — fail open */
      }
    }

    // Pick a lightweight default model unless caller specified one.
    const modelOverride =
      options.model ??
      (options.provider ? defaultModelFor(options.provider) : undefined);

    const user = buildUserPrompt(input, context);
    const result = await callLLM(endpoint, modelOverride, SYSTEM_PROMPT, user);
    const rewritten = cleanupLLMText(result.text);
    if (!rewritten) return input;

    // Fire-and-forget cost tracking.
    if (options.projectId) {
      recordLLMCall(options.projectId, {
        provider: result.provider,
        model: result.model,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        operation: 'llm_explainer.rewrite',
      }).catch(() => {});
    }

    if (useCache) setCached(key, rewritten);
    return rewritten;
  } catch (err) {
    console.warn(
      '[hipp0:llm-explainer] rewriteExplanation failed, falling back:',
      (err as Error).message,
    );
    return input;
  }
}

/**
 * Batch helper: rewrite many deterministic explanations at once. This is
 * a thin wrapper around `rewriteExplanation` that runs the calls in
 * parallel and guarantees a stable output order. Errors on individual
 * items fall back to the original text without affecting the rest.
 */
export async function rewriteExplanationsBatch(
  items: Array<{ text: string; context: ExplanationContext }>,
  options: LLMExplainerOptions = {},
): Promise<string[]> {
  if (items.length === 0) return [];
  const results = await Promise.all(
    items.map((item) =>
      rewriteExplanation(item.text, item.context, options).catch(
        () => item.text,
      ),
    ),
  );
  return results;
}
