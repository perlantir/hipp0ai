# Self-Hosting Hipp0

This guide covers everything you need to run Hipp0 in production: Docker Compose deployment, manual installation, reverse proxy configuration, TLS/SSL, database backups, and monitoring.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Docker Compose Deployment](#docker-compose-deployment)
- [Manual Installation](#manual-installation)
- [Environment Configuration](#environment-configuration)
- [Nginx Reverse Proxy](#nginx-reverse-proxy)
- [Caddy Reverse Proxy (Cloudflare-Friendly)](#caddy-reverse-proxy-cloudflare-friendly)
- [Vercel: Playground Environment Variables](#vercel-playground-environment-variables)
- [TLS / SSL with Let's Encrypt](#tls--ssl-with-lets-encrypt)
- [Database Management](#database-management)
- [Backups](#backups)
- [Monitoring & Observability](#monitoring--observability)
- [Scaling Considerations](#scaling-considerations)
- [Security Hardening](#security-hardening)
- [Upgrading Hipp0](#upgrading-hipp0)

---

## Architecture Overview

A production Hipp0 deployment consists of three services:

```
Internet
   |
   v
nginx (80/443)
   |
   +--> /api/*  ->  hipp0-server   (port 3100)
   |                    |
   +--> /*      ->  hipp0-dashboard (port 3200)
                        |
                 PostgreSQL 17 + pgvector
                      (port 5432)
```

All three services can run on a single VM for small deployments. For larger teams, extract PostgreSQL to a managed service (RDS, Supabase, Neon) and scale the server horizontally.

---

## Docker Compose Deployment

This is the recommended production deployment method.

### Step 1: Clone and Configure

```bash
git clone https://github.com/perlantir/hipp0.git
cd hipp0

# Copy the example environment file
cp .env.example .env
```

Edit `.env` with production values (see [Environment Configuration](#environment-configuration)).

### Step 2: Build Images

```bash
docker compose build
```

Or pull pre-built images if your CI pushes them to a registry:

```bash
docker compose pull
```

### Step 3: Start Services

```bash
# Start in detached mode
docker compose up -d

# Check all services are healthy
docker compose ps
```

Expected output:

```
NAME                STATUS          PORTS
hipp0-postgres-1    Up (healthy)    5432/tcp
hipp0-server-1      Up              0.0.0.0:3100->3100/tcp
hipp0-dashboard-1   Up              0.0.0.0:3200->3200/tcp
```

### Step 4: Run Migrations

```bash
docker compose exec server pnpm db:migrate
```

Or run migrations directly against the database:

```bash
docker compose exec postgres psql -U hipp0 -d hipp0 \
  -f /migrations/001_initial_schema.sql \
  -f /migrations/002_audit_log.sql \
  -f /migrations/003_relevance_feedback.sql
```

### Step 5: Create Your First Project

```bash
curl -X POST http://localhost:3100/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project", "description": "Production project"}'
```

### Docker Compose File Reference

The included `docker-compose.yml` defines these services:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: hipp0
      POSTGRES_PASSWORD: hipp0_dev   # Override in production!
      POSTGRES_DB: hipp0
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hipp0"]
      interval: 5s
      timeout: 5s
      retries: 5

  server:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3100:3100"
    environment:
      DATABASE_URL: postgresql://hipp0:hipp0_dev@postgres:5432/hipp0
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy

  dashboard:
    build:
      context: .
      dockerfile: Dockerfile.dashboard
    ports:
      - "3200:3200"
    environment:
      VITE_API_URL: ${VITE_API_URL:-http://localhost:3100}
    depends_on:
      - server

volumes:
  postgres_data:
```

### Production Docker Compose Override

Create a `docker-compose.prod.yml` override for production-specific settings:

```yaml
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # Strong random password
    restart: always

  server:
    restart: always
    environment:
      NODE_ENV: production
      HIPP0_API_KEY: ${HIPP0_API_KEY}
    # Remove public port binding — nginx handles it
    ports: []

  dashboard:
    restart: always
    ports: []
```

Run with both files:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Manual Installation

For environments where Docker is not available.

### Prerequisites

| Dependency | Version | Notes |
|-----------|---------|-------|
| Node.js | ≥ 20 | LTS recommended |
| pnpm | ≥ 8 | `npm install -g pnpm` |
| PostgreSQL | 17 | With pgvector extension |
| pgvector | ≥ 0.7 | Must be installed in PostgreSQL |

### Installing pgvector

**Ubuntu / Debian:**

```bash
sudo apt install postgresql-17-pgvector
```

**macOS (Homebrew):**

```bash
brew install pgvector
```

**From source:**

```bash
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
make install  # requires postgresql-server-dev-17
```

Enable the extension in your database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Database Setup

```bash
# Create user and database
sudo -u postgres psql <<EOF
CREATE USER hipp0 WITH PASSWORD 'your_strong_password';
CREATE DATABASE hipp0 OWNER hipp0;
\c hipp0
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL PRIVILEGES ON DATABASE hipp0 TO hipp0;
EOF
```

### Install Dependencies and Build

```bash
git clone https://github.com/perlantir/hipp0.git
cd hipp0

# Install all workspace dependencies
pnpm install

# Build all packages
pnpm build
```

### Run Migrations

```bash
# Using the Hipp0 CLI
HIPP0_API_URL=http://localhost:3100 pnpm --filter @hipp0/server db:migrate

# Or apply SQL files directly
psql -U hipp0 -d hipp0 -f supabase/migrations/001_initial_schema.sql
psql -U hipp0 -d hipp0 -f supabase/migrations/002_audit_log.sql
psql -U hipp0 -d hipp0 -f supabase/migrations/003_relevance_feedback.sql
```

### Start the Server

```bash
# Development
pnpm dev

# Production (after build)
NODE_ENV=production node packages/server/dist/index.js
```

### Systemd Service

Create `/etc/systemd/system/hipp0-server.service`:

```ini
[Unit]
Description=Hipp0 Decision Memory Server
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=hipp0
WorkingDirectory=/opt/hipp0
EnvironmentFile=/opt/hipp0/.env
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hipp0-server

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/hipp0

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/hipp0-dashboard.service`:

```ini
[Unit]
Description=Hipp0 Dashboard
After=hipp0-server.service
Requires=hipp0-server.service

[Service]
Type=simple
User=hipp0
WorkingDirectory=/opt/hipp0
EnvironmentFile=/opt/hipp0/.env
ExecStart=/usr/bin/node packages/dashboard/dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable hipp0-server hipp0-dashboard
sudo systemctl start hipp0-server hipp0-dashboard
sudo systemctl status hipp0-server
```

---

## Environment Configuration

Copy `.env.example` to `.env` and configure the following variables:

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://hipp0:your_password@localhost:5432/hipp0
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# LLM Provider (optional — pick one)
OPENROUTER_API_KEY=sk-or-...   # Recommended: one key, all features
# OPENAI_API_KEY=sk-...         # Alternative: OpenAI direct
# ANTHROPIC_API_KEY=sk-ant-...  # Alternative: Anthropic direct

# Server
PORT=3100
HOST=0.0.0.0
NODE_ENV=production

# Security
HIPP0_API_KEY=<random 64-char hex string>
```

Generate a strong `HIPP0_API_KEY`:

```bash
openssl rand -hex 64
```

### Optional Variables

```bash
# MCP transport (stdio or sse)
MCP_TRANSPORT=stdio

# Dashboard API URL (what the dashboard browser talks to)
VITE_API_URL=https://api.yourdomain.com

# Logging
LOG_LEVEL=info    # debug | info | warn | error
```

### Alternative Embedding Providers

If you prefer not to use OpenAI for embeddings:

```bash
EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_URL=http://localhost:11434/api/embeddings
LOCAL_EMBEDDING_MODEL=nomic-embed-text
```

### Alternative Distillery Providers

```bash
DISTILLERY_PROVIDER=openai
OPENAI_DISTILLERY_MODEL=gpt-4o-mini
```

---

## LLM Provider Configuration

Hipp0 makes two types of optional LLM calls internally:

| Feature | What it does | Without a key |
|---------|-------------|---------------|
| Embeddings | Converts decisions to vectors for semantic search | Falls back to text search (PostgreSQL ILIKE) |
| Distillery | Extracts structured decisions from conversation transcripts | Agents record decisions manually via API |

The core product — decision graph, context compilation, change propagation, notifications, and dashboard — works with zero LLM keys.

### Quick Setup

Most users need one line in `.env`:

```dotenv
OPENROUTER_API_KEY=sk-or-your-key
```

This routes embedding requests through OpenAI (via OpenRouter) and extraction requests through Anthropic Claude (via OpenRouter). One key, both features, 200+ models available.

### Provider Examples

**OpenRouter (recommended)**
```dotenv
OPENROUTER_API_KEY=sk-or-your-key
```

**OpenAI direct**
```dotenv
OPENAI_API_KEY=sk-your-key
```
Enables embeddings and distillery (using GPT-4o-mini for extraction).

**Anthropic direct**
```dotenv
ANTHROPIC_API_KEY=sk-ant-your-key
```
Enables distillery only. Embeddings fall back to text search (Anthropic does not offer an embeddings API).

**OpenAI + Anthropic**
```dotenv
OPENAI_API_KEY=sk-your-key
ANTHROPIC_API_KEY=sk-ant-your-key
```
Embeddings via OpenAI, distillery via Anthropic Claude.

**Ollama (local, free, private)**
```dotenv
HIPP0_EMBEDDINGS_URL=http://localhost:11434/v1
HIPP0_EMBEDDINGS_KEY=ollama
HIPP0_EMBEDDINGS_MODEL=nomic-embed-text
HIPP0_LLM_URL=http://localhost:11434/v1
HIPP0_LLM_KEY=ollama
HIPP0_LLM_MODEL=llama3
```
Requires Ollama running locally with the models pulled.

**Together AI**
```dotenv
HIPP0_EMBEDDINGS_URL=https://api.together.xyz/v1
HIPP0_EMBEDDINGS_KEY=your-together-key
HIPP0_EMBEDDINGS_MODEL=togethercomputer/m2-bert-80M-8k-retrieval
HIPP0_LLM_URL=https://api.together.xyz/v1
HIPP0_LLM_KEY=your-together-key
HIPP0_LLM_MODEL=meta-llama/Llama-3-70b-chat-hf
```

**Groq (fast inference)**
```dotenv
HIPP0_LLM_URL=https://api.groq.com/openai/v1
HIPP0_LLM_KEY=gsk_your-groq-key
HIPP0_LLM_MODEL=llama-3.3-70b-versatile
```
Note: Groq does not offer embeddings. Use with a separate embeddings provider or rely on text search.

**Azure OpenAI**
```dotenv
HIPP0_EMBEDDINGS_URL=https://your-resource.openai.azure.com/openai/deployments/your-embedding-deployment
HIPP0_EMBEDDINGS_KEY=your-azure-key
HIPP0_EMBEDDINGS_MODEL=text-embedding-3-small
HIPP0_LLM_URL=https://your-resource.openai.azure.com/openai/deployments/your-chat-deployment
HIPP0_LLM_KEY=your-azure-key
HIPP0_LLM_MODEL=gpt-4o-mini
```

**LiteLLM Proxy**
```dotenv
HIPP0_EMBEDDINGS_URL=http://localhost:4000/v1
HIPP0_EMBEDDINGS_KEY=your-litellm-key
HIPP0_EMBEDDINGS_MODEL=text-embedding-3-small
HIPP0_LLM_URL=http://localhost:4000/v1
HIPP0_LLM_KEY=your-litellm-key
HIPP0_LLM_MODEL=claude-haiku-4-5-20251001
```

### Verifying Your Configuration

After starting Hipp0, check the logs:
```bash
docker compose logs server | grep hipp0
```

You should see:
```
[hipp0] Embeddings: openai/text-embedding-3-small via openrouter
[hipp0] Distillery: anthropic/claude-haiku-4-5-20251001 via openrouter
```

Or if no keys are configured:
```
[hipp0] Embeddings: disabled (text search fallback)
[hipp0] Distillery: disabled (manual recording only)
```

### Priority Order

If multiple keys are set, Hipp0 uses this priority:

**Embeddings:**
1. `HIPP0_EMBEDDINGS_URL` + `HIPP0_EMBEDDINGS_KEY` (explicit override)
2. `OPENROUTER_API_KEY`
3. `OPENAI_API_KEY`
4. Text search fallback

**Distillery:**
1. `HIPP0_LLM_URL` + `HIPP0_LLM_KEY` (explicit override)
2. `OPENROUTER_API_KEY`
3. `ANTHROPIC_API_KEY` (direct Anthropic SDK)
4. `OPENAI_API_KEY`
5. Manual recording only

---

## Nginx Reverse Proxy

### Installation

```bash
sudo apt install nginx
```

### Configuration

Create `/etc/nginx/sites-available/hipp0`:

```nginx
upstream hipp0_api {
    server 127.0.0.1:3100;
    keepalive 32;
}

upstream hipp0_dashboard {
    server 127.0.0.1:3200;
    keepalive 16;
}

server {
    listen 80;
    server_name hipp0.yourdomain.com;

    # Redirect all HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hipp0.yourdomain.com;

    # SSL certificates (configured by Certbot)
    ssl_certificate /etc/letsencrypt/live/hipp0.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hipp0.yourdomain.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy no-referrer-when-downgrade;

    # API routes
    location /api/ {
        proxy_pass http://hipp0_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # Timeouts — context compilation can take a few seconds
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # Request size limit for distillery payloads
        client_max_body_size 10m;
    }

    # Health endpoint (bypass auth for load balancers)
    location /health {
        proxy_pass http://hipp0_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        access_log off;
    }

    # Dashboard
    location / {
        proxy_pass http://hipp0_dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/hipp0 /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Separate API and Dashboard Domains

If you want separate subdomains for the API and dashboard:

```nginx
# api.yourdomain.com → port 3100
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;
    # ... (same SSL config)

    location / {
        proxy_pass http://hipp0_api;
        # ... (same proxy settings)
    }
}

# app.yourdomain.com → port 3200
server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;
    # ... (same SSL config)

    location / {
        proxy_pass http://hipp0_dashboard;
        # ... (same proxy settings)
    }
}
```

Set `VITE_API_URL=https://api.yourdomain.com` so the dashboard browser knows where to call the API.

---

## Caddy Reverse Proxy (Cloudflare-Friendly)

Caddy is the simplest way to put Hipp0 behind TLS when your zone is already on Cloudflare. Cloudflare's proxy terminates TLS at the edge and expects plain HTTP on port 80 at the origin, so we point Caddy at port 80 and let it forward to Hipp0 on port 3100.

### Install

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Configure

Create `/etc/caddy/Caddyfile`:

```caddy
# Port 80 -> Hipp0 server on 3100
# Cloudflare proxies hipp0.yourdomain.com -> origin:80, so we serve
# plain HTTP here. Don't add TLS — Cloudflare handles it at the edge.
:80 {
    # Health probe bypasses everything
    handle /api/health* {
        reverse_proxy 127.0.0.1:3100
    }

    # API + WebSocket upgrades
    handle /api/* {
        reverse_proxy 127.0.0.1:3100 {
            header_up Host {host}
            header_up X-Real-IP {remote}
            header_up X-Forwarded-For {remote}
            header_up X-Forwarded-Proto https
            transport http {
                keepalive 30s
                read_timeout 60s
            }
        }
    }

    # Real-time event stream (/ws/events) and collab room (/ws/room)
    handle /ws/* {
        reverse_proxy 127.0.0.1:3100
    }

    # Dashboard
    handle {
        reverse_proxy 127.0.0.1:3200
    }

    encode gzip
    log {
        output file /var/log/caddy/hipp0.log
        format json
    }
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

### Important: Set `HIPP0_TRUSTED_PROXY=true`

When Hipp0 runs behind Caddy + Cloudflare, you **must** set this in `.env` so rate limiting, audit logs, and per-IP throttling see the real client IP from `X-Forwarded-For` instead of `127.0.0.1`:

```dotenv
HIPP0_TRUSTED_PROXY=true
```

### ufw Firewall Rules

Lock down the box so only Caddy (port 80/443) and SSH are reachable from the public internet. Hipp0's internal ports (3100, 3200, 5432) should never be exposed directly:

```bash
# Deny everything by default
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (adjust the port if you've moved sshd)
sudo ufw allow 22/tcp

# Caddy handles 80 (Cloudflare origin) and optionally 443 (direct TLS)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Explicitly reject public access to the Hipp0 internal ports
sudo ufw deny 3100/tcp
sudo ufw deny 3200/tcp
sudo ufw deny 5432/tcp

# Enable
sudo ufw enable
sudo ufw status verbose
```

If your server is behind Cloudflare only (no direct access), consider restricting port 80/443 to [Cloudflare's published IP ranges](https://www.cloudflare.com/ips/) instead of allowing from anywhere — the `ufw` syntax is `sudo ufw allow from <cidr> to any port 80`.

---

## Vercel: Playground Environment Variables

The public playground at `hipp0.ai/playground` is a Next.js app on Vercel that talks to a self-hosted Hipp0 server. Wire it up in the Vercel project's **Settings → Environment Variables**:

| Name | Environment | Value | Why |
|---|---|---|---|
| `HIPP0_API_URL` | Production, Preview, Development | `https://hipp0.yourdomain.com` | Base URL the playground server-side routes call |
| `HIPP0_PLAYGROUND_API_KEY` | Production, Preview | `h0_…` | API key minted on the origin with playground-only scope |
| `NEXT_PUBLIC_HIPP0_WS_URL` | Production, Preview | `wss://hipp0.yourdomain.com/ws/events` | WebSocket endpoint for the live demo panels |
| `HIPP0_PLAYGROUND_SESSION_TTL` | Production | `3600` | Seconds before an ephemeral session is reaped (default 1h) |
| `HIPP0_ALLOWED_ORIGINS` | (on the origin) | `https://hipp0.ai,https://*.vercel.app` | CORS for preview deploys |

On the **origin** Hipp0 server, enable playground routes:

```dotenv
HIPP0_PLAYGROUND_ENABLED=true
```

After editing env vars in Vercel, redeploy the project so the new values are baked into the build. `NEXT_PUBLIC_*` vars require a redeploy; private vars take effect on next request.

---

## TLS / SSL with Let's Encrypt

### Install Certbot

```bash
sudo apt install certbot python3-certbot-nginx
```

### Obtain Certificate

```bash
sudo certbot --nginx -d hipp0.yourdomain.com
```

Certbot automatically modifies your nginx config to add the SSL certificate paths and enables auto-renewal.

### Manual Certificate Renewal

Certificates expire after 90 days. Certbot installs a systemd timer that auto-renews. Verify it:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

### Wildcard Certificate (optional)

For `*.yourdomain.com`:

```bash
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials ~/.secrets/cloudflare.ini \
  -d "*.yourdomain.com" \
  -d "yourdomain.com"
```

---

## Database Management

### Connecting to the Database

**Docker Compose:**

```bash
docker compose exec postgres psql -U hipp0 -d hipp0
```

**Manual install:**

```bash
psql -U hipp0 -h localhost -d hipp0
```

### Useful Queries

Check decision count and embedding coverage:

```sql
SELECT
  COUNT(*) AS total_decisions,
  COUNT(embedding) AS with_embeddings,
  COUNT(*) - COUNT(embedding) AS missing_embeddings,
  status,
  COUNT(*) as count_by_status
FROM decisions
GROUP BY status;
```

Check HNSW index size:

```sql
SELECT
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexname::regclass)) AS index_size
FROM pg_indexes
WHERE tablename IN ('decisions', 'artifacts')
AND indexname LIKE '%embedding%';
```

Find decisions without embeddings (need re-indexing):

```sql
SELECT id, title, created_at
FROM decisions
WHERE embedding IS NULL
ORDER BY created_at DESC;
```

### Connection Pool Tuning

For high-concurrency deployments, tune the pool:

```bash
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=25
```

PostgreSQL `max_connections` must be higher than your pool maximum:

```sql
SHOW max_connections;
-- If too low, add to postgresql.conf:
-- max_connections = 100
```

---

## Backups

### Automated pg_dump Backup

Create `/opt/hipp0/scripts/backup.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/hipp0"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/hipp0_${DATE}.dump"

mkdir -p "$BACKUP_DIR"

# Custom-format dump (compressed, supports parallel restore)
pg_dump \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  --file="$BACKUP_FILE" \
  "postgresql://hipp0:${POSTGRES_PASSWORD}@localhost:5432/hipp0"

echo "Backup written to $BACKUP_FILE"

# Delete backups older than 30 days
find "$BACKUP_DIR" -name "hipp0_*.dump" -mtime +30 -delete

echo "Backup complete: $(ls -lh $BACKUP_FILE | awk '{print $5}')"
```

Make executable and schedule:

```bash
chmod +x /opt/hipp0/scripts/backup.sh

# Run daily at 2am
echo "0 2 * * * hipp0 /opt/hipp0/scripts/backup.sh >> /var/log/hipp0-backup.log 2>&1" \
  | sudo tee -a /etc/cron.d/hipp0-backup
```

### Restoring from Backup

```bash
# Stop the server
sudo systemctl stop hipp0-server

# Drop and recreate the database
sudo -u postgres psql -c "DROP DATABASE hipp0;"
sudo -u postgres psql -c "CREATE DATABASE hipp0 OWNER hipp0;"
sudo -u postgres psql -d hipp0 -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Restore
pg_restore \
  --format=custom \
  --no-acl \
  --no-owner \
  --dbname="postgresql://hipp0:your_password@localhost:5432/hipp0" \
  /var/backups/hipp0/hipp0_20260101_020000.dump

# Restart the server
sudo systemctl start hipp0-server
```

### Docker Compose Backup

```bash
# Backup
docker compose exec postgres pg_dump \
  -U hipp0 -Fc hipp0 > hipp0_backup_$(date +%Y%m%d).dump

# Restore
docker compose exec -T postgres pg_restore \
  -U hipp0 -d hipp0 < hipp0_backup_20260101.dump
```

### Continuous Archiving with WAL-G (Advanced)

For near-zero RPO, configure WAL-G with S3:

```bash
# Install WAL-G
wget https://github.com/wal-g/wal-g/releases/latest/download/wal-g-pg-ubuntu-22.04-amd64
chmod +x wal-g-pg-ubuntu-22.04-amd64
sudo mv wal-g-pg-ubuntu-22.04-amd64 /usr/local/bin/wal-g
```

Add to `postgresql.conf`:

```
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 60
```

Schedule base backups:

```bash
# Weekly full backup
0 1 * * 0 postgres wal-g backup-push $PGDATA
```

---

## Monitoring & Observability

### Health Check Endpoint

Hipp0 exposes a health endpoint at `/health`:

```bash
curl http://localhost:3100/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": "connected",
  "uptime": 3600
}
```

Use this for load balancer health checks and uptime monitoring.

### Prometheus Metrics (if enabled)

If your Hipp0 build includes the metrics middleware, metrics are available at `/metrics`:

```bash
curl http://localhost:3100/metrics
```

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: hipp0
    static_configs:
      - targets: ['localhost:3100']
    metrics_path: /metrics
    scheme: http
```

### Structured Logging

Set `LOG_LEVEL=info` (or `debug` for verbose output). Hipp0 logs structured JSON to stdout:

```json
{
  "level": "info",
  "time": "2026-04-03T04:34:00.000Z",
  "msg": "POST /api/projects/proj_01hx.../compile 200 143ms",
  "method": "POST",
  "path": "/api/projects/proj_01hx.../compile",
  "status": 200,
  "duration": 143
}
```

### Shipping Logs to a Log Aggregator

**With Docker and Loki:**

```yaml
# docker-compose.prod.yml
services:
  server:
    logging:
      driver: loki
      options:
        loki-url: "http://loki:3100/loki/api/v1/push"
        loki-labels: "app=hipp0-server"
```

**With systemd and journald → Grafana:**

```bash
# Install promtail
sudo apt install promtail

# Configure /etc/promtail/config.yml
scrape_configs:
  - job_name: hipp0
    journal:
      labels:
        job: hipp0-server
      matches: _SYSTEMD_UNIT=hipp0-server.service
```

### Alerting Rules

Key metrics to alert on:

| Alert | Condition | Severity |
|-------|-----------|----------|
| Server down | `/health` returns non-200 for > 1 min | Critical |
| High response latency | `p99 > 5s` for compile endpoint | Warning |
| Database connection exhaustion | Pool utilization > 90% | Warning |
| High contradiction count | `contradictions.count > 20` | Info |
| Embedding failure rate | Distillery error rate > 5% | Warning |

Example uptime check (cron-based):

```bash
#!/bin/bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health)
if [ "$STATUS" != "200" ]; then
  echo "Hipp0 server unhealthy (HTTP $STATUS)" | mail -s "ALERT: Hipp0 down" ops@yourdomain.com
fi
```

---

## Scaling Considerations

### Horizontal Server Scaling

The Hipp0 server is stateless — all state lives in PostgreSQL. You can run multiple server instances behind a load balancer:

```nginx
upstream hipp0_api {
    least_conn;
    server 10.0.1.10:3100;
    server 10.0.1.11:3100;
    server 10.0.1.12:3100;
    keepalive 64;
}
```

Ensure all instances share the same `DATABASE_URL`, `OPENAI_API_KEY`, and `HIPP0_API_KEY`.

### PostgreSQL Read Replicas

For read-heavy workloads (context compilation is read-heavy), configure a replica:

```bash
# Primary
DATABASE_URL=postgresql://hipp0:password@primary:5432/hipp0

# Read replica for compile_context and search
DATABASE_READ_URL=postgresql://hipp0:password@replica:5432/hipp0
```

### Managed Database Services

Hipp0 works with any PostgreSQL 17 service that supports pgvector:

| Service | pgvector support | Notes |
|---------|-----------------|-------|
| Supabase | Yes | `CREATE EXTENSION vector` runs automatically |
| Neon | Yes | Enable in project settings |
| AWS RDS | Yes (pgvector extension) | Use `rds.force_ssl=1` |
| Google Cloud SQL | Yes | Enable `cloudsql.enable_pgvector` flag |
| Azure Database | Yes | Available in Flexible Server |

### Caching Layer

The context compiler uses a 1-hour in-memory cache keyed by `SHA-256(agent_id + "::" + task_description)`. For multi-instance deployments, this cache is per-process. To share the cache across instances, add Redis:

```bash
CACHE_PROVIDER=redis
REDIS_URL=redis://redis:6379
```

---

## Security Hardening

### API Key Authentication

Enable API key authentication by setting `HIPP0_API_KEY` in your environment. Create keys via the API:

```bash
curl -X POST http://localhost:3100/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "production-agent", "project_id": "proj_01hx..."}'
```

Include the returned key in all subsequent requests:

```bash
curl http://localhost:3100/api/projects \
  -H "X-API-Key: nxk_..."
```

### Network Isolation

In Docker Compose, never expose PostgreSQL to the host in production:

```yaml
services:
  postgres:
    # No 'ports' mapping — only accessible within the Docker network
    expose:
      - "5432"
```

### Rate Limiting with Nginx

Add rate limiting to prevent abuse:

```nginx
# In the http block
limit_req_zone $binary_remote_addr zone=hipp0_api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=hipp0_compile:10m rate=10r/m;

# In the server block
location /api/ {
    limit_req zone=hipp0_api burst=20 nodelay;
    # ...
}

location /api/projects/*/compile {
    limit_req zone=hipp0_compile burst=5 nodelay;
    # ...
}
```

### Firewall Rules

```bash
# Allow only nginx to access Hipp0 ports
sudo ufw allow from 127.0.0.1 to any port 3100
sudo ufw allow from 127.0.0.1 to any port 3200
sudo ufw deny 3100
sudo ufw deny 3200

# Allow nginx HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### Secrets Management

Never commit `.env` to version control. For production, use a secrets manager:

**AWS Secrets Manager:**

```bash
aws secretsmanager get-secret-value \
  --secret-id hipp0/production \
  --query SecretString \
  --output text | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' > /opt/hipp0/.env
```

**HashiCorp Vault:**

```bash
vault kv get -format=json secret/hipp0/production \
  | jq -r '.data.data | to_entries | .[] | "\(.key)=\(.value)"' > /opt/hipp0/.env
```

---

## Upgrading Hipp0

### Docker Compose Upgrade

```bash
# Pull latest code
git pull origin main

# Rebuild images
docker compose build

# Apply any new migrations (always before restarting).
# Docker initdb only runs on first database creation.
# Existing installations MUST run migrations manually on upgrade.
docker compose run --rm server pnpm db:migrate

# Rolling restart (minimizes downtime)
docker compose up -d --no-deps server
docker compose up -d --no-deps dashboard
```

### Manual Upgrade

```bash
git pull origin main
pnpm install
pnpm build

# Apply migrations
psql -U hipp0 -d hipp0 -f supabase/migrations/$(ls supabase/migrations/ | tail -1)

sudo systemctl restart hipp0-server hipp0-dashboard
```

### Migration Safety

Hipp0 migrations are always additive (no destructive DDL in migrations). Before upgrading:

1. Take a database backup
2. Review the migration files in `supabase/migrations/`
3. Test on a staging environment
4. Apply migrations before restarting the server

---

## Rate Limiting in Multi-Instance Deployments

Hipp0's built-in rate limiter stores counters in process memory. When running
a single server instance this works out of the box. In a multi-instance
deployment behind a load balancer each instance maintains its own counters,
so a client could theoretically receive `N x limit` requests across `N`
instances.

To enforce shared rate limits across instances, configure a Redis-backed
store:

```bash
CACHE_PROVIDER=redis
REDIS_URL=redis://redis:6379
```

When `CACHE_PROVIDER=redis` is set, rate-limit counters, auth-failure lockouts,
and the context cache are all stored in Redis, giving you consistent limits
regardless of how many server processes are running.

If Redis is not available the server falls back to in-process memory
automatically, so a Redis outage does not take down the API.

---

### Rollback

If a new version causes issues:

```bash
# Roll back to the previous Docker image tag
docker compose down
git checkout v0.1.0   # previous stable tag
docker compose up -d

# If migrations need reverting, restore from backup
```

---

## Production Deployment Checklist

Before deploying to production, ensure:

1. **Database password**: Set a strong `POSTGRES_PASSWORD` (the default `hipp0_dev` is for local development only)
2. **Auth enabled**: `HIPP0_AUTH_REQUIRED=true` (enforced automatically when `NODE_ENV=production`)
3. **API keys**: Generated automatically on project creation. Retrieve via `GET /api/api-keys`
4. **TLS**: Configure a reverse proxy (nginx, Caddy, Traefik) with TLS termination
5. **Proxy trust**: Set `HIPP0_TRUSTED_PROXY=true` when behind a reverse proxy
6. **CORS**: Set `HIPP0_CORS_ORIGINS` to your dashboard domain
7. **Database**: Bind PostgreSQL to localhost only (default in docker-compose.yml)
8. **Secrets**: Never commit `.env` files. Use environment variables or secret management
9. **Backups**: Configure PostgreSQL backup schedule for the `nexus_nexus_pgdata` volume
10. **Monitoring**: Check `/api/health` and `/api/metrics` endpoints
