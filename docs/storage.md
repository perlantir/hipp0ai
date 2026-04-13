# Storage Options

Hipp0 supports two database backends: **SQLite** for local and development use, and **PostgreSQL** for production deployments. You do not need to choose upfront — the default works immediately, and switching requires only one environment variable.

---

## SQLite (Default)

SQLite is the default storage backend. No installation, no configuration, no running database process required.

### Best for

- Local development and experimentation
- Single-machine deployments
- Quick starts via `npx @hipp0/cli init` or `pip install hipp0-memory`
- CI/CD pipelines that need an ephemeral Hipp0 instance
- Projects with fewer than ~50,000 decisions

### How it works

When you run Hipp0 without a `DATABASE_URL`, it creates a SQLite file at the path specified by `HIPP0_DB_PATH` (default: `./hipp0.db`). All tables, indexes, and schema migrations are applied automatically on first start.

```bash
# Default — creates hipp0.db in the current directory
npx @hipp0/cli start

# Custom path
HIPP0_DB_PATH=/data/my-project.db npx @hipp0/cli start
```

With `hipp0-memory` (Python):

```python
import hipp0_memory

# SQLite at ./hipp0.db (default)
client = hipp0_memory.init()

# Custom path
client = hipp0_memory.init(db_path="/data/my-project.db")
```

### Limitations

- **No semantic search** — pgvector is PostgreSQL-only. Tag and keyword search still work; cosine similarity scoring is skipped and the semantic signal weight redistributed.
- **Single writer** — SQLite does not support concurrent writes from multiple processes. Run a single Hipp0 server instance.
- **Not recommended above ~50k decisions** — query performance degrades at large scale without PostgreSQL's query planner.

---

## PostgreSQL (Production)

PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension is the recommended backend for production. It enables the full 5-signal context compiler including semantic similarity scoring via HNSW cosine indexes.

### Best for

- Production deployments
- Teams with multiple concurrent agents writing decisions
- Projects that need semantic search (cosine similarity on embeddings)
- Large decision graphs (100k+ nodes)
- Multi-tenant setups where isolation matters

### Requirements

- PostgreSQL 15 or later (PostgreSQL 17 recommended)
- The `pgvector` extension installed (`CREATE EXTENSION vector;`)

The Docker Compose setup in the Hipp0 repo handles both automatically.

### How to switch

Set the `DATABASE_URL` environment variable before starting the server:

```bash
export DATABASE_URL=postgresql://user:password@localhost:5432/hipp0
hipp0 start
```

Or with Docker Compose, edit your `.env` file:

```bash
DATABASE_URL=postgresql://hipp0:hipp0@db:5432/hipp0
```

Then restart:

```bash
docker compose up -d --force-recreate
```

### Migration is automatic

Hipp0 runs schema migrations on startup regardless of backend. When you switch from SQLite to PostgreSQL (or upgrade Hipp0), all migrations are applied automatically. You do not need to run any migration commands manually.

> **Note:** Switching from an existing SQLite database to PostgreSQL does not migrate your data automatically. Export your decisions first using `hipp0 export` (CLI) or the `/api/projects/:id/export` endpoint, then import into the new PostgreSQL instance with `hipp0 import`.

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | _(unset — uses SQLite)_ | PostgreSQL connection string. When set, SQLite is not used. |
| `HIPP0_DB_PATH` | `./hipp0.db` | SQLite file path. Ignored when `DATABASE_URL` is set. |
| `PORT` | `3100` | HTTP port the Hipp0 server listens on. |
| `HIPP0_API_KEY` | _(auto-generated)_ | API key for authenticating requests. |

---

## Choosing a Backend

| | SQLite | PostgreSQL |
|---|---|---|
| Setup time | Zero | ~5 minutes |
| Semantic search | No | Yes (pgvector) |
| Concurrent writers | No | Yes |
| Scale | Up to ~50k decisions | Millions of decisions |
| Recommended for | Local / dev | Production |
