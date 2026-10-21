import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** Every timestamp is an instant (`timestamptz`); the API returns them as UTC ISO strings. */
const timestamptz = () => timestamp({ withTimezone: true });

export const stations = pgTable("stations", {
  id: integer().primaryKey(),
  name: text().notNull(),
  stationKey: text().notNull(),
  radioChannel: text(),
  latitude: numeric().notNull(),
  longitude: numeric().notNull(),
  address: text(),
  phoneNumber: text(),
  fax: text(),
  email: text(),
  isOperative: boolean()
});

export const stationsRelations = relations(stations, ({ many }) => ({
  vehicles: many(vehicles),
  vehicleStationHistory: many(vehicleStationHistory),
  dispatchedStations: many(dispatchedStations),
  dispatchedVehicles: many(dispatchedVehicles)
}));

export const vehicles = pgTable("vehicles", {
  id: integer().primaryKey(),
  // Not unique: SIGAE moves internal numbers between vehicles, and the stored row of the old
  // holder keeps its number until the next reference sync (or forever, if it was retired).
  internalNumber: text().notNull(),
  plate: text().notNull(),
  stationId: integer()
    .notNull()
    .references(() => stations.id),
  descriptionType: text().notNull(),
  class: text().notNull(),
  descriptionOperationalStatus: text().notNull()
});

/**
 * Where each vehicle was assigned and in what operational state, over time (spec section
 * 5.2). `vehicles` only holds the current values. A row covers consecutive observations of
 * the same station and status: `firstSeenAt` is the first one (not the real assignment
 * date), `lastSeenAt` the latest. Rows are never updated otherwise, nor deleted.
 */
export const vehicleStationHistory = pgTable(
  "vehicle_station_history",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    vehicleId: integer()
      .notNull()
      .references(() => vehicles.id),
    stationId: integer()
      .notNull()
      .references(() => stations.id),
    /** `Des_estado_operativo`; `NULL` while SIGAE never gave one. */
    operationalStatus: text(),
    firstSeenAt: timestamptz().notNull(),
    lastSeenAt: timestamptz().notNull()
  },
  (table) => [
    index("vehicle_station_history_vehicle_last_seen_idx").on(table.vehicleId, table.lastSeenAt)
  ]
);

export const vehicleDisponibility = pgTable("vehicle_disponibility", {
  id: integer().primaryKey(),
  description: text().notNull()
});

export const dispatchedVehicles = pgTable("dispatched_vehicles", {
  id: integer().primaryKey(),
  vehicleId: integer().references(() => vehicles.id),
  incidentId: integer()
    .notNull()
    .references(() => incidents.id),
  stationId: integer()
    .notNull()
    .references(() => stations.id),
  /** Unit label from SIGAE, kept for units whose `vehicleId` is unknown. */
  vehicleInternalNumber: text(),
  /** `NULL` when SIGAE has no time yet (its `0001-01-01T00:00:00` placeholder). */
  dispatchedTime: timestamptz(),
  arrivalTime: timestamptz(),
  departureTime: timestamptz(),
  baseReturnTime: timestamptz(),
  attentionOnFoot: boolean().default(false)
});

export const dispatchedStations = pgTable("dispatched_stations", {
  id: integer().primaryKey(),
  stationId: integer()
    .notNull()
    .references(() => stations.id),
  incidentId: integer()
    .notNull()
    .references(() => incidents.id),
  serviceTypeId: integer(),
  attentionOnFoot: boolean().notNull()
});

export const incidentTypes = pgTable("incident_types", {
  id: integer("id").primaryKey(),
  incidentCode: text().notNull().unique(),
  name: text().notNull(),
  parentId: integer("parent_id").references((): AnyPgColumn => incidentTypes.id)
});

/** `observed`: first poll that saw it closed. `estimated`: already closed when first seen. */
export const CLOSED_AT_SOURCES = ["observed", "estimated"] as const;
export type ClosedAtSource = (typeof CLOSED_AT_SOURCES)[number];

export const incidents = pgTable(
  "incidents",
  {
    id: integer().primaryKey(),
    incidentCode: text().references(() => incidentTypes.incidentCode),
    specificIncidentCode: text().references(() => incidentTypes.incidentCode),
    dispatchIncidentCode: text().references(() => incidentTypes.incidentCode),
    specificDispatchIncidentCode: text().references(() => incidentTypes.incidentCode),
    EEConsecutive: text().notNull(),
    address: text().notNull(),
    responsibleStation: integer().references(() => stations.id),
    incidentTimestamp: timestamptz().notNull(),
    importantDetails: text().notNull(),
    latitude: numeric().notNull(),
    longitude: numeric().notNull(),
    /** SIGAE sends the coordinates as unknown: `latitude`/`longitude` are the last known ones. */
    coordinatesClearedUpstream: boolean().notNull().default(false),
    provinceId: integer().references(() => provinces.id),
    cantonId: integer().references(() => cantons.id),
    districtId: integer().references(() => districts.id),
    isOpen: boolean().notNull(),
    /** When SIGAE closed it; see `closedAtSource`. Cleared when it reopens. */
    closedAt: timestamptz(),
    closedAtSource: text({ enum: CLOSED_AT_SOURCES }),
    controlledAt: timestamptz(),
    fireUnderControlAt: timestamptz(),
    lossesStoppedAt: timestamptz(),
    allClearAt: timestamptz(),
    modifiedAt: timestamptz().notNull().defaultNow()
  },
  (table) => [
    index("incidents_latitude_idx").on(table.latitude),
    index("incidents_longitude_idx").on(table.longitude),
    index("incidents_latitude_longitude_idx").on(table.latitude, table.longitude)
  ]
);

