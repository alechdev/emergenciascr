import { config } from "dotenv";
/**
 * Records redacted SIGAE responses into `test/fixtures/recorded`. The client's tests check
 * that every recorded response decodes to the kind its `Codigo` implies.
 *
 *   bun run scripts/record-fixtures.ts [--env ../../apps/sync-v2/.env] [--incidents 20]
 *
 * Read-only. Every body goes through an allowlist before it is written (the incident
 * endpoints use the snapshot allowlists from spec section 5.2), lists are trimmed to a few
 * items, and nothing from a body is printed. Unlike snapshots, fixtures are public, so
 * incident locations (free-text addresses and coordinates) and station contacts are
 * replaced with synthetic values; empty values, `null` and `0` are kept because they
 * carry meaning.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  type SigaeEndpoint,
  type SigaeError,
  type SigaeResponse,
  type SigaeResult,
  createSigaeClient,
  formatSigaeRequestDate
} from "../src/client";

const { values: args } = parseArgs({
  options: {
    env: { type: "string", default: "../../apps/sync-v2/.env" },
    incidents: { type: "string", default: "20" }
  }
});

config({ path: resolve(args.env), quiet: true });
// apps/web names it SIGAE_COD_SYS, apps/sync-v2 SIGAE_SYSTEM_CODE.
if (!process.env.SIGAE_COD_SYS && process.env.SIGAE_SYSTEM_CODE) {
  process.env.SIGAE_COD_SYS = process.env.SIGAE_SYSTEM_CODE;
}

const required = ["SIGAE_API_URL", "SIGAE_USER", "SIGAE_PASSWORD", "SIGAE_COD_SYS", "SIGAE_IP"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const sigae = createSigaeClient({
  baseUrl: process.env.SIGAE_API_URL!,
  credentials: {
    user: process.env.SIGAE_USER!,
    password: process.env.SIGAE_PASSWORD!,
    systemCode: process.env.SIGAE_COD_SYS!,
    ip: process.env.SIGAE_IP!
  },
  proxy: process.env.SIGAE_PROXY_URL || undefined,
  maxConcurrency: 2
});

const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures", "recorded");
const LIST_LIMIT = 3;

type Allowlist = {
  keys: readonly string[];
  lists?: Record<string, Allowlist>;
  /** Replacements for kept fields whose real values must not be published. */
  synthetic?: Record<string, string | number>;
};

const SYNTHETIC_ADDRESS = "DIRECCION DE PRUEBA";
const SYNTHETIC_LOCATION = "UBICACION DE PRUEBA";
const SYNTHETIC_COORDINATES = { latitud: 9.9333, longitud: -84.0833 };

const STATION_ATTENDING_ITEM = [
  "Codigo",
  "Descripcion",
  "AtencionAPie",
  "ClaveEstacion",
  "DestipoServicio",
  "HoraAtencionAPie",
  "IdBoletaEstacionAtiende",
  "IdEstacion",
  "IdTipoServicio",
  "NombreEstacion"
];
const DISPATCHED_UNIT_ITEM = [
  "Codigo",
  "Descripcion",
  "CodigoEstacion",
  "CodigoUnidad",
  "DespachoAlarma",
  "HoraBase",
  "HoraDespacho",
  "HoraDevolverBase",
  "HoraLLegada",
  "HoraRetiro",
  "HoraTraslado",
  "IdBoletaServicio",
  "IdBoletaUnidadDespachada",
  "IdVehiculo",
  "NumeroInterno",
  "Traslado",
  "Unidad",
  "UnidadCompleta"
];
const INCIDENT_LIST_ITEM = [
  "codigoTipoIncidente",
  "codigoTipoIncidenteDespacho",
  "consecutivoEE",
  "direccion",
  "estacionResponsable",
  "fecha",
  "horaIncidente",
  "idBoletaIncidente",
  "tipoIncidente",
  "tipoIncidenteDespacho"
];
const ENVELOPE = ["Codigo", "Descripcion"];
const itemsList = (
  keys: string[],
  synthetic?: Allowlist["synthetic"]
): Record<string, Allowlist> => ({
  Items: { keys, synthetic },
  items: { keys, synthetic }
});
const INCIDENT_LIST_SYNTHETIC = { direccion: SYNTHETIC_ADDRESS };
const incidentType: Allowlist = {
  keys: ["codigo_tipo_incidente", "id_tipo_incidente", "tipo_incidente", "items"]
};
incidentType.lists = { items: incidentType };

