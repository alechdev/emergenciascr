import { describe, expect, it } from "vitest";

import { storedOperationalStatus, vehicleAssignmentWrite } from "../src/reconcile";

const now = new Date("2026-10-16T12:00:00.000Z");
const latest = { id: 7, stationId: 2, operationalStatus: "OPERATIVO" };

describe("vehicleAssignmentWrite", () => {
  it("starts the history with the first observation", () => {
    expect(vehicleAssignmentWrite(null, { stationId: 2, operationalStatus: null }, now)).toEqual({
      kind: "insert",
      row: { stationId: 2, operationalStatus: null, firstSeenAt: now, lastSeenAt: now }
    });
  });

  it("only moves lastSeenAt while station and status stay the same", () => {
    expect(
      vehicleAssignmentWrite(latest, { stationId: 2, operationalStatus: "OPERATIVO" }, now)
    ).toEqual({ kind: "bump", id: 7, lastSeenAt: now });
  });

  it("starts a new row when the station or the status changes", () => {
    for (const observed of [
      { stationId: 5, operationalStatus: "OPERATIVO" },
      { stationId: 2, operationalStatus: "EN MANTENIMIENTO" },
      { stationId: 2, operationalStatus: null }
    ]) {
      expect(vehicleAssignmentWrite(latest, observed, now)).toEqual({
        kind: "insert",
        row: { ...observed, firstSeenAt: now, lastSeenAt: now }
      });
    }
  });
});

describe("storedOperationalStatus", () => {
  it("reads the placeholder of a vehicle without a status as null", () => {
    expect(storedOperationalStatus("")).toBeNull();
    expect(storedOperationalStatus("OPERATIVO")).toBe("OPERATIVO");
  });
});
