import { describe, expect, it } from "vitest";

import {
  type PlaceholderIssue,
  incidentTimestamp,
  keepReportValues,
  normalizeDate,
  normalizeIncidentTypeCode,
  normalizePoll,
  resolveIncidentTypes
} from "../src/normalize/index";
import {
  CAST_ERROR,
  INCIDENT_ID,
  KNOWN_INCIDENT_TYPES,
  PLACEHOLDER,
  classify,
  cr,
  detailsBody,
  listBody,
  reportBody,
  station,
  unit,
  type PollInput
} from "./builders";

function normalize(input: PollInput = {}) {
  const classification = classify(input);
  if (classification.kind !== "ok" && classification.kind !== "partial") {
    throw new Error(`expected ok or partial, got ${classification.kind}`);
  }
  return normalizePoll(INCIDENT_ID, classification.data);
}

const source = () => ({
  entity: "incident" as const,
  entityId: INCIDENT_ID,
  issues: [] as PlaceholderIssue[]
});

describe("dates (spec 6.2)", () => {
  it("parses SIGAE dates as Costa Rica time", () => {
    expect(normalizeDate("2026-10-10T20:25:19", "f", "F", source())?.toISOString()).toBe(
      "2026-10-11T02:25:19.000Z"
    );
  });

  it("0001-01-01T00:00:00 becomes NULL without an issue", () => {
    const s = source();
    expect(normalizeDate(PLACEHOLDER, "f", "F", s)).toBeNull();
    expect(s.issues).toEqual([]);
  });

  it("other pre-1971 dates become NULL with an issue", () => {
    for (const raw of ["1900-01-01T00:00:00", "1970-12-31T23:59:59", "0001-01-01T00:00:00.000"]) {
      const s = source();
      expect(normalizeDate(raw, "arrivalTime", "HoraLLegada", s)).toBeNull();
      expect(s.issues).toEqual([
        {
          entity: "incident",
          entityId: INCIDENT_ID,
          field: "arrivalTime",
          sigaeField: "HoraLLegada",
          raw
        }
      ]);
    }
    expect(normalizeDate("1971-01-01T00:00:00", "f", "F", source())).not.toBeNull();
  });

  it("incident time is the date of Fecha with the time of Hora_Aviso", () => {
    expect(
      incidentTimestamp("2026-10-10T00:00:00", "2026-10-10T20:25:19", source())?.toISOString()
    ).toBe("2026-10-11T02:25:19.000Z");
  });

  it("incident time around midnight", () => {
    expect(
      incidentTimestamp("2026-10-11T00:00:00", "2026-10-11T23:58:41", source())?.toISOString()
    ).toBe("2026-10-12T05:58:41.000Z");
    expect(
      incidentTimestamp("2026-10-12T00:00:00", "2026-10-12T00:01:05", source())?.toISOString()
    ).toBe("2026-10-12T06:01:05.000Z");
  });

  it("keeps the date of Fecha when Hora_Aviso carries another date", () => {
    expect(
      incidentTimestamp("2026-10-12T00:00:00", "2026-10-11T23:58:41", source())?.toISOString()
    ).toBe("2026-10-13T05:58:41.000Z");
  });

  it("no incident time when either part is missing", () => {
    expect(incidentTimestamp(PLACEHOLDER, "2026-10-10T20:25:19", source())).toBeNull();
    expect(incidentTimestamp("2026-10-10T00:00:00", PLACEHOLDER, source())).toBeNull();
  });
});

