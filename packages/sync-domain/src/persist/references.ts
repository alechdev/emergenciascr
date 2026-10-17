import { type SQL, desc, eq, inArray, lt, sql } from "@bomberoscr/db/operators";
import {
  cantons,
  districts,
  incidentTypes,
  provinces,
  stations,
  vehicleStationHistory,
  vehicles
} from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";

import {
  type NewIncidentType,
  incidentTypeAncestors,
  nearestIncidentTypeAncestor
} from "../normalize/incident-types";
import {
  type VehicleAssignment,
  storedOperationalStatus,
  vehicleAssignmentWrite
} from "../reconcile/vehicle-assignment";

import type { KnownReferences, ReferenceIds } from "../reconcile/references";
import type { Executor } from "./executor";
import type {
  IncidentType as SigaeIncidentType,
  StationDetails,
  VehicleDetails
} from "@bomberoscr/sigae/client";

export interface KnownReferenceRows extends KnownReferences {
  /** The referenced incident type codes that exist, and those of their ancestors. */
  incidentTypes: ReadonlySet<string>;
  /** The ones whose types were created from incident data (negative IDs). */
  inferredIncidentTypes: ReadonlySet<string>;
}

/** Which of the referenced rows exist. */
export async function findKnownReferences(
  db: Executor,
  ids: ReferenceIds
): Promise<KnownReferenceRows> {
  const typeCodes = [
    ...new Set(ids.incidentTypes.flatMap((code) => [code, ...incidentTypeAncestors(code)]))
  ];
  const [stationRows, vehicleRows, typeRows, provinceRows, cantonRows, districtRows] =
    await Promise.all([
      ids.stations.length === 0
        ? []
        : db.select({ id: stations.id }).from(stations).where(inArray(stations.id, ids.stations)),
      ids.vehicles.length === 0
        ? []
        : db.select({ id: vehicles.id }).from(vehicles).where(inArray(vehicles.id, ids.vehicles)),
      typeCodes.length === 0
        ? []
        : db
            .select({ id: incidentTypes.id, code: incidentTypes.incidentCode })
            .from(incidentTypes)
            .where(inArray(incidentTypes.incidentCode, typeCodes)),
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
    inferredIncidentTypes: new Set(
      typeRows.filter((row) => isInferredIncidentType(row.id)).map((row) => row.code)
    ),
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

/**
 * Stores a vehicle and records its station and operational status in
 * `vehicle_station_history` (spec section 9), in one transaction. Its station must exist.
 *
 * The upsert locks the vehicle's row until the transaction ends (a new vehicle's insert waits
 * for a concurrent one to commit, then updates it), so writers of the same vehicle take turns
 * and the next one reads the history row the previous one wrote: two observations of one
 * change can't both start a new row.
 */
export async function upsertVehicleDetails(
  db: Executor,
  id: number,
  details: VehicleDetails,
  now: Date
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
  await db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(vehicles)
      .values({
        id,
        plate: "",
        class: "",
        descriptionType: "",
        descriptionOperationalStatus: "",
        ...update
      })
      .onConflictDoUpdate({ target: vehicles.id, set: update })
      .returning({
        stationId: vehicles.stationId,
        operationalStatus: vehicles.descriptionOperationalStatus
      });
    if (!stored) throw new Error(`vehicle ${id} upsert returned no row`);
    // The stored row, not the details: a `null` status from SIGAE kept the stored one.
    await recordVehicleAssignment(
      tx,
      id,
      {
        stationId: stored.stationId,
        operationalStatus: storedOperationalStatus(stored.operationalStatus)
      },
      now
    );
  });
}

/** Must run under the vehicle's row lock: see {@link upsertVehicleDetails}. */
async function recordVehicleAssignment(
  db: Executor,
  vehicleId: number,
  observed: VehicleAssignment,
  now: Date
): Promise<void> {
  const [latest] = await db
    .select({
      id: vehicleStationHistory.id,
      stationId: vehicleStationHistory.stationId,
      operationalStatus: vehicleStationHistory.operationalStatus
    })
    .from(vehicleStationHistory)
    .where(eq(vehicleStationHistory.vehicleId, vehicleId))
    .orderBy(desc(vehicleStationHistory.lastSeenAt), desc(vehicleStationHistory.id))
    .limit(1);
  const write = vehicleAssignmentWrite(latest ?? null, observed, now);
  if (write.kind === "bump") {
    // Never back: a writer with an older clock reading may come second.
    await db
      .update(vehicleStationHistory)
      .set({
        lastSeenAt: sql`greatest(${vehicleStationHistory.lastSeenAt}, ${write.lastSeenAt.toISOString()}::timestamptz)`
      })
      .where(eq(vehicleStationHistory.id, write.id));
    return;
  }
  await db.insert(vehicleStationHistory).values({ vehicleId, ...write.row });
}

/**
 * Stores SIGAE's incident type tree, in one transaction. A code that was created from
 * incident data takes SIGAE's ID and name: the row is kept, since incidents reference its
 * code, and its children are linked again afterwards. Returns how many types SIGAE listed.
 */
export async function upsertIncidentTypes(
  db: Executor,
  items: readonly SigaeIncidentType[]
): Promise<number> {
  const rows = flattenIncidentTypes(items);
  if (rows.length === 0) return 0;
  await db.transaction(async (tx) => {
    await lockInferredIncidentTypes(tx);
    const listed = new Map(rows.map((row) => [row.incidentCode, row.id]));
    const inferred = await tx
      .select({ id: incidentTypes.id, code: incidentTypes.incidentCode })
      .from(incidentTypes)
      .where(lt(incidentTypes.id, 0));
    const adopted = inferred.filter((row) => listed.has(row.code));
    if (adopted.length > 0) {
      // Only inferred types have inferred parents. Detached here, they are linked below.
      await tx
        .update(incidentTypes)
        .set({ parentId: null })
        .where(
          inArray(
            incidentTypes.parentId,
            adopted.map((row) => row.id)
          )
        );
      for (const row of adopted) {
        await tx
          .update(incidentTypes)
          .set({ id: listed.get(row.code) })
          .where(eq(incidentTypes.id, row.id));
      }
    }
    await tx
      .insert(incidentTypes)
      .values(rows)
      .onConflictDoUpdate({
        target: incidentTypes.id,
        set: conflictUpdateSetAllColumns(incidentTypes)
      });
    if (inferred.length > adopted.length) await linkInferredIncidentTypes(tx);
  });
  return rows.length;
}

/**
 * Creates incident types SIGAE's list lacks, from an incident's data, parents first. Each one
 * gets the next free negative ID (SIGAE's are positive) and the nearest existing ancestor as
 * its parent; a code that exists by then is left as it is. Run it in the transaction that
 * stores the incident: the lock it takes serializes creators until they commit, so two polls
 * creating the same code end with one row, and a new ID can't be taken twice.
 */
export async function insertInferredIncidentTypes(
  db: Executor,
  types: readonly NewIncidentType[]
): Promise<void> {
  if (types.length === 0) return;
  await lockInferredIncidentTypes(db);
  for (const type of types) {
    const ancestors = incidentTypeAncestors(type.code);
    const existing =
      ancestors.length === 0
        ? []
        : await db
            .select({ id: incidentTypes.id, code: incidentTypes.incidentCode })
            .from(incidentTypes)
            .where(inArray(incidentTypes.incidentCode, ancestors));
    const ids = new Map(existing.map((row) => [row.code, row.id]));
    const parent = nearestIncidentTypeAncestor(type.code, new Set(ids.keys()));
    await db
      .insert(incidentTypes)
      .values({
        id: sql`(select least(min(${incidentTypes.id}), 0) - 1 from ${incidentTypes})`,
        incidentCode: type.code,
        name: type.name,
        parentId: parent === null ? null : (ids.get(parent) ?? null)
      })
      .onConflictDoNothing({ target: incidentTypes.incidentCode });
  }
}

/** Types created from incident data have negative IDs; SIGAE's are positive. */
export function isInferredIncidentType(id: number): boolean {
  return id < 0;
}

// The incident locks use the two-key space with namespace 5302026.
const INFERRED_INCIDENT_TYPES_LOCK = [5_302_027, 1] as const;

/** Serializes creating inferred incident types and the type sync until the transaction ends. */
async function lockInferredIncidentTypes(tx: Executor): Promise<void> {
  const [namespace, key] = INFERRED_INCIDENT_TYPES_LOCK;
  await tx.execute(sql`select pg_advisory_xact_lock(${namespace}, ${key})`);
}

/** Points every inferred type at its nearest existing ancestor. */
async function linkInferredIncidentTypes(tx: Executor): Promise<void> {
  const all = await tx
    .select({
      id: incidentTypes.id,
      code: incidentTypes.incidentCode,
      parentId: incidentTypes.parentId
    })
    .from(incidentTypes);
  const ids = new Map(all.map((row) => [row.code, row.id]));
  const codes = new Set(ids.keys());
  for (const row of all) {
    if (!isInferredIncidentType(row.id)) continue;
    const parent = nearestIncidentTypeAncestor(row.code, codes);
    const parentId = parent === null ? null : (ids.get(parent) ?? null);
    if (parentId === row.parentId) continue;
    await tx.update(incidentTypes).set({ parentId }).where(eq(incidentTypes.id, row.id));
  }
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
