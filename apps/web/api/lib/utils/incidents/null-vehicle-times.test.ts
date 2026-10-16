import { toIsoStringOrNull } from "@api/lib/utils/incidents/formatters";
import { buildIncidentResponseTimes } from "@api/lib/utils/incidents/response-times";
import { buildDispatchedStationsSummary } from "@api/lib/utils/incidents/stations";
import { buildTimelineEvents } from "@api/lib/utils/incidents/timeline";
import { describe, expect, it } from "vitest";

// sync-v2 stores missing vehicle times as NULL instead of SIGAE's 0001-01-01 placeholder.
const station = { id: 7, name: "Estación Central", stationKey: "1-1" };
const reportedAt = new Date("2026-10-11T02:25:19.000Z");
const dispatchedAt = new Date("2026-10-11T02:27:00.000Z");
const arrivedAt = new Date("2026-10-11T02:35:30.000Z");

const neverDispatched = {
  id: 1,
  stationId: station.id,
  dispatchedTime: null,
  arrivalTime: null,
  departureTime: null,
  baseReturnTime: null,
  vehicle: { internalNumber: "M-48" },
  station
};
const onScene = {
  ...neverDispatched,
  id: 2,
  dispatchedTime: dispatchedAt,
  arrivalTime: arrivedAt,
  vehicle: { internalNumber: "M-12" }
};

describe("NULL vehicle times", () => {
  it("serialize as null", () => {
    expect(toIsoStringOrNull(null)).toBeNull();
    expect(toIsoStringOrNull(dispatchedAt)).toBe("2026-10-11T02:27:00.000Z");
  });

  it("give zero durations in response times", () => {
    const [first, second] = buildIncidentResponseTimes({
      isOpen: false,
      dispatchedVehicles: [neverDispatched, onScene]
    });

    expect(first).toMatchObject({
      dispatchedTime: null,
      arrivalTime: null,
      departureTime: null,
      baseReturnTime: null,
      responseTimeSeconds: 0,
      onSceneTimeSeconds: 0,
      returnTimeSeconds: 0,
      totalTimeSeconds: 0,
      isEnRoute: false
    });
    expect(second).toMatchObject({
      dispatchedTime: "2026-10-11T02:27:00.000Z",
      arrivalTime: "2026-10-11T02:35:30.000Z",
      responseTimeSeconds: 510,
      isEnRoute: false
    });
  });

  it("add no timeline events", () => {
    const events = buildTimelineEvents(
      { id: 1923918, incidentTimestamp: reportedAt, isOpen: true, modifiedAt: null },
      [neverDispatched, onScene]
    );

    expect(events.map((event) => event.title)).toEqual([
      "Reporte inicial",
      "Despachado: M-12",
      "Llegada a escena: M-12"
    ]);
  });

  it("keep the unit in the station summary", () => {
    const [summary] = buildDispatchedStationsSummary({
      responsibleStation: station.id,
      dispatchedStations: [{ serviceTypeId: 1, station }],
      dispatchedVehicles: [neverDispatched]
    });

    expect(summary?.vehicles).toEqual([
      { internalNumber: "M-48", dispatchTime: null, arrivalTime: null, departureTime: null }
    ]);
  });
});
