# Observability

Hipp0 emits OpenTelemetry traces and metrics so operators can monitor
decision graph activity in their existing observability stack — Datadog,
Grafana Tempo/Mimir, Honeycomb, New Relic, the OpenTelemetry Collector,
or any other OTLP-compatible backend.

All telemetry is **off by default** and fully safe to enable in production:
instrumentation is wrapped in try/catch and degrades to a no-op if the SDK
fails to initialise or an OTLP endpoint is unreachable.

## Enabling telemetry

Set these environment variables on the Hipp0 server process:

```bash
HIPP0_TELEMETRY_ENABLED=true
HIPP0_OTLP_ENDPOINT=http://localhost:4318
HIPP0_OTEL_SERVICE_NAME=hipp0-server
HIPP0_OTEL_SERVICE_VERSION=0.1.1
```

| Variable | Default | Description |
| --- | --- | --- |
| `HIPP0_TELEMETRY_ENABLED` | `false` | Set to `true` to initialise the OpenTelemetry SDK. Any other value keeps everything a no-op. |
| `HIPP0_OTLP_ENDPOINT` | `http://localhost:4318` | Base OTLP/HTTP endpoint. Hipp0 appends `/v1/traces` and `/v1/metrics`. |
| `HIPP0_OTEL_SERVICE_NAME` | `hipp0-server` | Populates the `service.name` resource attribute. |
| `HIPP0_OTEL_SERVICE_VERSION` | `0.1.1` | Populates the `service.version` resource attribute. |

Once enabled you should see this log line on startup:

```
[hipp0/telemetry] OpenTelemetry initialised (service=hipp0-server, endpoint=http://localhost:4318)
```

Telemetry is flushed on graceful shutdown (`SIGTERM` / `SIGINT`).

## What is emitted

### Metrics

All metrics use the `hipp0.*` namespace and low-cardinality dimensions
(`project_id`, `agent_name`, `format`, `source`, `reflection_type`,
`success`). High-cardinality values like decision IDs are **never** used
as metric dimensions.

| Metric | Type | Unit | Description |
| --- | --- | --- | --- |
| `hipp0.compile.duration` | Histogram | ms | Latency of `POST /api/compile` |
| `hipp0.compile.decisions_included` | Histogram | decisions | Number of decisions returned per compile |
| `hipp0.compile.count` | Counter | — | Total compile operations |
| `hipp0.decisions.created` | Counter | — | Total decisions created |
| `hipp0.contradictions.detected` | Counter | — | Total contradictions detected |
| `hipp0.outcomes.recorded` | Counter | — | Total outcomes recorded |
| `hipp0.reflections.run` | Counter | — | Total reflection runs |
| `hipp0.capture.duration` | Histogram | ms | Latency of passive capture extraction |

### Spans

Top-level span names:

| Span | Source | Key attributes |
| --- | --- | --- |
| `compile_context` | `POST /api/compile` | `hipp0.project_id`, `hipp0.agent_name`, `hipp0.format`, `hipp0.decisions_included`, `hipp0.decisions_considered` |
| `distill_conversation` | `@hipp0/core` distillery | `hipp0.project_id`, `hipp0.agent_name`, `hipp0.source`, `hipp0.decisions_extracted`, `hipp0.contradictions_found` |
| `reflection_run` | `@hipp0/core` reflection engine | `hipp0.project_id`, `hipp0.reflection_type` |
| `decision_create` | `POST /api/projects/:id/decisions` | `hipp0.project_id`, `hipp0.agent_name`, `hipp0.source` |
| `experiment_resolve` | `POST /api/projects/:id/experiments/:id/resolve` | `hipp0.project_id`, `hipp0.winner` |

Because Hipp0 uses `@opentelemetry/auto-instrumentations-node`, you also
get free spans for Hono HTTP routes, Postgres/SQLite queries, Redis
commands (BullMQ/cache), outbound `fetch`, and BullMQ job processing.

## Routing to your backend

The OTLP/HTTP protocol is supported by all major observability vendors.
The recommended topology is to run an OpenTelemetry Collector next to
Hipp0 and let it fan out to your backends — this way you can change
vendors without restarting Hipp0.

### OpenTelemetry Collector

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch:
    send_batch_size: 1024
    timeout: 10s
  memory_limiter:
    check_interval: 1s
    limit_mib: 512

exporters:
  # Any combination of these:
  otlphttp/honeycomb:
    endpoint: https://api.honeycomb.io
    headers:
      x-honeycomb-team: ${HONEYCOMB_API_KEY}
  datadog:
    api:
      key: ${DD_API_KEY}
      site: datadoghq.com
  prometheus:
    endpoint: 0.0.0.0:9464
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true
  debug:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/honeycomb, datadog, otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [datadog, prometheus]
```

Point Hipp0 at the collector:

```bash
HIPP0_TELEMETRY_ENABLED=true
HIPP0_OTLP_ENDPOINT=http://otel-collector:4318
```

### Datadog

Datadog accepts OTLP natively via the Datadog Agent (since v7.41). Run
the agent with OTLP enabled and point Hipp0 at it:

```yaml
# datadog.yaml
otlp_config:
  receiver:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
```

```bash
HIPP0_TELEMETRY_ENABLED=true
HIPP0_OTLP_ENDPOINT=http://dd-agent:4318
HIPP0_OTEL_SERVICE_NAME=hipp0-prod
```

### Grafana (Tempo + Mimir)

Use the Grafana Alloy agent or the OpenTelemetry Collector with the
`otlp` exporter for traces and `prometheusremotewrite` for metrics.

```bash
HIPP0_TELEMETRY_ENABLED=true
HIPP0_OTLP_ENDPOINT=http://alloy:4318
```

### Honeycomb

Honeycomb accepts OTLP/HTTP directly — no collector required.

```bash
HIPP0_TELEMETRY_ENABLED=true
HIPP0_OTLP_ENDPOINT=https://api.honeycomb.io
# Add these via standard OTel env vars:
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://api.honeycomb.io/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://api.honeycomb.io/v1/metrics
```

### New Relic

```bash
HIPP0_TELEMETRY_ENABLED=true
HIPP0_OTLP_ENDPOINT=https://otlp.nr-data.net
OTEL_EXPORTER_OTLP_HEADERS=api-key=YOUR_LICENSE_KEY
```

## Dashboards

Useful dashboard queries / panels:

- **Compile latency p95** — `histogram_quantile(0.95, hipp0.compile.duration)` grouped by `format`
- **Compile throughput** — `rate(hipp0.compile.count[5m])` grouped by `project_id`
- **Decision creation rate** — `rate(hipp0.decisions.created[5m])` grouped by `source`
- **Contradiction detection rate** — `rate(hipp0.contradictions.detected[1h])`
- **Capture pipeline p99** — `histogram_quantile(0.99, hipp0.capture.duration)`
- **Compile error rate** — `rate(hipp0.compile.count{success="false"}[5m]) / rate(hipp0.compile.count[5m])`

## Operational notes

- Telemetry failures never crash Hipp0. Initialisation errors log a
  warning and fall through to no-op tracers.
- The OTel SDK packages are optional dependencies — if they are missing,
  the server still starts (the dynamic `import()` in `telemetry.ts` will
  fail gracefully).
- Metrics are exported every 60 seconds by default.
- Spans from `@hipp0/core` (distillery, reflection engine) are emitted
  through the OpenTelemetry API. When no SDK is registered they are no-op.
- To tune cardinality further, avoid setting `project_id` or `agent_name`
  as dimensions in your dashboards when you have thousands of projects.
  The raw metrics still include them, but you should aggregate away from
  them at query time.
