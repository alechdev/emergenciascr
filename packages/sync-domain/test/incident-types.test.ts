import { describe, expect, it } from "vitest";

import {
  incidentTypeAncestors,
  incidentTypeNames,
  nearestIncidentTypeAncestor,
  normalizePoll,
  resolveIncidentTypes
} from "../src/normalize/index";
import { processPoll } from "../src/poll/process";
import { anomalyKey, dedupeAnomalies } from "../src/reconcile/anomalies";
import { INCIDENT_ID, classify, cr, detailsBody, incidentState, syncState } from "./builders";

/** Shaped like SIGAE's list: top-level categories 1 to 9, no 10 or 11. */
const KNOWN: ReadonlySet<string> = new Set([
  "2",
  "2.1",
  "2.1.3",
  "2.1.3.1",
  "3",
  "3.3",
  "7",
  "7.1",
  "7.1.1"
]);

const SPECIAL_SERVICES = {
  codigo_tipo_incidente: "10",
  tipo_incidente: "SERVICIOS ESPECIALES",
  codigo_tipo_incidente_esp: "10.3",
  tipo_incidente_esp: "INTER-INSTITUCIONAL",
  codigo_tipo_incidente_despacho: "10",
  tipo_incidente_despacho: "SERVICIOS ESPECIALES",
  codigo_tipo_incidente_despacho_esp: "10.3",
  tipo_incidente_despacho_esp: "INTER-INSTITUCIONAL"
};

const DECLINED = {
  codigo_tipo_incidente: "11",
  tipo_incidente: "SERVICIOS DECLINADOS",
  codigo_tipo_incidente_esp: "11.1",
  tipo_incidente_esp: "INCIDENTE DECLINADO, RECURSOS DEVUELTOS",
  codigo_tipo_incidente_despacho: "3",
  tipo_incidente_despacho: "TIPO 3",
  codigo_tipo_incidente_despacho_esp: "3.3",
  tipo_incidente_despacho_esp: "TIPO 3.3"
};

function pollData(details: Record<string, unknown>) {
  const classification = classify({ details: { body: detailsBody(details) } });
  if (classification.kind !== "ok") throw new Error(`expected ok, got ${classification.kind}`);
  return classification.data;
}

function resolve(
  details: Record<string, unknown>,
  options: { known?: ReadonlySet<string>; inferred?: ReadonlySet<string> } = {}
) {
  const data = pollData(details);
  return resolveIncidentTypes(normalizePoll(INCIDENT_ID, data).incident, {
    known: options.known ?? KNOWN,
    inferred: options.inferred,
    names: incidentTypeNames(data.details)
  });
}

const codes = (incident: ReturnType<typeof resolve>["incident"]) => [
  incident.incidentCode,
  incident.specificIncidentCode,
  incident.dispatchIncidentCode,
  incident.specificDispatchIncidentCode
];

const details = (result: ReturnType<typeof resolve>) =>
  result.anomalies.map((anomaly) => anomaly.details);

describe("incident type codes", () => {
  it("walks up the dotted hierarchy", () => {
    expect(incidentTypeAncestors("6.1.1.1.2")).toEqual(["6.1.1.1", "6.1.1", "6.1", "6"]);
    expect(incidentTypeAncestors("6")).toEqual([]);
    expect(nearestIncidentTypeAncestor("10.3.1", new Set(["10", "10.3"]))).toBe("10.3");
    expect(nearestIncidentTypeAncestor("10.3.1", new Set(["10"]))).toBe("10");
    expect(nearestIncidentTypeAncestor("10.3.1", new Set(["2"]))).toBeNull();
  });

  it("reads the name SIGAE sent with each code, without the trailing dot", () => {
    const names = incidentTypeNames(
      pollData({
        ...SPECIAL_SERVICES,
        codigo_tipo_incidente_esp: "10.3.",
        codigo_tipo_incidente_despacho_esp: "10.4",
        tipo_incidente_despacho_esp: "   ",
        codigo_tipo_incidente_despacho: "12",
        tipo_incidente_despacho: null
      }).details
    );
    expect([...names]).toEqual([
      ["10", "SERVICIOS ESPECIALES"],
      ["10.3", "INTER-INSTITUCIONAL"]
    ]);
  });
});

