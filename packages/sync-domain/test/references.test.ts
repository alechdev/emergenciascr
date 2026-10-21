import { describe, expect, it } from "vitest";

import { processPoll } from "../src/poll/process";
import { pollReferences } from "../src/poll/references";
import { anomalyKey } from "../src/reconcile/anomalies";
import {
  applyKnownReferences,
  type KnownReferences,
  mergeReferences
} from "../src/reconcile/references";
import {
  CAST_ERROR,
  INCIDENT_ID,
  KNOWN_INCIDENT_TYPES,
  classify,
  cr,
  incidentState,
  listBody,
  reportBody,
  station,
  syncState,
  unit,
  type PollInput
} from "./builders";

const now = cr("2026-10-10T20:30:00");

const ALL_KNOWN: KnownReferences = {
  stations: new Set([2, 5]),
  vehicles: new Set([140]),
  provinces: new Set([1]),
  cantons: new Set([101]),
  districts: new Set([10101])
};

function known(overrides: Partial<KnownReferences> = {}): KnownReferences {
  return { ...ALL_KNOWN, ...overrides };
}

function run(input: PollInput, references: KnownReferences, recorded = new Set<string>()) {
  return processPoll({
    incidentId: INCIDENT_ID,
    classification: classify(input),
    current: null,
    syncState: syncState(),
    knownIncidentTypes: KNOWN_INCIDENT_TYPES,
    knownReferences: references,
    recordedAnomalies: recorded,
    now
  });
}

describe("pollReferences", () => {
  it("lists every station, vehicle, incident type and geography ID once", () => {
    const classification = classify({
      stations: {
        body: listBody([station(), station({ IdBoletaEstacionAtiende: 2, IdEstacion: 5 })])
      },
      units: {
        body: listBody([
          unit(),
          unit({ IdBoletaUnidadDespachada: 2, CodigoEstacion: 5, CodigoUnidad: 141 }),
          unit({ IdBoletaUnidadDespachada: 3, Unidad: "ATENCION A PIE", CodigoUnidad: 0 })
        ])
      }
    });

    expect(pollReferences(INCIDENT_ID, classification)).toEqual({
      stations: [2, 5],
      vehicles: [140, 141],
      incidentTypes: ["2.1.3", "2.1.3.1", "2.1"],
      provinces: [1],
      cantons: [101],
      districts: [10101]
    });
  });

  it("adds what the stored state refers to, since the poll can keep it", () => {
    // An empty unit list keeps the stored units; a partial report keeps the stored geography.
    const { Id_Provincia: _p, Id_Canton: _c, Id_Distrito: _d, ...partial } = reportBody();
    const classification = classify({
      report: { body: { ...partial, ...CAST_ERROR } },
      stations: { body: listBody([station({ IdEstacion: 5 })]) },
      units: { body: listBody([]) }
    });
    const current = incidentState({
      units: { body: listBody([unit({ CodigoUnidad: 152 })]) }
    });

    expect(pollReferences(INCIDENT_ID, classification)).toEqual({
      stations: [5],
      vehicles: [],
      incidentTypes: ["2.1.3", "2.1.3.1", "2.1"],
      provinces: [],
      cantons: [],
      districts: []
    });
    expect(pollReferences(INCIDENT_ID, classification, current)).toEqual({
      stations: [5, 2],
      vehicles: [152],
      incidentTypes: ["2.1.3", "2.1.3.1", "2.1"],
      provinces: [1],
      cantons: [101],
      districts: [10101]
    });
  });

  it("is empty for polls that store nothing", () => {
    const classification = classify({ details: { error: { kind: "timeout", message: "slow" } } });
    expect(pollReferences(INCIDENT_ID, classification, incidentState())).toEqual({
      stations: [],
      vehicles: [],
      incidentTypes: [],
      provinces: [],
      cantons: [],
      districts: []
    });
    expect(pollReferences(INCIDENT_ID, classification)).toEqual({
      stations: [],
      vehicles: [],
      incidentTypes: [],
      provinces: [],
      cantons: [],
      districts: []
    });
  });
});

