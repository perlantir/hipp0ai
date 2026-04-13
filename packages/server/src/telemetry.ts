/**
 * OpenTelemetry instrumentation for Hipp0.
 *
 * This module provides a thin, failure-tolerant wrapper around the
 * OpenTelemetry SDK. It is designed to be a no-op when telemetry is
 * disabled, and to never crash the server if OTel initialisation or
 * emission fails.
 *
 * Enable by setting HIPP0_TELEMETRY_ENABLED=true. Configuration:
 *
 *   HIPP0_TELEMETRY_ENABLED      false | true
 *   HIPP0_OTLP_ENDPOINT          http://localhost:4318
 *   HIPP0_OTEL_SERVICE_NAME      hipp0-server
 *   HIPP0_OTEL_SERVICE_VERSION   0.1.1
 *
 * Metrics emitted:
 *   hipp0.compile.duration            (histogram, ms)
 *   hipp0.compile.decisions_included  (histogram, count)
 *   hipp0.compile.count               (counter)
 *   hipp0.decisions.created           (counter)
 *   hipp0.contradictions.detected     (counter)
 *   hipp0.outcomes.recorded           (counter)
 *   hipp0.reflections.run             (counter)
 *   hipp0.capture.duration            (histogram, ms)
 *
 * Span names (top-level):
 *   compile_context
 *   distill_conversation
 *   reflection_run
 *   decision_create
 *   experiment_resolve
 */

import {
  trace,
  metrics,
  type Tracer,
  type Meter,
  type Histogram,
  type Counter,
  type Span,
  SpanStatusCode,
} from '@opentelemetry/api';

const INSTRUMENTATION_NAME = 'hipp0';
const INSTRUMENTATION_VERSION = '0.1.1';

// ---------------------------------------------------------------------------
// SDK lifecycle
// ---------------------------------------------------------------------------

let sdk: unknown = null;
let initialized = false;

/**
 * Initialise the OpenTelemetry SDK. No-op when HIPP0_TELEMETRY_ENABLED
 * is not set to 'true'. Any failure is logged and swallowed — telemetry
 * must never crash the server.
 *
 * Safe to call multiple times (subsequent calls are no-ops).
 */
export async function initTelemetry(): Promise<void> {
  if (initialized) return;
  if (process.env.HIPP0_TELEMETRY_ENABLED !== 'true') {
    // Telemetry disabled — the OTel API returns no-op tracers/meters.
    initialized = true;
    return;
  }

  try {
    const endpoint =
      process.env.HIPP0_OTLP_ENDPOINT?.replace(/\/$/, '') ??
      'http://localhost:4318';
    const serviceName =
      process.env.HIPP0_OTEL_SERVICE_NAME ?? 'hipp0-server';
    const serviceVersion =
      process.env.HIPP0_OTEL_SERVICE_VERSION ?? '0.1.1';

    // Dynamic imports — the SDK packages are optional and should not be
    // required when telemetry is off.
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { OTLPMetricExporter },
      { PeriodicExportingMetricReader },
      { getNodeAutoInstrumentations },
      { resourceFromAttributes },
      semConv,
    ] = await Promise.all([
      import('@opentelemetry/sdk-node' as string),
      import('@opentelemetry/exporter-trace-otlp-http' as string),
      import('@opentelemetry/exporter-metrics-otlp-http' as string),
      import('@opentelemetry/sdk-metrics' as string),
      import('@opentelemetry/auto-instrumentations-node' as string),
      import('@opentelemetry/resources' as string),
      import('@opentelemetry/semantic-conventions' as string),
    ]);

    const attrs = {
      [semConv.SEMRESATTRS_SERVICE_NAME ?? 'service.name']: serviceName,
      [semConv.SEMRESATTRS_SERVICE_VERSION ?? 'service.version']: serviceVersion,
    } as Record<string, string>;

    const resource = typeof resourceFromAttributes === 'function'
      ? resourceFromAttributes(attrs)
      : undefined;

    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    });

    sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations: [getNodeAutoInstrumentations()],
    });

    (sdk as { start: () => void }).start();
    initialized = true;
    console.warn(
      `[hipp0/telemetry] OpenTelemetry initialised (service=${serviceName}, endpoint=${endpoint})`,
    );
  } catch (err) {
    // Never crash: log and fall through to no-op tracers/meters.
    console.warn(
      '[hipp0/telemetry] Initialisation failed (telemetry disabled):',
      (err as Error).message,
    );
    initialized = true;
    sdk = null;
  }
}

/**
 * Graceful shutdown — flushes any pending spans/metrics.
 */
export async function shutdown(): Promise<void> {
  if (!sdk) return;
  try {
    const s = sdk as { shutdown?: () => Promise<void> };
    if (typeof s.shutdown === 'function') {
      await s.shutdown();
    }
  } catch (err) {
    console.warn(
      '[hipp0/telemetry] Shutdown failed:',
      (err as Error).message,
    );
  } finally {
    sdk = null;
  }
}

// ---------------------------------------------------------------------------
// Tracer / meter accessors
// ---------------------------------------------------------------------------