describe("resolveIncidentTypes", () => {
  it("keeps known codes without anomalies", () => {
    const result = resolve({});
    expect(codes(result.incident)).toEqual(["2.1.3", "2.1.3.1", "2.1", "2.1.3"]);
    expect(result).toMatchObject({ unknownCodes: [], created: [], anomalies: [] });
  });

  it("uses a code the type list refresh brought", () => {
    const result = resolve(SPECIAL_SERVICES, { known: new Set([...KNOWN, "10", "10.3"]) });
    expect(codes(result.incident)).toEqual(["10", "10.3", "10", "10.3"]);
    expect(result).toMatchObject({ unknownCodes: [], created: [], anomalies: [] });
  });

  it("creates unknown types from the names SIGAE sent with them, parents first", () => {
    const result = resolve({
      ...SPECIAL_SERVICES,
      codigo_tipo_incidente_esp: "10.3.",
      codigo_tipo_incidente_despacho_esp: "10.3"
    });
    expect(codes(result.incident)).toEqual(["10", "10.3", "10", "10.3"]);
    expect(result.unknownCodes).toEqual(["10", "10.3"]);
    expect(result.created).toEqual([
      { code: "10", name: "SERVICIOS ESPECIALES" },
      { code: "10.3", name: "INTER-INSTITUCIONAL" }
    ]);
    expect(details(result)).toEqual([
      { field: "incidentCode", incidentCode: "10", storedCode: "10", resolution: "created" },
      {
        field: "specificIncidentCode",
        incidentCode: "10.3",
        storedCode: "10.3",
        resolution: "created"
      },
      {
        field: "dispatchIncidentCode",
        incidentCode: "10",
        storedCode: "10",
        resolution: "created"
      },
      {
        field: "specificDispatchIncidentCode",
        incidentCode: "10.3",
        storedCode: "10.3",
        resolution: "created"
      }
    ]);
  });

  it("creates the parent from the category name, sorted before a child listed first", () => {
    const result = resolve({
      codigo_tipo_incidente: "2.1.3",
      codigo_tipo_incidente_esp: "10.3",
      tipo_incidente_esp: "INTER-INSTITUCIONAL",
      codigo_tipo_incidente_despacho: "10",
      tipo_incidente_despacho: "SERVICIOS ESPECIALES",
      codigo_tipo_incidente_despacho_esp: "2.1.3.1"
    });
    expect(result.unknownCodes).toEqual(["10.3", "10"]);
    expect(result.created.map((type) => type.code)).toEqual(["10", "10.3"]);
  });

  it("doesn't invent levels it has no name for", () => {
    const result = resolve({
      ...SPECIAL_SERVICES,
      codigo_tipo_incidente_esp: "10.3.1",
      tipo_incidente_esp: "COORDINACION",
      codigo_tipo_incidente_despacho_esp: "10.3.1",
      tipo_incidente_despacho_esp: "COORDINACION"
    });
    expect(result.created).toEqual([
      { code: "10", name: "SERVICIOS ESPECIALES" },
      { code: "10.3.1", name: "COORDINACION" }
    ]);
    expect(codes(result.incident)).toEqual(["10", "10.3.1", "10", "10.3.1"]);
  });

  it("only trusts a name for the code it came with", () => {
    // `tipo_incidente` names `2.1.3` here, not the unknown category of `10.3`.
    const result = resolve({
      codigo_tipo_incidente: "2.1.3",
      tipo_incidente: "INCENDIO DE ESTRUCTURA",
      codigo_tipo_incidente_esp: "10.3",
      tipo_incidente_esp: "INTER-INSTITUCIONAL"
    });
    expect(result.created).toEqual([{ code: "10.3", name: "INTER-INSTITUCIONAL" }]);
  });

  it("falls back to the nearest known ancestor without a name", () => {
    const result = resolve({
      codigo_tipo_incidente_esp: "2.1.3.1.4.",
      tipo_incidente_esp: ""
    });
    expect(result.incident.specificIncidentCode).toBe("2.1.3.1");
    expect(result.unknownCodes).toEqual(["2.1.3.1.4"]);
    expect(result.created).toEqual([]);
    expect(details(result)).toEqual([
      {
        field: "specificIncidentCode",
        incidentCode: "2.1.3.1.4",
        storedCode: "2.1.3.1",
        resolution: "parent"
      }
    ]);
  });

  it("falls back to a parent created from another field", () => {
    const result = resolve({ ...DECLINED, tipo_incidente_esp: null });
    expect(codes(result.incident)).toEqual(["11", "11", "3", "3.3"]);
    expect(result.created).toEqual([{ code: "11", name: "SERVICIOS DECLINADOS" }]);
    expect(details(result)[1]).toEqual({
      field: "specificIncidentCode",
      incidentCode: "11.1",
      storedCode: "11",
      resolution: "parent"
    });
  });

  it("stores NULL with nothing to fall back to", () => {
    const result = resolve({
      ...DECLINED,
      tipo_incidente: "",
      tipo_incidente_esp: ""
    });
    expect(codes(result.incident)).toEqual([null, null, "3", "3.3"]);
    expect(result.unknownCodes).toEqual(["11", "11.1"]);
    expect(details(result)).toEqual([
      { field: "incidentCode", incidentCode: "11", storedCode: null, resolution: "none" },
      { field: "specificIncidentCode", incidentCode: "11.1", storedCode: null, resolution: "none" }
    ]);
  });

  it("records a code an earlier poll created from incident data", () => {
    const result = resolve(SPECIAL_SERVICES, {
      known: new Set([...KNOWN, "10", "10.3"]),
      inferred: new Set(["10", "10.3"])
    });
    expect(codes(result.incident)).toEqual(["10", "10.3", "10", "10.3"]);
    expect(result.unknownCodes).toEqual([]);
    expect(result.created).toEqual([]);
    expect(details(result)[1]).toEqual({
      field: "specificIncidentCode",
      incidentCode: "10.3",
      storedCode: "10.3",
      resolution: "inferred"
    });
  });

  it("records each field and code once across polls", () => {
    const first = resolve(DECLINED);
    const recorded = new Set(first.anomalies.map(anomalyKey));
    expect(recorded.size).toBe(2);

    const again = resolve(DECLINED, {
      known: new Set([...KNOWN, "11", "11.1"]),
      inferred: new Set(["11", "11.1"])
    });
    expect(dedupeAnomalies(again.anomalies, recorded)).toEqual([]);

    const reclassified = resolve({ ...DECLINED, codigo_tipo_incidente_esp: "11.2" });
    expect(
      dedupeAnomalies(reclassified.anomalies, recorded).map((anomaly) => anomaly.details)
    ).toEqual([
      {
        field: "specificIncidentCode",
        incidentCode: "11.2",
        storedCode: "11.2",
        resolution: "created"
      }
    ]);
  });

  it("dedupes against anomalies recorded before the resolution details", () => {
    const recorded = new Set([
      anomalyKey({
        code: "UNKNOWN_INCIDENT_TYPE",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: { field: "incidentCode", incidentCode: "11" }
      })
    ]);
    const result = resolve(DECLINED);
    expect(
      dedupeAnomalies(result.anomalies, recorded).map((anomaly) => anomaly.details.field)
    ).toEqual(["specificIncidentCode"]);
  });
});

