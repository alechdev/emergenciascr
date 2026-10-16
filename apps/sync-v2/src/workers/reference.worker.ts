import { DelayedError, type Job, type Queue, QueueEvents } from "bullmq";
import { type Result, err, ok } from "neverthrow";

import { createRedisConnection } from "@/config/redis";
import { SyncError } from "@/lib/errors";
import { createWorker, removeFinishedJob } from "@/lib/jobs";
import logger from "@/lib/logger";
import { recordReferenceSuccess } from "@/lib/metrics";
import { type ReferenceJobData, referenceQueue } from "@/queues/reference.queue";
import { STATION_JOB_NAME, stationJobId, stationsQueue } from "@/queues/stations.queue";
import { VEHICLE_JOB_NAME, vehicleJobId, vehiclesQueue } from "@/queues/vehicles.queue";
import { syncDistricts } from "@/services/districts.service";
import { syncIncidentTypes } from "@/services/incidentTypes.service";
import { listStations } from "@/services/stations.service";
import { syncVehicleDisponibility } from "@/services/vehicleDisponibility.service";
import { listVehicles } from "@/services/vehicles.service";

/** Each kind references the ones before it (spec section 9). */
export const REFERENCE_KINDS = [
  "geography",
  "stations",
  "vehicles",
  "incident_types",
  "vehicle_availability"
] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

const ITEM_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
/** How long a reference job interrupted by a shutdown waits before it resumes. */
const RESUME_DELAY_MS = 30 * 1000;

class ShutdownError extends Error {
  override readonly name = "ShutdownError";
}

const log = logger.child({ queue: referenceQueue.name });

export interface ReferenceWorker {
  worker: ReturnType<typeof createWorker<ReferenceJobData, { kinds: string[] }>>;
  queueEvents: QueueEvents[];
}

/**
 * Syncs every reference kind in order. Stations and vehicles fan out one job per item
 * (`station-<id>`, `vehicle-<id>`) and the next kind starts once they all finished. A kind
 * that fails doesn't stop the others; the job fails at the end and its retry skips the
 * kinds that already succeeded. On shutdown (`signal`), the job stops waiting and puts
 * itself back as delayed, so it resumes after the restart without counting an attempt.
 */
export function createReferenceWorker({ signal }: { signal: AbortSignal }): ReferenceWorker {
  const stationsEvents = new QueueEvents(stationsQueue.name, {
    connection: createRedisConnection("stations-events")
  });
  const vehiclesEvents = new QueueEvents(vehiclesQueue.name, {
    connection: createRedisConnection("vehicles-events")
  });

  const steps: Record<ReferenceKind, () => Promise<Result<string, Error>>> = {
    geography: async () => syncDistricts(),
    stations: async () => {
      const list = await listStations();
      if (list.isErr()) return err(list.error);
      return runItemJobs(
        stationsQueue,
        stationsEvents,
        STATION_JOB_NAME,
        list.value.map((data) => ({ jobId: stationJobId(data.id), data })),
        signal
      );
    },
    vehicles: async () => {
      const list = await listVehicles();
      if (list.isErr()) return err(list.error);
      return runItemJobs(
        vehiclesQueue,
        vehiclesEvents,
        VEHICLE_JOB_NAME,
        list.value.map((data) => ({ jobId: vehicleJobId(data.id), data })),
        signal
      );
    },
    incident_types: async () => syncIncidentTypes(),
    vehicle_availability: async () => syncVehicleDisponibility()
  };

  const worker = createWorker<ReferenceJobData, { kinds: string[] }>(
    referenceQueue.name,
    async (job, token) => {
      const completed = new Set(job.data.completedKinds ?? []);
      const failures: Error[] = [];

      for (const kind of REFERENCE_KINDS) {
        if (completed.has(kind)) continue;
        if (signal.aborted) return postpone(job, token);

        const startedAt = performance.now();
        let result: Result<string, Error>;
        try {
          result = await steps[kind]();
        } catch (error) {
          if (error instanceof ShutdownError) return postpone(job, token);
          result = err(new SyncError(`${kind} sync threw`, { cause: error }));
        }
        const durationMs = Math.round(performance.now() - startedAt);

        if (result.isOk()) {
          completed.add(kind);
          recordReferenceSuccess(kind);
          await job.updateData({ ...job.data, completedKinds: [...completed] });
          log.info("reference data synced", {
            jobId: job.id,
            kind,
            summary: result.value,
            durationMs
          });
        } else {
          failures.push(result.error);
          log.warn("reference data sync failed", {
            jobId: job.id,
            kind,
            durationMs,
            error: result.error
          });
        }
      }

      if (failures.length > 0) {
        throw new AggregateError(failures, `reference sync failed for ${failures.length} kinds`);
      }
      return { kinds: [...completed] };
    },
    { concurrency: 1 }
  );

  return { worker, queueEvents: [stationsEvents, vehiclesEvents] };
}

async function postpone(job: Job<ReferenceJobData>, token: string | undefined): Promise<never> {
  log.info("reference sync postponed by shutdown", {
    jobId: job.id,
    completedKinds: job.data.completedKinds ?? []
  });
  await job.moveToDelayed(Date.now() + RESUME_DELAY_MS, token);
  throw new DelayedError();
}

async function runItemJobs<Data>(
  queue: Queue<Data>,
  events: QueueEvents,
  name: string,
  items: { jobId: string; data: Data }[],
  signal: AbortSignal
): Promise<Result<string, Error>> {
  await events.waitUntilReady();
  // A finished job with the same ID would make the new one a silent duplicate.
  await Promise.all(items.map((item) => removeFinishedJob(queue as Queue, item.jobId)));
  const jobs = await (queue as Queue).addBulk(
    items.map((item) => ({ name, data: item.data, opts: { jobId: item.jobId } }))
  );

  // Each `waitUntilFinished` adds a "closing" listener to the queue until it settles.
  queue.setMaxListeners(Math.max(queue.getMaxListeners(), jobs.length + 10));
  const outcomes = await untilAborted(
    Promise.allSettled(jobs.map((job) => job.waitUntilFinished(events, ITEM_WAIT_TIMEOUT_MS))),
    signal
  );
  const failed = outcomes.flatMap((outcome, index) =>
    outcome.status === "rejected" ? [{ jobId: jobs[index]?.id, reason: outcome.reason }] : []
  );
  if (failed.length === 0) return ok(`${jobs.length} ${name}s`);

  return err(
    new SyncError(`${failed.length} of ${jobs.length} ${name} jobs failed`, {
      cause: new AggregateError(
        failed.map(
          ({ jobId, reason }) =>
            new SyncError(`${jobId}: ${reason instanceof Error ? reason.message : String(reason)}`)
        ),
        `failed ${name} jobs`
      )
    })
  );
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ShutdownError("shutting down"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ShutdownError("shutting down"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
