# Hipp0 Server — multi-stage Docker build
# No CACHE_BUSTER needed here — server code is not cached by browsers.
# For the dashboard (browser-cached), see Dockerfile.dashboard.
FROM node:22.12-slim AS base
LABEL maintainer="Perlantir"
LABEL org.opencontainers.image.authors="Perlantir"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp/package.json packages/mcp/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY turbo.json ./
COPY packages/ packages/
RUN pnpm --filter @hipp0/core --filter @hipp0/sdk --filter @hipp0/mcp --filter @hipp0/server build

FROM node:22.12-slim AS production
LABEL maintainer="Perlantir"
LABEL org.opencontainers.image.authors="Perlantir"

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

RUN addgroup --system hipp0 && adduser --system --ingroup hipp0 hipp0

COPY --from=base /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=base /app/packages/core/package.json packages/core/
COPY --from=base /app/packages/core/dist packages/core/dist/
COPY --from=base /app/packages/server/package.json packages/server/
COPY --from=base /app/packages/server/dist packages/server/dist/
COPY --from=base /app/packages/sdk/package.json packages/sdk/
COPY --from=base /app/packages/sdk/dist packages/sdk/dist/
COPY --from=base /app/node_modules node_modules/
COPY --from=base /app/packages/core/node_modules packages/core/node_modules/
COPY --from=base /app/packages/server/node_modules packages/server/node_modules/

USER hipp0

# Migrations: copied as fallback if volume mount is not provided.
# In docker-compose, ./supabase/migrations is mounted as a read-only volume.
COPY supabase/migrations /app/supabase/migrations

ENV NODE_ENV=production
EXPOSE 3100

# Health check: readiness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
