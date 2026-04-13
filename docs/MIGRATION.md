# Hipp0 — Migration to Fly.io / Railway

This guide covers migrating a self-hosted Hipp0 deployment to a managed platform.

## Prerequisites

- Working local/VPS deployment
- Database backup (run `scripts/backup.sh`)
- All environment variables documented

## Option A: Fly.io

### 1. Install flyctl

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 2. Create Fly app

```bash
fly launch --name hipp0 --no-deploy
```

### 3. Configure PostgreSQL

```bash
# Create a Fly Postgres cluster
fly postgres create --name hipp0-db

# Attach to the app
fly postgres attach hipp0-db --app hipp0
```

### 4. Import database

```bash
# Restore from backup
gunzip -c backups/hipp0_YYYYMMDD_HHMMSS.sql.gz | \
  fly postgres connect -a hipp0-db -d hipp0
```

### 5. Set secrets

```bash
fly secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  HIPP0_API_KEY=your-key \
  NODE_ENV=production
```

### 6. Configure fly.toml

```toml
[build]

[http_service]
  internal_port = 3100
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

[[services.http_checks]]
  interval = 10000
  timeout = 2000
  path = "/api/health/ready"

[checks]
  [checks.alive]
    type = "http"
    port = 3100
    path = "/api/health/live"
    interval = "15s"
    timeout = "5s"
```

### 7. Deploy

```bash
fly deploy
```

### 8. Verify

```bash
fly status
curl https://hipp0.fly.dev/api/health
```

---

## Option B: Railway

### 1. Install Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### 2. Create project

```bash
railway init
```

### 3. Add PostgreSQL

```bash
railway add --plugin postgresql
```

### 4. Import database

```bash
# Get connection string
railway variables | grep DATABASE_URL

# Restore from backup
gunzip -c backups/hipp0_YYYYMMDD_HHMMSS.sql.gz | \
  psql "$RAILWAY_DATABASE_URL"
```

### 5. Set environment variables

```bash
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set HIPP0_API_KEY=your-key
railway variables set NODE_ENV=production
railway variables set PORT=3100
```

### 6. Configure railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/api/health/ready",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

### 7. Deploy

```bash
railway up
```

### 8. Verify

```bash
railway status
curl https://your-app.up.railway.app/api/health
```

---

## Post-Migration Checklist

- [ ] Verify `/api/health` returns `ok` with valid `db_latency_ms`
- [ ] Verify `/api/health/ready` returns `ready`
- [ ] Test compile endpoint with a known agent
- [ ] Check dashboard loads and can list decisions
- [ ] Update DNS records if using custom domain
- [ ] Update webhook URLs (GitHub, Slack, Discord) to new domain
- [ ] Update bot tokens and project IDs for connectors
- [ ] Set up monitoring/alerting on the new platform
- [ ] Run `scripts/backup.sh` on new environment
- [ ] Remove or decommission old VPS deployment

## Redis (Optional)

Both Fly.io and Railway offer Redis add-ons:

```bash
# Fly.io
fly redis create --name hipp0-redis
# Sets REDIS_URL automatically

# Railway
railway add --plugin redis
# Sets REDIS_URL automatically
```

Set `REDIS_URL` in your environment to enable Redis caching.

## Rollback

If something goes wrong:

1. Point DNS back to old VPS
2. Ensure old deployment is still running
3. Investigate logs on new platform: `fly logs` or `railway logs`
