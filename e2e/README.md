# E2E Test Harness

Spins up a real hipp0 server (Postgres + pgvector) plus a fake LLM server, seeds data, runs API-level + agent-level tests.

## Run

    ./e2e/run-e2e.sh

Requires: Docker, Docker Compose, Node 20, pnpm.

## Files

- `docker-compose.yml` - hipp0 server + Postgres (pgvector/pg17)
- `Dockerfile.server` - multi-stage server build
- `seed.ts` - HTTP seeder (projects, agents, decisions, entities, outcomes, contradiction pairs)
- `fake-llm-server.ts` - deterministic LLM responses for tests
- `fixtures/llm/` - pre-recorded LLM responses
- `run-e2e.sh` - one-shot runner

Specific test suites live in `e2e/scenarios/` (API), `e2e/dashboard/` (Playwright), `e2e/agent/` (hermulti integration).

## Env vars set in the compose file

- `HIPP0_AUTH_REQUIRED=false` so the seeder can POST without a JWT/API key
- `HIPP0_EMBEDDING_PROVIDER=off` / `HIPP0_ENRICHMENT_PROVIDER=off` to avoid outbound LLM calls
- `NODE_ENV=test` (production forces auth regardless of flag)
- `PORT=3000` inside the container, mapped to `3001` on the host

## Notes

- Contradictions are auto-detected by the server, so the seeder plants two
  decision pairs that should trigger detection rather than POSTing contradictions
  directly (no such endpoint exists).
- Entities return `{entity, action, tier_changed}` on POST; the seeder unwraps `.entity.id`.
- `/api/health` (not `/health`) is the health endpoint.
