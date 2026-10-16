import { type SQL, inArray, sql } from "@bomberoscr/db/operators";
import {
  cantons,
  districts,
  incidentTypes,
  provinces,
  stations,
  vehicles
} from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";

import type { KnownReferences, ReferenceIds } from "../reconcile/references";
import type { Executor } from "./executor";
import type {
  IncidentType as SigaeIncidentType,
  StationDetails,
  VehicleDetails
} from "@bomberoscr/sigae/client";

export interface KnownReferenceRows extends KnownReferences {
  incidentTypes: ReadonlySet<string>;
}

/** Which of the referenced rows exist. */
export async function findKnownReferences(
  db: Executor,
  ids: ReferenceIds
): Promise<KnownReferenceRows> {
  const [stationRows, vehicleRows, typeRows, provinceRows, cantonRows, districtRows] =
    await Promise.all([
      ids.stations.length === 0
        ? []
        : db.select({ id: stations.id }).from(stations).where(inArray(stations.id, ids.stations)),
      ids.vehicles.length === 0
        ? []
        : db.select({ id: vehicles.id }).from(vehicles).where(inArray(vehicles.id, ids.vehicles)),
      ids.incidentTypes.length === 0
        ? []
        : db
            .select({ code: incidentTypes.incidentCode })
            .from(incidentTypes)
            .where(inArray(incidentTypes.incidentCode, ids.incidentTypes)),
      ids.provinces.length === 0
        ? []
        : db
            .select({ id: provinces.id })
            .from(provinces)
            .where(inArray(provinces.id, ids.provinces)),
      ids.cantons.length === 0
        ? []
        : db.select({ id: cantons.id }).from(cantons).where(inArray(cantons.id, ids.cantons)),
      ids.districts.length === 0
        ? []
        : db
            .select({ id: districts.id })
            .from(districts)
            .where(inArray(districts.id, ids.districts))
    ]);
  return {
    stations: new Set(stationRows.map((row) => row.id)),
    vehicles: new Set(vehicleRows.map((row) => row.id)),
    incidentTypes: new Set(typeRows.map((row) => row.code)),
    provinces: new Set(provinceRows.map((row) => row.id)),
    cantons: new Set(cantonRows.map((row) => row.id)),
    districts: new Set(districtRows.map((row) => row.id))
  };
}

/** What the station list says about a station. */
export interface ListedStation {
  id: number;
  name: string;
  stationKey: string;
  isOperative: boolean;
}

/**
 * Stores a station from its details. Values the details lack keep what is stored; `listed`
 * fills them for a new row (without it, an unknown operative state stays `NULL`, and the
 * name and key are `""` until the reference job runs). An empty name or key never replaces
 * a stored one: the reference job may have inserted the row meanwhile.
 */
export async function upsertStationDetails(
  db: Executor,
  id: number,
  details: StationDetails,
  listed?: Omit<ListedStation, "id">
): Promise<void> {
  const row = {
    id,
    name: details.Nombre ?? listed?.name ?? "",
    stationKey: details.ClaveEstacion ?? listed?.stationKey ?? "",
    radioChannel: details.CanalRadio,
    latitude: details.Latitud.toString(),
    longitude: details.Longitud.toString(),
    address: details.Direccion,
    phoneNumber: details.Telefono,
    fax: details.Fax,
    email: details.Email,
    isOperative: listed?.isOperative ?? null
  };
  await db
    .insert(stations)
    .values(row)
    .onConflictDoUpdate({
      target: stations.id,
      set: {
        ...conflictUpdateSetAllColumns(stations),
        name: keepUnlessEmpty(stations.name),
        stationKey: keepUnlessEmpty(stations.stationKey)
      }
    });
}

/** `ON CONFLICT DO UPDATE` value: the proposed one, unless it is `NULL` or `""`. */
function keepUnlessEmpty(column: typeof stations.name | typeof stations.stationKey): SQL {
  return sql`coalesce(nullif(excluded.${sql.identifier(column.name)}, ''), ${column})`;
}

/**
 * Some listed stations have no details (`03`). Incidents can still reference them, so the
 * row is kept with what the list says, and details stored earlier are left as they are.
 */
export async function upsertListedStation(db: Executor, station: ListedStation): Promise<void> {
  await db
    .insert(stations)
    .values({
      id: station.id,
      name: station.name,
      stationKey: station.stationKey,
      latitude: "0",
      longitude: "0",
      isOperative: station.isOperative
    })
    .onConflictDoUpdate({
      target: stations.id,
      set: {
        name: station.name,
        stationKey: station.stationKey,
        isOperative: station.isOperative
      }
    });
}

/** Stores a vehicle. Its station must exist. */
export async function upsertVehicleDetails(
  db: Executor,
  id: number,
  details: VehicleDetails
): Promise<void> {
  // A `null` from SIGAE keeps the stored value; `""` only fills the column for a new vehicle.
  const nullable = {
    plate: details.Placa,
    class: details.Des_clase_vehiculo,
    descriptionType: details.Des_tipo_vehiculo,
    descriptionOperationalStatus: details.Des_estado_operativo
  };
  const known = Object.fromEntries(
    Object.entries(nullable).filter(([, value]) => value !== null)
  ) as Partial<Record<keyof typeof nullable, string>>;
  const update = {
    internalNumber: details.Numero_interno,
    stationId: details.Id_estacion,
    ...known
  };
  await db
    .insert(vehicles)
    .values({
      id,
      plate: "",
      class: "",
      descriptionType: "",
      descriptionOperationalStatus: "",
      ...update
    })
    .onConflictDoUpdate({ target: vehicles.id, set: update });
}

/** Stores the incident type tree. Returns how many types it has. */
export async function upsertIncidentTypes(
  db: Executor,
  items: readonly SigaeIncidentType[]
): Promise<number> {
  const rows = flattenIncidentTypes(items);
  if (rows.length === 0) return 0;
  await db
    .insert(incidentTypes)
    .values(rows)
    .onConflictDoUpdate({
      target: incidentTypes.id,
      set: conflictUpdateSetAllColumns(incidentTypes)
    });
  return rows.length;
}

type IncidentTypeRow = typeof incidentTypes.$inferInsert;

/** Parents come before their children, so the self-reference holds within one insert. */
function flattenIncidentTypes(
  items: readonly SigaeIncidentType[],
  parentId?: number
): IncidentTypeRow[] {
  const result: IncidentTypeRow[] = [];
  for (const item of items) {
    result.push({
      id: item.id_tipo_incidente,
      incidentCode: item.codigo_tipo_incidente,
      name: item.tipo_incidente,
      parentId: parentId ?? null
    });
    if (item.items && item.items.length > 0) {
      result.push(...flattenIncidentTypes(item.items, item.id_tipo_incidente));
    }
  }
  return result;
}
