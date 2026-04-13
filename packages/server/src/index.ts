// OpenTelemetry must be initialised before any instrumented modules load.
// initTelemetry() is a no-op unless HIPP0_TELEMETRY_ENABLED=true, so this
// has zero cost when telemetry is disabled.
import { initTelemetry, shutdown as shutdownTelemetry } from './telemetry.js';
await initTelemetry();

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { logStartupDiagnostics } from './routes/status.js';
import { initDb, closeDb } from '@hipp0/core/db/index.js';
import { resolveLLMConfig, logLLMConfig } from '@hipp0/core';
import { initQueues, closeQueues } from './queue/index.js';
import { handleExtractionJob } from './queue/extraction-worker.js';
import { handleIngestionJob } from './queue/ingestion-worker.js';
import { startTelegramBot, stopTelegramBot, handleTelegramNotification } from './connectors/telegram.js';
import { startOpenClawWatcher, stopOpenClawWatcher } from './connectors/openclaw-watcher.js';
import { registerGitHubWebhook } from './connectors/github.js';
import { startDiscordBot, stopDiscordBot } from './connectors/discord.js';
import { initWebSocket, getMainWss } from './websocket.js';
import { initCollabWebSocket, getCollabWss } from './collab-ws.js';
import { initEventWebSocket, getEventsWss } from './events/event-ws.js';
import type { NotificationJobData } from './queue/index.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initCache, cache } from './cache/redis.js';
import { startEvolutionWorker, stopEvolutionWorker } from './jobs/evolution-worker.js';
import { startScheduler, stopScheduler } from './jobs/reflection-scheduler.js';
import { bootstrapApiKeys } from './bootstrap-keys.js';
import { seedDemoProject } from './seed-demo-project.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV ?? 'production';

// Optional Sentry error tracking
if (process.env.SENTRY_DSN) {
  const sentryModule = '@sentry/node';
  import(sentryModule).then((Sentry: Record<string, any>) => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: NODE_ENV,
      tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    console.warn('[hipp0] Sentry error tracking: enabled');
  }).catch((err: unknown) => {
    console.warn('[hipp0] Sentry init failed (package may not be installed):', (err as Error).message);
  });
}

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Locate the dashboard dist directory by checking several candidate paths.
 * Returns the directory path (containing index.html) or null when not found.
 */
function resolveDashboardPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'dashboard', 'dist'),
    path.resolve(__dirname, '..', '..', '..', 'dashboard', 'dist'),
    path.resolve(process.cwd(), 'dashboard'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

async function main() {
  // Validate required environment
  if (!process.env.DATABASE_URL) {
    console.error('[hipp0] FATAL: DATABASE_URL environment variable is not set.');
    console.error('[hipp0] Set it in .env or docker-compose.yml:');
    console.error('  DATABASE_URL=postgresql://hipp0:hipp0_dev@postgres:5432/hipp0');
    process.exit(1);
  }

  // Auto-detect and connect to the database (SQLite or PostgreSQL).
  let db;
  try {
    db = await initDb();
    console.warn(`[hipp0] Database connected (${db.dialect})`);
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[hipp0] FATAL: Cannot connect to database:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error('[hipp0] Stack trace:', err.stack);
    }
    process.exit(1);
  }

  // Verify data exists (warn if empty — may indicate wrong volume)
  try {
    const { rows } = await db.query('SELECT count(*) as c FROM decisions', []);
    const count = parseInt((rows[0] as Record<string, unknown>)?.c as string ?? '0', 10);
    if (count === 0) {
      console.warn('[hipp0] WARNING: Database has 0 decisions. If you expected data, check your Docker volume.');
    } else {
      console.warn(`[hipp0] Database contains ${count} decisions`);
    }
  } catch { /* table may not exist yet — migrations will create it */ }

  // Clear context cache on startup — prevents stale cached results from a
  // previous deployment (e.g. after a revert or scoring algorithm change)
  // from poisoning fresh compile calls.
  try {
    const delResult = await db.query('DELETE FROM context_cache', []);
    const deleted = delResult.rowCount ?? 0;
    if (deleted > 0) {
      console.warn(`[hipp0] Cleared ${deleted} stale context_cache entries on startup`);
    }
  } catch { /* table may not exist yet */ }

    // Seed demo project for public playground.
    // MUST run before bootstrapApiKeys so the demo project (created on
    // first boot) gets an API key emitted to the journal in the same
    // bootstrap cycle. Otherwise the demo project would only get a key
    // on the *second* boot, breaking single-shot deploy capture flows.
  try {
    await seedDemoProject();
  } catch (err) {
    console.warn('[hipp0] Demo seed failed (non-fatal):', (err as Error).message);
  }

    // Bootstrap API keys for keyless projects (runs after seed-demo so
    // the just-seeded project gets a key on its very first boot).
  await bootstrapApiKeys();

  logLLMConfig(resolveLLMConfig());

    // Initialize cache
  await initCache();

    // Initialize job queues
  const notificationHandler = async (data: NotificationJobData): Promise<void> => {
    // Route notifications to the appropriate connector
    if (data.source === 'telegram') {
      await handleTelegramNotification(data);
    }
    // Additional notification handlers (webhooks, etc.) can be added here
  };

  const queueEnabled = await initQueues(
    handleExtractionJob,
    handleIngestionJob,
    notificationHandler,
  );
  console.warn(`[hipp0] Queue: ${queueEnabled ? 'BullMQ (Redis connected)' : 'inline mode (Redis not configured)'}`);

    // Start connectors
  const telegramStarted = startTelegramBot();

  const openclawStarted = startOpenClawWatcher();
  const discordStarted = await startDiscordBot();
  if (!openclawStarted && !telegramStarted && !discordStarted) {
    console.warn('[hipp0] Auto-discovery: no connectors configured');
  }

  // Log contradiction detection
  console.warn('[hipp0] Contradiction detection: enabled (semantic threshold: 0.40)');

  // Staleness cron — run on startup + every 24 hours
  const runStalenessCheck = async () => {
    try {
      const { markStaleDecisions } = await import('@hipp0/core/intelligence/staleness-tracker.js');
      const stalDb = (await import('@hipp0/core/db/index.js')).getDb();
      const result = await stalDb.query('SELECT id FROM projects', []);
      for (const row of result.rows) {
        const projectId = (row as Record<string, unknown>).id as string;
        await markStaleDecisions(projectId);
      }
      console.warn('[hipp0/staleness] Staleness check completed');
    } catch (err) {
      console.warn('[hipp0/staleness] Check failed:', (err as Error).message);
    }
  };
  void runStalenessCheck();
  setInterval(() => void runStalenessCheck(), 24 * 60 * 60 * 1000);

  // Weekly digest cron — every Monday at 8:00 AM UTC
  const runWeeklyDigests = async () => {
    try {
      const { generateDigest } = await import('@hipp0/core/intelligence/weekly-digest.js');
      const digDb = (await import('@hipp0/core/db/index.js')).getDb();
      const projects = await digDb.query(
        `SELECT p.id FROM projects p
         JOIN decisions d ON d.project_id = p.id AND d.status = 'active'
         GROUP BY p.id HAVING COUNT(*) >= 20`,
        [],
      );
      for (const row of projects.rows) {
        const pid = (row as Record<string, unknown>).id as string;
        try {
          await generateDigest(pid);
          console.warn(`[hipp0/digest] Generated for project ${pid}`);
        } catch (err) {
          console.warn(`[hipp0/digest] Failed for project ${pid}:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn('[hipp0/digest] Weekly digest run failed:', (err as Error).message);
    }
  };
  // Schedule: check every hour, run on Monday 8 AM UTC
  setInterval(() => {
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
      void runWeeklyDigests();
    }
    // Pattern extraction at 10 AM UTC Monday (after digests)
    if (now.getUTCDay() === 1 && now.getUTCHours() === 10 && now.getUTCMinutes() < 5) {
      import('@hipp0/core/intelligence/pattern-extractor.js')
        .then(({ extractPatterns }) => extractPatterns())
        .then(() => console.warn('[hipp0/patterns] Weekly extraction complete'))
        .catch((err: Error) => console.warn('[hipp0/patterns] Extraction failed:', err.message));
    }
  }, 5 * 60 * 1000); // check every 5 minutes

  // Evolution worker — daily scan at 6 AM UTC
  startEvolutionWorker();

  // Distillery drain loop — drains the in-memory extraction queue once
  // the circuit breakers return to closed state after an outage.
  try {
    const { startDistilleryDrainLoop } = await import('@hipp0/core/intelligence/resilience.js');
    startDistilleryDrainLoop();
  } catch (err) {
    console.warn('[hipp0] Distillery drain loop failed to start:', (err as Error).message);
  }

  const app = createApp();

    // Register GitHub PR webhook
  registerGitHubWebhook(app);
  if (process.env.HIPP0_GITHUB_WEBHOOK_SECRET) {
    console.warn('[hipp0] GitHub PR webhook: active');
  }

  // Dashboard static files are served when running without Docker
  // (npm start mode). In Docker, nginx serves the dashboard separately.
  // The dashboard must be pre-built (cd packages/dashboard && pnpm build)
  // before these paths resolve correctly.

  // Serve the dashboard static files when they are available (non-Docker mode).
  // Dashboard path is resolved by resolveDashboardPath() which checks several
  // candidate directories relative to the server build output.
  const dashboardDist = resolveDashboardPath();
  if (dashboardDist) {
    app.get('/dashboard/*', serveStatic({ root: dashboardDist }));
    app.get('/dashboard', (c) => c.redirect('/dashboard/'));
    console.warn(`[hipp0] Dashboard: http://${HOST}:${PORT}/dashboard`);
  }

  const server = serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: HOST,
    },
    (info) => {
      console.warn(`[hipp0] Server started`);
      console.warn(`[hipp0] Listening on http://${HOST}:${info.port}`);
      console.warn(`[hipp0] Environment: ${NODE_ENV}`);
      // Log system diagnostics after startup
      logStartupDiagnostics().catch(() => {});

      // Start the reflection scheduler after the HTTP server is listening.
      // Wrapped in try/catch so scheduler failure never prevents the server
      // from serving requests.
      try {
        startScheduler();
      } catch (err) {
        console.warn(
          '[hipp0] Reflection scheduler failed to start:',
          (err as Error).message,
        );
      }
    },
  );

  // Initialise WebSocket servers in noServer mode
  initWebSocket();
  initCollabWebSocket();
  initEventWebSocket();

  // Route HTTP upgrade requests to the correct WebSocketServer by path
  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';

    if (url.startsWith('/ws/room')) {
      const collabWss = getCollabWss();
      if (collabWss) {
        collabWss.handleUpgrade(req, socket, head, (ws) => {
          collabWss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    } else if (url.startsWith('/ws/events')) {
      const eventsWss = getEventsWss();
      if (eventsWss) {
        eventsWss.handleUpgrade(req, socket, head, (ws) => {
          eventsWss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    } else if (url === '/ws' || url.startsWith('/ws?')) {
      const mainWss = getMainWss();
      if (mainWss) {
        mainWss.handleUpgrade(req, socket, head, (ws) => {
          mainWss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    } else {
      // Unknown WS path — reject the upgrade
      socket.destroy();
    }
  });

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.warn(`\n[hipp0] Received ${signal}. Shutting down gracefully...`);

    // Stop connectors and workers first
    try {
      stopScheduler();
    } catch (err) {
      console.warn('[hipp0] Error stopping scheduler:', (err as Error).message);
    }
    stopEvolutionWorker();
    stopTelegramBot();
    await stopDiscordBot();
    await stopOpenClawWatcher();
    await closeQueues();
    await cache.close();

    server.close(async () => {
      console.warn('[hipp0] HTTP server closed');

      try {
        await closeDb();
        console.warn('[hipp0] Database closed');
      } catch (err) {
        console.error('[hipp0] Error closing database:', (err as Error).message);
      }

      // Flush any pending OTel spans/metrics
      try {
        await shutdownTelemetry();
      } catch (err) {
        console.warn('[hipp0] Telemetry shutdown failed:', (err as Error).message);
      }

      console.warn('[hipp0] Shutdown complete');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      console.error('[hipp0] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    console.error('[hipp0] Uncaught exception:', err);
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[hipp0] Unhandled rejection:', reason);
  });
}

main().catch((err) => {
  console.error('[hipp0] Fatal startup error:', err);
  process.exit(1);
});
