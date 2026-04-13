/**
 * Resilience primitives: exponential-backoff retry + circuit breaker.
 *
 * These wrap external calls (LLM providers, webhooks, embedding APIs) so
 * that transient faults don't take down the server and extended outages
 * don't pile up calls against a dead upstream.
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ name: 'anthropic' });
 *   const result = await breaker.execute(() =>
 *     withRetry(() => callLLM(prompt), { maxRetries: 3 }),
 *   );
 *
 * Design notes:
 *   - Both helpers are intentionally free of external dependencies so they
 *     can be used by any core module.
 *   - State transitions are logged via `console.warn` (Hipp0's convention
 *     for operational diagnostics).
 *   - Breakers are exported as singletons from this file for the known
 *     providers so callers share state across the process.
 *   - `withRetry` classifies errors via a small rule set; callers can
 *     supply a custom `isRetryable` predicate when the default is wrong.
 *   - Nothing here throws unexpected errors: every caller-visible throw is
 *     either the original fn error (after retries / open-circuit) or a
 *     `CircuitOpenError`.
 */

/* ------------------------------------------------------------------ */
/*  Retry                                                             */
/* ------------------------------------------------------------------ */

export interface RetryOptions {
  /** Maximum number of retry attempts after the initial call. Default 3. */
  maxRetries?: number;
  /** Starting delay in milliseconds. Default 1000 (1s). */
  initialDelayMs?: number;
  /** Maximum delay between attempts in ms. Default 30000 (30s). */
  maxDelayMs?: number;
  /** Multiplier applied between attempts. Default 2 (double each time). */
  backoffFactor?: number;
  /** Apply +/-50% jitter to the delay. Default true. */
  jitter?: boolean;
  /** Custom retry predicate. Defaults to `defaultIsRetryable`. */
  isRetryable?: (err: unknown) => boolean;
  /** Optional hook fired before each retry (useful for tests / metrics). */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

const DEFAULT_RETRY: Required<Omit<RetryOptions, 'isRetryable' | 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * Default retryable-error heuristic. Considers an error retryable if:
 *   - It looks like a network error (ECONNRESET, ENOTFOUND, ETIMEDOUT, ...)
 *   - It has an HTTP status of 408, 425, 429, or any 5xx
 *   - Its message contains common retryable substrings
 *   - It's an AbortError caused by a timeout
 *
 * Returns `false` for 4xx client errors (400, 401, 403, 404, 422, ...).
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;

  // HTTP status from fetch-like errors (fetch, OpenAI SDK, Anthropic SDK)
  const status =
    (typeof e.status === 'number' ? e.status : undefined) ??
    (typeof e.statusCode === 'number' ? e.statusCode : undefined) ??
    (typeof (e as { response?: { status?: number } }).response?.status === 'number'
      ? (e as { response?: { status?: number } }).response!.status
      : undefined);

  if (typeof status === 'number') {
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    if (status >= 400 && status < 500) return false;
  }

  // Node/Undici network error codes
  const code = typeof e.code === 'string' ? (e.code as string) : undefined;
  if (code) {
    const NET = new Set([
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'EPIPE',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNABORTED',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
    ]);
    if (NET.has(code)) return true;
  }

  const name = typeof e.name === 'string' ? (e.name as string) : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;

  const msg = typeof e.message === 'string' ? (e.message as string).toLowerCase() : '';
  if (
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout')
  ) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff and optional jitter.
 * Retries at most `maxRetries` times, so the function is called up to
 * `maxRetries + 1` total times.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  const isRetryable = options?.isRetryable ?? defaultIsRetryable;

