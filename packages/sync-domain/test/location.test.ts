import { describe, expect, it } from "vitest";

import { processPoll } from "../src/poll/process";
import { anomalyKey, keepKnownLocation } from "../src/reconcile/index";
import {
  CAST_ERROR,
  INCIDENT_ID,
  KNOWN_INCIDENT_TYPES,
  classify,
  cr,
  detailsBody,
  incidentState,
  reportBody,
  syncState,
  type PollInput
} from "./builders";

import type { Anomaly, Change, IncidentState } from "../src/types";

const now = cr("2026-10-10T20:40:00");
const codes = (anomalies: Anomaly[]) => anomalies.map((anomaly) => anomaly.code);
const fields = (changes: Change[]) => changes.map((change) => `${change.field}:${change.kind}`);

const noCoordinates = { details: { body: detailsBody({ latitud: 0, longitud: 0 }) } };
const noGeography = {
  report: { body: reportBody({ Id_Provincia: 0, Id_Canton: 0, Id_Distrito: 0 }) }
};

function run(input: PollInput, current: IncidentState | null, recorded = new Set<string>()) {
  return processPoll({
    incidentId: INCIDENT_ID,
    classification: classify(input),
    current,
    syncState: syncState({ lastPolledAt: cr("2026-10-10T20:37:00") }),
    knownIncidentTypes: KNOWN_INCIDENT_TYPES,
    recordedAnomalies: recorded,
    now
  });
}

