import { db } from "@bomberoscr/db/index";
import {
  dispatchedStations as dispatchedStationsTable,
  dispatchedVehicles as dispatchedVehiclesTable,
  incidents as incidentsTable
} from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";
import { rawToDispatchedStations } from "@bomberoscr/sync-domain/transform/rawToDispatchedStations";
import { rawToDispatchedVehicles } from "@bomberoscr/sync-domain/transform/rawToDispatchedVehicles";
import { rawToIncident } from "@bomberoscr/sync-domain/transform/rawToIncident";

import type {
  DispatchedStation,
  DispatchedUnit,
  IncidentDetails,
  IncidentReport
} from "@bomberoscr/sigae/client";

export type UpsertIncidentInput = {
  incidentId: number;
  incidentDetails: IncidentDetails;
  incidentReport: IncidentReport;
  stationsAttending: DispatchedStation[];
  vehiclesDispatched: DispatchedUnit[];
};

export async function upsertIncident({
  incidentId,
  incidentDetails,
  incidentReport,
  stationsAttending,
  vehiclesDispatched
}: UpsertIncidentInput) {
  if (!incidentDetails || !incidentReport) return;

  const responsibleStation =
    stationsAttending.find((s) => s.DestipoServicio === "RESPONSABLE") ||
    stationsAttending[stationsAttending.length - 1];

  const incident = await rawToIncident({
    incidentId,
    responsibleStationId: responsibleStation?.IdEstacion || stationsAttending[0]?.IdEstacion || 0,
    incidentReport,
    incidentDetails
  });

  const dispatchedStationsData = rawToDispatchedStations({
    dispatchedStations: stationsAttending,
    incidentId
  });

  const dispatchedVehiclesData = rawToDispatchedVehicles({
    dispatchedVehicles: vehiclesDispatched,
    incidentId
  });

  // One transaction, so a failed child insert never leaves a stored incident without them.
  await db.transaction(async (tx) => {
    await tx.insert(incidentsTable).values(incident).onConflictDoUpdate({
      set: incident,
      target: incidentsTable.id
    });

    if (dispatchedStationsData.length > 0) {
      await tx
        .insert(dispatchedStationsTable)
        .values(dispatchedStationsData)
        .onConflictDoUpdate({
          target: dispatchedStationsTable.id,
          set: conflictUpdateSetAllColumns(dispatchedStationsTable)
        });
    }

    if (dispatchedVehiclesData.length > 0) {
      await tx
        .insert(dispatchedVehiclesTable)
        .values(dispatchedVehiclesData)
        .onConflictDoUpdate({
          target: dispatchedVehiclesTable.id,
          set: conflictUpdateSetAllColumns(dispatchedVehiclesTable)
        });
    }
  });

  return incident;
}
