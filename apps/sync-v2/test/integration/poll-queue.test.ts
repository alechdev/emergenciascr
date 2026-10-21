import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  INCIDENT_ID,
  INTEGRATION,
  type IncidentAnswers,
  type TestDatabase,
  detailsBody,
  eventually,
  fakeClock,
  listBody,
  loadHistory,
  openTestDatabase,
  reportBody,
  resetDatabase,
  scriptedSigae,
  seedReferences,
  sigaeTime,
  station,
  unit
} from "./harness";

import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JOB_ID = `incident-poll-${INCIDENT_ID}`;

/** An incident reported at `reportedAt`, open or closed upstream. */
function incidentAnswers(reportedAt: Date, isOpen: boolean): IncidentAnswers {
  const time = sigaeTime(reportedAt);
  const date = `${time.slice(0, 10)}T00:00:00`;
  return {
    ObtenerBoletaIncidente: {
      body: reportBody({ Fecha: date, Hora_Aviso: time, Estado_Abierto: String(isOpen) })
    },
    ObtenerDetalleEmergencias: { body: detailsBody({ fecha: date, hora_incidente: time }) },
    ObtenerEstacionesAtiendeIncidente: { body: listBody([station()]) },
    ObtenerUnidadesDespachadasIncidente: {
      body: listBody([unit({ HoraDespacho: sigaeTime(new Date(reportedAt.getTime() + MINUTE)) })])
    }
  };
}

