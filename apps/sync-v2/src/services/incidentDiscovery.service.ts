import db, { inArray } from "@bomberoscr/db/index";
import { incidents } from "@bomberoscr/db/schema";
import { ResultAsync, okAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

const LATEST_INCIDENTS = 50;

/** IDs among the latest incidents in SIGAE that are not stored yet. */
export function getNewIncidents(): ResultAsync<number[], SyncError> {
  return expectOk(
    sigae.getLatestIncidents({ count: LATEST_INCIDENTS }),
    "latest incidents"
  ).andThen((data) => {
    if (data.items.length === 0) return okAsync([]);

    const incidentIds = data.items.map((incident) => incident.idBoletaIncidente);

    return ResultAsync.fromPromise(
      db.select({ id: incidents.id }).from(incidents).where(inArray(incidents.id, incidentIds)),
      (cause) => new SyncError("failed to read existing incidents", { cause })
    ).map((existing) => {
      const existingIds = new Set(existing.map((incident) => incident.id));
      return incidentIds.filter((id) => !existingIds.has(id));
    });
  });
}
