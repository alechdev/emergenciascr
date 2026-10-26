import Redis from "ioredis";

import env from "@/config/env";
import logger from "@/lib/logger";

const connections = new Set<Redis>();

function track(connection: Redis, name: string): Redis {
  connection.on("error", (error) => {
    logger.warn("redis connection error", { connection: name, error });
  });
  connections.add(connection);
  return connection;
}

/** Shared by queues and workers (workers open their own blocking connection from it). */
export const redis = track(
  new Redis(env.REDIS_URL, { enableReadyCheck: false, maxRetriesPerRequest: null }),
  "main"
);

redis.on("ready", () => {
  logger.info("redis ready");
});

/** A separate connection, for clients that block it (`QueueEvents`). */
export function createRedisConnection(name: string): Redis {
  return track(redis.duplicate(), name);
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([...connections].map((connection) => connection.quit()));
  connections.clear();
}
