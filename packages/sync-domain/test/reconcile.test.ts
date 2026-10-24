import { describe, expect, it } from "vitest";

import {
  anomalyKey,
  applyEmptyUnitsRule,
  dedupeAnomalies,
  detectAnomalies,
  diffIncidentState
} from "../src/reconcile/index";
import { PLACEHOLDER, cr, detailsBody, incidentState, listBody, unit } from "./builders";

import type { Anomaly } from "../src/types";

const now = cr("2026-10-10T22:00:00");
const units = (...items: Record<string, unknown>[]) => ({ body: listBody(items) });
const codes = (anomalies: Anomaly[]) => anomalies.map((anomaly) => anomaly.code);

describe("diffIncidentState", () => {
  it("a new incident: one added change per row", () => {
    const next = incidentState();
    expect(diffIncidentState(null, next)).toEqual([
      expect.objectContaining({ entity: "incident", field: "*", kind: "added", oldValue: null }),
      expect.objectContaining({ entity: "dispatched_vehicle", entityId: 5200101, kind: "added" }),
      expect.objectContaining({ entity: "dispatched_station", entityId: 3400101, kind: "added" })
    ]);
  });

  it("no changes when nothing changed, even with new Date objects", () => {
    expect(diffIncidentState(incidentState(), incidentState())).toEqual([]);
  });

  it("set, changed and cleared fields", () => {
    const before = incidentState({
      details: { body: detailsBody({ latitud: 0, longitud: 0 }) },
      units: units(unit({ HoraLLegada: "2026-10-10T20:33:45" }))
    });
    const after = incidentState({
      units: units(unit({ HoraLLegada: PLACEHOLDER, HoraDespacho: "2026-10-10T20:27:00" }))
    });
    expect(diffIncidentState(before, after)).toEqual([
      {
        entity: "incident",
        entityId: 1900001,
        field: "latitude",
        kind: "set",
        oldValue: "0",
        newValue: "9.9"
      },
      {
        entity: "incident",
        entityId: 1900001,
        field: "longitude",
        kind: "set",
        oldValue: "0",
        newValue: "-84.1"
      },
      {
        entity: "dispatched_vehicle",
        entityId: 5200101,
        field: "dispatchedTime",
        kind: "changed",
        oldValue: "2026-10-11T02:26:02.000Z",
        newValue: "2026-10-11T02:27:00.000Z"
      },
      {
        entity: "dispatched_vehicle",
        entityId: 5200101,
        field: "arrivalTime",
        kind: "cleared",
        oldValue: "2026-10-11T02:33:45.000Z",
        newValue: null
      }
    ]);
  });

  it("a placeholder date stored by the legacy sync is unknown", () => {
    const legacy = new Date("0001-01-01T05:36:13Z");
    const stored = incidentState({ units: units(unit({ HoraLLegada: "2026-10-10T20:33:45" })) });
    const before = {
      ...stored,
      vehicles: stored.vehicles.map((row) => ({
        ...row,
        arrivalTime: legacy,
        baseReturnTime: legacy
      }))
    };
    const after = incidentState({ units: units(unit({ HoraLLegada: "2026-10-10T20:33:45" })) });

    expect(diffIncidentState(before, after)).toEqual([
      {
        entity: "dispatched_vehicle",
        entityId: 5200101,
        field: "arrivalTime",
        kind: "set",
        oldValue: "0001-01-01T05:36:13.000Z",
        newValue: "2026-10-11T02:33:45.000Z"
      }
    ]);
    expect(after.vehicles[0]?.baseReturnTime).toBeNull();
    expect(codes(detectAnomalies(before, after, { now }))).toEqual([]);
  });

  it("unit added and unit removed", () => {
    const before = incidentState({ units: units(unit()) });
    const after = incidentState({ units: units(unit({ IdBoletaUnidadDespachada: 5200102 })) });
    expect(diffIncidentState(before, after)).toEqual([
      expect.objectContaining({ entityId: 5200102, kind: "added", field: "*" }),
      expect.objectContaining({ entityId: 5200101, kind: "removed", field: "*", newValue: null })
    ]);
    expect(codes(detectAnomalies(before, after, { now }))).toEqual(["UNIT_REMOVED"]);
  });
});

