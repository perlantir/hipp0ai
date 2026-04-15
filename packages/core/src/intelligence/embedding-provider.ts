export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const provider = (process.env.HIPP0_EMBEDDING_PROVIDER ?? 'off').toLowerCase();
  if (provider === 'off' || provider === '') return null;
  if (provider === 'openai') return new OpenAIEmbeddingProvider();
  throw new Error(`Unknown embedding provider: ${provider}`);
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  readonly model = 'text-embedding-3-small';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY required for openai embedding provider');
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // Truncate each input to ~8k tokens (~32k chars) to avoid API errors
    const inputs = texts.map(t => t.length > 32000 ? t.slice(0, 32000) : t);
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI embeddings failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
    // Ensure order is preserved (OpenAI returns items with 'index')
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map(d => d.embedding);
  }
}

/**
 * Cosine similarity of two equal-length vectors.
 * Returns a value in [-1, 1]. Returns 0 for mismatched/empty vectors.
 */
export function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
