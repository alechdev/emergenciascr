import { metrics as metricsApi, trace } from "@opentelemetry/api";
import { logs, metrics, tracing } from "@opentelemetry/sdk-node";
import { describe, expect, it } from "vitest";

import { createLogger } from "@/lib/logger";
import { startTelemetry } from "@/telemetry";

describe("startTelemetry", () => {
  it("is off without an endpoint", async () => {
    const telemetry = startTelemetry({ env: {} });

    expect(telemetry.enabled).toBe(false);
    await telemetry.shutdown();
  });

  it("exports every signal with the service name and flushes on shutdown", async () => {
    const spans: tracing.ReadableSpan[] = [];
    const records: logs.SdkLogRecord[] = [];
    const metricExporter = new metrics.InMemoryMetricExporter(
      metrics.AggregationTemporality.CUMULATIVE
    );
    const telemetry = startTelemetry({
      env: {},
      spanProcessors: [
        {
          onStart: () => {},
          onEnd: (span) => void spans.push(span),
          forceFlush: async () => {},
          shutdown: async () => {}
        }
      ],
      metricReaders: [
        new metrics.PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 60_000
        })
      ],
      logRecordProcessors: [
        {
          onEmit: (record) => void records.push(record),
          forceFlush: async () => {},
          shutdown: async () => {}
        }
      ]
    });
    expect(telemetry.enabled).toBe(true);

    const logger = createLogger({ level: "info", pretty: false });
    logger.transports[0]!.silent = true;
    trace.getTracer("test").startActiveSpan("test.span", (span) => {
      logger.info("inside span", { incidentId: 1 });
      span.end();
    });
    metricsApi.getMeter("test").createCounter("test.counter").add(1, { queue: "test" });

    await telemetry.shutdown();
    await telemetry.shutdown();

    expect(spans.map((span) => span.name)).toEqual(["test.span"]);
    expect(spans[0]?.resource.attributes["service.name"]).toBe("sync-v2");

    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe("inside span");
    expect(records[0]?.attributes).toMatchObject({ incidentId: 1 });
    expect(records[0]?.resource.attributes["service.name"]).toBe("sync-v2");
    expect(records[0]?.spanContext?.spanId).toBe(spans[0]?.spanContext().spanId);

    const exported = metricExporter.getMetrics();
    const names = exported.flatMap((resourceMetrics) =>
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.map((metric) => metric.descriptor.name)
      )
    );
    expect(names).toContain("test.counter");
    expect(exported[0]?.resource.attributes["service.name"]).toBe("sync-v2");
  });
});