  let attempt = 0;
  let delay = opts.initialDelayMs;
  let lastErr: unknown;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= opts.maxRetries) throw err;
      if (!isRetryable(err)) throw err;

      let wait = Math.min(delay, opts.maxDelayMs);
      if (opts.jitter) {
        // Full jitter +/-50% around the computed delay
        const jitterAmount = wait * 0.5;
        wait = wait - jitterAmount + Math.random() * jitterAmount * 2;
      }
      wait = Math.max(0, Math.floor(wait));

      try {
        options?.onRetry?.(attempt + 1, wait, err);
      } catch {
        // Never let an onRetry hook break the retry loop.
      }

      await sleep(wait);
      attempt += 1;
      delay = delay * opts.backoffFactor;
    }
  }

  // Unreachable but keeps TypeScript happy.
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/*  Circuit Breaker                                                    */
/* ------------------------------------------------------------------ */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Identifier used in logs (e.g. "anthropic"). */
  name: string;
  /** Consecutive failures before the breaker opens. Default 5. */
  failureThreshold?: number;
  /** Consecutive successes in half-open before it fully closes. Default 2. */
  successThreshold?: number;
  /**
   * Per-call timeout in ms. The breaker wraps `fn` in Promise.race with a
   * timeout; if it fires, the attempt counts as a failure. Default 60000.
   */
  timeout?: number;
  /**
   * How long to stay in the `open` state before allowing a single probe.
   * Default 300000 (5 minutes).
   */
  resetTimeout?: number;
}

export interface CircuitStats {
  successes: number;
  failures: number;
  lastFailureAt?: Date;
  lastStateChangeAt: Date;
  totalOpens: number;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit ${name} is open`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly resetTimeout: number;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalOpens = 0;
  private lastFailureAt?: Date;
  private lastStateChangeAt: Date = new Date();
  private openUntilMs = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60_000;
    this.resetTimeout = options.resetTimeout ?? 300_000;
  }

  getState(): CircuitState {
    this._maybeTransitionFromOpen();
    return this.state;
  }

  getStats(): CircuitStats {
    return {
      successes: this.totalSuccesses,
      failures: this.totalFailures,
      lastFailureAt: this.lastFailureAt,
      lastStateChangeAt: this.lastStateChangeAt,
      totalOpens: this.totalOpens,
    };
  }

  reset(): void {
    const wasOpen = this.state !== 'closed';
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openUntilMs = 0;
    if (wasOpen) {
      this.lastStateChangeAt = new Date();
      console.warn(`[hipp0/resilience] Circuit ${this.name} manually reset to closed`);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this._maybeTransitionFromOpen();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await this._runWithTimeout(fn);
      this._recordSuccess();
      return result;
    } catch (err) {
      this._recordFailure();
      throw err;
    }
  }

  private async _runWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.timeout || this.timeout <= 0) return fn();

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            const err = new Error(`Circuit ${this.name}: operation timed out after ${this.timeout}ms`);
            err.name = 'TimeoutError';
            reject(err);
          }, this.timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private _recordSuccess(): void {
    this.totalSuccesses += 1;

    if (this.state === 'half_open') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this._transition('closed');
      }
    } else {
      // Closed state: success resets the failure counter
      this.consecutiveFailures = 0;
    }
  }

  private _recordFailure(): void {
    this.totalFailures += 1;
    this.lastFailureAt = new Date();

    if (this.state === 'half_open') {
      // A single failure in half-open reopens the circuit.
      this._transition('open');
      return;
    }

    this.consecutiveFailures += 1;
    this.consecutiveSuccesses = 0;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this._transition('open');
    }
  }

  private _maybeTransitionFromOpen(): void {
    if (this.state !== 'open') return;
    if (Date.now() >= this.openUntilMs) {
      this._transition('half_open');
    }
  }

  private _transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.lastStateChangeAt = new Date();

    if (to === 'open') {
      this.openUntilMs = Date.now() + this.resetTimeout;
      this.totalOpens += 1;
      this.consecutiveSuccesses = 0;
      console.warn(
        `[hipp0/resilience] Circuit ${this.name} opened after ${this.consecutiveFailures} failures`,
      );
    } else if (to === 'half_open') {
      this.consecutiveSuccesses = 0;
      console.warn(`[hipp0/resilience] Circuit ${this.name} half-open, testing`);
    } else {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      console.warn(`[hipp0/resilience] Circuit ${this.name} closed`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Shared Distillery Breakers + Queue                                 */
/* ------------------------------------------------------------------ */

/** Maximum in-memory queue size before new items are dropped. */
export const DISTILLERY_QUEUE_MAX_SIZE = 1000;

export interface QueuedExtraction {
  /** Unique id for observability. */
  id: string;
  /** Provider the request was intended for. */
  provider: 'anthropic' | 'openai' | 'other';
  /** The function to execute once the breaker closes. */
  run: () => Promise<unknown>;
  /** Timestamp the item was enqueued. */
  enqueuedAt: Date;
}

class ExtractionQueue {
  private readonly items: QueuedExtraction[] = [];
  private processing = false;

  size(): number {
    return this.items.length;
  }

  enqueue(item: Omit<QueuedExtraction, 'id' | 'enqueuedAt'>): boolean {
    if (this.items.length >= DISTILLERY_QUEUE_MAX_SIZE) {
      console.warn(
        `[hipp0/resilience] Extraction queue full (${DISTILLERY_QUEUE_MAX_SIZE}); dropping request`,
      );
      return false;
    }
    this.items.push({
      id: Math.random().toString(36).slice(2, 12),
      enqueuedAt: new Date(),
      ...item,
    });
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  /**
   * Drain the queue by running each item in order. Items that fail are
   * logged and discarded — callers must be OK with best-effort delivery.
   */
  async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.items.length > 0) {
        const next = this.items.shift();
        if (!next) break;
        try {
          await next.run();
        } catch (err) {
          console.warn(
            `[hipp0/resilience] Queued extraction ${next.id} failed during drain: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

export const distilleryQueue = new ExtractionQueue();

/**
 * Shared circuit breakers, one per LLM provider. Import these directly so
 * every call site shares state within the process.
 */
export const distilleryBreakerAnthropic = new CircuitBreaker({
  name: 'anthropic',
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60_000,
  resetTimeout: 300_000,
});

export const distilleryBreakerOpenAI = new CircuitBreaker({
  name: 'openai',
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60_000,
  resetTimeout: 300_000,
});

/**
 * Choose a breaker for a provider string. Falls back to the anthropic
 * breaker for unknown providers so callers never get undefined.
 */
export function getBreakerForProvider(
  provider: string | undefined,
): CircuitBreaker {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('openai') || p.includes('openrouter') || p.includes('groq')) {
    return distilleryBreakerOpenAI;
  }
  return distilleryBreakerAnthropic;
}

