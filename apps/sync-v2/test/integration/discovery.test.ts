import { formatSigaeRequestDate } from "@bomberoscr/sigae/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  INTEGRATION,
  type TestDatabase,
  eventually,
  fakeClock,
  fakeSigae,
  openTestDatabase,
  resetDatabase,
  sigaeFixtureBody,
  sigaeTime
} from "./harness";

import type { SyncState } from "@bomberoscr/sync-domain/types";
import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const LIST_ITEM = (
  sigaeFixtureBody("ObtenerListaEmergenciasApp").items as Record<string, unknown>[]
)[0] as Record<string, unknown>;

function listItem(incidentId: number, reportedAt: Date | null) {
  const time = reportedAt ? sigaeTime(reportedAt) : "0001-01-01T00:00:00";
  return {
    ...LIST_ITEM,
    idBoletaIncidente: incidentId,
    fecha: `${time.slice(0, 10)}T00:00:00`,
    horaIncidente: time
  };
}

describe.skipIf(!INTEGRATION)("discovery, gap fill and resume", () => {
  let db: TestDatabase;
  let redis: Redis;
  let closeRedis: () => Promise<void>;
  let pollQueue: Queue;
  let discoveryQueue: Queue;
  let workers: Worker[] = [];
  let modules: {
    poll: typeof import("@/queues/incidentPoll.queue");
    discoveryQueue: typeof import("@/queues/incidentDiscovery.queue");
    discovery: typeof import("@/services/incidentDiscovery.service");
    worker: typeof import("@/workers/incidentDiscovery.worker");
    jobs: typeof import("@/lib/jobs");
    persist: typeof import("@bomberoscr/sync-domain/persist");
    schedule: typeof import("@/lib/schedule");
  };

  beforeAll(async () => {
    db = await openTestDatabase();
    ({ redis, closeRedis } = await import("@/config/redis"));
    modules = {
      poll: await import("@/queues/incidentPoll.queue"),
      discoveryQueue: await import("@/queues/incidentDiscovery.queue"),
      discovery: await import("@/services/incidentDiscovery.service"),
      worker: await import("@/workers/incidentDiscovery.worker"),
      jobs: await import("@/lib/jobs"),
      persist: await import("@bomberoscr/sync-domain/persist"),
      schedule: await import("@/lib/schedule")
    };
    pollQueue = modules.poll.incidentPollQueue as Queue;
    discoveryQueue = modules.discoveryQueue.incidentDiscoveryQueue as Queue;
  });
  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await pollQueue?.close();
    await discoveryQueue?.close();
    await closeRedis?.();
    await db?.$client.end();
  });
  beforeEach(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    workers = [];
    await redis.flushall();
    await resetDatabase(db);
  });

  function realClock() {
    return fakeClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  }

  /** Every pending poll job: incident ID → state and, for delayed ones, when it is due. */
  async function pendingPolls() {
    const jobs = await pollQueue.getJobs(["waiting", "delayed", "active", "prioritized"]);
    const result = new Map<number, { state: string; at: number | null }>();
    for (const job of jobs) {
      const state = await job.getState();
      const score = await redis.zscore(`bull:${pollQueue.name}:delayed`, job.id as string);
      // BullMQ adds the delay to its own clock reading, a few milliseconds after the
      // scheduler's; every expected time here is on a whole second.
      result.set((job.data as { incidentId: number }).incidentId, {
        state,
        at: score === null ? null : Math.round(Number(score) / 0x1000 / 1000) * 1000
      });
    }
    expect(jobs.map((job) => job.id).sort()).toEqual(
      [...result.keys()].map((id) => modules.schedule.incidentPollJobId(id)).sort()
    );
    return result;
  }

  function state(
    incidentId: number,
    phase: SyncState["phase"],
    nextPollAt: Date | null,
    now: Date
  ): SyncState {
    return {
      incidentId,
      phase,
      nextPollAt,
      lastPolledAt: now,
      upstreamClosedAt: phase === "settling" ? now : null,
      consecutiveFailures: 0,
      notFoundCount: 0,
      emptyUnitsCount: 0,
      lastError: null,
      firstSeenAt: now
    };
  }

  /** What `main.ts` does at boot for the poll queue: one gap fill job, run by its worker. */
  async function boot(sigae: ReturnType<typeof fakeSigae>, now: () => Date) {
    const worker = modules.worker.createIncidentDiscoveryWorker({
      db,
      sigae: sigae.client,
      scheduler: modules.poll.createPollScheduler(),
      now
    }) as Worker;
    workers.push(worker);
    await modules.jobs.removeFinishedJob(discoveryQueue, "incident-gap-fill-boot");
    await discoveryQueue.add(
      modules.discoveryQueue.GAP_FILL_JOB_NAME,
      {},
      {
        jobId: "incident-gap-fill-boot"
      }
    );
    const job = await eventually(async () => {
      const found = await discoveryQueue.getJob("incident-gap-fill-boot");
      return found && (await found.getState()) === "completed" ? found : null;
    });
    await worker.close();
    workers = workers.filter((item) => item !== worker);
    return job.returnvalue as Record<string, number>;
  }

  it("reschedules every active and settling incident once after Redis lost everything", async () => {
    const clock = realClock();
    const now = clock.now();
    const at = (ms: number) => new Date(now.getTime() + ms);
    const rows = [
      state(101, "active", at(-5 * MINUTE), now),
      state(102, "active", at(2 * MINUTE), now),
      state(103, "settling", at(HOUR), now),
      state(104, "settling", null, now),
      state(105, "done", null, now),
      state(106, "deleted", null, now),
      state(107, "failed", null, now)
    ];
    for (const row of rows) await modules.persist.saveSyncState(db, row);
    const sigae = fakeSigae(() => ({
      body: { ...sigaeFixtureBody("ObtenerListaEmergenciasApp"), items: [] }
    }));

    // Polls scheduled before the loss, then Redis is wiped.
    await modules.poll
      .createPollScheduler(pollQueue as never, clock.now)
      .schedule(rows.map((row) => ({ incidentId: row.incidentId, at: row.nextPollAt })));
    await redis.flushall();
    expect(await pendingPolls()).toEqual(new Map());

    const first = await boot(sigae, clock.now);
    expect(first).toMatchObject({ tracked: 4, scheduled: 4, discovered: 0 });
    const expected = new Map([
      [101, { state: "waiting", at: null }],
      [102, { state: "delayed", at: at(2 * MINUTE).getTime() }],
      [103, { state: "delayed", at: at(HOUR).getTime() }],
      [104, { state: "waiting", at: null }]
    ]);
    expect(await pendingPolls()).toEqual(expected);

    // A restart without losing Redis: nothing is added twice.
    const second = await boot(sigae, clock.now);
    expect(second).toMatchObject({ tracked: 4, scheduled: 0 });
    expect(await pendingPolls()).toEqual(expected);
  });

  it("reschedules an incident whose previous poll job finished", async () => {
    const clock = realClock();
    await modules.persist.saveSyncState(db, state(110, "active", null, clock.now()));
    // A completed job from when the incident was done (before a manual sync revived it).
    const { Worker } = await import("bullmq");
    const finisher = new Worker(pollQueue.name, async () => "done", { connection: redis });
    await pollQueue.add("incident-poll", { incidentId: 110 }, { jobId: "incident-poll-110" });
    await eventually(
      async () => (await pollQueue.getJobState("incident-poll-110")) === "completed"
    );
    await finisher.close();

    const result = await modules.discovery.resumePolledIncidents({
      db,
      scheduler: modules.poll.createPollScheduler(pollQueue as never, clock.now)
    });

    expect(result).toEqual({ tracked: 1, scheduled: 1 });
    expect(await pendingPolls()).toEqual(new Map([[110, { state: "waiting", at: null }]]));
  });

  it("tracks new incidents from the latest list and schedules each once", async () => {
    const clock = realClock();
    const now = clock.now();
    // 201 is tracked but lost its poll job; 204 is done.
    await modules.persist.trackNewIncidents(db, [{ incidentId: 201, firstSeenAt: now }]);
    await modules.persist.saveSyncState(db, state(204, "done", null, now));
    const items = [
      listItem(201, new Date(now.getTime() - 30 * MINUTE)),
      listItem(202, new Date(now.getTime() - 2 * MINUTE)),
      listItem(203, new Date(now.getTime() - MINUTE)),
      listItem(204, new Date(now.getTime() - 3 * HOUR))
    ];
    const sigae = fakeSigae(({ endpoint }) =>
      endpoint === "ObtenerListaUltimasEmergenciasApp"
        ? { body: { ...sigaeFixtureBody("ObtenerListaUltimasEmergenciasApp"), items } }
        : { status: 500 }
    );
    const deps = {
      db,
      sigae: sigae.client,
      scheduler: modules.poll.createPollScheduler(pollQueue as never, clock.now),
      now: clock.now
    };

    const first = await modules.discovery.discoverLatestIncidents(deps);
    expect(first).toEqual({ listed: 4, discovered: [202, 203], rescheduled: 1 });
    expect(sigae.calls[0]?.params).toMatchObject({ numero_registros: 50 });
    const second = await modules.discovery.discoverLatestIncidents(deps);
    expect(second).toEqual({ listed: 4, discovered: [], rescheduled: 0 });

    expect(await pendingPolls()).toEqual(
      new Map([
        [201, { state: "waiting", at: null }],
        [202, { state: "waiting", at: null }],
        [203, { state: "waiting", at: null }]
      ])
    );
    const tracked = await db.query.incidentSyncState.findMany();
    expect(tracked.map((row) => [row.incidentId, row.phase, row.nextPollAt]).sort()).toEqual([
      [201, "active", now],
      [202, "active", now],
      [203, "active", now],
      [204, "done", null]
    ]);
  });

  it("fills the gap with the last 6 hours, keeping items without a usable time", async () => {
    const clock = realClock();
    const now = clock.now();
    const items = [
      listItem(301, new Date(now.getTime() - 5 * HOUR)),
      listItem(302, new Date(now.getTime() - 7 * HOUR)),
      listItem(303, null)
    ];
    const sigae = fakeSigae(({ endpoint }) =>
      endpoint === "ObtenerListaEmergenciasApp"
        ? { body: { ...sigaeFixtureBody("ObtenerListaEmergenciasApp"), items } }
        : { status: 500 }
    );

    const result = await modules.discovery.fillDiscoveryGap({
      db,
      sigae: sigae.client,
      scheduler: modules.poll.createPollScheduler(pollQueue as never, clock.now),
      now: clock.now
    });

    expect(result).toEqual({ listed: 2, discovered: [301, 303], rescheduled: 0 });
    expect(sigae.calls[0]?.params).toEqual({
      FechaDesde: formatSigaeRequestDate(new Date(now.getTime() - 6 * HOUR)),
      FechaHasta: formatSigaeRequestDate(now)
    });
    expect([...(await pendingPolls()).keys()].sort()).toEqual([301, 303]);
  });
});
