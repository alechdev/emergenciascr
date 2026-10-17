import { describe, expect, it } from "vitest";

import {
  type CapturedPoll,
  type SnapshotRow,
  buildFixturePolls,
  createLocationMasker,
  readOnlyConnection,
  validateFixturePolls
} from "../scripts/fixture-capture";
import { INCIDENT_ID, detailsBody, listBody, reportBody, station, unit } from "./builders";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 11, 2, minutes));

function row(endpoint: SnapshotRow["endpoint"], minutes: number, payload: unknown): SnapshotRow {
  return { endpoint, fetchedAt: at(minutes), payload };
}

describe("buildFixturePolls", () => {
  it("makes one poll per snapshot time, carrying each endpoint's latest answer", () => {
    const report = reportBody();
    const stations = listBody([
      station({ AtencionAPie: true, HoraAtencionAPie: "2026-10-10T20:26:50" })
    ]);
    const firstUnits = listBody([unit()]);
    const laterUnits = listBody([unit(), unit({ IdBoletaUnidadDespachada: 2, CodigoUnidad: 152 })]);
    const polls = buildFixturePolls(INCIDENT_ID, [
      row("ObtenerUnidadesDespachadasIncidente", 10, laterUnits),
      row("ObtenerBoletaIncidente", 0, report),
      row("ObtenerEstacionesAtiendeIncidente", 0, stations),
      row("ObtenerUnidadesDespachadasIncidente", 0, firstUnits)
    ]);

    expect(polls.map((poll) => poll.fetchedAt)).toEqual([
      at(0).toISOString(),
      at(10).toISOString()
    ]);
    expect(Object.keys(polls[0]!.responses)).toEqual([
      "ObtenerBoletaIncidente",
      "ObtenerDetalleEmergencias",
      "ObtenerEstacionesAtiendeIncidente",
      "ObtenerUnidadesDespachadasIncidente"
    ]);
    // The details never answered before the first poll.
    expect(polls[0]!.responses.ObtenerDetalleEmergencias).toEqual({
      error: { kind: "network", message: "no snapshot before this poll" }
    });
    expect(polls[1]!.responses.ObtenerEstacionesAtiendeIncidente).toEqual({ body: stations });
    expect(polls[1]!.responses.ObtenerUnidadesDespachadasIncidente).toEqual({ body: laterUnits });
    expect(polls[1]!.responses.ObtenerBoletaIncidente).toEqual(
      polls[0]!.responses.ObtenerBoletaIncidente
    );
  });

  it("drops fields outside the current allowlists", () => {
    const [poll] = buildFixturePolls(INCIDENT_ID, [
      row("ObtenerBoletaIncidente", 0, reportBody({ Nombre_Reporta: "PERSONA", Cedula: "1-1" }))
    ]);
    const body = (poll!.responses.ObtenerBoletaIncidente as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty("Nombre_Reporta");
    expect(body).not.toHaveProperty("Cedula");
    expect(body.Consecutivo).toBe("51234-2026");
  });

  it("drops HoraAtencionAPie from older snapshots of items without attention on foot", () => {
    const [poll] = buildFixturePolls(INCIDENT_ID, [
      row(
        "ObtenerEstacionesAtiendeIncidente",
        0,
        listBody([
          station({ HoraAtencionAPie: "2026-10-10T20:27:02" }),
          station({ AtencionAPie: true, HoraAtencionAPie: "2026-10-10T20:26:50" })
        ])
      )
    ]);
    const response = poll!.responses.ObtenerEstacionesAtiendeIncidente as {
      body: { Items: Record<string, unknown>[] };
    };
    expect(response.body.Items.map((item) => item.HoraAtencionAPie)).toEqual([
      undefined,
      "2026-10-10T20:26:50"
    ]);
    expect(Object.keys(response.body.Items[1]!)).toEqual(Object.keys(station()));
  });

  it("replaces locations, keeping changes, moves and empty values", () => {
    const polls = buildFixturePolls(INCIDENT_ID, [
      row("ObtenerBoletaIncidente", 0, reportBody({ DesUbicacion: "CALLE REAL 1", Direccion: "" })),
      row(
        "ObtenerDetalleEmergencias",
        0,
        detailsBody({ direccion: "CALLE REAL 1", latitud: 0, longitud: 0 })
      ),
      row(
        "ObtenerBoletaIncidente",
        5,
        reportBody({ DesUbicacion: "CALLE REAL 2", Direccion: "CASA" })
      ),
      row(
        "ObtenerDetalleEmergencias",
        5,
        detailsBody({ direccion: "CALLE REAL 1", latitud: 10.01, longitud: -84.2 })
      ),
      row(
        "ObtenerDetalleEmergencias",
        9,
        detailsBody({ direccion: "CALLE REAL 1", latitud: 10.06, longitud: -84.21 })
      )
    ]);
    const body = (poll: CapturedPoll, endpoint: keyof CapturedPoll["responses"]) =>
      (poll.responses[endpoint] as { body: Record<string, unknown> }).body;

    expect(body(polls[0]!, "ObtenerBoletaIncidente")).toMatchObject({
      DesUbicacion: "DIRECCION DE PRUEBA 1",
      Direccion: ""
    });
    expect(body(polls[0]!, "ObtenerDetalleEmergencias")).toMatchObject({
      direccion: "DIRECCION DE PRUEBA 1",
      latitud: 0,
      longitud: 0
    });
    expect(body(polls[1]!, "ObtenerBoletaIncidente")).toMatchObject({
      DesUbicacion: "DIRECCION DE PRUEBA 2",
      Direccion: "DIRECCION DE PRUEBA 3"
    });
    expect(body(polls[1]!, "ObtenerDetalleEmergencias")).toMatchObject({
      latitud: 9.9333,
      longitud: -84.0833
    });
    expect(body(polls[2]!, "ObtenerDetalleEmergencias")).toMatchObject({
      latitud: 9.9833,
      longitud: -84.0933
    });
    expect(JSON.stringify(polls)).not.toMatch(/CALLE REAL|CASA"|10\.0|-84\.2/);
  });
});

describe("validateFixturePolls", () => {
  const [poll] = buildFixturePolls(INCIDENT_ID, [row("ObtenerBoletaIncidente", 0, reportBody())]);

  it("accepts what buildFixturePolls makes", () => {
    expect(() => validateFixturePolls([poll!])).not.toThrow();
  });

  it("rejects fields outside the allowlists and real addresses, naming no value", () => {
    const report = (poll!.responses.ObtenerBoletaIncidente as { body: Record<string, unknown> })
      .body;
    const extra = {
      ...poll!,
      responses: { ...poll!.responses, ObtenerBoletaIncidente: { body: { ...report, Extra: 1 } } }
    } as CapturedPoll;
    const address = {
      ...poll!,
      responses: {
        ...poll!.responses,
        ObtenerBoletaIncidente: { body: { ...report, Direccion: "CALLE REAL 9" } }
      }
    } as CapturedPoll;

    expect(() => validateFixturePolls([extra])).toThrow(/outside the allowlist/);
    expect(() => validateFixturePolls([address])).toThrow(/Direccion is not synthetic/);
    expect(() => validateFixturePolls([address])).not.toThrow(/CALLE REAL/);
  });

  it("accepts synthetic coordinates with their moves, and zero or null ones", () => {
    const polls = buildFixturePolls(INCIDENT_ID, [
      row("ObtenerDetalleEmergencias", 0, detailsBody({ latitud: 0, longitud: null })),
      row("ObtenerDetalleEmergencias", 5, detailsBody({ latitud: 10.01, longitud: -84.2 })),
      row("ObtenerDetalleEmergencias", 9, detailsBody({ latitud: 10.06, longitud: -84.21 }))
    ]);
    expect(() => validateFixturePolls(polls)).not.toThrow();
  });

  it("rejects real coordinates, naming no value", () => {
    const withDetails = (details: Record<string, unknown>) =>
      ({
        ...poll!,
        responses: {
          ...poll!.responses,
          ObtenerDetalleEmergencias: { body: { ...details, direccion: "DIRECCION DE PRUEBA 1" } }
        }
      }) as CapturedPoll;
    const real = withDetails(detailsBody({ latitud: 10.0123, longitud: -84.0833 }));
    const text = withDetails(detailsBody({ latitud: 9.9333, longitud: "-84.2" }));
    // The first one is synthetic; the next is too far from it to be a masked move.
    const far = [
      withDetails(detailsBody({ latitud: 9.9333, longitud: -84.0833 })),
      withDetails(detailsBody({ latitud: 9.9333, longitud: -85.1 }))
    ];

    expect(() => validateFixturePolls([real])).toThrow(/latitud is not synthetic/);
    expect(() => validateFixturePolls([real])).not.toThrow(/10\.0123/);
    expect(() => validateFixturePolls([text])).toThrow(/longitud is not synthetic/);
    expect(() => validateFixturePolls(far)).toThrow(/longitud is not synthetic/);
    expect(() => validateFixturePolls([far[0]!])).not.toThrow();
  });
});

describe("createLocationMasker", () => {
  it("gives equal values equal synthetic values across endpoints", () => {
    const mask = createLocationMasker();
    const report = mask("ObtenerBoletaIncidente", { DesUbicacion: "A", Direccion: "B" });
    const details = mask("ObtenerDetalleEmergencias", { direccion: "B" });
    expect(report).toEqual({
      DesUbicacion: "DIRECCION DE PRUEBA 1",
      Direccion: "DIRECCION DE PRUEBA 2"
    });
    expect(details).toEqual({ direccion: "DIRECCION DE PRUEBA 2" });
  });
});

describe("readOnlyConnection", () => {
  it("makes every transaction read-only and keeps the rest of the URL", () => {
    const url = new URL(
      readOnlyConnection("postgres://user:secret@127.0.0.1:5432/db?sslmode=disable")
    );
    expect(url.searchParams.get("options")).toBe("-c default_transaction_read_only=on");
    expect(url.searchParams.get("sslmode")).toBe("disable");
    expect(url.pathname).toBe("/db");
  });
});
