/**
 * BullMQ Job Queue — central queue infrastructure for ingestion.
 *
 * Three queues:
 *   decision-extraction  — raw text → Distillery → structured decision JSON
 *   decision-ingestion   — structured decision → validate → embed → insert
 *   decision-notification — optional: reply in Telegram / webhook
 *
 * If HIPP0_REDIS_URL is not set, jobs are processed inline (no queue).
 */
import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

  // Types

export interface ExtractionJobData {
  raw_text: string;
  source: 'telegram' | 'openclaw' | 'api' | 'discord' | 'slack' | 'github';
  source_session_id: string;
  made_by: string;
  project_id: string;
}

export interface IngestionJobData {
  title: string;
  description: string;
  tags: string[];
  affects: string[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  alternatives_considered: Array<{ option: string; rejected_reason: string }>;
  source: 'telegram' | 'openclaw' | 'api' | 'discord' | 'slack' | 'github';
  source_session_id: string;
  made_by: string;
  project_id: string;
}

export interface NotificationJobData {
  title: string;
  source: 'telegram' | 'openclaw' | 'api' | 'discord' | 'slack' | 'github';
  chat_id?: string | number;
  message_id?: number;
  decision_id: string;
}

  // Queue instances (null when Redis not configured)

let extractionQueue: Queue<ExtractionJobData> | null = null;
let ingestionQueue: Queue<IngestionJobData> | null = null;
let notificationQueue: Queue<NotificationJobData> | null = null;

let extractionWorker: Worker<ExtractionJobData> | null = null;
let ingestionWorker: Worker<IngestionJobData> | null = null;
let notificationWorker: Worker<NotificationJobData> | null = null;

let redisConnection: Redis | null = null;

  // Inline processing fallback

type InlineExtractionHandler = (data: ExtractionJobData) => Promise<void>;
type InlineIngestionHandler = (data: IngestionJobData) => Promise<void>;
type InlineNotificationHandler = (data: NotificationJobData) => Promise<void>;

let _inlineExtraction: InlineExtractionHandler | null = null;
let _inlineIngestion: InlineIngestionHandler | null = null;
let _inlineNotification: InlineNotificationHandler | null = null;

  // Inline stats (when no Redis)

let _inlineStats = { pending: 0, completed: 0, failed: 0 };

