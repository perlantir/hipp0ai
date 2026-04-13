/**
 * Lightweight telemetry helpers for @hipp0/core.
 *
 * Core packages can't import from @hipp0/server (server depends on core),
 * so this module uses the OpenTelemetry API directly. When no SDK is
 * registered, `trace.getTracer()` returns a no-op tracer and these helpers
 * do nothing — so core remains safe to use with or without telemetry.
 */

import {
  trace,
  type Tracer,
  type Span,
  SpanStatusCode,
} from '@opentelemetry/api';

const INSTRUMENTATION_NAME = 'hipp0-core';
const INSTRUMENTATION_VERSION = '0.1.1';

/** Returns the core tracer. Safe when no SDK is registered (no-op). */
export function getCoreTracer(): Tracer {
  return trace.getTracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION);
}

export type CoreTelemetryAttributes = {
  project_id?: string;
  agent_name?: string;
  source?: string;
  reflection_type?: string;
  success?: boolean;
};

/**
 * Wrap an async callback in a span. Swallows all telemetry errors so
 * instrumentation can never break business logic.
 */
export async function withCoreSpan<T>(
  name: string,
  attrs: CoreTelemetryAttributes | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  let span: Span | undefined;
  try {
    const tracer = getCoreTracer();
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
    // If we can't create a span, run the callback with a no-op span stub.
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
