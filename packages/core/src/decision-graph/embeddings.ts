import { resolveLLMConfig, createLLMClient } from '../config/llm.js';
import type { LLMEndpoint } from '../config/llm.js';
import type OpenAI from 'openai';
import {
  generateLocalEmbedding,
  isLocalEmbeddingReady,
} from './local-embeddings.js';

const EMBEDDING_DIM = 1536;

let _client: OpenAI | null = null;
let _endpoint: LLMEndpoint | null | undefined;

function getEmbeddingClient(): { client: OpenAI; model: string } | null {
  if (_endpoint === undefined) {
    _endpoint = resolveLLMConfig().embeddings;
  }
  if (!_endpoint) return null;
  if (!_client) {
    _client = createLLMClient(_endpoint);
  }
  return { client: _client, model: _endpoint.model };
}

type Provider = 'openai' | 'local' | 'auto';

function resolveProvider(): Provider {
  const p = (process.env.HIPP0_EMBEDDING_PROVIDER ?? '').toLowerCase();
  if (p === 'local' || p === 'openai' || p === 'auto') return p;
  // Legacy switch — any value sets fallback mode.
  if ((process.env.HIPP0_EMBEDDING_FALLBACK ?? '').toLowerCase() === 'local') {
    return 'auto';
  }
  return 'openai';
}

async function tryLocal(text: string): Promise<number[] | null> {
  try {
    const ready = await isLocalEmbeddingReady();
    if (!ready) return null;
    const vec = await generateLocalEmbedding(text);
    console.warn('[hipp0:embeddings] used provider=local');
    return vec;
  } catch (err) {
    console.warn(
      '[hipp0:embeddings] Local fallback failed:',
      (err as Error)?.message ?? err,
    );
    return null;
  }
}

async function tryOpenAI(text: string): Promise<number[] | null> {
  const ctx = getEmbeddingClient();
  if (!ctx) return null;

  try {
    const response = await ctx.client.embeddings.create({
      model: ctx.model,
      input: text.slice(0, 8191),
    });
    const vec = response.data[0]?.embedding;
    if (!vec) return null;
    console.warn('[hipp0:embeddings] used provider=openai');
    return vec;
  } catch (err) {
    console.warn(
      '[hipp0:embeddings] OpenAI request failed:',
      (err as Error)?.message ?? err,
    );
    return null;
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = resolveProvider();

  // Explicit local mode — skip OpenAI entirely.
  if (provider === 'local') {
    const local = await tryLocal(text);
    if (local) return local;
    console.warn(
      '\n⚠️  [hipp0:embeddings] HIPP0_EMBEDDING_PROVIDER=local but no local model available.',
    );
    console.warn('    Install @xenova/transformers to enable the local fallback.\n');
    return new Array(EMBEDDING_DIM).fill(0) as number[];
  }

  // OpenAI-first (default and auto share this path)
  const openai = await tryOpenAI(text);
  if (openai) return openai;

  // On failure, try local fallback if auto mode or fallback env flag set.
  if (
    provider === 'auto' ||
    (process.env.HIPP0_EMBEDDING_FALLBACK ?? '').toLowerCase() === 'local'
  ) {
    const local = await tryLocal(text);
    if (local) return local;
  }

  // No provider yielded a vector — emit the legacy warning + zero vector.
  console.warn('\n⚠️  [hipp0:embeddings] No embedding provider available — returning zero-vector!');
  console.warn('    Set OPENAI_API_KEY or HIPP0_EMBEDDINGS_URL in .env to enable semantic search.');
  console.warn('    Or set HIPP0_EMBEDDING_PROVIDER=local and install @xenova/transformers.');
  console.warn('    Without embeddings, context compilation cannot differentiate by semantic similarity.\n');
  return new Array(EMBEDDING_DIM).fill(0) as number[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
