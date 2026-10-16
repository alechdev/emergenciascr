import { closeDb, db, sql } from "@bomberoscr/db/index";
import { countIncidentsByPhase } from "@bomberoscr/sync-domain/persist";

import env from "@/config/env";
import { referenceResolver } from "@/config/pipeline";
import { closeRedis, redis } from "@/config/redis";
import { lastSigaeSuccessAt, sigae } from "@/config/sigae";
import { type HealthServer, startHealthServer } from "@/lib/health";
import { removeFinishedJob } from "@/lib/jobs";
import logger from "@/lib/logger";
import { observeIncidentPhases, observeQueues } from "@/lib/metrics";
import { expectOk } from "@/lib/sigae";
import {
  DISCOVERY_JOB_NAME,
  GAP_FILL_JOB_NAME,
  incidentDiscoveryQueue
} from "@/queues/incidentDiscovery.queue";
import { createPollScheduler } from "@/queues/incidentPoll.queue";
import { allQueues } from "@/queues/index";
import { referenceQueue } from "@/queues/reference.queue";
import { createIncidentDiscoveryWorker } from "@/workers/incidentDiscovery.worker";
import { createIncidentPollWorker } from "@/workers/incidentPoll.worker";
import { createReferenceWorker } from "@/workers/reference.worker";
import { createStationsWorker } from "@/workers/stations.worker";
import { createVehiclesWorker } from "@/workers/vehicles.worker";

import type { Telemetry } from "@/telemetry";
import type { Queue, QueueEvents, Worker } from "bullmq";

const WORKER_CLOSE_TIMEOUT_MS = 30_000;
/** Longer than the worker grace period, so only a hung close or flush reaches it. */
const SHUTDOWN_TIMEOUT_MS = 45_000;
const EXIT_GRACE_MS = 1_000;
const REFERENCE_BOOT_JOB_ID = "reference-boot";
const GAP_FILL_BOOT_JOB_ID = "incident-gap-fill-boot";

interface Scheduler {
  id: string;
  pattern: string;
  name: string;
}

/** The only job schedulers each queue should have; any other one is left over and removed. */
const SCHEDULERS = new Map<Queue, Scheduler[]>([
  [referenceQueue, [{ id: "reference", pattern: "0 */12 * * *", name: "reference" }]],
  [
    incidentDiscoveryQueue,
    [
      { id: "incident-discovery", pattern: "* * * * *", name: DISCOVERY_JOB_NAME },
      { id: "incident-gap-fill", pattern: "30 * * * *", name: GAP_FILL_JOB_NAME }
    ]
  ]
]);

const shutdownController = new AbortController();
const workers: Worker[] = [];
const queueEvents: QueueEvents[] = [];
let health: HealthServer | undefined;
let stopObservingQueues: (() => void) | undefined;
let stopObservingPhases: (() => void) | undefined;
let telemetry: Telemetry | undefined;

async function main(): Promise<void> {
  logger.info("starting sync-v2", { telemetry: telemetry?.enabled ?? false });
  if (!telemetry?.enabled) {
    logger.info("telemetry export is off: OTEL_EXPORTER_OTLP_ENDPOINT is not set");
  }

  const ping = await expectOk(sigae.ping(), "ping");
  if (ping.isErr()) {
    // Not fatal: restarting doesn't fix SIGAE being down, and every job retries on its own.
    logger.error("SIGAE ping failed", { error: ping.error });
  } else {
    logger.info("SIGAE reachable");
  }

  health = await startHealthServer({
    port: env.HEALTH_PORT,
    host: env.HEALTH_HOST,
    checks: {
      redis: () => redis.ping(),
      database: () => db.execute(sql`select 1`)
    },
    lastSigaeSuccessAt
  });
  logger.info("health endpoint listening", { host: env.HEALTH_HOST, port: health.port });

  stopObservingQueues = observeQueues(allQueues);
  stopObservingPhases = observeIncidentPhases(() => countIncidentsByPhase(db));

  // Before any worker runs, so a leftover scheduler can't start one more periodic job.
  await syncSchedulers();
  // A shutdown that started meanwhile has already closed the queues.
  if (shutdownController.signal.aborted) return;

  const now = () => new Date();
  const reference = createReferenceWorker({ signal: shutdownController.signal });
  workers.push(
    reference.worker,
    createStationsWorker(),
    createVehiclesWorker(),
    createIncidentDiscoveryWorker({ db, sigae, scheduler: createPollScheduler(), now }),
    createIncidentPollWorker({ db, sigae, references: referenceResolver, now })
  );
  queueEvents.push(...reference.queueEvents);

  // Reference data runs once at boot, then on the 12h cron. A boot job postponed by the
  // previous shutdown is still delayed, and adding the same ID again leaves it as is.
  await removeFinishedJob(referenceQueue, REFERENCE_BOOT_JOB_ID);
  await referenceQueue.add("reference", {}, { jobId: REFERENCE_BOOT_JOB_ID });

  // Bootstrap (spec section 8.1): every tracked incident gets its poll back, then the gap
  // fill catches what was reported while the sync was down.
  await removeFinishedJob(incidentDiscoveryQueue, GAP_FILL_BOOT_JOB_ID);
  await incidentDiscoveryQueue.add(GAP_FILL_JOB_NAME, {}, { jobId: GAP_FILL_BOOT_JOB_ID });

  logger.info("sync-v2 started");
}

