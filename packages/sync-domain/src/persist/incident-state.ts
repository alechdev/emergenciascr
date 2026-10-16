import { eq } from "@bomberoscr/db/operators";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidentSyncState,
  incidents,
  syncAnomalies
} from "@bomberoscr/db/schema";
import { conflictUpdateSetColumns } from "@bomberoscr/db/utils";

import type {
  Anomaly,
  DispatchedStationRow,
  DispatchedVehicleRow,
  IncidentRow,
  IncidentState,
  JsonValue,
  SyncState
} from "../types";
import type { Executor } from "./executor";

/** What the database holds for an incident, or `null` when it isn't stored. */
export async function loadIncidentState(
  db: Executor,
  incidentId: number
): Promise<IncidentState | null> {
  const [incidentRows, vehicleRows, stationRows] = await Promise.all([
    db.select().from(incidents).where(eq(incidents.id, incidentId)),
    db.select().from(dispatchedVehicles).where(eq(dispatchedVehicles.incidentId, incidentId)),
    db.select().from(dispatchedStations).where(eq(dispatchedStations.incidentId, incidentId))
  ]);
  const row = incidentRows[0];
  if (!row) return null;

  const incident: IncidentRow = {
    id: row.id,
    EEConsecutive: row.EEConsecutive,
    address: row.address,
    importantDetails: row.importantDetails,
    incidentTimestamp: row.incidentTimestamp,
    provinceId: row.provinceId,
    cantonId: row.cantonId,
    districtId: row.districtId,
    incidentCode: row.incidentCode,
    specificIncidentCode: row.specificIncidentCode,
    dispatchIncidentCode: row.dispatchIncidentCode,
    specificDispatchIncidentCode: row.specificDispatchIncidentCode,
    responsibleStation: row.responsibleStation,
    latitude: row.latitude,
    longitude: row.longitude,
    isOpen: row.isOpen,
    controlledAt: row.controlledAt,
    fireUnderControlAt: row.fireUnderControlAt,
    lossesStoppedAt: row.lossesStoppedAt,
    allClearAt: row.allClearAt,
    closedAt: row.closedAt,
    closedAtSource: row.closedAtSource
  };
  const vehicles: DispatchedVehicleRow[] = vehicleRows
    .map((vehicle) => ({
      id: vehicle.id,
      incidentId: vehicle.incidentId,
      stationId: vehicle.stationId,
      vehicleId: vehicle.vehicleId,
      vehicleInternalNumber: vehicle.vehicleInternalNumber,
      dispatchedTime: vehicle.dispatchedTime,
      arrivalTime: vehicle.arrivalTime,
      departureTime: vehicle.departureTime,
      baseReturnTime: vehicle.baseReturnTime,
      attentionOnFoot: vehicle.attentionOnFoot
    }))
    .sort((a, b) => a.id - b.id);
  const stations: DispatchedStationRow[] = stationRows
    .map((station) => ({
      id: station.id,
      incidentId: station.incidentId,
      stationId: station.stationId,
      serviceTypeId: station.serviceTypeId,
      attentionOnFoot: station.attentionOnFoot
    }))
    .sort((a, b) => a.id - b.id);
  return { incident, vehicles, stations };
}

export async function loadSyncState(db: Executor, incidentId: number): Promise<SyncState | null> {
  const [row] = await db
    .select()
    .from(incidentSyncState)
    .where(eq(incidentSyncState.incidentId, incidentId));
  return row ?? null;
}

/** Inserts or replaces the sync state row. */
export async function saveSyncState(db: Executor, state: SyncState): Promise<void> {
  await db
    .insert(incidentSyncState)
    .values(state)
    .onConflictDoUpdate({
      target: incidentSyncState.incidentId,
      set: conflictUpdateSetColumns(incidentSyncState, [
        "phase",
        "nextPollAt",
        "lastPolledAt",
        "upstreamClosedAt",
        "consecutiveFailures",
        "notFoundCount",
        "emptyUnitsCount",
        "lastError",
        "firstSeenAt"
      ])
    });
}

export type RecordedAnomaly = Pick<Anomaly, "code" | "entity" | "entityId" | "details">;

/** Every anomaly recorded for the incident, to skip conditions already recorded. */
export async function loadRecordedAnomalies(
  db: Executor,
  incidentId: number
): Promise<RecordedAnomaly[]> {
  const rows = await db
    .select({
      code: syncAnomalies.code,
      entity: syncAnomalies.entity,
      entityId: syncAnomalies.entityId,
      details: syncAnomalies.details
    })
    .from(syncAnomalies)
    .where(eq(syncAnomalies.incidentId, incidentId));
  return rows.map((row) => ({
    code: row.code as Anomaly["code"],
    entity: row.entity,
    entityId: row.entityId,
    details: isObject(row.details) ? row.details : {}
  }));
}

function isObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
