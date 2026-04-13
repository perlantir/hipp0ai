/**
 * Redis cache with graceful fallback to in-memory Map+TTL when REDIS_URL not set.
 *
 * Usage:
 *   import { cache } from './cache/redis.js';
 *   await cache.get('key');
 *   await cache.set('key', value, 300); // TTL in seconds
 *   await cache.del('key');
 *   await cache.invalidatePrefix('compile:project123');
 */

/* ------------------------------------------------------------------ */
/*  In-memory fallback (Map with TTL)                                  */
/* ------------------------------------------------------------------ */

interface MemEntry {
  value: string;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, MemEntry>();

  // Prune expired entries every 30s
  private timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) this.store.delete(k);
    }
  }, 30_000);

  constructor() {
    this.timer.unref();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.store.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  Redis-backed cache                                                 */
/* ------------------------------------------------------------------ */

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: string, ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string | number, ...args: (string | number)[]): Promise<[string, string[]]>;
  disconnect(): void;
  connect(): Promise<void>;
}

class RedisCache {
  private client: RedisLike;

  constructor(client: RedisLike) {
    this.client = client;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch {
      // Swallow — cache miss is acceptable
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      // Swallow
    }
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    try {
      let cursor = '0';
      let count = 0;
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor, 'MATCH', `${prefix}*`, 'COUNT', 100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
          count += keys.length;
        }
      } while (cursor !== '0');
      return count;
    } catch {
      return 0;
    }
  }

  async close(): Promise<void> {
    try {
      this.client.disconnect();
    } catch {
      // Swallow
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Unified CacheClient interface                                      */
/* ------------------------------------------------------------------ */

export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  invalidatePrefix(prefix: string): Promise<number>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Cache helper methods                                               */
/* ------------------------------------------------------------------ */

export const CACHE_TTL = {
  COMPILE: 300,       // 5 minutes
  PROJECT_STATS: 60,  // 1 minute
  AGENT_LIST: 300,    // 5 minutes
} as const;

export function compileKey(projectId: string, agentName: string, taskHash: string): string {
  return `compile:${projectId}:${agentName}:${taskHash}`;
}

export function projectStatsKey(projectId: string): string {
  return `stats:${projectId}`;
}

export function agentListKey(projectId: string): string {
  return `agents:${projectId}`;
}

/**
 * Invalidate all cache entries related to a project's decisions.
 * Called on: decision create, update, supersede, revert.
 */
export async function invalidateDecisionCaches(projectId: string): Promise<void> {
  await Promise.all([
    cache.invalidatePrefix(`compile:${projectId}`),
    cache.invalidatePrefix(`stats:${projectId}`),
    cache.invalidatePrefix(`agents:${projectId}`),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Singleton initialization                                           */
/* ------------------------------------------------------------------ */

let cache: CacheClient;

async function createCache(): Promise<CacheClient> {
  const redisUrl = process.env.REDIS_URL || process.env.HIPP0_REDIS_URL;

  if (redisUrl) {
    try {
      const { Redis } = await import('ioredis');
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          if (times > 5) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });
      await client.connect();
      console.warn('[hipp0/cache] Redis connected:', redisUrl.replace(/\/\/.*@/, '//<credentials>@'));
      return new RedisCache(client as unknown as RedisLike);
    } catch (err) {
      console.warn('[hipp0/cache] Redis unavailable, falling back to in-memory:', (err as Error).message);
    }
  }

  console.warn('[hipp0/cache] Using in-memory cache (REDIS_URL not set)');
  return new InMemoryCache();
}

// Eagerly initialize — exports a promise-resolved singleton
cache = new InMemoryCache(); // default until init

export async function initCache(): Promise<CacheClient> {
  cache = await createCache();
  return cache;
}

export { cache };
