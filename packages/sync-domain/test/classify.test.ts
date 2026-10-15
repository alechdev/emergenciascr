import { describe, expect, it } from "vitest";

import {
  CAST_ERROR,
  NOT_FOUND,
  PLACEHOLDER,
  classify,
  listBody,
  reportBody,
  station,
  unit
} from "./builders";

const notFoundList = { body: { ...NOT_FOUND, Items: [] } };
const timeout = { error: { kind: "timeout", message: "request timed out after 15000ms" } };

describe("classifyPoll (spec 6.1)", () => {
  it("all four 00: ok", () => {
    const result = classify();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.units).toHaveLength(1);
    expect(result.data.stations).toHaveLength(1);
  });

  it("report 99 and the rest 00: partial, keeping the body", () => {
    const result = classify({ report: { body: reportBody(CAST_ERROR) } });
    expect(result).toMatchObject({ kind: "partial", reportDescription: CAST_ERROR.Descripcion });
    if (result.kind !== "partial") return;
    expect(result.data.report.Estado_Abierto).toBe("true");
  });

  it("report 99 without the fields an incident needs: failed", () => {
    const body = reportBody(CAST_ERROR);
    delete body.Hora_Aviso;
    expect(classify({ report: { body } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerBoletaIncidente"
    });
  });

  it("detail and report 03: not_found", () => {
    expect(
      classify({
        details: { body: NOT_FOUND },
        report: { body: NOT_FOUND },
        stations: notFoundList,
        units: notFoundList
      })
    ).toEqual({ kind: "not_found" });
  });

  it("only detail or only report 03: failed", () => {
    expect(classify({ details: { body: NOT_FOUND } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerDetalleEmergencias"
    });
    expect(classify({ report: { body: NOT_FOUND } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerBoletaIncidente"
    });
  });

  it("request failures: failed, even when detail and report are 03", () => {
    expect(classify({ units: timeout })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerUnidadesDespachadasIncidente",
      reason: "request failed (timeout): request timed out after 15000ms"
    });
    expect(
      classify({ details: { body: NOT_FOUND }, report: { body: NOT_FOUND }, stations: timeout })
    ).toMatchObject({ kind: "failed", endpoint: "ObtenerEstacionesAtiendeIncidente" });
    expect(
      classify({ report: { error: { kind: "invalid_json", message: "invalid JSON" } } })
    ).toMatchObject({ kind: "failed", endpoint: "ObtenerBoletaIncidente" });
    expect(classify({ details: { error: { kind: "http", message: "HTTP 502" } } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerDetalleEmergencias"
    });
  });

  it("a changed response shape: failed", () => {
    expect(classify({ report: { body: reportBody({ Estado_Abierto: true }) } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerBoletaIncidente"
    });
  });

  it("99 on any other endpoint: failed", () => {
    expect(classify({ details: { body: { ...CAST_ERROR } } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerDetalleEmergencias"
    });
    expect(classify({ stations: { body: listBody([], CAST_ERROR) } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerEstacionesAtiendeIncidente"
    });
    expect(classify({ units: { body: listBody([], CAST_ERROR) } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerUnidadesDespachadasIncidente"
    });
  });

  it("any other code: failed, with the code and description", () => {
    const dbError = { Codigo: "04", Descripcion: "Ha ocurrido un error con la base de datos." };
    expect(classify({ report: { body: reportBody(dbError) } })).toEqual({
      kind: "failed",
      endpoint: "ObtenerBoletaIncidente",
      reason: "answered Codigo 04 (Ha ocurrido un error con la base de datos.)"
    });
    expect(classify({ units: { body: listBody([unit()], dbError) } })).toMatchObject({
      kind: "failed",
      endpoint: "ObtenerUnidadesDespachadasIncidente"
    });
  });

  it("units or stations 03 while detail and report are 00: ok with empty lists", () => {
    const result = classify({ stations: notFoundList, units: notFoundList });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.units).toEqual([]);
    expect(result.data.stations).toEqual([]);
  });

  it("units 03 with a partial report: partial with no units", () => {
    const result = classify({ report: { body: reportBody(CAST_ERROR) }, units: notFoundList });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.data.units).toEqual([]);
  });

  it("a report without an incident time: failed", () => {
    expect(classify({ report: { body: reportBody({ Hora_Aviso: PLACEHOLDER }) } })).toMatchObject({
      kind: "failed",
      reason: "report has no incident time (Fecha, Hora_Aviso)"
    });
  });

  it("reads list items whether SIGAE sends Items or items", () => {
    const result = classify({
      stations: { body: { Codigo: "00", Descripcion: "", items: [station()] } }
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.stations).toHaveLength(1);
  });
});
