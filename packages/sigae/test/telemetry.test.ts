import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "vitest";

import { CREDENTIALS, hangUntilAborted, json, loadFixture, testClient } from "./helpers";

function setup(handler: Parameters<typeof testClient>[0]) {
  const spans = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spans)]
  });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000
  });
  const meterProvider = new MeterProvider({ readers: [reader] });
  const { client } = testClient(handler, { tracerProvider, meterProvider, timeoutMs: 30 });

  async function collectMetrics() {
    await reader.forceFlush();
    return metricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics);
  }
  return { client, spans, collectMetrics };
}

describe("telemetry", () => {
  test("one client span per request, with endpoint, outcome and incident ID", async () => {
    const { client, spans } = setup({
      ObtenerBoletaIncidente: () => json(loadFixture("ObtenerBoletaIncidente", "report-99")),
      ObtenerDetalleEmergencias: () => json(loadFixture("ObtenerDetalleEmergencias", "closed")),
      ObtenerEstaciones: (call) => hangUntilAborted(call.init.signal)
    });
    await client.getIncidentReport(1900002);
    await client.getIncidentDetails(1900001);
    await client.getStations();

    const finished = spans.getFinishedSpans();
    expect(finished.map((span) => span.name)).toEqual([
      "sigae ObtenerBoletaIncidente",
      "sigae ObtenerDetalleEmergencias",
      "sigae ObtenerEstaciones"
    ]);
    const [report, details, stations] = finished;
    expect(report?.kind).toBe(SpanKind.CLIENT);
    expect(report?.attributes).toMatchObject({
      "sigae.endpoint": "ObtenerBoletaIncidente",
      "sigae.incident_id": 1900002,
      "sigae.outcome": "upstream_error",
      "sigae.codigo": "99",
      "http.response.status_code": 200,
      "error.type": "codigo_99"
    });
    expect(report?.status.code).toBe(SpanStatusCode.ERROR);
    expect(details?.attributes).toMatchObject({ "sigae.outcome": "ok", "sigae.codigo": "00" });
    expect(details?.status.code).toBe(SpanStatusCode.UNSET);
    expect(stations?.attributes).toMatchObject({
      "sigae.outcome": "timeout",
      "error.type": "timeout"
    });
    expect(stations?.status.code).toBe(SpanStatusCode.ERROR);

    const everything = JSON.stringify(
      finished.map((span) => [span.attributes, span.status, span.events])
    );
    for (const secret of [CREDENTIALS.password, CREDENTIALS.user, CREDENTIALS.systemCode]) {
      expect(everything).not.toContain(secret);
    }
  });

  test("request counter and duration histogram by endpoint and outcome, without IDs", async () => {
    const { client, collectMetrics } = setup({
      ObtenerBoletaIncidente: () => json(loadFixture("ObtenerBoletaIncidente", "closed")),
      ObtenerEstaciones: () => new Response("", { status: 500 })
    });
    await client.getIncidentReport(1900001);
    await client.getIncidentReport(1900002);
    await client.getStations();

    const metrics = await collectMetrics();
    const requests = metrics.find((metric) => metric.descriptor.name === "sigae.client.requests");
    const duration = metrics.find(
      (metric) => metric.descriptor.name === "sigae.client.request.duration"
    );
    expect(duration?.descriptor.unit).toBe("s");

    const points = requests?.dataPoints.map((point) => [point.attributes, point.value]);
    expect(points).toEqual(
      expect.arrayContaining([
        [{ endpoint: "ObtenerBoletaIncidente", outcome: "ok" }, 2],
        [{ endpoint: "ObtenerEstaciones", outcome: "http" }, 1]
      ])
    );
    for (const metric of [requests, duration]) {
      for (const point of metric?.dataPoints ?? []) {
        expect(Object.keys(point.attributes).sort()).toEqual(["endpoint", "outcome"]);
      }
    }
  });

  test("is a no-op without an SDK", async () => {
    const { client } = testClient(() => json(loadFixture("ObtenerProvinciaLista", "ok")));
    const result = await client.getProvinces();
    expect(result.isOk()).toBe(true);
  });
});