/** Returns the shared Hipp0 tracer. Safe when telemetry is disabled. */
export function getTracer(): Tracer {
  return trace.getTracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION);
}

/** Returns the shared Hipp0 meter. Safe when telemetry is disabled. */
export function getMeter(): Meter {
  return metrics.getMeter(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION);
}

// ---------------------------------------------------------------------------
// Metric instruments (lazily created, always safe to use)
// ---------------------------------------------------------------------------

interface Hipp0Metrics {
  compileDuration: Histogram;
  compileDecisionsIncluded: Histogram;
  compileCount: Counter;
  decisionsCreated: Counter;
  contradictionsDetected: Counter;
  outcomesRecorded: Counter;
  reflectionsRun: Counter;
  captureDuration: Histogram;
}

let metricsCache: Hipp0Metrics | null = null;

function buildMetrics(): Hipp0Metrics {
  const meter = getMeter();
  return {
    compileDuration: meter.createHistogram('hipp0.compile.duration', {
      description: 'Latency of the compile endpoint in milliseconds',
      unit: 'ms',
    }),
    compileDecisionsIncluded: meter.createHistogram('hipp0.compile.decisions_included', {
      description: 'Number of decisions included in a compile response',
      unit: '{decision}',
    }),
    compileCount: meter.createCounter('hipp0.compile.count', {
      description: 'Total number of compile operations',
    }),
    decisionsCreated: meter.createCounter('hipp0.decisions.created', {
      description: 'Total number of decisions created',
    }),
    contradictionsDetected: meter.createCounter('hipp0.contradictions.detected', {
      description: 'Total number of contradictions detected',
    }),
    outcomesRecorded: meter.createCounter('hipp0.outcomes.recorded', {
      description: 'Total number of outcomes recorded',
    }),
    reflectionsRun: meter.createCounter('hipp0.reflections.run', {
      description: 'Total number of reflection runs',
    }),
    captureDuration: meter.createHistogram('hipp0.capture.duration', {
      description: 'Latency of passive capture extraction in milliseconds',
      unit: 'ms',
    }),
  };
}

/** Returns the cached metric instruments, creating them on first use. */
export function getMetrics(): Hipp0Metrics {
  if (!metricsCache) {
    try {
      metricsCache = buildMetrics();
    } catch (err) {
      // If the no-op meter ever throws (it shouldn't), fall through to a
      // second-best no-op stub so callers still work.
      console.warn(
        '[hipp0/telemetry] Metric build failed, using no-op stubs:',
        (err as Error).message,
      );
      const noop = {
        add: () => undefined,
        record: () => undefined,
      } as unknown as Histogram & Counter;
      metricsCache = {
        compileDuration: noop,
        compileDecisionsIncluded: noop,
        compileCount: noop,
        decisionsCreated: noop,
        contradictionsDetected: noop,
        outcomesRecorded: noop,
        reflectionsRun: noop,
        captureDuration: noop,
      };
    }
  }
  return metricsCache;
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Allowed low-cardinality attribute keys. Keep this list small to avoid
 * metrics explosion. Never use decision IDs, project IDs with high fanout,
 * or raw user text as dimensions.
 */
export type TelemetryAttributes = {
  project_id?: string;
  agent_name?: string;
  format?: string;
  success?: boolean;
  source?: string;
  reflection_type?: string;
  winner?: string;
};

/**
 * Wrap an async callback in a span. On error, records the exception and
 * re-throws. All telemetry errors are swallowed so instrumentation never
 * breaks business logic.
 */
export async function withSpan<T>(
  name: string,
  attrs: TelemetryAttributes | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  let span: Span | undefined;
  try {
    const tracer = getTracer();
    span = tracer.startSpan(name);
    if (attrs) {
      try {
        for (const [k, v] of Object.entries(attrs)) {
          if (v !== undefined && v !== null) {
            span.setAttribute(`hipp0.${k}`, v as string | number | boolean);
          }
        }
      } catch { /* ignore */ }
    }
  } catch {
    // If we can't create the span, run the callback anyway without tracing.
    return fn({
      setAttribute: () => undefined,
      setAttributes: () => undefined,
      addEvent: () => undefined,
      setStatus: () => undefined,
      updateName: () => undefined,
      end: () => undefined,
      isRecording: () => false,
      recordException: () => undefined,
      spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
    } as unknown as Span);
  }

  try {
    const result = await fn(span);
    try {
      span.setStatus({ code: SpanStatusCode.OK });
    } catch { /* ignore */ }
    return result;
  } catch (err) {
    try {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
    } catch { /* ignore */ }
    throw err;
  } finally {
    try {
      span.end();
    } catch { /* ignore */ }
  }
}

/** Record a counter safely. Never throws. */
export function recordCounter(
  metric: Counter,
  value: number,
  attrs?: Record<string, string | number | boolean>,
): void {
  try {
    metric.add(value, attrs);
  } catch { /* ignore */ }
}

/** Record a histogram value safely. Never throws. */
export function recordHistogram(
  metric: Histogram,
  value: number,
  attrs?: Record<string, string | number | boolean>,
): void {
  try {
    metric.record(value, attrs);
  } catch { /* ignore */ }
}