describe("normalizeIncident (spec 6.3)", () => {
  it("maps a report and its details", () => {
    const { incident, issues } = normalize({
      report: {
        body: reportBody({
          Hora_Controlado: "2026-10-10T21:02:40",
          Hora_Fuego_Bajo_Control: "2026-10-10T20:51:07",
          Hora_Perdidas_Detenidas: "2026-10-10T21:10:00",
          Hora_Todo_Claro: "2026-10-10T21:30:00.1270000",
          Estado_Abierto: "false"
        })
      }
    });
    expect(issues).toEqual([]);
    expect(incident).toEqual({
      id: INCIDENT_ID,
      EEConsecutive: "51234-2026",
      address: "SAN JOSE SAN JOSE CARMEN CALLE SINTETICA 1",
      importantDetails: "EDIFICIO SINTETICO",
      incidentTimestamp: cr("2026-10-10T20:25:19"),
      provinceId: 1,
      cantonId: 101,
      districtId: 10101,
      incidentCode: "2.1.3",
      specificIncidentCode: "2.1.3.1",
      dispatchIncidentCode: "2.1",
      specificDispatchIncidentCode: "2.1.3",
      responsibleStation: 2,
      latitude: "9.9",
      longitude: "-84.1",
      isOpen: false,
      controlledAt: cr("2026-10-10T21:02:40"),
      fireUnderControlAt: cr("2026-10-10T20:51:07"),
      lossesStoppedAt: cr("2026-10-10T21:10:00"),
      allClearAt: cr("2026-10-10T21:30:00.127")
    });
  });

  it("isOpen follows Estado_Abierto", () => {
    expect(normalize().incident.isOpen).toBe(true);
    expect(
      normalize({ report: { body: reportBody({ Estado_Abierto: "false" }) } }).incident.isOpen
    ).toBe(false);
  });

  it("0 province, canton and district become NULL", () => {
    const { incident } = normalize({
      report: { body: reportBody({ Id_Provincia: 0, Id_Canton: 0, Id_Distrito: 0 }) }
    });
    expect([incident.provinceId, incident.cantonId, incident.districtId]).toEqual([
      null,
      null,
      null
    ]);
  });

  it("missing coordinates are stored as 0", () => {
    const { incident } = normalize({
      details: { body: detailsBody({ latitud: null, longitud: 0 }) }
    });
    expect([incident.latitude, incident.longitude]).toEqual(["0", "0"]);
  });

  it("strips a trailing dot from incident type codes", () => {
    expect(normalizeIncidentTypeCode("6.1.2.")).toBe("6.1.2");
    expect(normalizeIncidentTypeCode("6.1.2")).toBe("6.1.2");
    expect(normalizeIncidentTypeCode(".")).toBeNull();
    expect(normalizeIncidentTypeCode("")).toBeNull();
    expect(normalizeIncidentTypeCode(null)).toBeNull();
  });

  it("unknown incident type codes without a name or known ancestor become NULL", () => {
    const { incident } = normalize({
      details: {
        body: detailsBody({ codigo_tipo_incidente: "9.9.", codigo_tipo_incidente_esp: "9.9" })
      }
    });
    const resolved = resolveIncidentTypes(incident, { known: KNOWN_INCIDENT_TYPES });
    expect(resolved.incident.incidentCode).toBeNull();
    expect(resolved.incident.specificIncidentCode).toBeNull();
    expect(resolved.incident.dispatchIncidentCode).toBe("2.1");
    expect(resolved.unknownCodes).toEqual(["9.9"]);
    expect(resolved.created).toEqual([]);
    expect(resolved.anomalies).toEqual([
      {
        code: "UNKNOWN_INCIDENT_TYPE",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: {
          field: "incidentCode",
          incidentCode: "9.9",
          storedCode: null,
          resolution: "none"
        }
      },
      {
        code: "UNKNOWN_INCIDENT_TYPE",
        entity: "incident",
        entityId: INCIDENT_ID,
        details: {
          field: "specificIncidentCode",
          incidentCode: "9.9",
          storedCode: null,
          resolution: "none"
        }
      }
    ]);
  });

  describe("responsible station", () => {
    const apoyo = (id: number, stationId: number) =>
      station({ DestipoServicio: "APOYO", IdBoletaEstacionAtiende: id, IdEstacion: stationId });

    it("is the RESPONSABLE station", () => {
      const stations = { body: listBody([apoyo(1, 7), station({ IdEstacion: 3 }), apoyo(2, 8)]) };
      expect(normalize({ stations }).incident.responsibleStation).toBe(3);
    });

    it("falls back to the last station", () => {
      const stations = { body: listBody([apoyo(1, 7), apoyo(2, 8)]) };
      expect(normalize({ stations }).incident.responsibleStation).toBe(8);
    });

    it("is NULL without stations", () => {
      expect(
        normalize({ stations: { body: listBody([]) } }).incident.responsibleStation
      ).toBeNull();
    });

    it("is NULL when the chosen station has ID 0", () => {
      const stations = { body: listBody([apoyo(1, 7), apoyo(2, 0)]) };
      expect(normalize({ stations }).incident.responsibleStation).toBeNull();
    });
  });

  it("records implausible report dates", () => {
    const { incident, issues } = normalize({
      report: { body: reportBody({ Hora_Controlado: "1900-01-01T00:00:00" }) }
    });
    expect(incident.controlledAt).toBeNull();
    expect(issues).toMatchObject([{ field: "controlledAt", sigaeField: "Hora_Controlado" }]);
  });
});