export const provinces = pgTable("provinces", {
  id: integer().primaryKey(),
  name: text().notNull(),
  code: text().notNull()
});

export const cantons = pgTable("cantons", {
  id: integer().primaryKey(),
  name: text().notNull(),
  code: text().notNull(),
  provinceId: integer()
    .notNull()
    .references(() => provinces.id)
});

export const districts = pgTable("districts", {
  id: integer().primaryKey(),
  name: text().notNull(),
  code: text().notNull(),
  cantonId: integer()
    .notNull()
    .references(() => cantons.id)
});

export const SIGAE_INCIDENT_ENDPOINTS = [
  "ObtenerBoletaIncidente",
  "ObtenerDetalleEmergencias",
  "ObtenerEstacionesAtiendeIncidente",
  "ObtenerUnidadesDespachadasIncidente"
] as const;
export type SigaeIncidentEndpoint = (typeof SIGAE_INCIDENT_ENDPOINTS)[number];

/**
 * Redacted SIGAE responses for tracked incidents. A row is only added when the payload hash
 * differs from the latest one for the same incident and endpoint. `incidentId` is not a
 * foreign key: the history outlives the incident.
 */
export const sigaeSnapshots = pgTable(
  "sigae_snapshots",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    incidentId: integer().notNull(),
    endpoint: text({ enum: SIGAE_INCIDENT_ENDPOINTS }).notNull(),
    codigo: text(),
    fetchedAt: timestamptz().notNull(),
    payloadHash: text().notNull(),
    payload: jsonb().notNull()
  },
  (table) => [
    index("sigae_snapshots_incident_endpoint_fetched_idx").on(
      table.incidentId,
      table.endpoint,
      table.fetchedAt.desc()
    )
  ]
);

export const CHANGE_ENTITIES = ["incident", "dispatched_vehicle", "dispatched_station"] as const;
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];

export const CHANGE_KINDS = ["set", "changed", "cleared", "added", "removed"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Field-level changes to synced data. `field` is `*` for added and removed rows. */
export const incidentChanges = pgTable(
  "incident_changes",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    incidentId: integer().notNull(),
    entity: text({ enum: CHANGE_ENTITIES }).notNull(),
    entityId: integer().notNull(),
    field: text().notNull(),
    kind: text({ enum: CHANGE_KINDS }).notNull(),
    oldValue: jsonb(),
    newValue: jsonb(),
    snapshotIds: bigint({ mode: "number" }).array().notNull().default([]),
    detectedAt: timestamptz().notNull()
  },
  (table) => [
    index("incident_changes_incident_detected_idx").on(table.incidentId, table.detectedAt)
  ]
);

/** Judgments about upstream data (spec section 7). They never change what is stored. */
export const syncAnomalies = pgTable(
  "sync_anomalies",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    incidentId: integer().notNull(),
    entity: text({ enum: CHANGE_ENTITIES }).notNull(),
    entityId: integer(),
    code: text().notNull(),
    details: jsonb(),
    detectedAt: timestamptz().notNull()
  },
  (table) => [
    index("sync_anomalies_incident_idx").on(table.incidentId),
    index("sync_anomalies_code_detected_idx").on(table.code, table.detectedAt)
  ]
);

export const INCIDENT_SYNC_PHASES = ["active", "settling", "done", "deleted", "failed"] as const;
export type IncidentSyncPhase = (typeof INCIDENT_SYNC_PHASES)[number];

/**
 * One row per tracked incident: the source of truth for scheduling, so the queues can be
 * rebuilt from it. Not a foreign key, because the row is created before the incident is
 * stored and kept after it is deleted.
 */
export const incidentSyncState = pgTable(
  "incident_sync_state",
  {
    incidentId: integer().primaryKey(),
    phase: text({ enum: INCIDENT_SYNC_PHASES }).notNull(),
    nextPollAt: timestamptz(),
    lastPolledAt: timestamptz(),
    /** First poll that saw it closed upstream. */
    upstreamClosedAt: timestamptz(),
    consecutiveFailures: integer().notNull().default(0),
    /** Consecutive not-found polls. */
    notFoundCount: integer().notNull().default(0),
    /** Consecutive polls with zero units while the database has some. */
    emptyUnitsCount: integer().notNull().default(0),
    lastError: text(),
    firstSeenAt: timestamptz().notNull().defaultNow()
  },
  (table) => [index("incident_sync_state_phase_next_poll_idx").on(table.phase, table.nextPollAt)]
);

