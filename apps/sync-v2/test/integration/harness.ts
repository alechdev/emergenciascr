/**
 * The sync-domain integration harness (throwaway Postgres, fake SIGAE, fixture replay) plus
 * the throwaway Redis. Both come only from `TEST_DATABASE_URL` and `TEST_REDIS_URL`.
 */
import { TEST_DATABASE_URL } from "../../../../packages/sync-domain/test/integration/harness";

export * from "../../../../packages/sync-domain/test/integration/harness";
export {
  INCIDENT_ID,
  detailsBody,
  listBody,
  reportBody,
  station,
  unit
} from "../../../../packages/sync-domain/test/builders";

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL || undefined;

/** Both throwaway servers are configured; otherwise the suites skip. */
export const INTEGRATION = Boolean(TEST_DATABASE_URL && TEST_REDIS_URL);

/** Costa Rica wall-clock time as SIGAE writes it (`YYYY-MM-DDTHH:mm:ss`). */
export function sigaeTime(at: Date): string {
  return new Date(at.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

/** Waits for a condition that other processes or workers make true. */
export async function eventually<T>(
  check: () => Promise<T | undefined | null | false>,
  { timeoutMs = 10_000, intervalMs = 25 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
