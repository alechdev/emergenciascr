import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SNAPSHOT_ALLOWLISTS, payloadHash, redactSnapshot } from "../src/redact/index";
import { detailsBody, listBody, reportBody, station, unit } from "./builders";
import { listScenarios, readSnapshot, snapshotFiles } from "./fixture-runner";

import type { Allowlist } from "../src/redact/allowlists";
import type { SigaeIncidentEndpoint } from "../src/types";

const PERSONAL = {
  Telefono_Avisa: "8888-8888",
  Nombre_Avisa: "NOMBRE SINTETICO",
  Cedula_Avisa: "1-1111-1111",
  Usuario: "operador",
  Nombre_Mando: "MANDO SINTETICO",
  NomBomberoMando: "BOMBERO SINTETICO",
  Info_Relevante: "texto libre",
  Observaciones: "texto libre",
  Condiciones_Especiales: "texto libre",
  Matricula: "ABC-123",
  CampoNuevo: "SIGAE added this later"
};

/** Every key path in a payload that its endpoint's allowlist doesn't permit. */
function unlistedKeys(value: unknown, allowlist: Allowlist, path = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, field]) => {
    const rule = Object.hasOwn(allowlist, key) ? allowlist[key] : undefined;
    const here = `${path}${key}`;
    if (rule === undefined) return [here];
    if (rule === true) {
      return typeof field === "object" && field !== null ? [`${here} (not a scalar)`] : [];
    }
    if (field === null) return [];
    if (!Array.isArray(field)) return [`${here} (not a list)`];
    return field.flatMap((item, index) => unlistedKeys(item, rule.each, `${here}[${index}].`));
  });
}

describe("redactSnapshot (spec 5.2)", () => {
  it("drops personal data, free text and unknown fields from the report", () => {
    const redacted = redactSnapshot("ObtenerBoletaIncidente", reportBody(PERSONAL));
    for (const key of Object.keys(PERSONAL)) expect(redacted).not.toHaveProperty(key);
    expect(redacted).toMatchObject({ Codigo: "00", Estado_Abierto: "true", Id_Provincia: 1 });
    expect(unlistedKeys(redacted, SNAPSHOT_ALLOWLISTS.ObtenerBoletaIncidente)).toEqual([]);
  });

  it("filters nested detail stations and vehicles, and drops DetallesImportantes", () => {
    const redacted = redactSnapshot(
      "ObtenerDetalleEmergencias",
      detailsBody({
        DetallesImportantes: "texto libre",
        estaciones: [
          {
            clave_estacion: "1-1",
            nombre: "METROPOLITANA NORTE",
            telefono: "2222-2222",
            vehiculos: [{ estado: "RETIRADO", numero_interno: "M-12", conductor: "NOMBRE" }]
          }
        ]
      })
    );
    expect(redacted).not.toHaveProperty("DetallesImportantes");
    expect(redacted.estaciones).toEqual([
      {
        clave_estacion: "1-1",
        nombre: "METROPOLITANA NORTE",
        vehiculos: [{ estado: "RETIRADO", numero_interno: "M-12" }]
      }
    ]);
  });

  it("filters list items and keeps the list key as received", () => {
    const items = [unit({ Operador: "NOMBRE" })];
    const upper = redactSnapshot("ObtenerUnidadesDespachadasIncidente", listBody(items));
    expect(Object.keys(upper)).toEqual(["Codigo", "Descripcion", "Items"]);
    expect((upper.Items as Record<string, unknown>[])[0]).not.toHaveProperty("Operador");

    const lower = redactSnapshot("ObtenerEstacionesAtiendeIncidente", {
      Codigo: "00",
      Descripcion: "",
      items: [station({ Encargado: "NOMBRE" })]
    });
    expect(Object.keys(lower)).toEqual(["Codigo", "Descripcion", "items"]);
    expect((lower.items as Record<string, unknown>[])[0]).not.toHaveProperty("Encargado");
  });

  it("drops allowlisted fields that change shape", () => {
    const redacted = redactSnapshot("ObtenerUnidadesDespachadasIncidente", {
      Codigo: "00",
      Descripcion: { Nombre: "NOMBRE" },
      Items: "not a list"
    });
    expect(redacted).toEqual({ Codigo: "00" });
    expect(
      redactSnapshot("ObtenerUnidadesDespachadasIncidente", { Codigo: "03", Items: null })
    ).toEqual({ Codigo: "03", Items: null });
    expect(redactSnapshot("ObtenerBoletaIncidente", "not an object")).toEqual({});
  });

  it("hashes key-sorted payloads", () => {
    const a = redactSnapshot("ObtenerBoletaIncidente", reportBody());
    const reversed = Object.fromEntries(Object.entries(a).reverse());
    expect(payloadHash(reversed)).toBe(payloadHash(a));
    expect(payloadHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadHash({ ...a, Estado_Abierto: "false" })).not.toBe(payloadHash(a));
  });
});

describe("fixtures", () => {
  const scenarios = listScenarios();

  it("contain no field outside the allowlists", () => {
    for (const scenario of scenarios) {
      for (const file of snapshotFiles(scenario)) {
        const { responses } = readSnapshot(scenario, file);
        for (const [endpoint, input] of Object.entries(responses)) {
          if (!("body" in input)) continue;
          const allowlist = SNAPSHOT_ALLOWLISTS[endpoint as SigaeIncidentEndpoint];
          expect(allowlist, `${scenario}/${file}: unknown endpoint ${endpoint}`).toBeDefined();
          expect(unlistedKeys(input.body, allowlist), `${scenario}/${file} ${endpoint}`).toEqual(
            []
          );
        }
      }
    }
  });

  it("are the only files in each scenario besides expected.json", () => {
    for (const scenario of scenarios) {
      const dir = new URL(`../fixtures/${scenario}/`, import.meta.url).pathname;
      const extra = readdirSync(dir).filter(
        (name) => name !== "expected.json" && !/^\d{3}\.json$/.test(name)
      );
      expect(extra, scenario).toEqual([]);
      expect(() => JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"))).not.toThrow();
    }
  });
});