const ALLOWLISTS: Record<SigaeEndpoint, Allowlist> = {
  ObtenerBoletaIncidente: {
    keys: [
      ...ENVELOPE,
      "Id_Boleta_Incidente",
      "Consecutivo",
      "Fecha",
      "Hora_Aviso",
      "Hora_Controlado",
      "Hora_Disponible",
      "Hora_Fuego_Bajo_Control",
      "Hora_Hospital",
      "Hora_Paciente",
      "Hora_Perdidas_Detenidas",
      "Hora_Todo_Claro",
      "Hora_Traslado",
      "Estado_Abierto",
      "DesUbicacion",
      "Direccion",
      "Id_Provincia",
      "Id_Canton",
      "Id_Distrito",
      "Provincia",
      "Canton",
      "Distrito",
      "CodigoTipoIncidenteDespacho",
      "CodigoTipoIncidenteReal",
      "NomtipoIncidenteDespacho",
      "NomTipoIncidenteReal",
      "Id_Etapa_Incidente",
      "DesEtapaIncidente",
      "Civiles_Heridos",
      "Civiles_Fallecidos",
      "Bomberos_Heridos",
      "Bomberos_Fallecidos"
    ],
    synthetic: { DesUbicacion: SYNTHETIC_LOCATION, Direccion: SYNTHETIC_ADDRESS }
  },
  ObtenerDetalleEmergencias: {
    keys: [
      ...ENVELOPE,
      "codigo_tipo_incidente",
      "codigo_tipo_incidente_despacho",
      "codigo_tipo_incidente_despacho_esp",
      "codigo_tipo_incidente_esp",
      "consecutivo_EE",
      "direccion",
      "fecha",
      "hora_incidente",
      "latitud",
      "longitud",
      "tipo_incidente",
      "tipo_incidente_despacho",
      "tipo_incidente_despacho_esp",
      "tipo_incidente_esp",
      "estaciones"
    ],
    synthetic: { direccion: SYNTHETIC_ADDRESS, ...SYNTHETIC_COORDINATES },
    lists: {
      estaciones: {
        keys: ["clave_estacion", "nombre", "vehiculos"],
        lists: { vehiculos: { keys: ["estado", "numero_interno"] } }
      }
    }
  },
  ObtenerEstacionesAtiendeIncidente: {
    keys: [...ENVELOPE, "Items", "items"],
    lists: itemsList(STATION_ATTENDING_ITEM)
  },
  ObtenerUnidadesDespachadasIncidente: {
    keys: [...ENVELOPE, "Items", "items"],
    lists: itemsList(DISPATCHED_UNIT_ITEM)
  },
  ObtenerListaUltimasEmergenciasApp: {
    keys: [...ENVELOPE, "items", "itemsFecha"],
    lists: {
      items: { keys: INCIDENT_LIST_ITEM, synthetic: INCIDENT_LIST_SYNTHETIC },
      itemsFecha: { keys: ["CantidadEmergencias", "Fecha"] }
    }
  },
  ObtenerListaEmergenciasApp: {
    keys: [...ENVELOPE, "items", "Items"],
    lists: itemsList(INCIDENT_LIST_ITEM, INCIDENT_LIST_SYNTHETIC)
  },
  ObtenerTiposIncidente: { keys: [...ENVELOPE, "items"], lists: { items: incidentType } },
  ObtenerProvinciaLista: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["CodigoProvincia", "IdProvincia", "Provincia"])
  },
  ObtenerCantonesLista: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["Canton", "CodigoCanton", "IdCanton", "IdProvincia"])
  },
  ObtenerDistritosLista: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["Codigo_Distrito", "Distrito", "Id_Canton", "Id_Distrito"])
  },
  ObtenerEstaciones: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["ClaveEstacion", "IdEstacion", "Nombre"])
  },
  ObtenerEstacionesOperativas: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["ClaveEstacion", "IdEstacion", "Nombre"])
  },
  ObtenerEstacionDetalle: {
    keys: [
      ...ENVELOPE,
      "CanalRadio",
      "ClaveEstacion",
      "Direccion",
      "Email",
      "Fax",
      "IdEstacion",
      "Latitud",
      "Longitud",
      "Nombre",
      "Telefono"
    ],
    synthetic: { Email: "estacion@example.test", Telefono: "0000-0000", Fax: "0000-0000" }
  },
  ObtenerVehiculosComboF5: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["IdVehiculo", "NumeroInterno"])
  },
  // Staff assignments (Asignado_a, Id_personal, Transferido_a, ...) and free text are dropped.
  ObtenerDatosVehiculo: {
    keys: [
      ...ENVELOPE,
      "Canton",
      "Capacidad",
      "Des_clase_vehiculo",
      "Des_estado_disponibilidad",
      "Des_estado_operativo",
      "Des_tipo_vehiculo",
      "Distrito",
      "Id_canton",
      "Id_clase_vehiculo",
      "Id_distrito",
      "Id_estacion",
      "Id_estado_disponibilidad",
      "Id_estado_operativo",
      "Id_provincia",
      "Id_tipo_vehiculo",
      "Id_vehiculo",
      "Numero_interno",
      "Placa",
      "Provincia"
    ]
  },
  ObtenerEstadoDisponibilidadUnidades: {
    keys: [...ENVELOPE, "Items"],
    lists: itemsList(["Descripcion", "IdGrupoClasificacion"])
  }
};

