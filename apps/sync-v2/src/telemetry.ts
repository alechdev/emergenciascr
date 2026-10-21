import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK, logs, metrics, tracing } from "@opentelemetry/sdk-node";

export const DEFAULT_SERVICE_NAME = "sync-v2";
const METRIC_EXPORT_INTERVAL_MS = 60_000;

export interface Telemetry {
  /** Whether anything is exported. */
  readonly enabled: boolean;
  /** Flushes and stops every signal. Safe to call more than once. */
  shutdown(): Promise<void>;
}

export interface TelemetryOptions {
  /** Standard OTel variables; the exporters read the rest of them themselves. */
  env: { OTEL_EXPORTER_OTLP_ENDPOINT?: string; OTEL_SERVICE_NAME?: string };
  /** Replace the OTLP exporters, for tests. Setting any of these enables telemetry. */
  spanProcessors?: tracing.SpanProcessor[];
  metricReaders?: metrics.IMetricReader[];
  logRecordProcessors?: logs.LogRecordProcessor[];
}

/**
 * Starts one SDK for traces, metrics and logs. Must run before any module creates meters
 * or the SIGAE client: the metrics API has no proxy provider, so instruments created
 * earlier stay no-ops.
 *
 * No auto-instrumentation: jobs, SIGAE requests and the logger are instrumented explicitly.
 */
export function startTelemetry(options: TelemetryOptions): Telemetry {
  const custom =
    options.spanProcessors !== undefined ||
    options.metricReaders !== undefined ||
    options.logRecordProcessors !== undefined;
  if (!options.env.OTEL_EXPORTER_OTLP_ENDPOINT && !custom) {
    return { enabled: false, shutdown: async () => {} };
  }

  const sdk = new NodeSDK({
    serviceName: options.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
    spanProcessors: options.spanProcessors ?? [
      new tracing.BatchSpanProcessor(new OTLPTraceExporter())
    ],
    metricReaders: options.metricReaders ?? [
      new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS
      })
    ],
    logRecordProcessors: options.logRecordProcessors ?? [
      new logs.BatchLogRecordProcessor(new OTLPLogExporter())
    ],
    instrumentations: []
  });
  sdk.start();

  let stopped: Promise<void> | undefined;
  return {
    enabled: true,
    shutdown: () => {
      stopped ??= sdk.shutdown();
      return stopped;
    }
  };
}
