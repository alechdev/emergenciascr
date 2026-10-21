import {
  buildIncidentResponseTimes,
  isIncidentTracked
} from "@api/lib/utils/incidents/response-times";
import { describe, expect, it } from "vitest";

import type { IncidentSyncPhase } from "@bomberoscr/db/schema";

const MINUTE = 60 * 1000;
const dispatchedAt = new Date("2026-10-11T02:27:00.000Z");
const arrivedAt = new Date("2026-10-11T02:35:00.000Z");
const departedAt = new Date("2026-10-11T03:35:00.000Z");
const returnedAt = new Date("2026-10-11T03:55:00.000Z");
const after = (minutes: number) => new Date(departedAt.getTime() + minutes * MINUTE);

const leftScene = {
  id: 1,
  dispatchedTime: dispatchedAt,
  arrivalTime: arrivedAt,
  departureTime: departedAt as Date | null,
  baseReturnTime: null as Date | null,
  vehicle: { internalNumber: "M-12" },
  vehicleInternalNumber: null,
  station: { name: "ESTACION DE PRUEBA" }
};

function responseTime(
  phase: IncidentSyncPhase | null,
  now: Date,
  vehicle: Partial<typeof leftScene> = {}
) {
  const [times] = buildIncidentResponseTimes(
    {
      isOpen: false,
      syncState: phase ? { phase } : null,
      dispatchedVehicles: [{ ...leftScene, ...vehicle }]
    },
    { now }
  );
  if (!times) throw new Error("no response times");
  return times;
}

describe("isIncidentTracked", () => {
  it("is true while sync-v2 polls the incident", () => {
    expect(isIncidentTracked({ phase: "active" })).toBe(true);
    expect(isIncidentTracked({ phase: "settling" })).toBe(true);
  });

  it("is false once it stops, and without a sync state", () => {
    for (const phase of ["done", "deleted", "failed"] as const) {
      expect(isIncidentTracked({ phase })).toBe(false);
    }
    expect(isIncidentTracked(null)).toBe(false);
    expect(isIncidentTracked(undefined)).toBe(false);
  });
});

describe("En camino", () => {
  it("shows while the incident is tracked and the unit left less than 2 hours ago", () => {
    expect(responseTime("settling", after(30)).isEnRoute).toBe(true);
    expect(responseTime("active", after(119)).isEnRoute).toBe(true);
  });

  it("ends 2 hours after the departure", () => {
    const times = responseTime("settling", after(120));
    expect(times.isEnRoute).toBe(false);
    expect(times.returnTimeSeconds).toBe(0);
    expect(responseTime("active", after(60 * 24)).isEnRoute).toBe(false);
  });

  it("doesn't show once the incident isn't tracked, even right after the departure", () => {
    for (const phase of ["done", "deleted", "failed", null] as const) {
      const times = responseTime(phase, after(5));
      expect(times.isEnRoute).toBe(false);
      expect(times.returnTimeSeconds).toBe(0);
    }
  });

  it("doesn't show without a departure", () => {
    for (const departureTime of [null, new Date("0001-01-01T00:00:00.000Z")]) {
      expect(responseTime("active", after(5), { departureTime }).isEnRoute).toBe(false);
    }
  });

  it("doesn't show once the unit is back at base", () => {
    const times = responseTime("settling", after(30), { baseReturnTime: returnedAt });
    expect(times.isEnRoute).toBe(false);
    expect(times.returnTimeSeconds).toBe(20 * 60);
  });

  it("measures the time on scene of an open incident up to now", () => {
    const now = new Date(arrivedAt.getTime() + 10 * MINUTE);
    const [times] = buildIncidentResponseTimes(
      {
        isOpen: true,
        syncState: { phase: "active" },
        dispatchedVehicles: [{ ...leftScene, departureTime: null }]
      },
      { now }
    );
    expect(times?.onSceneTimeSeconds).toBe(10 * 60);
  });
});
