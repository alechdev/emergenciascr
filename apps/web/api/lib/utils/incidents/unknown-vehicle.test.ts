import { getDispatchedVehicleLabel } from "@api/lib/utils/incidents/formatters";
import { buildIncidentResponseTimes } from "@api/lib/utils/incidents/response-times";
import { buildDispatchedStationsSummary } from "@api/lib/utils/incidents/stations";
import { buildTimelineEvents } from "@api/lib/utils/incidents/timeline";
import { describe, expect, it } from "vitest";

// sync-v2 stores a unit whose vehicle SIGAE doesn't know with vehicleId NULL and its number.
const station = { id: 7, name: "ESTACION DE PRUEBA", stationKey: "9-9" };
const reportedAt = new Date("2026-10-11T02:25:19.000Z");
const dispatchedAt = new Date("2026-10-11T02:27:00.000Z");

const unknownVehicle = {
  id: 1,
  stationId: station.id,
  dispatchedTime: dispatchedAt,
  arrivalTime: null,
  departureTime: null,
  baseReturnTime: null,
  vehicle: null,
  vehicleInternalNumber: "M-99",
  station
};

describe("getDispatchedVehicleLabel", () => {
  it("prefers the vehicle's number", () => {
    expect(
      getDispatchedVehicleLabel({
        vehicle: { internalNumber: "M-12" },
        vehicleInternalNumber: "M-11"
      })
    ).toBe("M-12");
  });

  it("uses the stored number when the vehicle is unknown", () => {
    expect(getDispatchedVehicleLabel({ vehicle: null, vehicleInternalNumber: "M-99" })).toBe(
      "M-99"
    );
  });

  it("says N/A without either", () => {
    expect(getDispatchedVehicleLabel({ vehicle: null, vehicleInternalNumber: null })).toBe("N/A");
    expect(getDispatchedVehicleLabel({ vehicle: null, vehicleInternalNumber: "" })).toBe("N/A");
  });
});

describe("an unknown vehicle", () => {
  it("shows its number in the timeline", () => {
    const events = buildTimelineEvents(
      { id: 1, incidentTimestamp: reportedAt, isOpen: true, closedAt: null, modifiedAt: null },
      [unknownVehicle]
    );
    expect(events.map((event) => event.title)).toContain("Despachado: M-99");
  });

  it("shows its number in the response times", () => {
    const [times] = buildIncidentResponseTimes({
      isOpen: true,
      syncState: null,
      dispatchedVehicles: [unknownVehicle]
    });
    expect(times?.vehicle).toBe("M-99");
  });

  it("shows its number in the station summary", () => {
    const [summary] = buildDispatchedStationsSummary({
      responsibleStation: station.id,
      dispatchedStations: [{ serviceTypeId: 1, station }],
      dispatchedVehicles: [unknownVehicle]
    });
    expect(summary?.vehicles.map((vehicle) => vehicle.internalNumber)).toEqual(["M-99"]);
  });
});