describe("applyEmptyUnitsRule", () => {
  const stored = incidentState().vehicles;

  it("keeps the units after one empty response", () => {
    expect(applyEmptyUnitsRule(stored, [], 0)).toEqual({
      vehicles: stored,
      emptyUnitsCount: 1,
      deferred: true
    });
  });

  it("deletes them after two in a row", () => {
    expect(applyEmptyUnitsRule(stored, [], 1)).toEqual({
      vehicles: [],
      emptyUnitsCount: 0,
      deferred: false
    });
  });

  it("resets the count when units come back, and ignores empty incidents", () => {
    expect(applyEmptyUnitsRule(stored, stored, 1).emptyUnitsCount).toBe(0);
    expect(applyEmptyUnitsRule([], [], 1)).toEqual({
      vehicles: [],
      emptyUnitsCount: 0,
      deferred: false
    });
  });
});

describe("detectAnomalies (spec 7)", () => {
  it("dispatched but never arrived, only when the incident is done", () => {
    const state = incidentState();
    expect(codes(detectAnomalies(state, state, { now }))).toEqual([]);
    expect(detectAnomalies(state, state, { now, reachedDone: true })).toEqual([
      {
        code: "UNIT_NEVER_ARRIVED",
        entity: "dispatched_vehicle",
        entityId: 5200101,
        details: { dispatchedTime: "2026-10-11T02:26:02.000Z" }
      }
    ]);
  });

  it("time-order violation", () => {
    const state = incidentState({
      units: units(unit({ HoraLLegada: "2026-10-10T20:33:45", HoraRetiro: "2026-10-10T20:30:00" }))
    });
    expect(detectAnomalies(null, state, { now })).toEqual([
      expect.objectContaining({
        code: "TIME_ORDER_VIOLATION",
        entityId: 5200101,
        details: expect.objectContaining({
          earlierField: "arrivalTime",
          laterField: "departureTime"
        })
      })
    ]);
  });

  it("missing times don't break the order", () => {
    const state = incidentState({ units: units(unit({ HoraRetiro: "2026-10-10T21:00:00" })) });
    expect(detectAnomalies(null, state, { now })).toEqual([]);
  });

  it("dispatch more than 5 minutes before the report time", () => {
    const state = incidentState({
      units: units(
        unit({ HoraDespacho: "2026-10-10T20:15:00" }),
        unit({ IdBoletaUnidadDespachada: 5200102, HoraDespacho: "2026-10-10T20:21:00" })
      )
    });
    expect(detectAnomalies(null, state, { now })).toEqual([
      {
        code: "TIME_BEFORE_INCIDENT",
        entity: "dispatched_vehicle",
        entityId: 5200101,
        details: {
          field: "dispatchedTime",
          value: "2026-10-11T02:15:00.000Z",
          incidentTimestamp: "2026-10-11T02:25:19.000Z"
        }
      }
    ]);
  });

  it("times in the future", () => {
    const state = incidentState({ units: units(unit({ HoraLLegada: "2026-10-10T22:10:00" })) });
    expect(detectAnomalies(null, state, { now })).toEqual([
      expect.objectContaining({
        code: "TIME_IN_FUTURE",
        details: { field: "arrivalTime", value: "2026-10-11T04:10:00.000Z" }
      })
    ]);
    expect(detectAnomalies(null, state, { now: cr("2026-10-10T22:06:00") })).toEqual([]);
  });

  it("valid time replaced by a placeholder: VALUE_REGRESSED", () => {
    const before = incidentState({ units: units(unit({ HoraLLegada: "2026-10-10T20:33:45" })) });
    const after = incidentState({ units: units(unit({ HoraLLegada: PLACEHOLDER })) });
    expect(after.vehicles[0]?.arrivalTime).toBeNull();
    expect(detectAnomalies(before, after, { now })).toEqual([
      {
        code: "VALUE_REGRESSED",
        entity: "dispatched_vehicle",
        entityId: 5200101,
        details: { field: "arrivalTime", oldValue: "2026-10-11T02:33:45.000Z" }
      }
    ]);
  });

  it("coordinates: 0, filled in later, moved", () => {
    const missing = incidentState({ details: { body: detailsBody({ latitud: 0, longitud: 0 }) } });
    const filled = incidentState({
      details: { body: detailsBody({ latitud: 9.93512, longitud: -84.07716 }) }
    });
    const nudged = incidentState({
      details: { body: detailsBody({ latitud: 9.936, longitud: -84.077 }) }
    });
    const moved = incidentState({
      details: { body: detailsBody({ latitud: 10.01, longitud: -84.2 }) }
    });

    expect(codes(detectAnomalies(missing, missing, { now, reachedDone: true }))).toContain(
      "COORDINATES_MISSING"
    );
    expect(codes(detectAnomalies(missing, filled, { now }))).toEqual([]);
    expect(codes(detectAnomalies(filled, nudged, { now }))).toEqual([
      "VALUE_CHANGED_AFTER_SET",
      "VALUE_CHANGED_AFTER_SET"
    ]);
    expect(codes(detectAnomalies(filled, moved, { now }))).toEqual([
      "VALUE_CHANGED_AFTER_SET",
      "VALUE_CHANGED_AFTER_SET",
      "COORDINATES_MOVED"
    ]);
    expect(codes(detectAnomalies(filled, missing, { now }))).toEqual([
      "VALUE_REGRESSED",
      "VALUE_REGRESSED"
    ]);
  });

  it("vehicle time changed after it was set", () => {
    const before = incidentState({ units: units(unit({ HoraLLegada: "2026-10-10T20:33:45" })) });
    const after = incidentState({ units: units(unit({ HoraLLegada: "2026-10-10T20:35:00" })) });
    expect(codes(detectAnomalies(before, after, { now }))).toEqual(["VALUE_CHANGED_AFTER_SET"]);
  });

  it("reopened", () => {
    const closed = incidentState();
    closed.incident.isOpen = false;
    expect(codes(detectAnomalies(closed, incidentState(), { now }))).toEqual(["REOPENED"]);
  });

  it("partial reports and implausible dates", () => {
    const state = incidentState();
    expect(
      detectAnomalies(state, state, {
        now,
        partialReport: { description: "Specified cast is not valid." },
        issues: [
          {
            entity: "dispatched_vehicle",
            entityId: 5200101,
            field: "arrivalTime",
            sigaeField: "HoraLLegada",
            raw: "1900-01-01T00:00:00"
          }
        ]
      })
    ).toEqual([
      {
        code: "UPSTREAM_PARTIAL_REPORT",
        entity: "incident",
        entityId: 1900001,
        details: { description: "Specified cast is not valid." }
      },
      {
        code: "PLACEHOLDER_SHAPE_UNKNOWN",
        entity: "dispatched_vehicle",
        entityId: 5200101,
        details: { field: "arrivalTime", sigaeField: "HoraLLegada", raw: "1900-01-01T00:00:00" }
      }
    ]);
  });
});