  // Public API

export function isQueueEnabled(): boolean {
  return _inlineExtraction !== null || extractionQueue !== null;
}

export function getQueues() {
  return { extractionQueue, ingestionQueue, notificationQueue };
}

/**
 * Add a job to the extraction queue (or process inline if no Redis).
 */
export async function addExtractionJob(data: ExtractionJobData): Promise<void> {
  if (extractionQueue) {
    await extractionQueue.add('extract', data, {
      attempts: 3,
      backoff: { type: 'custom' },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    console.warn(`[hipp0/queue] Extraction job added: source=${data.source} by=${data.made_by}`);
  } else if (_inlineExtraction) {
    // Inline fallback — process synchronously
    _inlineStats.pending++;
    try {
      await _inlineExtraction(data);
      _inlineStats.completed++;
    } catch (err) {
      _inlineStats.failed++;
      console.error('[hipp0/queue] Inline extraction failed:', (err as Error).message);
    }
    _inlineStats.pending = Math.max(0, _inlineStats.pending - 1);
  }
}

/**
 * Unified interface for connectors — routes to queue or inline automatically.
 */
export const submitForExtraction = addExtractionJob;

/**
 * Add a job to the ingestion queue (or process inline if no Redis).
 */
export async function addIngestionJob(data: IngestionJobData): Promise<void> {
  if (ingestionQueue) {
    await ingestionQueue.add('ingest', data, {
      attempts: 3,
      backoff: { type: 'custom' },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  } else if (_inlineIngestion) {
    try {
      await _inlineIngestion(data);
    } catch (err) {
      console.error('[hipp0/queue] Inline ingestion failed:', (err as Error).message);
    }
  }
}

/**
 * Add a job to the notification queue (or process inline if no Redis).
 */
export async function addNotificationJob(data: NotificationJobData): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.add('notify', data, {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 100,
    });
  } else if (_inlineNotification) {
    try {
      await _inlineNotification(data);
    } catch (err) {
      console.error('[hipp0/queue] Inline notification failed:', (err as Error).message);
    }
  }
}

/**
 * Custom backoff strategy: 1s, 5s, 30s
 */
function customBackoff(attemptsMade: number): number {
  const delays = [1000, 5000, 30000];
  return delays[Math.min(attemptsMade - 1, delays.length - 1)] ?? 30000;
}

/**
 * Initialize BullMQ queues and workers.
 * Returns true if Redis is available, false for inline fallback.
 */
export async function initQueues(
  extractionHandler: InlineExtractionHandler,
  ingestionHandler: InlineIngestionHandler,
  notificationHandler: InlineNotificationHandler,
): Promise<boolean> {
  const redisUrl = process.env.HIPP0_REDIS_URL;

  // Store inline handlers regardless (used as fallback)
  _inlineExtraction = extractionHandler;
  _inlineIngestion = ingestionHandler;
  _inlineNotification = notificationHandler;

  if (!redisUrl) {
    console.warn('[hipp0/queue] No HIPP0_REDIS_URL — using inline processing (no queue)');
    return false;
  }

  try {
    redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });
    await redisConnection.connect();
    console.warn(`[hipp0/queue] Redis connected: ${redisUrl}`);
  } catch (err) {
    console.warn(`[hipp0/queue] Redis unavailable (${(err as Error).message}) — using inline processing`);
    redisConnection = null;
    return false;
  }

  const connection: ConnectionOptions = redisConnection as unknown as ConnectionOptions;

  // Create queues
  extractionQueue = new Queue<ExtractionJobData>('decision-extraction', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  ingestionQueue = new Queue<IngestionJobData>('decision-ingestion', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  notificationQueue = new Queue<NotificationJobData>('decision-notification', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });

  // Create workers
  extractionWorker = new Worker<ExtractionJobData>(
    'decision-extraction',
    async (job: Job<ExtractionJobData>) => {
      await extractionHandler(job.data);
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60000 },
      settings: {
        backoffStrategy: customBackoff,
      },
    },
  );

  ingestionWorker = new Worker<IngestionJobData>(
    'decision-ingestion',
    async (job: Job<IngestionJobData>) => {
      await ingestionHandler(job.data);
    },
    {
      connection,
      concurrency: 5,
      settings: {
        backoffStrategy: customBackoff,
      },
    },
  );

  notificationWorker = new Worker<NotificationJobData>(
    'decision-notification',
    async (job: Job<NotificationJobData>) => {
      await notificationHandler(job.data);
    },
    {
      connection,
      concurrency: 3,
    },
  );

  // Error logging
  for (const w of [extractionWorker, ingestionWorker, notificationWorker]) {
    w.on('failed', (job, err) => {
      const name = job?.name ?? 'unknown';
      const attempts = job?.attemptsMade ?? 0;
      console.error(`[hipp0/queue] Job ${name} failed (attempt ${attempts}):`, err.message);
    });
  }

  console.warn('[hipp0/queue] BullMQ queues initialized: extraction, ingestion, notification');
  return true;
}

/**
 * Get queue stats for /api/status.
 */
export async function getQueueStats(): Promise<Record<string, unknown>> {
  if (!extractionQueue || !ingestionQueue || !notificationQueue) {
    return {
      enabled: true,
      mode: 'inline',
      pending: _inlineStats.pending,
      completed: _inlineStats.completed,
      failed: _inlineStats.failed,
    };
  }

  try {
    const [extCounts, ingCounts, notCounts] = await Promise.all([
      extractionQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      ingestionQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      notificationQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ]);

    return {
      enabled: true,
      mode: 'bullmq',
      extraction: extCounts,
      ingestion: ingCounts,
      notification: notCounts,
    };
  } catch {
    return { enabled: true, mode: 'bullmq', error: 'Failed to fetch queue stats' };
  }
}

/**
 * Graceful shutdown — close workers and queues.
 */
export async function closeQueues(): Promise<void> {
  const closables = [
    extractionWorker, ingestionWorker, notificationWorker,
    extractionQueue, ingestionQueue, notificationQueue,
  ].filter(Boolean);

  await Promise.allSettled(closables.map((c) => c!.close()));

  if (redisConnection) {
    try { redisConnection.disconnect(); } catch { /* ignore */ }
  }

  console.warn('[hipp0/queue] Queues closed');
}