export const provincesRelations = relations(provinces, ({ many }) => ({
  cantons: many(cantons)
}));

export const cantonsRelations = relations(cantons, ({ one, many }) => ({
  districts: many(districts),
  province: one(provinces, {
    fields: [cantons.provinceId],
    references: [provinces.id]
  })
}));

export const districtsRelations = relations(districts, ({ one }) => ({
  canton: one(cantons, {
    fields: [districts.cantonId],
    references: [cantons.id]
  })
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  station: one(stations, {
    fields: [vehicles.stationId],
    references: [stations.id]
  }),
  dispatchedVehicles: many(dispatchedVehicles),
  stationHistory: many(vehicleStationHistory)
}));

export const vehicleStationHistoryRelations = relations(vehicleStationHistory, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleStationHistory.vehicleId],
    references: [vehicles.id]
  }),
  station: one(stations, {
    fields: [vehicleStationHistory.stationId],
    references: [stations.id]
  })
}));

export const vehicleDisponibilityRelations = relations(vehicleDisponibility, () => ({}));

export const dispatchedVehiclesRelations = relations(dispatchedVehicles, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [dispatchedVehicles.vehicleId],
    references: [vehicles.id]
  }),
  incident: one(incidents, {
    fields: [dispatchedVehicles.incidentId],
    references: [incidents.id]
  }),
  station: one(stations, {
    fields: [dispatchedVehicles.stationId],
    references: [stations.id]
  })
}));

export const dispatchedStationsRelations = relations(dispatchedStations, ({ one }) => ({
  station: one(stations, {
    fields: [dispatchedStations.stationId],
    references: [stations.id]
  }),
  incident: one(incidents, {
    fields: [dispatchedStations.incidentId],
    references: [incidents.id]
  })
}));

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  station: one(stations, {
    fields: [incidents.responsibleStation],
    references: [stations.id]
  }),
  dispatchedVehicles: many(dispatchedVehicles),
  dispatchedStations: many(dispatchedStations),
  /** No foreign key (see `incidentSyncState`); `NULL` for incidents sync-v2 never tracked. */
  syncState: one(incidentSyncState, {
    fields: [incidents.id],
    references: [incidentSyncState.incidentId]
  }),
  incidentType: one(incidentTypes, {
    fields: [incidents.incidentCode],
    references: [incidentTypes.incidentCode]
  }),
  dispatchIncidentType: one(incidentTypes, {
    fields: [incidents.dispatchIncidentCode],
    references: [incidentTypes.incidentCode]
  }),
  specificIncidentType: one(incidentTypes, {
    fields: [incidents.specificIncidentCode],
    references: [incidentTypes.incidentCode]
  }),
  specificDispatchIncidentType: one(incidentTypes, {
    fields: [incidents.specificDispatchIncidentCode],
    references: [incidentTypes.incidentCode]
  }),
  province: one(provinces, {
    fields: [incidents.provinceId],
    references: [provinces.id]
  }),
  canton: one(cantons, {
    fields: [incidents.cantonId],
    references: [cantons.id]
  }),
  district: one(districts, {
    fields: [incidents.districtId],
    references: [districts.id]
  })
}));

export const stationsInsertSchema = createInsertSchema(stations);
export const vehiclesInsertSchema = createInsertSchema(vehicles);
export const vehicleDisponibilityInsertSchema = createInsertSchema(vehicleDisponibility);
export const dispatchedVehiclesInsertSchema = createInsertSchema(dispatchedVehicles);
export const dispatchedStationsInsertSchema = createInsertSchema(dispatchedStations);
export const incidentTypesInsertSchema = createInsertSchema(incidentTypes);
export const incidentsInsertSchema = createInsertSchema(incidents);
export const provincesInsertSchema = createInsertSchema(provinces);
export const cantonsInsertSchema = createInsertSchema(cantons);
export const districtsInsertSchema = createInsertSchema(districts);

export type SigaeSnapshot = typeof sigaeSnapshots.$inferSelect;
export type SigaeSnapshotInsert = typeof sigaeSnapshots.$inferInsert;
export type IncidentChange = typeof incidentChanges.$inferSelect;
export type IncidentChangeInsert = typeof incidentChanges.$inferInsert;
export type SyncAnomaly = typeof syncAnomalies.$inferSelect;
export type SyncAnomalyInsert = typeof syncAnomalies.$inferInsert;
export type IncidentSyncState = typeof incidentSyncState.$inferSelect;
export type IncidentSyncStateInsert = typeof incidentSyncState.$inferInsert;
export type VehicleStationHistory = typeof vehicleStationHistory.$inferSelect;