function redact(value: unknown, allowlist: Allowlist, trim: boolean): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of allowlist.keys) {
    if (!(key in value)) continue;
    const field = (value as Record<string, unknown>)[key];
    const nested = allowlist.lists?.[key];
    if (Array.isArray(field) && nested) {
      const items = trim ? field.slice(0, LIST_LIMIT) : field;
      out[key] = items.map((item) => redact(item, nested, trim));
    } else if (Array.isArray(field) || (typeof field === "object" && field !== null)) {
      // Unknown nested structure: not allowlisted, so not kept.
      continue;
    } else {
      const replacement = allowlist.synthetic?.[key];
      const filled =
        (typeof field === "string" && field !== "") || (typeof field === "number" && field !== 0);
      out[key] = replacement !== undefined && filled ? replacement : field;
    }
  }
  return out;
}

function save(
  name: string,
  endpoint: SigaeEndpoint,
  request: Record<string, unknown>,
  response: SigaeResponse<unknown>,
  options: { trim?: boolean } = {}
) {
  const fileName =
    response.kind === "upstream_error" && name === "ok" ? `codigo-${response.code}` : name;
  const file = join(FIXTURES, endpoint, `${fileName}.json`);
  mkdirSync(dirname(file), { recursive: true });
  const body = redact(response.raw, ALLOWLISTS[endpoint], options.trim ?? true);
  const fixture = { source: "recorded", endpoint, request, body };
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${endpoint}/${fileName}.json (${response.kind})`);
}

const summary: Record<string, Record<string, number>> = {};
function count(endpoint: string, outcome: string) {
  summary[endpoint] ??= {};
  summary[endpoint][outcome] = (summary[endpoint][outcome] ?? 0) + 1;
}

async function run<E extends SigaeEndpoint>(
  endpoint: E,
  result: SigaeResult<E>
): Promise<SigaeResponse<unknown> | undefined> {
  const outcome = await result;
  if (outcome.isErr()) {
    const error: SigaeError = outcome.error;
    count(endpoint, error.kind);
    const issues = error.issues?.map((i) => `${i.path}: ${i.message}`).join("; ") ?? "";
    console.error(`${endpoint}: ${error.kind} ${error.message} ${issues}`);
    return undefined;
  }
  const response = outcome.value as SigaeResponse<unknown>;
  count(endpoint, response.kind === "upstream_error" ? `codigo_${response.code}` : response.kind);
  return response;
}

async function main() {
  const reference: Array<[string, SigaeEndpoint, () => SigaeResult<SigaeEndpoint>]> = [
    ["ok", "ObtenerProvinciaLista", () => sigae.getProvinces()],
    ["ok", "ObtenerCantonesLista", () => sigae.getCantons()],
    ["ok", "ObtenerDistritosLista", () => sigae.getDistricts()],
    ["ok", "ObtenerEstaciones", () => sigae.getStations()],
    ["ok", "ObtenerEstacionesOperativas", () => sigae.getOperativeStations()],
    ["ok", "ObtenerVehiculosComboF5", () => sigae.getVehicles()],
    ["ok", "ObtenerEstadoDisponibilidadUnidades", () => sigae.getVehicleAvailabilityStates()],
    ["ok", "ObtenerTiposIncidente", () => sigae.getIncidentTypes()]
  ];
  const responses: Partial<Record<SigaeEndpoint, SigaeResponse<unknown>>> = {};
  for (const [name, endpoint, fn] of reference) {
    const response = await run(endpoint, fn());
    if (!response) continue;
    responses[endpoint] = response;
    save(name, endpoint, {}, response);
  }

  const stations = responses.ObtenerEstaciones;
  const firstStation =
    stations?.kind === "ok"
      ? (stations.data as { items: { IdEstacion: number }[] }).items[0]
      : null;
  if (firstStation) {
    const response = await run(
      "ObtenerEstacionDetalle",
      sigae.getStationDetails(firstStation.IdEstacion)
    );
    if (response) {
      save("ok", "ObtenerEstacionDetalle", { id_estacion: firstStation.IdEstacion }, response);
    }
  }

  const vehicles = responses.ObtenerVehiculosComboF5;
  if (vehicles?.kind === "ok") {
    const items = (vehicles.data as { items: { IdVehiculo: number }[] }).items;
    for (const [index, vehicle] of items.slice(0, 5).entries()) {
      const response = await run(
        "ObtenerDatosVehiculo",
        sigae.getVehicleDetails(vehicle.IdVehiculo)
      );
      if (response && index === 0) {
        save("ok", "ObtenerDatosVehiculo", { Id_Vehiculo: vehicle.IdVehiculo }, response);
      }
    }
  }

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const between = await run(
    "ObtenerListaEmergenciasApp",
    sigae.getIncidentsBetween({ from: yesterday, to: now })
  );
  if (between)
    save(
      "ok",
      "ObtenerListaEmergenciasApp",
      {
        FechaDesde: formatSigaeRequestDate(yesterday),
        FechaHasta: formatSigaeRequestDate(now)
      },
      between
    );

  const latest = await run(
    "ObtenerListaUltimasEmergenciasApp",
    sigae.getLatestIncidents({ count: 50 })
  );
  if (!latest || latest.kind !== "ok") throw new Error("Could not list latest incidents");
  save("ok", "ObtenerListaUltimasEmergenciasApp", { numero_registros: 50 }, latest);

  const ids = [
    ...(latest.data as { items: { idBoletaIncidente: number }[] }).items
      .slice(0, Number(args.incidents))
      .map((item) => item.idBoletaIncidente),
    1923918
  ];

  const saved = new Set<string>();
  for (const id of ids) {
    const [details, report, stationsAttending, units] = await Promise.all([
      run("ObtenerDetalleEmergencias", sigae.getIncidentDetails(id)),
      run("ObtenerBoletaIncidente", sigae.getIncidentReport(id)),
      run("ObtenerEstacionesAtiendeIncidente", sigae.getDispatchedStations(id)),
      run("ObtenerUnidadesDespachadasIncidente", sigae.getDispatchedUnits(id))
    ]);
    if (!details || !report || !stationsAttending || !units) continue;

    const unitCount = Array.isArray(units.raw.Items) ? units.raw.Items.length : 0;
    const isOpen = report.raw.Estado_Abierto === "true";
    let scenario: string | undefined;
    if (report.kind === "upstream_error") scenario = `report-${report.code}`;
    else if (report.kind === "ok" && unitCount > 0) scenario = isOpen ? "open" : "closed";
    if (!scenario || saved.has(scenario)) continue;
    saved.add(scenario);

    const request = { incidentId: id };
    save(scenario, "ObtenerDetalleEmergencias", request, details);
    save(scenario, "ObtenerBoletaIncidente", request, report);
    save(scenario, "ObtenerEstacionesAtiendeIncidente", request, stationsAttending, {
      trim: false
    });
    save(scenario, "ObtenerUnidadesDespachadasIncidente", request, units, { trim: false });
  }

  const nonexistent = 1;
  const notFound: Array<[SigaeEndpoint, () => SigaeResult<SigaeEndpoint>]> = [
    ["ObtenerDetalleEmergencias", () => sigae.getIncidentDetails(nonexistent)],
    ["ObtenerBoletaIncidente", () => sigae.getIncidentReport(nonexistent)],
    ["ObtenerEstacionesAtiendeIncidente", () => sigae.getDispatchedStations(nonexistent)],
    ["ObtenerUnidadesDespachadasIncidente", () => sigae.getDispatchedUnits(nonexistent)]
  ];
  for (const [endpoint, fn] of notFound) {
    const response = await run(endpoint, fn());
    if (response) save("not-found", endpoint, { incidentId: nonexistent }, response);
  }

  console.log(JSON.stringify(summary, null, 2));
  await sigae.close();
}

await main();