describe("known locations SIGAE clears (spec 6.3)", () => {
  it("cleared coordinates keep the stored pair, without changes or regressions", () => {
    const result = run(noCoordinates, incidentState());
    expect(result.next?.incident).toMatchObject({ latitude: "9.9", longitude: "-84.1" });
    expect(result.changes).toEqual([]);
    expect(result.anomalies).toEqual([
      {
        code: "LOCATION_CLEARED_UPSTREAM",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: {
          fields: "coordinates",
          kept: { latitude: "9.9", longitude: "-84.1" },
          received: { latitude: "0", longitude: "0" }
        }
      }
    ]);
  });

  it("one coordinate cleared keeps the stored pair, never a half pair", () => {
    for (const details of [{ latitud: 0 }, { longitud: null }, { latitud: 9.95, longitud: 0 }]) {
      const result = run({ details: { body: detailsBody(details) } }, incidentState());
      expect(result.next?.incident).toMatchObject({ latitude: "9.9", longitude: "-84.1" });
      expect(result.changes).toEqual([]);
      expect(codes(result.anomalies)).toEqual(["LOCATION_CLEARED_UPSTREAM"]);
    }
    const half = run(
      { details: { body: detailsBody({ latitud: 9.95, longitud: 0 }) } },
      incidentState()
    );
    expect(half.anomalies[0]?.details.received).toEqual({ latitude: "9.95", longitude: "0" });
  });

  it("new known coordinates replace the stored ones", () => {
    const result = run(
      { details: { body: detailsBody({ latitud: 9.95, longitud: -84.2 }) } },
      incidentState()
    );
    expect(result.next?.incident).toMatchObject({ latitude: "9.95", longitude: "-84.2" });
    expect(fields(result.changes)).toEqual(["latitude:changed", "longitude:changed"]);
    expect(codes(result.anomalies)).toEqual([
      "VALUE_CHANGED_AFTER_SET",
      "VALUE_CHANGED_AFTER_SET",
      "COORDINATES_MOVED"
    ]);
  });

  it("a stored half pair follows SIGAE", () => {
    const current = incidentState({ details: { body: detailsBody({ longitud: 0 }) } });
    const result = run(noCoordinates, current);
    expect(result.next?.incident).toMatchObject({ latitude: "0", longitude: "0" });
    expect(fields(result.changes)).toEqual(["latitude:cleared"]);
    expect(codes(result.anomalies)).toEqual(["VALUE_REGRESSED"]);
  });

  it("cleared geography keeps the stored province, canton and district", () => {
    const result = run(noGeography, incidentState());
    expect(result.next?.incident).toMatchObject({
      provinceId: 1,
      cantonId: 101,
      districtId: 10101
    });
    expect(result.changes).toEqual([]);
    expect(result.anomalies).toEqual([
      {
        code: "LOCATION_CLEARED_UPSTREAM",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: {
          fields: "geography",
          kept: { provinceId: 1, cantonId: 101, districtId: 10101 },
          received: { provinceId: null, cantonId: null, districtId: null }
        }
      }
    ]);
  });

  it("geography with some fields sent stores what SIGAE sent, never mixed with the stored", () => {
    const result = run(
      { report: { body: reportBody({ Id_Provincia: 2, Id_Canton: 0, Id_Distrito: 0 }) } },
      incidentState()
    );
    expect(result.next?.incident).toMatchObject({
      provinceId: 2,
      cantonId: null,
      districtId: null
    });
    expect(fields(result.changes)).toEqual([
      "provinceId:changed",
      "cantonId:cleared",
      "districtId:cleared"
    ]);
    expect(codes(result.anomalies)).toEqual(["VALUE_REGRESSED", "VALUE_REGRESSED"]);
  });

  it("a partly known stored geography is kept as a unit", () => {
    const current = incidentState({
      report: { body: reportBody({ Id_Canton: 0, Id_Distrito: 0 }) }
    });
    const result = run(noGeography, current);
    expect(result.next?.incident).toMatchObject({
      provinceId: 1,
      cantonId: null,
      districtId: null
    });
    expect(result.changes).toEqual([]);
    expect(result.anomalies[0]?.details.kept).toEqual({
      provinceId: 1,
      cantonId: null,
      districtId: null
    });
  });

  it("the first poll stores an unknown location as it is", () => {
    const result = run({ ...noCoordinates, ...noGeography }, null);
    expect(result.next?.incident).toMatchObject({
      latitude: "0",
      longitude: "0",
      provinceId: null,
      cantonId: null,
      districtId: null
    });
    expect(codes(result.anomalies)).toEqual([]);
  });

  it("an unknown stored location takes whatever SIGAE sends", () => {
    const current = incidentState({ ...noCoordinates, ...noGeography });
    expect(run({ ...noCoordinates, ...noGeography }, current).anomalies).toEqual([]);
    const filled = run({}, current);
    expect(fields(filled.changes)).toEqual([
      "provinceId:set",
      "cantonId:set",
      "districtId:set",
      "latitude:set",
      "longitude:set"
    ]);
    expect(filled.anomalies).toEqual([]);
  });

  it("a partial report keeps the geography by its own rule, and the coordinates by this one", () => {
    const body = reportBody({ ...CAST_ERROR });
    delete body.Id_Provincia;
    delete body.Id_Canton;
    delete body.Id_Distrito;
    const result = run({ ...noCoordinates, report: { body } }, incidentState());
    expect(result.kind).toBe("partial");
    expect(result.next?.incident).toMatchObject({
      provinceId: 1,
      cantonId: 101,
      districtId: 10101,
      latitude: "9.9",
      longitude: "-84.1"
    });
    expect(result.changes).toEqual([]);
    expect(result.anomalies).toEqual([
      expect.objectContaining({ code: "UPSTREAM_PARTIAL_REPORT" }),
      expect.objectContaining({
        code: "LOCATION_CLEARED_UPSTREAM",
        details: expect.objectContaining({ fields: "coordinates" })
      })
    ]);
  });

  it("records each field group once per incident, however long SIGAE keeps it cleared", () => {
    const current = incidentState();
    const first = run({ ...noCoordinates, ...noGeography }, current);
    expect(first.anomalies.map(anomalyKey)).toEqual([
      `LOCATION_CLEARED_UPSTREAM:incident:${INCIDENT_ID}:coordinates`,
      `LOCATION_CLEARED_UPSTREAM:incident:${INCIDENT_ID}:geography`
    ]);
    const recorded = new Set(first.anomalies.map(anomalyKey));
    const again = run({ ...noCoordinates, ...noGeography }, first.next, recorded);
    expect(again.next?.incident).toEqual(current.incident);
    expect(again.changes).toEqual([]);
    expect(again.anomalies).toEqual([]);
  });
});

describe("keepKnownLocation", () => {
  it("keeps nothing without a stored incident", () => {
    const next = incidentState(noCoordinates).incident;
    expect(keepKnownLocation(null, next)).toEqual({ incident: next, kept: [] });
  });

  it("doesn't touch the other fields", () => {
    const stored = incidentState().incident;
    const next = incidentState({
      ...noCoordinates,
      report: { body: reportBody({ Estado_Abierto: "false", Direccion: "OTRO" }) }
    }).incident;
    const { incident } = keepKnownLocation(stored, next);
    expect(incident).toEqual({ ...next, latitude: "9.9", longitude: "-84.1" });
  });
});
