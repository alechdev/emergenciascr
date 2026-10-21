/** A vehicle's station and operational status, as stored after a details upsert. */
export interface VehicleAssignment {
  stationId: number;
  /** `null` while SIGAE never gave one. */
  operationalStatus: string | null;
}

/** The latest `vehicle_station_history` row of a vehicle. */
export interface VehicleAssignmentRow extends VehicleAssignment {
  id: number;
}

export type VehicleAssignmentWrite =
  | { kind: "bump"; id: number; lastSeenAt: Date }
  | { kind: "insert"; row: VehicleAssignment & { firstSeenAt: Date; lastSeenAt: Date } };

/**
 * What one observation of a vehicle writes to its history (spec section 9): the same station
 * and status as its latest row only move that row's `lastSeenAt`; anything else, or no row
 * yet, starts a new row.
 */
export function vehicleAssignmentWrite(
  latest: VehicleAssignmentRow | null,
  observed: VehicleAssignment,
  now: Date
): VehicleAssignmentWrite {
  if (
    latest &&
    latest.stationId === observed.stationId &&
    latest.operationalStatus === observed.operationalStatus
  ) {
    return { kind: "bump", id: latest.id, lastSeenAt: now };
  }
  return { kind: "insert", row: { ...observed, firstSeenAt: now, lastSeenAt: now } };
}

/**
 * The status the history records for a stored vehicle. The `vehicles` column is `""` for a
 * vehicle SIGAE never gave a status, which the history keeps as `null`.
 */
export function storedOperationalStatus(column: string): string | null {
  return column === "" ? null : column;
}