describe.skipIf(!INTEGRATION)("incident polls through the real queue", () => {
  let db: TestDatabase;
  let redis: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  let closeRedis: () => Promise<void>;
  let createWorker: typeof import("@/workers/incidentPoll.worker").createIncidentPollWorker;
  let createScheduler: typeof import("@/queues/incidentPoll.queue").createPollScheduler;
  let loadSyncState: typeof import("@bomberoscr/sync-domain/persist").loadSyncState;
  let trackNewIncidents: typeof import("@bomberoscr/sync-domain/persist").trackNewIncidents;
  let createReferenceResolver: typeof import("@bomberoscr/sync-domain/pipeline").createReferenceResolver;

  beforeAll(async () => {
    db = await openTestDatabase();
    ({ redis, closeRedis } = await import("@/config/redis"));
    const queues = await import("@/queues/incidentPoll.queue");
    queue = queues.incidentPollQueue as Queue;
    createScheduler = queues.createPollScheduler;
    createWorker = (await import("@/workers/incidentPoll.worker")).createIncidentPollWorker;
    ({ loadSyncState, trackNewIncidents } = await import("@bomberoscr/sync-domain/persist"));
    ({ createReferenceResolver } = await import("@bomberoscr/sync-domain/pipeline"));
  });
  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await closeRedis?.();
    await db?.$client.end();
  });
  beforeEach(async () => {
    await worker?.close();
    worker = undefined;
    await redis.flushdb();
    await resetDatabase(db);
    await seedReferences(db);
  });

  /** A worker on a fake clock that starts now, so delays line up with real time. */
  async function start(answers: (now: Date) => IncidentAnswers) {
    const clock = fakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
    const sigae = scriptedSigae();
    const references = createReferenceResolver({ db, sigae: sigae.client, now: clock.now });
    sigae.answers = answers(clock.now());
    worker = createWorker({ db, sigae: sigae.client, references, now: clock.now }) as Worker;
    await trackNewIncidents(db, [{ incidentId: INCIDENT_ID, firstSeenAt: clock.now() }]);
    await createScheduler(queue as never, clock.now).schedule([
      { incidentId: INCIDENT_ID, at: null }
    ]);
    await polled(clock.now());
    return { clock, sigae };
  }

  /** Waits until the poll at `at` was stored and the worker let go of the job. */
  async function polled(at: Date) {
    return eventually(async () => {
      const state = await loadSyncState(db, INCIDENT_ID);
      if (state?.lastPolledAt?.getTime() !== at.getTime()) return null;
      const jobState = await queue.getJobState(JOB_ID);
      return jobState === "delayed" || jobState === "completed" ? { state, jobState } : null;
    });
  }

  /** Runs the next poll now on the fake clock instead of waiting for it. */
  async function pollAgainAt(clock: ReturnType<typeof fakeClock>, at: Date) {
    clock.set(at);
    const job = await queue.getJob(JOB_ID);
    expect(await job?.getState()).toBe("delayed");
    await job?.promote();
    return polled(at);
  }

  async function delayedUntil(): Promise<number | null> {
    const score = await redis.zscore(`bull:${queue.name}:delayed`, JOB_ID);
    return score === null ? null : Math.floor(Number(score) / 0x1000);
  }

  async function pendingJobs() {
    const counts = await queue.getJobCounts("waiting", "delayed", "active", "prioritized");
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
  }

  it("moves an incident through active, settling and done", async () => {
    let reportedAt = new Date(0);
    const { clock, sigae } = await start((now) => {
      reportedAt = new Date(now.getTime() - MINUTE);
      return incidentAnswers(reportedAt, true);
    });
    const t0 = clock.now().getTime();

    let state = await loadSyncState(db, INCIDENT_ID);
    expect(state).toMatchObject({ phase: "active", nextPollAt: new Date(t0 + 3 * MINUTE) });
    expect(await delayedUntil()).toBe(t0 + 3 * MINUTE);
    expect(await pendingJobs()).toBe(1);

    // Closed upstream: settling, every 15 minutes for the first 6 hours.
    sigae.answers = incidentAnswers(reportedAt, false);
    const closedAt = t0 + 3 * MINUTE;
    ({ state } = await pollAgainAt(clock, new Date(closedAt)));
    expect(state).toMatchObject({
      phase: "settling",
      upstreamClosedAt: new Date(closedAt),
      nextPollAt: new Date(closedAt + 15 * MINUTE)
    });
    expect(await delayedUntil()).toBe(closedAt + 15 * MINUTE);

    // Hourly after 6 hours.
    ({ state } = await pollAgainAt(clock, new Date(closedAt + 7 * HOUR)));
    expect(state).toMatchObject({ phase: "settling", nextPollAt: new Date(closedAt + 8 * HOUR) });
    expect(await delayedUntil()).toBe(closedAt + 8 * HOUR);

    // The last hour of the 72h window is capped at the window's end.
    ({ state } = await pollAgainAt(clock, new Date(closedAt + 71 * HOUR + 30 * MINUTE)));
    expect(state?.nextPollAt).toEqual(new Date(closedAt + 72 * HOUR));

    const done = await pollAgainAt(clock, new Date(closedAt + 72 * HOUR));
    expect(done.state).toMatchObject({ phase: "done", nextPollAt: null });
    expect(done.jobState).toBe("completed");
    expect(await pendingJobs()).toBe(0);
    const [incident] = await db.query.incidents.findMany();
    expect(incident).toMatchObject({
      isOpen: false,
      closedAt: new Date(closedAt),
      closedAtSource: "observed"
    });
  });

  it("polls an incident open for more than 72 hours hourly", async () => {
    const { clock } = await start((now) =>
      incidentAnswers(new Date(now.getTime() - 73 * HOUR), true)
    );
    const state = await loadSyncState(db, INCIDENT_ID);
    expect(state).toMatchObject({
      phase: "active",
      nextPollAt: new Date(clock.now().getTime() + HOUR)
    });
  });

  it("stops polling an incident still open after 30 days", async () => {
    await start((now) => incidentAnswers(new Date(now.getTime() - 30 * DAY - MINUTE), true));
    const state = await loadSyncState(db, INCIDENT_ID);
    expect(state).toMatchObject({ phase: "done", nextPollAt: null });
    expect(await queue.getJobState(JOB_ID)).toBe("completed");
    const { anomalies } = await loadHistory(db, INCIDENT_ID);
    expect(anomalies.map((anomaly) => anomaly.code)).toContain("OPEN_TOO_LONG");
  });

  it("backs off failed polls and ends in the failed phase after 10", async () => {
    const { clock } = await start((now) => ({
      ...incidentAnswers(new Date(now.getTime() - MINUTE), true),
      ObtenerDetalleEmergencias: { status: 502 }
    }));
    const delays: number[] = [];
    let state = await loadSyncState(db, INCIDENT_ID);
    for (let poll = 1; poll < 10; poll += 1) {
      const at = clock.now().getTime();
      expect(state).toMatchObject({ phase: "active", consecutiveFailures: poll });
      expect(state?.lastError).toContain("ObtenerDetalleEmergencias");
      delays.push(((state?.nextPollAt?.getTime() ?? 0) - at) / MINUTE);
      expect(await delayedUntil()).toBe(state?.nextPollAt?.getTime());
      ({ state } = await pollAgainAt(clock, state?.nextPollAt as Date));
    }
    expect(delays).toEqual([3, 6, 12, 24, 48, 60, 60, 60, 60]);
    expect(state).toMatchObject({ phase: "failed", consecutiveFailures: 10, nextPollAt: null });
    expect(await queue.getJobState(JOB_ID)).toBe("completed");
    expect(await pendingJobs()).toBe(0);
  });

  it("delays the job with a backoff while the database is down, without spending attempts", async () => {
    const clock = fakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
    const sigae = scriptedSigae();
    sigae.answers = incidentAnswers(new Date(clock.now().getTime() - MINUTE), true);
    let down = true;
    // Every query fails like a refused connection while `down`.
    const flaky = new Proxy(db, {
      get(target, property) {
        if (down) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        return Reflect.get(target, property, target);
      }
    });
    const references = createReferenceResolver({ db, sigae: sigae.client, now: clock.now });
    worker = createWorker({ db: flaky, sigae: sigae.client, references, now: clock.now }) as Worker;
    // A crash loop doesn't fail the job after the default single stall either.
    expect(worker.opts.maxStalledCount).toBe(5);
    await trackNewIncidents(db, [{ incidentId: INCIDENT_ID, firstSeenAt: clock.now() }]);
    await createScheduler(queue as never, clock.now).schedule([
      { incidentId: INCIDENT_ID, at: null }
    ]);

    /** Waits for the retry-th delayed retry, and returns how far out it was put. */
    const retried = async (retries: number) => {
      const before = Date.now();
      const job = await eventually(async () => {
        const found = await queue.getJob(JOB_ID);
        return found?.data.retries === retries && (await found.getState()) === "delayed"
          ? found
          : null;
      });
      expect(job.attemptsMade).toBe(0);
      return ((await delayedUntil()) ?? 0) - before;
    };
    const first = await retried(1);
    expect(first).toBeGreaterThan(29_000);
    expect(first).toBeLessThan(31_000);
    await (await queue.getJob(JOB_ID))?.promote();
    const second = await retried(2);
    expect(second).toBeGreaterThan(59_000);
    expect(second).toBeLessThan(61_000);
    expect(await loadSyncState(db, INCIDENT_ID)).toMatchObject({ consecutiveFailures: 0 });

    // Back up: the next poll goes through and the job carries no retry count anymore.
    down = false;
    await (await queue.getJob(JOB_ID))?.promote();
    const { state } = await polled(clock.now());
    expect(state).toMatchObject({ phase: "active", consecutiveFailures: 0 });
    const job = await queue.getJob(JOB_ID);
    expect(job?.data).toEqual({ incidentId: INCIDENT_ID });
    expect(job?.attemptsMade).toBe(0);
    expect(await delayedUntil()).toBe(state.nextPollAt?.getTime());
  });
});
