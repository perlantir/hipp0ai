# CLI

`@hipp0/cli` is the command-line tool for Hipp0. It's the fastest way to get started — one command creates a project, starts the server, and opens the dashboard without Docker or manual configuration.

> **Pre-release:** `@hipp0/cli` is not yet published to npm. Use the local path below while the package is in pre-release.

---

## Installation

### From the Hipp0 repo (current)

```bash
cd /path/to/hipp0
pnpm install
pnpm --filter @hipp0/cli build
```

Use via:

```bash
node ./packages/cli/dist/index.js <command>
```

Or add an alias:

```bash
alias hipp0="node /path/to/hipp0/packages/cli/dist/index.js"
```

### From npm (coming soon)

```bash
npm install -g @hipp0/cli
# then: hipp0 <command>
```

Or without installing:

```bash
npx @hipp0/cli <command>
```

---

## Commands

### `init <project-name>`

Creates a new Hipp0 project with a local SQLite database, starts the server, and opens the dashboard.

```bash
hipp0 init my-project
```

- Creates a `my-project/` directory
- Sets up a SQLite database (no PostgreSQL required)
- Starts the Hipp0 server on port 3100
- Opens the dashboard at http://localhost:3200
- Generates an API key and prints it

**Options:**

| Flag | Description |
|------|-------------|
| `--port <n>` | API server port (default: 3100) |
| `--dashboard-port <n>` | Dashboard port (default: 3200) |
| `--no-open` | Don't open the browser automatically |
| `--api-key <key>` | Use a specific API key instead of generating one |

---

### `start`

Start an existing Hipp0 project (run from inside the project directory).

```bash
cd my-project
hipp0 start
```

Restarts the server and dashboard using the existing database and configuration.

---

### `status`

Check whether the Hipp0 server and dashboard are running.

```bash
hipp0 status
```

Output:

```
● hipp0-server    running  (port 3100)
● hipp0-dashboard running  (port 3200)
● database        connected (SQLite)
```

---

### `stop`

Stop the running Hipp0 server and dashboard.

```bash
hipp0 stop
```

---

### `compile`

Compile context for an agent from the command line.

```bash
hipp0 compile \
  --agent architect \
  --task "design the authentication system" \
  --project <PROJECT_ID> \
  --api-key <API_KEY>
```

Outputs formatted markdown context to stdout. Pipe it or redirect it to a file.

**Options:**

| Flag | Description |
|------|-------------|
| `--agent <name>` | Agent name |
| `--task <description>` | Task description |
| `--project <id>` | Project ID |
| `--api-key <key>` | API key |
| `--format json\|markdown\|h0c` | Output format (default: markdown) |
| `--namespace <ns>` | Filter by namespace |

---

### `record`

Record a decision from the command line.

```bash
hipp0 record \
  --title "Use JWT for API auth" \
  --made-by architect \
  --tags auth,security \
  --confidence high \
  --project <PROJECT_ID> \
  --api-key <API_KEY>
```

Prompts for description and reasoning interactively if not provided as flags.

**Options:**

| Flag | Description |
|------|-------------|
| `--title <text>` | Decision title |
| `--description <text>` | What was decided |
| `--reasoning <text>` | Why |
| `--made-by <agent>` | Agent name |
| `--tags <tag1,tag2>` | Comma-separated tags |
| `--confidence high\|medium\|low` | Confidence level |
| `--namespace <ns>` | Domain namespace |

---

### `import github`

Scan a GitHub repository for decisions and import them.

```bash
hipp0 import github \
  --repo perlantir/hipp0ai \
  --token <GITHUB_TOKEN> \
  --project <PROJECT_ID> \
  --api-key <API_KEY>
```

Runs the Distillery pipeline on merged PRs. Shows a preview before committing. See [docs/github-integration.md](github-integration.md).

---

### `benchmark`

Run the benchmark suite from the CLI.

```bash
hipp0 benchmark --suite all
hipp0 benchmark --suite retrieval
hipp0 benchmark --suite contradiction
```

Equivalent to `npx tsx benchmarks/runner.ts --suite <suite>`. See [docs/benchmarks.md](benchmarks.md).

---

### `migrate`

Move projects, agents, decisions, edges, outcomes, sessions, and captures between Hipp0 instances. Used for dev → staging → prod promotions, backups, and SQLite → PostgreSQL migrations.

The export format is NDJSON (`hipp0-migrate-ndjson@1`) with one JSON record per line. Every record has a `kind` (`meta`, `project`, `agent`, `decision`, `edge`, `outcome`, `session`, `capture`) and a `data` payload.

#### `migrate dump`

Dump a running server to a local NDJSON file.

```bash
hipp0 migrate dump --output backup.ndjson
hipp0 migrate dump --output one-project.ndjson --project <PROJECT_ID>
hipp0 migrate dump --from https://dev.hipp0.local --output dev-backup.ndjson
```

**Options:**

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Output NDJSON file (default `hipp0-backup.ndjson`) |
| `-p, --project <id>` | Only dump a single project |
| `--from <url>` | Source server URL (default: `HIPP0_API_URL`) |

#### `migrate restore`

Restore an NDJSON dump into a running server.

```bash
hipp0 migrate restore --input backup.ndjson
hipp0 migrate restore --input backup.ndjson --conflict overwrite
hipp0 migrate restore --input backup.ndjson --to https://staging.hipp0.local
```

**Options:**

| Flag | Description |
|------|-------------|
| `-i, --input <file>` | Input NDJSON file (default `hipp0-backup.ndjson`) |
| `--to <url>` | Target server URL (default: `HIPP0_API_URL`) |
| `--conflict <strategy>` | `skip` (default), `overwrite`, or `fail` |

#### `migrate copy`

Copy data between two running servers in one step. Uses an intermediate NDJSON file.

```bash
hipp0 migrate copy \
  --from https://dev.hipp0.local \
  --to   https://prod.hipp0.example \
  --conflict skip
```

**Options:**

| Flag | Description |
|------|-------------|
| `--from <url>` | Source server URL (required) |
| `--to <url>` | Target server URL (required) |
| `-p, --project <id>` | Only copy a single project |
| `--conflict <strategy>` | `skip` (default), `overwrite`, or `fail` |
| `--tmp <file>` | Intermediate NDJSON file (default `/tmp/hipp0-copy.ndjson`) |

Both endpoints read `HIPP0_API_KEY` from the environment, so set it before running `copy`.

---

## Environment Variables

The CLI reads from environment variables so you don't have to pass flags every time:

```bash
export HIPP0_API_URL=http://localhost:3100
export HIPP0_API_KEY=your-api-key
export HIPP0_PROJECT_ID=your-project-id
```

Or use a `.hipp0` file in your project directory:

```
HIPP0_API_URL=http://localhost:3100
HIPP0_API_KEY=your-api-key
HIPP0_PROJECT_ID=your-project-id
```

---

## Related Docs

- [Getting Started](getting-started.md) — Docker Compose setup for production
- [TypeScript SDK](sdk.md) — programmatic access from TypeScript
- [Python SDK](python-sdk.md) — programmatic access from Python
- [API Reference](api-reference.md) — direct REST API