async function syncSchedulers(): Promise<void> {
  for (const queue of allQueues) {
    const expected = SCHEDULERS.get(queue) ?? [];
    const existing = await queue.getJobSchedulers();
    for (const scheduler of existing) {
      const id = scheduler.id ?? scheduler.key;
      if (expected.some((item) => item.id === id)) continue;
      await queue.removeJobScheduler(id);
      logger.info("removed leftover job scheduler", { queue: queue.name, scheduler: id });
    }
    for (const scheduler of expected) {
      await queue.upsertJobScheduler(
        scheduler.id,
        { pattern: scheduler.pattern },
        { name: scheduler.name, data: {} }
      );
    }
  }
}

async function closeWorker(worker: Worker): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), WORKER_CLOSE_TIMEOUT_MS);
  });
  const result = await Promise.race([worker.close(), timedOut]).finally(() => clearTimeout(timer));
  if (result === "timeout") {
    logger.warn("worker did not finish its jobs in time, closing it anyway", {
      queue: worker.name
    });
    await worker.close(true);
  }
}

let shuttingDown: Promise<void> | undefined;

function shutdown(reason: string, exitCode: number): Promise<void> {
  shuttingDown ??= (async () => {
    logger.info("shutting down", { reason });
    shutdownController.abort();
    const deadline = setTimeout(() => {
      logger.error("shutdown timed out, exiting", { timeoutMs: SHUTDOWN_TIMEOUT_MS });
      exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    const steps: [string, () => Promise<unknown>][] = [
      ["workers", () => Promise.all(workers.map(closeWorker))],
      ["queue metrics", async () => stopObservingQueues?.()],
      ["phase metrics", async () => stopObservingPhases?.()],
      ["queue events", () => Promise.all(queueEvents.map((events) => events.close()))],
      ["queues", () => Promise.all(allQueues.map((queue) => queue.close()))],
      ["health endpoint", async () => health?.close()],
      ["redis", closeRedis],
      ["database", closeDb],
      ["sigae client", () => sigae.close()]
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (error) {
        exitCode = 1;
        logger.error("shutdown step failed", { step: name, error });
      }
    }

    try {
      await telemetry?.shutdown();
    } catch (error) {
      exitCode = 1;
      logger.error("shutdown step failed", { step: "telemetry", error });
    }
    clearTimeout(deadline);
    // After the telemetry flush, so this line only reaches stdout.
    logger.info("sync-v2 stopped", { exitCode });
    exit(exitCode);
  })();
  return shuttingDown;
}

/**
 * Exits once the event loop is empty, which lets the last log lines drain, or after a short
 * grace period when something still holds it open.
 */
function exit(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
}

/** Starts the service. `telemetry` must have started before this module was imported. */
export function run(startedTelemetry: Telemetry): void {
  telemetry = startedTelemetry;

  // `on`, not `once`: a second signal (tsx and some runtimes forward their own) would
  // otherwise kill the process in the middle of the shutdown.
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGINT", () => void shutdown("SIGINT", 0));

  main().catch((error: unknown) => {
    logger.error("failed to start sync-v2", { error });
    void shutdown("startup failed", 1);
  });
}
