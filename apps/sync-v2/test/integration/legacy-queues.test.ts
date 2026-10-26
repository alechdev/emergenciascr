import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { INTEGRATION } from "./harness";

import type Redis from "ioredis";

describe.skipIf(!INTEGRATION)("legacy queues", () => {
  let redis: Redis;
  let closeRedis: () => Promise<void>;

  beforeAll(async () => {
    ({ redis, closeRedis } = await import("@/config/redis"));
    await redis.flushdb();
  });
  afterAll(async () => {
    await closeRedis?.();
  });

  it("removes the open-incidents queue with its jobs and schedulers, once", async () => {
    const { Queue } = await import("bullmq");
    const { removeLegacyQueues } = await import("@/lib/jobs");
    const legacy = new Queue("open-incidents", { connection: redis });
    await legacy.add("open-incident", { incidentId: 1 }, { jobId: "open-incident-1" });
    await legacy.add(
      "open-incident",
      { incidentId: 2 },
      { jobId: "open-incident-2", delay: 60_000 }
    );
    await legacy.upsertJobScheduler("open-incidents", { every: 60_000 }, { name: "open-incident" });
    await legacy.close();
    const current = new Queue("incident-poll", { connection: redis });
    await current.add("incident-poll", { incidentId: 1 }, { jobId: "incident-poll-1" });

    expect(await removeLegacyQueues()).toEqual(["open-incidents"]);
    expect(await redis.keys("bull:open-incidents:*")).toEqual([]);
    expect(await current.getJobState("incident-poll-1")).toBe("waiting");
    expect(await removeLegacyQueues()).toEqual([]);
    await current.close();
  });
});
