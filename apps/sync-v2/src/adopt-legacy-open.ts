/**
 * One-off, at the switch from the legacy sync: polls every incident the legacy sync left open
 * without tracking it (see `adoptLegacyOpenIncidents`). Run it with the sync-v2 image and
 * environment, next to the running service (each poll takes the incident's lock); it uses the
 * database and SIGAE, not Redis. Adopted incidents that are still open get their scheduled
 * polls from the service's next hourly queue resume.
 */
import { closeDb, db } from "@bomberoscr/db/index";

import { referenceResolver } from "@/config/pipeline";
import { sigae } from "@/config/sigae";
import logger from "@/lib/logger";
import { adoptLegacyOpenIncidents } from "@/services/legacyOpen.service";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

let exitCode = 0;
try {
  const startedAt = performance.now();
  const result = await adoptLegacyOpenIncidents(
    { db, sigae, references: referenceResolver, now: () => new Date() },
    {
      signal: controller.signal,
      onPolled: (polled, found) => {
        if (polled % 50 === 0) logger.info("legacy open incidents polled", { polled, found });
      },
      onFailed: (incidentId, reason) => {
        logger.warn("legacy open incident poll failed", { incidentId, error: reason });
      }
    }
  );
  const { found, ...ids } = result;
  const counts = Object.fromEntries(Object.entries(ids).map(([key, list]) => [key, list.length]));
  logger.info("legacy open incidents adopted", {
    found,
    ...counts,
    aborted: controller.signal.aborted,
    durationMs: Math.round(performance.now() - startedAt),
    notFoundIds: result.notFound,
    failedIds: result.failed
  });
  if (controller.signal.aborted || result.failed.length > 0) exitCode = 1;
} catch (error) {
  logger.error("adopting legacy open incidents failed", { error });
  exitCode = 1;
} finally {
  const closed = await Promise.allSettled([closeDb(), sigae.close()]);
  for (const [index, outcome] of closed.entries()) {
    if (outcome.status === "fulfilled") continue;
    logger.error("closing a connection failed", {
      connection: index === 0 ? "database" : "sigae",
      error: outcome.reason
    });
    exitCode = 1;
  }
}
// Not `process.exit()`: the process ends once the logs are written.
process.exitCode = exitCode;
