# Contributing to Hipp0

Thanks for your interest in contributing. Hipp0 is an Apache 2.0 open-source project built by Perlantir AI Studio.

---

## Before You Start

Open an issue before writing code for anything non-trivial. This avoids the situation where you build something we can't merge — either because it conflicts with planned work, or because it needs a design discussion first.

For typo fixes, documentation improvements, and obvious bug fixes: PRs are welcome without an issue.

---

## Getting the Repo Running

```bash
git clone https://github.com/perlantir/hipp0ai.git
cd Hipp0

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY at minimum

# Start everything
docker compose up -d

# Or start without Docker (SQLite mode)
pnpm --filter @hipp0/cli build
node packages/cli/dist/index.js init dev-project
```

Full setup: [docs/getting-started.md](docs/getting-started.md)

---

## Running the Benchmarks

Before submitting any PR that touches the scoring engine, context compiler, or retrieval pipeline, run the benchmark suite and include results in your PR description:

```bash
npx tsx benchmarks/runner.ts --suite all
```

We care about these numbers. Don't regress them. See [docs/benchmarks.md](docs/benchmarks.md).

---

## Code Style

- TypeScript everywhere on the server and SDK
- No `any` without a comment explaining why
- Prefer explicit over clever — this codebase is read by agents as much as humans
- Keep functions small and named for what they do

Run the linter before opening a PR:

```bash
pnpm lint
pnpm typecheck
```

---

## What We're Looking For

Good candidates for contribution:

- **Bug fixes** — especially anything in the scoring pipeline or MCP tools
- **Framework guides** — integration examples for agent frameworks not yet covered
- **Benchmark datasets** — more test cases for the retrieval and contradiction suites
- **Documentation** — corrections, clarifications, examples
- **SDK methods** — wrappers for API endpoints not yet in the TypeScript or Python SDK

Things we handle internally:

- Core architecture changes
- New dashboard views
- Pricing and billing
- Database schema changes

---

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm lint && pnpm typecheck`
4. Run benchmarks if relevant
5. Open a PR with a clear description of what changed and why
6. Reference any related issues

PRs are reviewed by the Perlantir team. We'll respond within a few business days.

---

## Reporting Issues

Use GitHub Issues. Include:
- What you were doing
- What you expected to happen
- What actually happened
- Relevant logs (`docker compose logs server --tail 50`)
- Your environment (OS, Docker version, Node version)

For security issues, do not open a public issue. Email hello@hipp0.ai with the details.

---

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 license.
