import { buildTimelineEvents } from "@api/lib/utils/incidents/timeline";
import { describe, expect, it } from "vitest";

const reportedAt = new Date("2026-10-11T02:25:19.000Z");
const closedAt = new Date("2026-10-11T03:40:00.000Z");
const modifiedAt = new Date("2026-10-11T05:10:00.000Z");
type TimelineIncident = Parameters<typeof buildTimelineEvents>[0];
const incident: TimelineIncident = {
  id: 1923918,
  incidentTimestamp: reportedAt,
  isOpen: false,
  closedAt,
  modifiedAt
};

function closingEvent(overrides: Partial<TimelineIncident>) {
  return buildTimelineEvents({ ...incident, ...overrides }, []).find(
    (event) => event.title === "Incidente cerrado"
  );
}

describe("timeline closing event", () => {
  it("uses closedAt, not the last modification", () => {
    expect(closingEvent({})?.date).toEqual(closedAt);
  });

  it("falls back to modifiedAt without closedAt", () => {
    expect(closingEvent({ closedAt: null })?.date).toEqual(modifiedAt);
  });

  it("falls back to modifiedAt when closedAt is a placeholder", () => {
    expect(closingEvent({ closedAt: new Date("0001-01-01T00:00:00.000Z") })?.date).toEqual(
      modifiedAt
    );
  });

  it("has no closing event while the incident is open", () => {
    expect(closingEvent({ isOpen: true })).toBeUndefined();
    expect(closingEvent({ isOpen: true, closedAt: null })).toBeUndefined();
  });

  it("sorts the closing event by its own time", () => {
    const arrivedAt = new Date("2026-10-11T04:00:00.000Z");
    const events = buildTimelineEvents(incident, [
      {
        dispatchedTime: null,
        arrivalTime: arrivedAt,
        departureTime: null,
        station: { name: "ESTACION DE PRUEBA" },
        vehicle: { internalNumber: "M-12" },
        vehicleInternalNumber: null
      }
    ]);
    expect(events.map((event) => event.title)).toEqual([
      "Reporte inicial",
      "Incidente cerrado",
      "Llegada a escena: M-12"
    ]);
  });
});
