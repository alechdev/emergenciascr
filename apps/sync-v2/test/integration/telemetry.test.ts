import { logs, metrics, tracing } from "@opentelemetry/sdk-node";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FAKE_CREDENTIALS,
  INCIDENT_ID,
  INTEGRATION,
  type IncidentAnswers,
  type TestDatabase,
  eventually,
  fakeClock,
  fixtureAnswers,
  openTestDatabase,
  readSnapshot,
  resetDatabase,
  scriptedSigae,
  seedReferences
} from "./harness";

import type { Telemetry } from "@/telemetry";
import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";

const MINUTE = 60_000;
const JOB_ID = `incident-poll-${INCIDENT_ID}`;
/** Report fields only SIGAE bodies carry; none may reach logs or spans. */
const PERSONAL = {
  DesUbicacion: "CALLE PRIVADA DE PRUEBA 77",
  Direccion: "CASA PRIVADA DE PRUEBA",
  Nombre_Reporta: "PERSONA PRIVADA DE PRUEBA",
  Telefono_Reporta: "8000-0077"
};
const SECRETS = [
  FAKE_CREDENTIALS.user,
  FAKE_CREDENTIALS.password,
  FAKE_CREDENTIALS.systemCode,
  FAKE_CREDENTIALS.ip,
  ...Object.values(PERSONAL)
];

/** A fixture poll, with personal data SIGAE could send in the report. */
function fixturePoll(): IncidentAnswers {
  const answers = fixtureAnswers(readSnapshot("open-close-reopen-close", "001.json"));
  const report = answers.ObtenerBoletaIncidente as { body: Record<string, unknown> };
  return { ...answers, ObtenerBoletaIncidente: { body: { ...report.body, ...PERSONAL } } };
}

/**
 * A fixture poll through the poll worker with the SDK on in-memory exporters (spec sections
 * 4.2 and 12): what each signal carries, and that none of them leaks incident IDs into metrics or SIGAE data into logs.
 */
