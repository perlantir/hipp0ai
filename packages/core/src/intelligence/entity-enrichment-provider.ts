/**
 * Entity enrichment providers: take an entity name+type+context, return compiled_truth.
 * Pluggable via HIPP0_ENRICHMENT_PROVIDER env: openai | perplexity | off (default).
 */

export interface EnrichmentResult {
  compiledTruth: string;
  factsJson: Record<string, unknown>;
  costUsd: number;
  source: string;
}

export interface EnrichmentProvider {
  readonly name: string;
  enrich(
    title: string,
    type: string,
    context: string,
  ): Promise<EnrichmentResult | null>;
}

export function getEnrichmentProvider(): EnrichmentProvider | null {
  const provider = (process.env.HIPP0_ENRICHMENT_PROVIDER ?? 'off').toLowerCase();
  if (provider === 'off' || provider === '') return null;
  if (provider === 'openai') return new OpenAIEnrichmentProvider();
  if (provider === 'perplexity') return new PerplexityEnrichmentProvider();
  throw new Error(`Unknown enrichment provider: ${provider}`);
}

const SYSTEM_PROMPT = `You are an entity enrichment service. Given an entity name and type, produce a structured "compiled truth" summary using only verifiable, non-speculative facts.

Output JSON ONLY in this shape:
{
  "compiled_truth": "<markdown body, ~200-400 words, sections: State / Trajectory / Beliefs / Relationship>",
  "facts": { "role": "...", "company": "...", "founded": "...", ...other key/values relevant to the entity type }
}

For unknown entities, return:
{ "compiled_truth": "", "facts": {} }

Never invent or speculate. Cite no external links. Output JSON only.`;

class OpenAIEnrichmentProvider implements EnrichmentProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    this.model = process.env.HIPP0_ENRICHMENT_MODEL ?? 'gpt-4o-mini';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY required for openai enrichment provider');
  }

  async enrich(title: string, type: string, context: string): Promise<EnrichmentResult | null> {
    const userMessage = `Entity: ${title}\nType: ${type}\nContext from our project: ${context.slice(0, 1000)}\n\nReturn JSON.`;
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(content) as { compiled_truth?: string; facts?: Record<string, unknown> };
      const compiledTruth = (parsed.compiled_truth ?? '').trim();
      if (!compiledTruth) return null;

      // Cost estimate: gpt-4o-mini is ~$0.15/1M input, ~$0.60/1M output.
      const inputTok = data.usage?.prompt_tokens ?? 0;
      const outputTok = data.usage?.completion_tokens ?? 0;
      const costUsd = (inputTok * 0.00000015) + (outputTok * 0.0000006);

      return {
        compiledTruth,
        factsJson: parsed.facts ?? {},
        costUsd,
        source: this.name,
      };
    } catch {
      return null;
    }
  }
}

class PerplexityEnrichmentProvider implements EnrichmentProvider {
  readonly name = 'perplexity';
  private readonly apiKey: string;
  private readonly model: string;
  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY ?? '';
    this.model = process.env.HIPP0_ENRICHMENT_MODEL ?? 'sonar-small-online';
    if (!this.apiKey) throw new Error('PERPLEXITY_API_KEY required for perplexity enrichment provider');
  }

  async enrich(title: string, type: string, context: string): Promise<EnrichmentResult | null> {
    const userMessage = `Entity: ${title}\nType: ${type}\nContext: ${context.slice(0, 500)}\n\nReturn JSON only.`;
    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
          max_tokens: 800,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      // Perplexity may not strictly return JSON - try to extract
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]) as { compiled_truth?: string; facts?: Record<string, unknown> };
      const compiledTruth = (parsed.compiled_truth ?? '').trim();
      if (!compiledTruth) return null;

      const inputTok = data.usage?.prompt_tokens ?? 0;
      const outputTok = data.usage?.completion_tokens ?? 0;
      // Perplexity sonar pricing approx
      const costUsd = (inputTok * 0.0000002) + (outputTok * 0.0000002);

      return {
        compiledTruth,
        factsJson: parsed.facts ?? {},
        costUsd,
        source: this.name,
      };
    } catch {
      return null;
    }
  }
}