/**
 * Snapshot used by /api/health to expose breaker state.
 */
export function getDistilleryHealth(): {
  anthropic_breaker: CircuitState;
  openai_breaker: CircuitState;
  queued_extractions: number;
} {
  return {
    anthropic_breaker: distilleryBreakerAnthropic.getState(),
    openai_breaker: distilleryBreakerOpenAI.getState(),
    queued_extractions: distilleryQueue.size(),
  };
}

/**
 * Hook a breaker up to the drain loop: whenever it transitions closed, drain
 * the queue. This is a polling helper — we attach via a short interval so we
 * don't need to modify CircuitBreaker itself.
 */
let drainInterval: NodeJS.Timeout | undefined;
export function startDistilleryDrainLoop(intervalMs = 15_000): void {
  if (drainInterval) return;
  drainInterval = setInterval(() => {
    try {
      const bothClosed =
        distilleryBreakerAnthropic.getState() === 'closed' &&
        distilleryBreakerOpenAI.getState() === 'closed';
      if (bothClosed && distilleryQueue.size() > 0) {
        void distilleryQueue.drain().catch((err) => {
          console.warn(
            `[hipp0/resilience] distilleryQueue drain failed: ${(err as Error).message}`,
          );
        });
      }
    } catch (err) {
      console.warn(
        `[hipp0/resilience] drain loop iteration failed: ${(err as Error).message}`,
      );
    }
  }, intervalMs);
  // Unref so the drain loop never keeps Node alive on its own.
  drainInterval.unref?.();
}

export function stopDistilleryDrainLoop(): void {
  if (drainInterval) {
    clearInterval(drainInterval);
    drainInterval = undefined;
  }
}
