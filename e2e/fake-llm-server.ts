/**
 * Fake LLM server for E2E tests.
 * Serves recorded responses from e2e/fixtures/llm/*.json
 * Usage: node e2e/fake-llm-server.js --port=4001
 *
 * Endpoints:
 *   POST /v1/embeddings         → deterministic 1536-d vectors seeded from input text hash
 *   POST /v1/chat/completions   → fixture match on body substring, falls back to empty actions
 *   POST /v1/messages           → Anthropic-shaped fallback mirroring chat/completions
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = Number(
  process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ??
    process.env.FAKE_LLM_PORT ??
    '4001',
);
const fixturesDir = join(__dirname, 'fixtures', 'llm');

interface Fixture {
  match: string;
  response: unknown;
}
const fixtures: Fixture[] = [];
try {
  for (const f of readdirSync(fixturesDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as Fixture;
      if (typeof data.match === 'string' && data.response !== undefined) {
        fixtures.push(data);
      }
    } catch (err) {
      console.error(`[fake-llm] skipping malformed fixture ${f}: ${(err as Error).message}`);
    }
  }
} catch {
  /* dir may not exist yet */
}
console.log(`[fake-llm] loaded ${fixtures.length} fixtures from ${fixturesDir}`);

function deterministicVector(text: string, dim = 1536): number[] {
  let seed = 0;
  for (let j = 0; j < text.length; j++) seed = (seed * 31 + text.charCodeAt(j)) | 0;
  const vec: number[] = new Array(dim);
  for (let k = 0; k < dim; k++) vec[k] = Math.sin((seed + k) * 0.01);
  return vec;
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const url = req.url ?? '';
    res.setHeader('Content-Type', 'application/json');

    if (url.endsWith('/embeddings')) {
      let parsed: { input?: string | string[] } = {};
      try {
        parsed = body ? (JSON.parse(body) as { input?: string | string[] }) : {};
      } catch {
        /* keep default */
      }
      const inputs: string[] = Array.isArray(parsed.input)
        ? parsed.input
        : [parsed.input ?? ''];
      const data = inputs.map((text, i) => ({
        embedding: deterministicVector(text),
        index: i,
        object: 'embedding',
      }));
      res.end(
        JSON.stringify({
          object: 'list',
          data,
          model: 'fake-embed',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      );
      return;
    }

    if (url.endsWith('/chat/completions')) {
      for (const f of fixtures) {
        if (body.includes(f.match)) {
          res.end(JSON.stringify(f.response));
          return;
        }
      }
      res.end(
        JSON.stringify({
          id: 'fake-cmpl',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"actions": []}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
      );
      return;
    }

    if (url.endsWith('/messages')) {
      // Anthropic-shaped fallback
      for (const f of fixtures) {
        if (body.includes(f.match)) {
          res.end(JSON.stringify(f.response));
          return;
        }
      }
      res.end(
        JSON.stringify({
          id: 'fake-msg',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '{"actions": []}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end('{}');
  });
});

server.listen(port, () => console.log(`[fake-llm] listening on :${port}`));
