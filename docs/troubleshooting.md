# Troubleshooting

Things break. This is the page where we collect everything that has broken for real users, what the actual error message looks like, why it happens, and how to fix it. If you hit something that isn't here, open an issue and we'll add it.

The table of contents below jumps by category. Most errors come in a few flavors — install, CLI, Docker, dashboard, compile, framework integration, deployment — so if you don't know what's wrong, start with the section that matches where you saw the error.

- [Installation errors](#installation-errors)
- [CLI errors](#cli-errors)
- [Docker errors](#docker-errors)
- [Dashboard errors](#dashboard-errors)
- [Compile errors](#compile-errors)
- [Framework integration errors](#framework-integration-errors)
- [Deployment errors](#deployment-errors)

![Hipp0 dashboard status panel](images/troubleshooting-dashboard.png)

---

## Installation errors

### `pnpm: command not found`

```
$ pnpm install
bash: pnpm: command not found
```

**Root cause:** Hipp0 uses pnpm workspaces and pnpm isn't installed globally.

**Fix:**

```bash
# Option 1: corepack (shipped with Node 16+)
corepack enable
corepack prepare pnpm@latest --activate

# Option 2: standalone installer
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Option 3: npm
npm install -g pnpm
```

Then reopen your shell (or `source ~/.bashrc`) and verify:

```bash
pnpm --version  # should print 9.x or later
```

### `Permission denied on .npm cache`

```
npm ERR! code EACCES
npm ERR! syscall mkdir
npm ERR! path /root/.npm
npm ERR! errno -13
```

**Root cause:** You ran `npm install` as one user and are now running as another. Common when switching between sudo and non-sudo, or when Docker creates files owned by root.

**Fix:**

```bash
sudo chown -R $(whoami):$(id -gn) ~/.npm
# If the project node_modules is also owned wrong:
sudo chown -R $(whoami):$(id -gn) ./node_modules
```

Never run `pnpm install` with sudo. If the project directory has bad ownership, fix it:

```bash
sudo chown -R $(whoami):$(id -gn) .
```

### `Cannot find module '@hipp0/core'`

```
Error: Cannot find module '@hipp0/core'
Require stack:
- /app/packages/server/dist/index.js
```

**Root cause:** Workspace packages weren't built. Hipp0 is a monorepo with TypeScript packages that need to be compiled before they can be imported.

**Fix:**

```bash
pnpm install
pnpm build
```

If the build fails partway through:

```bash
pnpm -r clean
pnpm install
pnpm -r build
```

The `-r` flag runs the command in every workspace package.

### `better-sqlite3` native compilation failures

```
gyp ERR! build error
gyp ERR! stack Error: not found: make
```

or

```
error: cannot find Python executable "python", you can set the PYTHON env variable
```

**Root cause:** `better-sqlite3` is a native module and needs a C++ toolchain + Python to compile.

**Fix:**

Ubuntu/Debian:

```bash
sudo apt-get install -y build-essential python3
```

macOS:

```bash
xcode-select --install
```

Alpine (Docker):

```bash
apk add --no-cache python3 make g++
```

After installing the toolchain:

```bash
pnpm rebuild better-sqlite3
```

If you don't need SQLite (Postgres-only deploys), you can skip it:

```bash
pnpm install --ignore-scripts=false --filter='!better-sqlite3'
```

---

## CLI errors

### `hipp0: command not found`

```
$ hipp0 list
bash: hipp0: command not found
```

**Root cause:** Either the CLI isn't installed, or `.env` wasn't sourced and the shim doesn't know where to find it.

**Fix:**

```bash
# Install globally
npm install -g @hipp0/cli

# Or use npx
npx @hipp0/cli list

# Or if you cloned the repo
./packages/cli/bin/hipp0 list
```

If `hipp0` is installed but commands fail because of missing env vars, source your project `.env`:

```bash
cd my-project
source .env
hipp0 list
```

### `ECONNREFUSED 127.0.0.1:3100`

```
$ hipp0 list
Error: connect ECONNREFUSED 127.0.0.1:3100
```

**Root cause:** The Hipp0 server isn't running on the expected port.

**Fix:**

```bash
# Check if anything is listening
lsof -i :3100
# or
curl -v http://localhost:3100/health

# If nothing is there, start the server
docker compose up -d server
# or for a local dev server
pnpm --filter @hipp0/server dev
```

If you ran the server on a non-default port:

```bash
export HIPP0_API_URL=http://localhost:8080
hipp0 list
```

### `HIPP0_PROJECT_ID not set`

```
$ hipp0 list
Error: HIPP0_PROJECT_ID is not set. Run `hipp0 init <project-name>` first.
```

**Root cause:** The CLI needs to know which project to read from. It picks the ID up from `HIPP0_PROJECT_ID` in the environment.

**Fix:**

```bash
# Create a project
hipp0 init my-project
# That writes a .env file with HIPP0_PROJECT_ID=proj_01h...

# Load it
source .env

# Now commands work
hipp0 list
```

If you already have a project and just need to find its ID:

```bash
hipp0 projects list
```

### `Invalid API key`

```
$ hipp0 list
Error: 401 Unauthorized - Invalid API key
```

**Root cause:** `HIPP0_API_KEY` is missing, wrong, or belongs to a different project.

**Fix:**

```bash
# Check what the CLI thinks the key is
echo $HIPP0_API_KEY

# Regenerate a key via CLI
hipp0 keys create --project $HIPP0_PROJECT_ID

# Or via dashboard: Settings -> API Keys -> Create
```

If the key looks right but still fails, the server might be running a different version of auth. Check the server logs:

```bash
docker logs hipp0-server | grep -i auth
```

Common gotcha: if you've got HIPP0_API_KEY exported in your shell AND in `.env`, the shell export wins and might be stale.

---

## Docker errors

### `Cannot connect to Docker daemon`

```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock.
Is the docker daemon running?
```

**Root cause:** Docker daemon isn't running, or your user isn't in the `docker` group.

**Fix:**

```bash
# Is it running?
sudo systemctl status docker
sudo systemctl start docker

# Are you in the docker group?
groups | grep docker

# Add yourself
sudo usermod -aG docker $USER
# Log out and back in (group membership is per-session)
```

On macOS, make sure Docker Desktop is actually running — the menu-bar whale icon should be steady, not animated.

### Postgres connection refused

```
server-1  | Error: FATAL: connection to "postgres:5432" refused
```

**Root cause:** The server container started before Postgres was ready. `depends_on` in docker-compose doesn't wait for the service to be *healthy*, only for it to be created.

**Fix:** Add a healthcheck-aware restart policy. Our `docker-compose.yml` already has this — if you're seeing this error, you might be on an older compose file:

```yaml
services:
  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hipp0"]
      interval: 5s
      retries: 10

  server:
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
```

If you can't change the compose file, a brute-force workaround:

```bash
docker compose up -d postgres
sleep 5
docker compose up -d server
```

### Migration runner fails

```
server-1  | Error: Cannot read properties of undefined (reading 'length')
server-1  |     at postgres-adapter.ts:47
```

**Root cause:** Multi-statement migrations return `result.rows = undefined` for DDL. This was fixed in April 2025 but older images still have it.

**Fix:** Update to the latest image:

```bash
docker compose pull server
docker compose up -d server
```

If you're building from source, make sure you're past the `postgres-adapter.ts` fix:

```bash
git pull
pnpm build
docker compose build --no-cache server
docker compose up -d server
```

### Container exits immediately

```
$ docker ps
CONTAINER ID   STATUS
abc123         Exited (1) 2 seconds ago
```

**Root cause:** Too many possibilities to list. Something failed at startup.

**Fix:** Get the logs.

```bash
docker logs hipp0-server 2>&1 | tail -50
```

The error will be somewhere in that output. Common ones:

- `FATAL: role "hipp0" does not exist` → see the Docker volume section below
- `EADDRINUSE` → something else is on port 3100
- `Cannot find module` → build didn't finish; see installation errors
- `DATABASE_URL is not set` → `.env` isn't being loaded into the container

Check env vars inside the container:

```bash
docker exec hipp0-server printenv | grep -E "DATABASE_URL|HIPP0"
```

### `role "hipp0" does not exist`

```
FATAL: role "hipp0" does not exist
```

**Root cause:** Docker created a fresh Postgres volume without the expected user. Usually because the volume was renamed in `docker-compose.yml`.

**Fix:**

```bash
# See what volumes exist
docker volume ls | grep pgdata

# See what volume the DB container is using
docker inspect hipp0-db | grep -A5 Mounts
```

If the existing volume has a different name than the one in docker-compose, either:

1. Change docker-compose to point at the old volume name, or
2. Create the role manually:

```bash
docker exec -it hipp0-db psql -U postgres -c "CREATE USER hipp0 WITH PASSWORD 'hipp0_dev' SUPERUSER;"
docker exec -it hipp0-db psql -U postgres -c "CREATE DATABASE hipp0 OWNER hipp0;"
```

Never rename the volume in docker-compose if you have real data. Doing so creates a new empty volume and hides your old data (it's still there, in the old volume).

---

## Dashboard errors

### Blank white page

You load the dashboard and see nothing. DevTools console shows an error like:

```
Failed to load module script: Expected a JavaScript module script but the
server responded with a MIME type of "text/html"
```

**Root cause:** The dashboard container is serving `index.html` for every request, including `.js` files. Usually a misconfigured nginx.

**Fix:** Check `packages/dashboard/nginx.conf` for the `location /` block. It should have `try_files $uri $uri/ /index.html;` but only match actual HTML routes, not asset paths.

Rebuild the dashboard:

```bash
docker compose build --no-cache dashboard
docker compose up -d dashboard
```

### "Loading..." forever

The dashboard shows "Loading..." and never renders. DevTools Network tab shows `/api/projects` pending forever or 500ing.

**Root cause:** Dashboard can't reach the API. Either the API is down or the proxy is broken.

**Fix:**

```bash
# Can curl reach the API directly?
curl -s http://localhost:3100/api/projects

# Can curl reach through the dashboard proxy?
curl -s http://localhost:3200/api/projects
```

If the direct call works but the proxy doesn't, nginx upstream is wrong. Check `nginx.conf`:

```nginx
upstream api {
    server server:3100;
}

location /api/ {
    proxy_pass http://api;
}
```

The upstream name `server` must match the service name in `docker-compose.yml`.

### WebSocket connection failed

```
WebSocket connection to 'ws://localhost:3200/ws' failed
```

**Root cause:** nginx isn't upgrading the WebSocket connection. The live events panel on the dashboard relies on it.

**Fix:** Add these headers to the `/ws` location block in nginx:

```nginx
location /ws {
    proxy_pass http://api/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

Restart:

```bash
docker compose restart dashboard
```

### `Cannot read properties of undefined`

```
TypeError: Cannot read properties of undefined (reading 'map')
    at DecisionList.tsx:42
```

**Root cause:** The API returned something the dashboard didn't expect. Usually an error object where an array was expected.

**Fix:** Check the network tab for the failing request. The response body will show what the API actually returned. Common causes:

- Authentication expired — refresh the page
- Project was deleted but the dashboard still has it in local storage — clear local storage
- API returned `{ error: "..." }` instead of `{ data: [] }` — check server logs

Clear local storage if you suspect stale state:

```js
// In DevTools console:
localStorage.clear()
location.reload()
```

---

## Compile errors

### "No decisions found"

```
$ hipp0 compile architect "design the api"
No relevant decisions found.
```

**Root cause:** The project has no decisions, or none of them match the task description above the relevance threshold.

**Fix:**

```bash
# Do any decisions exist at all?
hipp0 list

# If yes, see why they're not matching
hipp0 compile architect "design the api" --debug --min-relevance 0

# The --debug output shows every decision with its score.
# If the top score is under 0.3, there's no real semantic overlap.
```

Common reasons for no matches:

- Different project_id (check `echo $HIPP0_PROJECT_ID`)
- Different namespace (`--namespace` flag)
- Decisions were made by a different agent and you didn't set `--include-all-agents`

### "Database query error" from compile

```
Error: database query error: column "trust_multiplier" does not exist
```

**Root cause:** Migrations haven't run against this database, or the server is a newer version than the schema.

**Fix:**

```bash
# Re-run migrations
docker compose exec server node -e "
const { createAdapter } = require('./packages/core/dist/db/factory.js');
(async () => {
  const a = await createAdapter();
  await a.connect();
  await a.runMigrations('/app/supabase/migrations');
  console.log('Done');
  process.exit(0);
})();
"
```

Or rebuild the server, which runs migrations at startup:

```bash
docker compose down server
docker compose up -d server
```

### Trust multiplier not in debug output

```
$ hipp0 compile architect "task" --debug
...
(no trust_multiplier field)
```

**Root cause:** You're on an older server that doesn't yet expose the trust multiplier in debug output. It was added in 0.5.

**Fix:** Upgrade the server:

```bash
docker compose pull server
docker compose up -d server
```

### Contradictions not detected

You made two clearly contradictory decisions but Hipp0 doesn't flag them.

**Root cause:** One of:

- Embeddings aren't being computed (no embedding provider set)
- The similarity threshold is too high (default 0.82)
- The decisions are in different namespaces or projects

**Fix:**

```bash
# Check embedding provider
echo $HIPP0_EMBEDDING_PROVIDER
# Should be 'openai' or 'local'

# Lower the threshold for a test
HIPP0_CONTRADICTION_THRESHOLD=0.6 hipp0 reanalyze --project $HIPP0_PROJECT_ID

# Force reindex of embeddings
hipp0 reindex --project $HIPP0_PROJECT_ID
```

If embeddings aren't running, you'll see "No embedding provider configured" in the server logs at startup. Set one:

```bash
# Use OpenAI embeddings
export HIPP0_EMBEDDING_PROVIDER=openai
export OPENAI_API_KEY=sk-...

# Or use local (no API required)
export HIPP0_EMBEDDING_PROVIDER=local
```

Then restart the server.

---

## Framework integration errors

### CrewAI: `Hipp0CrewCallback is not callable`

```
TypeError: 'Hipp0CrewCallback' object is not callable
```

**Root cause:** You passed the callback *instance* to CrewAI instead of its `on_task_complete` method.

**Fix:**

```python
# Wrong
crew = Crew(..., task_callback=hipp0_cb)

# Right
crew = Crew(..., task_callback=hipp0_cb.on_task_complete)
```

See the [CrewAI guide](framework-guides/crewai.md) for the full pattern.

### LangGraph: `Cannot find langgraph.checkpoint`

```
ImportError: No module named 'langgraph.checkpoint'
```

**Root cause:** Pre-0.2 LangGraph. The checkpoint module was added in 0.2.

**Fix:**

```bash
pip install --upgrade "langgraph>=0.2.0"
```

Check:

```bash
python -c "from langgraph.checkpoint.base import BaseCheckpointSaver; print('ok')"
```

### Auto-instrumentation not capturing

You installed one of the framework packages but no decisions appear.

**Root cause:** Usually one of:

- Server isn't reachable (wrong `HIPP0_API_URL`)
- Project ID is wrong
- Hooks aren't wired into the right lifecycle point
- The agent isn't producing structured output the distillery can parse

**Fix:** Enable debug logging to see what the integration is doing:

```bash
export HIPP0_DEBUG=1
python main.py
```

You'll see every API call the integration makes. If you see zero calls, the hook isn't wired. If you see calls but they all return errors, check the server logs.

Also tail events in another terminal:

```bash
hipp0 events --follow
```

Run your code. Every task/step should produce an event. No events = no integration.

### Missing decisions after passive capture

You ran an agent, events show up, but `hipp0 list` is empty.

**Root cause:** Passive capture sends raw events to the distillery for async extraction. If the distillery hasn't run yet, nothing appears.

**Fix:**

```bash
# Force distillery to run now
hipp0 distill --project $HIPP0_PROJECT_ID

# Or wait ~60 seconds; it runs on a timer
```

If forced distillation still produces nothing, the raw content doesn't have anything extraction-worthy. Check what was captured:

```bash
hipp0 events --project $HIPP0_PROJECT_ID --limit 10
```

Look at the `content` field of the events. If they're all tiny tool call results with no structured decision language, the distillery won't find anything. You need to record decisions explicitly:

```python
client.record_decision(
    project_id=project_id,
    title="...",
    reasoning="...",
    made_by="agent_name",
)
```

---

## Deployment errors

### Cloudflare 308 redirect loop

```
$ curl -v https://hipp0.example.com/api/projects
< HTTP/2 308
< location: https://hipp0.example.com/api/projects
```

And it just keeps going.

**Root cause:** Cloudflare is set to "Always Use HTTPS" but your origin is redirecting HTTPS to HTTPS, creating a loop. Usually because origin nginx has a `return 301 https://$host...` that fires regardless of the `X-Forwarded-Proto` header.

**Fix:** In nginx, check `X-Forwarded-Proto` before redirecting:

```nginx
if ($http_x_forwarded_proto != "https") {
    return 301 https://$host$request_uri;
}
```

Or set Cloudflare SSL mode to "Full (strict)" and let the origin speak HTTPS directly.

### "Non-standard port cannot be proxied"

Cloudflare shows:

```
Error 521: Web server is down
```

or you see "non-standard port cannot be proxied" in Cloudflare docs.

**Root cause:** Cloudflare's proxy only supports a specific set of ports (80, 443, 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096, 8080, 8443, 8880). You put Hipp0 on port 3100 which isn't in the list.

**Fix:** Either:

1. Move Hipp0 to port 8080 or 443
2. Turn off Cloudflare proxy (gray cloud) for that hostname and go direct
3. Put an nginx or Caddy in front of Hipp0 on port 443 and reverse-proxy to 3100 internally

Option 3 is what we recommend in [self-hosting.md](self-hosting.md).

### SMTP auth failures

```
server-1  | Error: Invalid login: 535 5.7.8 Authentication credentials invalid
```

**Root cause:** `SMTP_USER` / `SMTP_PASS` in `.env` are wrong, or your provider requires app-specific passwords.

**Fix:**

```bash
# Test credentials from the container
docker exec hipp0-server node -e "
const n = require('nodemailer');
const t = n.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
t.verify((err) => console.log(err ? 'FAIL: ' + err.message : 'OK'));
"
```

Gmail: use an app-specific password, not your login password. Enable 2FA first, then create the app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).

SendGrid: user is literally `apikey`, pass is your API key.

Mailgun: user is `postmaster@yourdomain.com`, pass is the SMTP password from the domain settings page.

### HSTS cache issues

After switching a domain from HTTP to HTTPS (or vice versa), browsers refuse to load the site or show a hard security error.

```
Your connection is not private
NET::ERR_CERT_AUTHORITY_INVALID
```

**Root cause:** HSTS (HTTP Strict Transport Security) tells browsers to always use HTTPS for a domain. Once set, you can't go back for the max-age period.

**Fix:**

- In the browser: Chrome → `chrome://net-internals/#hsts` → "Delete domain security policies" → enter your hostname
- Firefox: clear site data for the domain
- Safari: clear history
- Don't set `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` unless you really mean it. For testing, use `max-age=300`.

If you submitted your domain to the HSTS preload list, you'll need to wait for the browser preload list to update (months). Prevention is better than cure here.

---

## Still stuck?

If you've worked through this page and the thing still doesn't work:

1. Grab the exact error message and the command that produced it
2. Run `hipp0 doctor` — it collects versions, env vars, and connection checks into a single report
3. Open an issue at [github.com/hipp0/hipp0/issues](https://github.com/hipp0/hipp0/issues) with the output

Include:

- Hipp0 version (`hipp0 --version`)
- OS and Docker version
- Full error message with stack trace
- What you were trying to do

We usually respond within a day. If it's a bug, we'll fix it and the fix lands in the next release.