describe("processPoll with unknown incident types", () => {
  const now = cr("2026-10-10T20:30:00");
  const DECLINED_BEFORE = {
    codigo_tipo_incidente: "7",
    codigo_tipo_incidente_esp: "7.1.1",
    codigo_tipo_incidente_despacho: "7",
    codigo_tipo_incidente_despacho_esp: "7.1.1"
  };
  const poll = (details: Record<string, unknown>) =>
    processPoll({
      incidentId: INCIDENT_ID,
      classification: classify({ details: { body: detailsBody(details) } }),
      current: incidentState({ details: { body: detailsBody(DECLINED_BEFORE) } }),
      syncState: syncState(),
      knownIncidentTypes: KNOWN,
      recordedAnomalies: new Set(),
      now
    });

  it("doesn't clear a known code when the new one has a known ancestor", () => {
    const result = poll({
      ...DECLINED_BEFORE,
      codigo_tipo_incidente_esp: "7.1.9",
      tipo_incidente_esp: ""
    });
    expect(result.next?.incident.specificIncidentCode).toBe("7.1");
    expect(result.anomalies.map((anomaly) => anomaly.code)).toEqual(["UNKNOWN_INCIDENT_TYPE"]);
    expect(result.changes).toMatchObject([
      { field: "specificIncidentCode", oldValue: "7.1.1", newValue: "7.1" }
    ]);
  });

  it("stores a reclassification to an unlisted category it can create", () => {
    const result = poll(DECLINED);
    expect(result.next?.incident).toMatchObject({
      incidentCode: "11",
      specificIncidentCode: "11.1"
    });
    expect(result.anomalies.map((anomaly) => anomaly.code)).not.toContain("VALUE_REGRESSED");
    expect(result.newIncidentTypes.map((type) => type.code)).toEqual(["11", "11.1"]);
  });
});
