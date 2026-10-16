import { and, eq, notInArray } from "@bomberoscr/db/operators";
import {
  dispatchedStations,
  dispatchedVehicles,
  incidentChanges,
  incidents,
  syncAnomalies
} from "@bomberoscr/db/schema";
import { conflictUpdateSetColumns } from "@bomberoscr/db/utils";

import { saveSyncState } from "./incident-state";

import type { Anomaly, Change, IncidentState, SyncState } from "../types";
import type { Executor } from "./executor";
import type { Database } from "@bomberoscr/db/client";

export interface PollWrite {
  incidentId: number;
  /** The state to store; `null` when the poll stores no incident data. */
  next: IncidentState | null;
  /** Delete the incident and everything under it (spec section 8.4). */
  deleteIncident: boolean;
  /** Incident data is only written, and `modifiedAt` bumped, when this is non-empty. */
  changes: readonly Change[];
  anomalies: readonly Anomaly[];
  syncState: SyncState;
  /** Snapshots behind this poll, stored with every change. */
  snapshotIds: readonly number[];
  now: Date;
}

const INCIDENT_COLUMNS = [
  "EEConsecutive",
  "address",
  "importantDetails",
  "incidentTimestamp",
  "provinceId",
  "cantonId",
  "districtId",
  "incidentCode",
  "specificIncidentCode",
  "dispatchIncidentCode",
  "specificDispatchIncidentCode",
  "responsibleStation",
  "latitude",
  "longitude",
  "isOpen",
  "controlledAt",
  "fireUnderControlAt",
  "lossesStoppedAt",
  "allClearAt",
  "closedAt",
  "closedAtSource",
  "modifiedAt"
] as const;

const VEHICLE_COLUMNS = [
  "incidentId",
  "stationId",
  "vehicleId",
  "vehicleInternalNumber",
  "dispatchedTime",
  "arrivalTime",
  "departureTime",
  "baseReturnTime",
  "attentionOnFoot"
] as const;

const STATION_COLUMNS = ["incidentId", "stationId", "serviceTypeId", "attentionOnFoot"] as const;

/**
 * Everything one poll writes, in one transaction: the incident with its dispatched units and
 * stations (or their deletion), changes, anomalies and the sync state. Snapshots are stored
 * before, on their own, so they survive a poll that fails later.
 */
export async function persistPollResult(db: Database, write: PollWrite): Promise<void> {
  await db.transaction(async (tx) => {
    if (write.deleteIncident) {
      await deleteIncident(tx, write.incidentId);
    } else if (write.next && write.changes.length > 0) {
      await writeIncidentState(tx, write.next, write.now);
    }

    if (write.changes.length > 0) {
      await tx.insert(incidentChanges).values(
        write.changes.map((change) => ({
          incidentId: write.incidentId,
          entity: change.entity,
          entityId: change.entityId,
          field: change.field,
          kind: change.kind,
          oldValue: change.oldValue,
          newValue: change.newValue,
          snapshotIds: [...write.snapshotIds],
          detectedAt: write.now
        }))
      );
    }
    await insertAnomalies(tx, write.incidentId, write.anomalies, write.now);
    await saveSyncState(tx, write.syncState);
  });
}

/** Anomalies for an incident, outside of a poll write (for example after a failed one). */
export async function insertAnomalies(
  db: Executor,
  incidentId: number,
  anomalies: readonly Anomaly[],
  now: Date
): Promise<void> {
  if (anomalies.length === 0) return;
  await db.insert(syncAnomalies).values(
    anomalies.map((anomaly) => ({
      incidentId,
      entity: anomaly.entity,
      entityId: anomaly.entityId,
      code: anomaly.code,
      details: anomaly.details,
      detectedAt: now
    }))
  );
}

async function writeIncidentState(db: Executor, state: IncidentState, now: Date): Promise<void> {
  const { incident } = state;
  await db
    .insert(incidents)
    .values({ ...incident, modifiedAt: now })
    .onConflictDoUpdate({
      target: incidents.id,
      set: conflictUpdateSetColumns(incidents, INCIDENT_COLUMNS)
    });

  const vehicleIds = state.vehicles.map((row) => row.id);
  await db
    .delete(dispatchedVehicles)
    .where(
      vehicleIds.length > 0
        ? and(
            eq(dispatchedVehicles.incidentId, incident.id),
            notInArray(dispatchedVehicles.id, vehicleIds)
          )
        : eq(dispatchedVehicles.incidentId, incident.id)
    );
  if (state.vehicles.length > 0) {
    await db
      .insert(dispatchedVehicles)
      .values(state.vehicles)
      .onConflictDoUpdate({
        target: dispatchedVehicles.id,
        set: conflictUpdateSetColumns(dispatchedVehicles, VEHICLE_COLUMNS)
      });
  }

  const stationIds = state.stations.map((row) => row.id);
  await db
    .delete(dispatchedStations)
    .where(
      stationIds.length > 0
        ? and(
            eq(dispatchedStations.incidentId, incident.id),
            notInArray(dispatchedStations.id, stationIds)
          )
        : eq(dispatchedStations.incidentId, incident.id)
    );
  if (state.stations.length > 0) {
    await db
      .insert(dispatchedStations)
      .values(state.stations)
      .onConflictDoUpdate({
        target: dispatchedStations.id,
        set: conflictUpdateSetColumns(dispatchedStations, STATION_COLUMNS)
      });
  }
}

/** The incident and its children. History tables have no foreign keys, so they stay. */
async function deleteIncident(db: Executor, incidentId: number): Promise<void> {
  await db.delete(dispatchedVehicles).where(eq(dispatchedVehicles.incidentId, incidentId));
  await db.delete(dispatchedStations).where(eq(dispatchedStations.incidentId, incidentId));
  await db.delete(incidents).where(eq(incidents.id, incidentId));
}
