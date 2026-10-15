import { closeDb, db, sql } from "@bomberoscr/db/index";

import env from "@/config/env";
import { closeRedis, redis } from "@/config/redis";
import { lastSigaeSuccessAt, sigae } from "@/config/sigae";
import { type HealthServer, startHealthServer } from "@/lib/health";
import { removeFinishedJob } from "@/lib/jobs";
import logger from "@/lib/logger";
import { observeQueues } from "@/lib/metrics";
import { expectOk } from "@/lib/sigae";
import { incidentDiscoveryQueue } from "@/queues/incidentDiscovery.queue";
import { allQueues } from "@/queues/index";
import { referenceQueue } from "@/queues/reference.queue";
import { createIncidentDiscoveryWorker } from "@/workers/incidentDiscovery.worker";
import { createOpenIncidentsWorker } from "@/workers/openIncidents.worker";
import { createReferenceWorker } from "@/workers/reference.worker";
import { createStationsWorker } from "@/workers/stations.worker";
import { createVehiclesWorker } from "@/workers/vehicles.worker";

import type { Telemetry } from "@/telemetry";
import type { Queue, QueueEvents, Worker } from "bullmq";

const WORKER_CLOSE_TIMEOUT_MS = 30_000;
const REFERENCE_BOOT_JOB_ID = "reference-boot";

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
    [{ id: "incident-discovery", pattern: "* * * * *", name: "incident-discovery" }]
  ]
]);

const shutdownController = new AbortController();
const workers: Worker[] = [];
const queueEvents: QueueEvents[] = [];
let health: HealthServer | undefined;
let stopObservingQueues: (() => void) | undefined;
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
    checks: {
      redis: () => redis.ping(),
      database: () => db.execute(sql`select 1`)
    },
    lastSigaeSuccessAt
  });
  logger.info("health endpoint listening", { port: health.port });

  stopObservingQueues = observeQueues(allQueues);

  const reference = createReferenceWorker({ signal: shutdownController.signal });
  workers.push(
    reference.worker,
    createStationsWorker(),
    createVehiclesWorker(),
    createIncidentDiscoveryWorker(),
    createOpenIncidentsWorker()
  );
  queueEvents.push(...reference.queueEvents);

  await syncSchedulers();

  // Reference data runs once at boot, then on the 12h cron. A boot job postponed by the
  // previous shutdown is still delayed, and adding the same ID again leaves it as is.
  await removeFinishedJob(referenceQueue, REFERENCE_BOOT_JOB_ID);
  await referenceQueue.add("reference", {}, { jobId: REFERENCE_BOOT_JOB_ID });

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

    const steps: [string, () => Promise<unknown>][] = [
      ["workers", () => Promise.all(workers.map(closeWorker))],
      ["queue metrics", async () => stopObservingQueues?.()],
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

    logger.info("sync-v2 stopped", { exitCode });
    try {
      await telemetry?.shutdown();
    } catch {
      exitCode = 1;
    }
    process.exit(exitCode);
  })();
  return shuttingDown;
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