describe.skipIf(!INTEGRATION)("poll telemetry", () => {
  const finished: tracing.ReadableSpan[] = [];
  const metricExporter = new metrics.InMemoryMetricExporter(
    metrics.AggregationTemporality.CUMULATIVE
  );
  const records: logs.SdkLogRecord[] = [];
  const lines: string[] = [];
  let telemetry: Telemetry;
  let db: TestDatabase;
  let redis: Redis;
  let closeRedis: () => Promise<void>;
  let queue: Queue;
  let worker: Worker | undefined;

  beforeAll(async () => {
    process.env.LOG_LEVEL = "info";
    // Before any module that creates meters, as `index.ts` does.
    const { startTelemetry } = await import("@/telemetry");
    telemetry = startTelemetry({
      env: {},
      // The in-memory span exporter forgets its spans on shutdown, so they are kept here.
      spanProcessors: [
        {
          onStart: () => {},
          onEnd: (span) => void finished.push(span),
          forceFlush: async () => {},
          shutdown: async () => {}
        }
      ],
      metricReaders: [
        new metrics.PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 3_600_000
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

    const winston = (await import("winston")).default;
    const logger = (await import("@/lib/logger")).default;
    // Stdout stays quiet; the same JSON lines are kept here instead.
    for (const transport of logger.transports) {
      if (transport instanceof winston.transports.Console) transport.silent = true;
    }
    logger.add(
      new winston.transports.Stream({
        format: winston.format.json(),
        stream: new Writable({
          write(chunk, _encoding, done) {
            lines.push(String(chunk));
            done();
          }
        })
      })
    );

    db = await openTestDatabase();
    ({ redis, closeRedis } = await import("@/config/redis"));
    queue = (await import("@/queues/incidentPoll.queue")).incidentPollQueue as Queue;
    await redis.flushall();
    await resetDatabase(db);
    await seedReferences(db);
  });
  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await closeRedis?.();
    await db?.$client.end();
    await telemetry?.shutdown();
  });

  it("traces each poll, counts it without incident IDs and logs no SIGAE data", async () => {
    const { createIncidentPollWorker } = await import("@/workers/incidentPoll.worker");
    const { createPollScheduler } = await import("@/queues/incidentPoll.queue");
    const { loadSyncState, trackNewIncidents } = await import("@bomberoscr/sync-domain/persist");
    const { createReferenceResolver } = await import("@bomberoscr/sync-domain/pipeline");

    const clock = fakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
    const sigae = scriptedSigae();
    sigae.answers = fixturePoll();
    const references = createReferenceResolver({ db, sigae: sigae.client, now: clock.now });
    worker = createIncidentPollWorker({
      db,
      sigae: sigae.client,
      references,
      now: clock.now
    }) as Worker;
    const polledAt = async (at: Date) =>
      eventually(async () => {
        const state = await loadSyncState(db, INCIDENT_ID);
        return state?.lastPolledAt?.getTime() === at.getTime() &&
          (await queue.getJobState(JOB_ID)) === "delayed"
          ? state
          : null;
      });

    await trackNewIncidents(db, [{ incidentId: INCIDENT_ID, firstSeenAt: clock.now() }]);
    await createPollScheduler(queue as never, clock.now).schedule([
      { incidentId: INCIDENT_ID, at: null }
    ]);
    await polledAt(clock.now());

    // A second poll that fails: SIGAE answers 502 for the details.
    sigae.answers = {
      ...sigae.answers,
      ObtenerDetalleEmergencias: { status: 502 }
    } as IncidentAnswers;
    clock.set(new Date(clock.now().getTime() + 3 * MINUTE));
    await (await queue.getJob(JOB_ID))?.promote();
    const failed = await polledAt(clock.now());
    expect(failed.consecutiveFailures).toBe(1);

    await worker.close();
    worker = undefined;
    await telemetry.shutdown();

    // Traces: one `sync.poll` per poll, with the SIGAE requests and each database step inside.
    const polls = finished.filter((span) => span.name === "sync.poll");
    expect(polls.map((span) => span.attributes)).toEqual([
      expect.objectContaining({ "sync.incident_id": INCIDENT_ID, "sync.poll.result": "ok" }),
      expect.objectContaining({ "sync.incident_id": INCIDENT_ID, "sync.poll.result": "failed" })
    ]);
    expect(polls.map((span) => span.status.code)).toEqual([0, 2]);
    for (const poll of polls) {
      const children = finished.filter(
        (span) => span.parentSpanContext?.spanId === poll.spanContext().spanId
      );
      expect(children.map((span) => span.name).sort()).toEqual(
        expect.arrayContaining([
          "sigae ObtenerBoletaIncidente",
          "sigae ObtenerDetalleEmergencias",
          "sigae ObtenerEstacionesAtiendeIncidente",
          "sigae ObtenerUnidadesDespachadasIncidente",
          "sync.poll.references",
          "sync.poll.snapshots",
          "sync.poll.transaction"
        ])
      );
    }
    const spanText = JSON.stringify(
      finished.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        status: span.status
      }))
    );
    for (const secret of SECRETS) expect(spanText).not.toContain(secret);

    // Metrics: the expected instruments, and no incident ID in any attribute.
    const exported = metricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
    const byName = new Map<string, Record<string, unknown>[]>();
    for (const metric of exported) {
      const points = metric.dataPoints as { attributes: Record<string, unknown> }[];
      byName.set(metric.descriptor.name, [
        ...(byName.get(metric.descriptor.name) ?? []),
        ...points.map((point) => point.attributes)
      ]);
    }
    expect(byName.get("sync.poll.results")).toEqual(
      expect.arrayContaining([{ result: "ok" }, { result: "failed" }])
    );
    expect(byName.get("sync.job.duration")).toContainEqual({
      queue: queue.name,
      outcome: "delayed"
    });
    expect(byName.get("sync.changes")?.length).toBeGreaterThan(0);
    expect(byName.get("sync.poll.lag")).toBeDefined();
    expect(byName.get("sigae.client.requests")).toEqual(
      expect.arrayContaining([
        { endpoint: "ObtenerBoletaIncidente", outcome: "ok" },
        { endpoint: "ObtenerDetalleEmergencias", outcome: "http" }
      ])
    );
    for (const [name, attributes] of byName) {
      for (const point of attributes) {
        for (const [key, value] of Object.entries(point)) {
          expect(key, name).not.toMatch(/incident/i);
          expect(String(value), `${name} ${key}`).not.toBe(String(INCIDENT_ID));
        }
      }
    }

    // Logs: one summary line per poll with the incident ID, never SIGAE data or credentials.
    const summaries = records.filter((record) => record.body === "incident polled");
    expect(summaries.map((record) => record.attributes)).toEqual([
      expect.objectContaining({ incidentId: INCIDENT_ID, jobId: JOB_ID, result: "ok" }),
      expect.objectContaining({ incidentId: INCIDENT_ID, jobId: JOB_ID, result: "failed" })
    ]);
    expect(summaries[0]?.spanContext?.spanId).toBe(polls[0]?.spanContext().spanId);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const logText = JSON.stringify([
      lines,
      records.map((record) => ({ body: record.body, attributes: record.attributes }))
    ]);
    for (const secret of SECRETS) expect(logText).not.toContain(secret);
  });
});