describe("partial reports", () => {
  const previous = normalize({
    report: { body: reportBody({ Hora_Controlado: "2026-10-10T21:02:40" }) }
  }).incident;

  it("set and change values but never clear them", () => {
    const body = reportBody({
      ...CAST_ERROR,
      DesUbicacion: "OTRA DIRECCION",
      Direccion: "",
      Hora_Controlado: PLACEHOLDER,
      Hora_Todo_Claro: "2026-10-10T21:30:00",
      Id_Canton: 0
    });
    delete body.Id_Provincia;
    const next = normalize({ report: { body } }).incident;
    const merged = keepReportValues(previous, next);

    expect(merged.address).toBe("OTRA DIRECCION");
    expect(merged.allClearAt).toEqual(cr("2026-10-10T21:30:00"));
    expect(merged.importantDetails).toBe(previous.importantDetails);
    expect(merged.controlledAt).toEqual(previous.controlledAt);
    expect(merged.provinceId).toBe(1);
    expect(merged.cantonId).toBe(101);
    expect(merged.districtId).toBe(10101);
  });

  it("store what they have for a new incident", () => {
    const body = reportBody({ ...CAST_ERROR, Direccion: "" });
    delete body.Id_Provincia;
    const next = normalize({ report: { body } }).incident;
    expect(keepReportValues(null, next)).toEqual(next);
    expect(next.provinceId).toBeNull();
    expect(next.importantDetails).toBe("");
  });
});

describe("normalizeDispatchedVehicles and stations (spec 6.4)", () => {
  it("maps units with their times", () => {
    const { vehicles } = normalize({
      units: {
        body: listBody([
          unit({
            HoraLLegada: "2026-10-10T20:33:45",
            HoraRetiro: "2026-10-10T21:40:10",
            HoraBase: "2026-10-10T21:55:31",
            NumeroInterno: "M-12"
          })
        ])
      }
    });
    expect(vehicles).toEqual([
      {
        id: 5200101,
        incidentId: INCIDENT_ID,
        stationId: 2,
        vehicleId: 140,
        vehicleInternalNumber: "M-12",
        dispatchedTime: cr("2026-10-10T20:26:02"),
        arrivalTime: cr("2026-10-10T20:33:45"),
        departureTime: cr("2026-10-10T21:40:10"),
        baseReturnTime: cr("2026-10-10T21:55:31"),
        attentionOnFoot: false
      }
    ]);
  });

  it("placeholder unit times are NULL", () => {
    const [vehicle] = normalize().vehicles;
    expect(vehicle).toMatchObject({
      arrivalTime: null,
      departureTime: null,
      baseReturnTime: null,
      vehicleInternalNumber: null
    });
  });

  it("ATENCION A PIE: attention on foot, no vehicle", () => {
    const [vehicle] = normalize({
      units: { body: listBody([unit({ Unidad: "ATENCION A PIE", CodigoUnidad: 0 })]) }
    }).vehicles;
    expect(vehicle).toMatchObject({ attentionOnFoot: true, vehicleId: null });
  });

  it("maps stations", () => {
    expect(normalize().stations).toEqual([
      {
        id: 3400101,
        incidentId: INCIDENT_ID,
        stationId: 2,
        serviceTypeId: 1,
        attentionOnFoot: false
      }
    ]);
  });
});