describe("dedupeAnomalies", () => {
  const condition: Anomaly = {
    code: "TIME_BEFORE_INCIDENT",
    entity: "dispatched_vehicle",
    entityId: 5200101,
    details: { field: "dispatchedTime", value: "x" }
  };
  const event: Anomaly = {
    code: "UNIT_REMOVED",
    entity: "dispatched_vehicle",
    entityId: 5200101,
    details: {}
  };

  it("records a condition once per incident, field and row", () => {
    const recorded = new Set([anomalyKey(condition)]);
    expect(dedupeAnomalies([condition, event], recorded)).toEqual([event]);
    expect(dedupeAnomalies([condition, condition], new Set())).toEqual([condition]);
    const otherField = { ...condition, details: { field: "arrivalTime" } };
    expect(dedupeAnomalies([otherField], recorded)).toEqual([otherField]);
  });

  it("tells time order violations apart by their pair of fields", () => {
    const violation = (earlierField: string, laterField: string): Anomaly => ({
      code: "TIME_ORDER_VIOLATION",
      entity: "dispatched_vehicle",
      entityId: 5200101,
      details: { earlierField, laterField, times: {} }
    });
    const first = violation("dispatchedTime", "arrivalTime");
    const second = violation("departureTime", "baseReturnTime");
    expect(anomalyKey(first)).not.toBe(anomalyKey(second));
    expect(dedupeAnomalies([second], new Set([anomalyKey(first)]))).toEqual([second]);
    expect(dedupeAnomalies([first], new Set([anomalyKey(first)]))).toEqual([]);
  });

  it("always keeps events", () => {
    expect(dedupeAnomalies([event, event], new Set([anomalyKey(event)]))).toEqual([event, event]);
  });
});
