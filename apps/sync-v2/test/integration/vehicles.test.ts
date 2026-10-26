import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  INTEGRATION,
  type TestDatabase,
  eventually,
  fakeClock,
  fakeSigae,
  openTestDatabase,
  resetDatabase,
  seedReferences,
  sigaeFixtureBody
} from "./harness";

import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";

const HOUR = 60 * 60 * 1000;

/** The reference sync's vehicle jobs (`vehicle-<id>`), as the 12h job fans them out. */
describe.skipIf(!INTEGRATION)("vehicle reference jobs", () => {
  let db: TestDatabase;
  let redis: Redis;
  let closeRedis: () => Promise<void>;
  let queue: Queue;
  let worker: Worker | undefined;
  let modules: {
    queue: typeof import("@/queues/vehicles.queue");
    worker: typeof import("@/workers/vehicles.worker");
    service: typeof import("@/services/vehicles.service");
  };

  beforeAll(async () => {
    db = await openTestDatabase();
    ({ redis, closeRedis } = await import("@/config/redis"));
    modules = {
      queue: await import("@/queues/vehicles.queue"),
      worker: await import("@/workers/vehicles.worker"),
      service: await import("@/services/vehicles.service")
    };
    queue = modules.queue.vehiclesQueue as Queue;
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

  async function history() {
    const rows = await db.query.vehicleStationHistory.findMany({
      where: (table, { eq }) => eq(table.vehicleId, 860),
      orderBy: (table, { asc }) => [asc(table.id)]
    });
    return rows.map(({ stationId, operationalStatus, firstSeenAt, lastSeenAt }) => ({
      stationId,
      operationalStatus,
      firstSeenAt,
      lastSeenAt
    }));
  }

  it("records the station history of every vehicle job", async () => {
    const clock = fakeClock("2026-10-16T12:00:00.000Z");
    const station = { current: 2 };
    const sigae = fakeSigae(({ params }) => ({
      body: sigaeFixtureBody("ObtenerDatosVehiculo", {
        Id_vehiculo: params.Id_Vehiculo,
        Numero_interno: "M-86",
        Id_estacion: station.current
      })
    }));
    worker = modules.worker.createVehiclesWorker({
      db,
      sigae: sigae.client,
      now: clock.now
    }) as Worker;
    const run = async () => {
      const jobId = modules.queue.vehicleJobId(860);
      await queue.add(modules.queue.VEHICLE_JOB_NAME, { id: 860 }, { jobId });
      // Completed jobs are removed right away.
      await eventually(async () => (await queue.getJob(jobId)) === undefined);
    };
    const t0 = clock.now();

    await run();
    clock.advance(12 * HOUR);
    await run();
    station.current = 5;
    clock.advance(12 * HOUR);
    await run();

    expect(await history()).toEqual([
      {
        stationId: 2,
        operationalStatus: "OPERATIVO",
        firstSeenAt: t0,
        lastSeenAt: new Date(t0.getTime() + 12 * HOUR)
      },
      {
        stationId: 5,
        operationalStatus: "OPERATIVO",
        firstSeenAt: clock.now(),
        lastSeenAt: clock.now()
      }
    ]);
    const vehicle = await db.query.vehicles.findFirst({
      where: (table, { eq }) => eq(table.id, 860)
    });
    expect(vehicle).toMatchObject({ stationId: 5, internalNumber: "M-86" });
  });

  it("stores neither the vehicle nor its history when the details can't be stored", async () => {
    const sigae = fakeSigae(({ params }) => ({
      body: sigaeFixtureBody("ObtenerDatosVehiculo", {
        Id_vehiculo: params.Id_Vehiculo,
        Id_estacion: 99
      })
    }));
    const result = await modules.service.syncSingleVehicle(860, {
      db,
      sigae: sigae.client,
      now: () => new Date()
    });

    expect(result.isErr()).toBe(true);
    expect(await history()).toEqual([]);
    expect(await db.query.vehicles.findFirst({ where: (t, { eq }) => eq(t.id, 860) })).toBe(
      undefined
    );
  });
});
