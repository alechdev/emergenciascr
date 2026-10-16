import { describe, expect, it } from "vitest";

import { processPoll } from "../src/poll/process";
import { anomalyKey } from "../src/reconcile/anomalies";
import {
  CAST_ERROR,
  INCIDENT_ID,
  KNOWN_INCIDENT_TYPES,
  NOT_FOUND,
  classify,
  cr,
  detailsBody,
  incidentState,
  listBody,
  reportBody,
  syncState,
  type PollInput
} from "./builders";

import type { IncidentState, SyncState } from "../src/types";

const now = cr("2026-10-10T20:30:00");

function run(
  input: PollInput,
  options: { current?: IncidentState | null; state?: SyncState; recorded?: Set<string> } = {}
) {
  return processPoll({
    incidentId: INCIDENT_ID,
    classification: classify(input),
    current: options.current ?? null,
    syncState: options.state ?? syncState(),
    knownIncidentTypes: KNOWN_INCIDENT_TYPES,
    recordedAnomalies: options.recorded ?? new Set(),
    now
  });
}

describe("processPoll", () => {
  it("a failed poll writes nothing and counts a failure", () => {
    const result = run({ units: { error: { kind: "network", message: "ECONNRESET" } } });
    expect(result).toMatchObject({
      kind: "failed",
      next: null,
      deleteIncident: false,
      changes: [],
      anomalies: []
    });
    expect(result.syncState).toMatchObject({
      consecutiveFailures: 1,
      lastError: "ObtenerUnidadesDespachadasIncidente request failed (network): ECONNRESET"
    });
  });

  it("a report with an unknown pre-1971 incident time records it once", () => {
    const input = { report: { body: reportBody({ Fecha: "1900-01-01T00:00:00" }) } };
    const first = run(input);
    expect(first).toMatchObject({ kind: "failed", next: null });
    expect(first.anomalies).toEqual([
      {
        code: "PLACEHOLDER_SHAPE_UNKNOWN",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: { field: "incidentTimestamp", sigaeField: "Fecha", raw: "1900-01-01T00:00:00" }
      }
    ]);
    const second = run(input, {
      state: first.syncState,
      recorded: new Set(first.anomalies.map(anomalyKey))
    });
    expect(second.anomalies).toEqual([]);
  });

  it("a failed or not-found poll restarts the count of empty unit lists", () => {
    const state = { ...syncState(), emptyUnitsCount: 1 };
    const failed = run({ units: { error: { kind: "network", message: "ECONNRESET" } } }, { state });
    expect(failed.syncState.emptyUnitsCount).toBe(0);
    const notFound = run(
      { details: { body: NOT_FOUND }, report: { body: NOT_FOUND } },
      { current: incidentState(), state }
    );
    expect(notFound.syncState.emptyUnitsCount).toBe(0);
  });

  it("not found once writes nothing", () => {
    const result = run(
      { details: { body: NOT_FOUND }, report: { body: NOT_FOUND } },
      { current: incidentState() }
    );
    expect(result).toMatchObject({ kind: "not_found", next: null, deleteIncident: false });
    expect(result.changes).toEqual([]);
  });

  it("unknown incident types: NULL, anomaly, and a types sync request", () => {
    const result = run({
      details: { body: detailsBody({ codigo_tipo_incidente_despacho: "7.7." }) }
    });
    expect(result.next?.incident.dispatchIncidentCode).toBeNull();
    expect(result.unknownIncidentTypes).toEqual(["7.7"]);
    expect(result.anomalies.map((anomaly) => anomaly.code)).toEqual(["UNKNOWN_INCIDENT_TYPE"]);
  });

  it("a partial report for a new incident stores what it has", () => {
    const body = reportBody({ ...CAST_ERROR });
    delete body.Id_Distrito;
    const result = run({ report: { body } });
    expect(result.kind).toBe("partial");
    expect(result.next?.incident.districtId).toBeNull();
    expect(result.next?.incident.provinceId).toBe(1);
    expect(result.anomalies.map((anomaly) => anomaly.code)).toEqual(["UPSTREAM_PARTIAL_REPORT"]);
  });

  it("doesn't repeat condition anomalies already recorded", () => {
    const first = run({ report: { body: reportBody(CAST_ERROR) } });
    const recorded = new Set(first.anomalies.map(anomalyKey));
    const second = run(
      { report: { body: reportBody(CAST_ERROR) } },
      { current: first.next, state: first.syncState, recorded }
    );
    expect(second.anomalies).toEqual([]);
  });

  it("one empty unit list keeps the units and counts it", () => {
    const current = incidentState();
    const result = run({ units: { body: listBody([]) } }, { current });
    expect(result.next?.vehicles).toEqual(current.vehicles);
    expect(result.changes).toEqual([]);
    expect(result.syncState.emptyUnitsCount).toBe(1);
  });

  it("an incident closed when first seen gets an estimated closing time", () => {
    const result = run({
      report: {
        body: reportBody({ Estado_Abierto: "false", Hora_Controlado: "2026-10-10T20:29:00" })
      }
    });
    expect(result.next?.incident).toMatchObject({
      isOpen: false,
      closedAt: cr("2026-10-10T20:29:00"),
      closedAtSource: "estimated"
    });
    expect(result.syncState).toMatchObject({ phase: "settling", upstreamClosedAt: now });
  });
});
