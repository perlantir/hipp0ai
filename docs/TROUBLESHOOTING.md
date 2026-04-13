# Hipp0 Troubleshooting Guide

## Quick Diagnostics

Run these commands first to assess system health:

```bash
# Check all containers are running
docker ps | grep hipp0

# Check server logs
docker logs hipp0-server --tail 20

# Check database connectivity
docker exec hipp0-db psql -U hipp0 -d hipp0 -c "SELECT count(*) FROM decisions"

# Check dashboard proxy
curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/api/projects

# Check API directly
curl -s "http://localhost:3100/api/projects" | head -50
```

## Common Errors

### "Cannot read properties of undefined (reading 'length')"

**Cause:** Multi-statement SQL in migrations returns `result.rows = undefined` for DDL statements (CREATE TABLE, ALTER, etc.)

**Fix:** All `result.rows` access is now guarded with `?? []`

**File:** `packages/core/src/db/postgres-adapter.ts`

### "role 'hipp0' does not exist"

**Cause:** Docker volume was renamed, creating an empty database without the expected user/database (formerly the role was named `hipp0`)

**Fix:** Check `docker-compose.yml` volume name matches the existing volume:

```bash
docker volume ls | grep pgdata
docker inspect hipp0-db | grep -A5 "Mounts"
```

If you see `hipp0_pgdata` in the volume list but a different name in docker-compose, you need to either:
1. Change docker-compose to use the old volume name, or
2. Copy data: `docker run --rm -v old_pgdata:/from -v hipp0_pgdata:/to alpine cp -a /from/. /to/`

### "FATAL: Cannot connect to database"

**Cause:** Multiple possible causes

**Diagnosis steps:**
1. Check if DB container is healthy: `docker ps | grep hipp0-db`
2. Check if DATABASE_URL reaches the container: `docker exec hipp0-server printenv DATABASE_URL`
3. Test direct DB connection: `docker exec hipp0-db psql -U hipp0 -d hipp0 -c "SELECT 1"`
4. Check Docker network: `docker network inspect hipp0_default`

### "Failed to load decisions" (Dashboard)

**Cause:** VITE_API_URL baked incorrectly during build

**Diagnosis:** Open browser DevTools → Console. If you see `http://api/projects` instead of `/api/projects`, the API URL is wrong.

**Fix:**
```bash
grep "VITE_API_URL" docker-compose.yml Dockerfile.dashboard
# Must be empty string "", never an absolute URL
```

### Dashboard shows "Load failed" but curl works

**Cause:** nginx proxy configuration issue

**Diagnosis:**
```bash
# Test proxy from outside
curl -s "http://YOUR_IP:3200/api/projects"

# Check nginx config
cat packages/dashboard/nginx.conf

# Verify upstream block and /api/ location exist
```

### Server crash-loops on startup

**Diagnosis sequence:**
```bash
# 1. Check container status
docker ps -a | grep server

# 2. Get full logs (not just tail)
docker logs hipp0-server 2>&1 | head -50

# 3. Test DB pool directly
docker compose run --rm server sh -c '
cd /app && node --input-type=module -e "
const { getPool } = await import(\"./packages/core/dist/db/pool.js\");
const pool = getPool();
const r = await pool.query(\"SELECT 1\");
console.log(\"Pool OK:\", r.rows);
process.exit(0);
"'

# 4. Test adapter layer
docker compose run --rm server sh -c '
cd /app && node --input-type=module -e "
const { createAdapter } = await import(\"./packages/core/dist/db/factory.js\");
const adapter = await createAdapter();
await adapter.connect();
console.log(\"Adapter OK\");
await adapter.runMigrations(\"/app/supabase/migrations\");
console.log(\"Migrations OK\");
process.exit(0);
"'
```

## Docker Volume Management

### Listing volumes

```bash
docker volume ls | grep hipp0
```

### Checking which volume the DB uses

```bash
docker inspect hipp0-db | grep -A5 "Mounts"
```

### NEVER rename the volume in docker-compose.yml

The volume contains all production data. Renaming it in `docker-compose.yml` causes Docker to create a new empty volume. Your data is still in the old volume but the containers can't see it.

## Environment Variables

Required in `.env`:

```
NODE_ENV=development
DATABASE_URL=postgresql://hipp0:hipp0_dev@postgres:5432/hipp0
DATABASE_SSL=false
ANTHROPIC_API_KEY=sk-ant-...
DISTILLERY_PROVIDER=anthropic
HIPP0_LLM_MODEL=claude-opus-4-6
```

## Rebuilding

### Server only

```bash
docker compose build --no-cache server
docker compose up -d server
```

### Dashboard only

```bash
docker compose build --no-cache dashboard
docker compose up -d dashboard
```

### Full rebuild

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Nuclear option (preserves data)

```bash
docker compose down
docker system prune -f
docker compose build --no-cache
docker compose up -d
```