describe("mergeReferences", () => {
  it("lists each ID once, in the order first seen", () => {
    const empty = {
      stations: [],
      vehicles: [],
      incidentTypes: [],
      provinces: [],
      cantons: [],
      districts: []
    };
    expect(
      mergeReferences(
        { ...empty, stations: [2, 5], incidentTypes: ["2.1"], districts: [10101] },
        { ...empty, stations: [5, 7], vehicles: [140], incidentTypes: ["2.1", "2.1.3"] },
        empty
      )
    ).toEqual({
      stations: [2, 5, 7],
      vehicles: [140],
      incidentTypes: ["2.1", "2.1.3"],
      provinces: [],
      cantons: [],
      districts: [10101]
    });
  });
});

describe("applyKnownReferences", () => {
  it("keeps a state whose references all exist", () => {
    const state = incidentState();
    expect(applyKnownReferences(state, known())).toEqual({
      state,
      anomalies: [],
      missingStations: []
    });
  });

  it("stores an unknown vehicle as NULL and keeps its label", () => {
    const state = incidentState({
      units: { body: listBody([unit({ NumeroInterno: "M-12" })]) }
    });
    const applied = applyKnownReferences(state, known({ vehicles: new Set() }));

    expect(applied.state.vehicles[0]).toMatchObject({
      vehicleId: null,
      vehicleInternalNumber: "M-12"
    });
    expect(applied.anomalies).toEqual([
      {
        code: "MISSING_REFERENCE",
        entity: "dispatched_vehicle",
        entityId: 5200101,
        details: { field: "vehicleId", vehicleId: 140, vehicleInternalNumber: "M-12" }
      }
    ]);
    expect(applied.missingStations).toEqual([]);
  });

  it("stores unknown geography as NULL", () => {
    const applied = applyKnownReferences(incidentState(), known({ districts: new Set() }));

    expect(applied.state.incident).toMatchObject({
      provinceId: 1,
      cantonId: 101,
      districtId: null
    });
    expect(applied.anomalies).toEqual([
      {
        code: "MISSING_REFERENCE",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: { field: "districtId", districtId: 10101 }
      }
    ]);
  });

  it("reports unknown stations wherever they appear", () => {
    const applied = applyKnownReferences(incidentState(), known({ stations: new Set() }));

    expect(applied.missingStations).toEqual([2]);
    expect(applied.anomalies.map((anomaly) => [anomaly.entity, anomaly.details.field])).toEqual([
      ["incident", "responsibleStation"],
      ["dispatched_station", "stationId"],
      ["dispatched_vehicle", "stationId"]
    ]);
  });
});

describe("processPoll with known references", () => {
  it("fails a poll that refers to an unknown station, recording it once", () => {
    const first = run({}, known({ stations: new Set() }));

    expect(first).toMatchObject({ kind: "failed", next: null, changes: [] });
    expect(first.syncState).toMatchObject({
      consecutiveFailures: 1,
      lastError: "MISSING_REFERENCE: unknown stations 2"
    });
    expect(first.anomalies.map((anomaly) => anomaly.code)).toEqual([
      "MISSING_REFERENCE",
      "MISSING_REFERENCE",
      "MISSING_REFERENCE"
    ]);

    const again = run({}, known({ stations: new Set() }), new Set(first.anomalies.map(anomalyKey)));
    expect(again.anomalies).toEqual([]);
  });

  it("stores the poll with unknown vehicles as NULL", () => {
    const result = run({}, known({ vehicles: new Set() }));

    expect(result.kind).toBe("ok");
    expect(result.next?.vehicles[0]?.vehicleId).toBeNull();
    expect(result.changes.find((change) => change.entity === "dispatched_vehicle")).toMatchObject({
      kind: "added",
      newValue: { vehicleId: null }
    });
    expect(result.anomalies.map((anomaly) => anomaly.code)).toContain("MISSING_REFERENCE");
  });

  it("treats every reference as known without the sets", () => {
    const result = processPoll({
      incidentId: INCIDENT_ID,
      classification: classify(),
      current: null,
      syncState: syncState(),
      knownIncidentTypes: KNOWN_INCIDENT_TYPES,
      recordedAnomalies: new Set(),
      now
    });
    expect(result.kind).toBe("ok");
    expect(result.next?.vehicles[0]?.vehicleId).toBe(140);
  });
});
