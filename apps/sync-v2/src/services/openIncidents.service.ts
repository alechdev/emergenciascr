import { and, db, eq, isNull, lt, or } from "@bomberoscr/db/index";
import { dispatchedVehicles, incidents } from "@bomberoscr/db/schema";
import { fetchIncident } from "@bomberoscr/sync-domain/fetch-incident";
import { upsertIncident } from "@bomberoscr/sync-domain/persist/upsertIncident";
import { ResultAsync, errAsync, okAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FIRST_PLAUSIBLE_TIME = new Date("1971-01-01T00:00:00Z");

export function updateIncident({ id }: { id: number }): ResultAsync<void, Error> {
  return fetchIncident(sigae, id).andThen((input) =>
    ResultAsync.fromPromise(
      upsertIncident(input),
      (cause) => new SyncError(`failed to store incident ${id}`, { cause })
    ).map(() => undefined)
  );
}

export type CloseIncidentError = {
  type: "no_coordinates" | "vehicles_in_scene" | "not_found" | "database_error";
  cause?: unknown;
};

export const ERROR_MESSAGES: Record<CloseIncidentError["type"], string> = {
  no_coordinates: "No coordinates",
  vehicles_in_scene: "Vehicles still in scene",
  not_found: "Not found",
  database_error: "Database error"
};

/**
 * Closes the incident unless it is too recent or if there are still vehicles in scene.
 * @param id - The id of the incident to close.
 * @returns A result indicating whether the incident was closed successfully.
 */
export async function closeIncident({
  id
}: {
  id: number;
}): Promise<ResultAsync<void, CloseIncidentError>> {
  const incidentQuery = db.query.incidents.findFirst({
    where: eq(incidents.id, id),
    columns: {
      incidentTimestamp: true,
      latitude: true,
      longitude: true
    }
  });
  const vehiclesInSceneQuery = db.query.dispatchedVehicles.findMany({
    where: and(
      eq(dispatchedVehicles.incidentId, id),
      // No departure yet: `NULL` from the new sync, SIGAE's year-1 placeholder in older rows.
      or(
        isNull(dispatchedVehicles.departureTime),
        lt(dispatchedVehicles.departureTime, FIRST_PLAUSIBLE_TIME)
      )
    ),
    columns: {
      departureTime: true
    }
  });

  return ResultAsync.combine([
    ResultAsync.fromPromise(
      incidentQuery,
      (cause) => ({ type: "database_error", cause }) as CloseIncidentError
    ),
    ResultAsync.fromPromise(
      vehiclesInSceneQuery,
      (cause) => ({ type: "database_error", cause }) as CloseIncidentError
    )
  ])
    .andThen(([incident, vehiclesInScene]) => {
      if (!incident) return errAsync({ type: "not_found" } as CloseIncidentError);

      // If the incident is older than three days, close it regardless of other conditions
      const threeDaysAgo = new Date(Date.now() - THREE_DAYS_MS);
      if (incident.incidentTimestamp < threeDaysAgo) {
        return okAsync(id);
      }

      if (incident.latitude === "0" || incident.longitude === "0")
        return errAsync({ type: "no_coordinates" } as CloseIncidentError);

      if (vehiclesInScene.length > 0)
        return errAsync({ type: "vehicles_in_scene" } as CloseIncidentError);

      return okAsync(id);
    })
    .andThen((id) => {
      return ResultAsync.fromPromise(
        db.update(incidents).set({ isOpen: false }).where(eq(incidents.id, id)),
        (cause) => ({ type: "database_error", cause }) as CloseIncidentError
      ).map(() => undefined);
    });
}
