import { type Database, db } from "@bomberoscr/db/index";
import {
  cantons,
  dispatchedStations,
  dispatchedVehicles,
  districts,
  incidents,
  incidentTypes,
  provinces,
  stations as stationsTable
} from "@bomberoscr/db/schema";
import { type SQL, and, between, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// Create aliases for the incident_types table since we join it multiple times
const dispatchIncidentTypes = alias(incidentTypes, "dispatch_incident_types");
const specificDispatchIncidentTypes = alias(incidentTypes, "specific_dispatch_incident_types");
const actualIncidentTypes = alias(incidentTypes, "actual_incident_types");
const specificActualIncidentTypes = alias(incidentTypes, "specific_actual_incident_types");
export type GetIncidentsParams = {
  pageSize: number;
  cursor?: number | null;
  sort: string[];
  q?: string | null;
  start?: Date | null;
  end?: Date | null;
  stations?: number[] | null;
  ids?: number[] | null;
  types?: string[] | null;
  open?: boolean | null;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
};

export async function getIncidents(params: GetIncidentsParams) {
  const { pageSize, cursor, sort, q, start, end, stations, ids, types, open, bounds } = params;

  const whereConditions: SQL[] = [];

  if (ids && ids.length > 0) {
    whereConditions.push(inArray(incidents.id, ids));
  }

  if (stations && stations.length > 0) {
    // Find incidents where the station is either responsible OR was dispatched
    const dispatchedToStation = db
      .select({ incidentId: dispatchedStations.incidentId })
      .from(dispatchedStations)
      .where(inArray(dispatchedStations.stationId, stations));

    const stationsCondition = or(
      inArray(incidents.responsibleStation, stations),
      inArray(incidents.id, dispatchedToStation)
    );
    if (stationsCondition) {
      whereConditions.push(stationsCondition);
    }
  }

  if (types && types.length > 0) {
    const typesCondition = or(
      inArray(incidents.incidentCode, types),
      inArray(incidents.specificIncidentCode, types)
    );
    if (typesCondition) {
      whereConditions.push(typesCondition);
    }
  }

  if (typeof open === "boolean") {
    whereConditions.push(eq(incidents.isOpen, open));
  }

  if (start && end) {
    whereConditions.push(between(incidents.incidentTimestamp, start, end));
  } else if (start) {
    whereConditions.push(gte(incidents.incidentTimestamp, start));
  } else if (end) {
    whereConditions.push(lte(incidents.incidentTimestamp, end));
  }

  if (q) {
    const searchCondition = or(
      ilike(incidents.importantDetails, `%${q}%`),
      ilike(incidents.EEConsecutive, `%${q}%`),
      ilike(incidents.address, `%${q}%`)
    );
    if (searchCondition) {
      whereConditions.push(searchCondition);
    }
  }

  const vehicleCounts = db
    .select({
      incidentId: dispatchedVehicles.incidentId,
      vehicleCount: sql<number>`count(*)::int`.as("vehicle_count")
    })
    .from(dispatchedVehicles)
    .groupBy(dispatchedVehicles.incidentId)
    .as("vehicle_counts");

  const stationCounts = db
    .select({
      incidentId: dispatchedStations.incidentId,
      stationCount: sql<number>`count(*)::int`.as("station_count")
    })
    .from(dispatchedStations)
    .groupBy(dispatchedStations.incidentId)
    .as("station_counts");

  const effectiveLatitude = sql<number>`
    CASE
      WHEN ${incidents.latitude}::double precision = 0 OR ${incidents.longitude}::double precision = 0
        THEN COALESCE(
          ${stationsTable.latitude}::double precision,
          0
        )
      ELSE ${incidents.latitude}::double precision
    END
  `;

  const effectiveLongitude = sql<number>`
    CASE
      WHEN ${incidents.latitude}::double precision = 0 OR ${incidents.longitude}::double precision = 0
        THEN COALESCE(
          ${stationsTable.longitude}::double precision,
          0
        )
      ELSE ${incidents.longitude}::double precision
    END
  `;

  if (bounds) {
    whereConditions.push(sql`
      ${effectiveLatitude} >= ${bounds.south}
      AND ${effectiveLatitude} <= ${bounds.north}
      AND ${effectiveLongitude} >= ${bounds.west}
      AND ${effectiveLongitude} <= ${bounds.east}
    `);
  }

  const query = db
    .select({
      id: incidents.id,
      isOpen: incidents.isOpen,
      EEConsecutive: incidents.EEConsecutive,
      address: incidents.address,
      incidentTimestamp: incidents.incidentTimestamp,
      closedAt: incidents.closedAt,
      closedAtSource: incidents.closedAtSource,
      modifiedAt: incidents.modifiedAt,
      importantDetails: incidents.importantDetails,
      latitude: incidents.latitude,
      longitude: incidents.longitude,
      responsibleStation: stationsTable.name,
      responsibleStationLatitude: stationsTable.latitude,
      responsibleStationLongitude: stationsTable.longitude,
      dispatchIncidentType: dispatchIncidentTypes.name,
      dispatchIncidentCode: incidents.dispatchIncidentCode,
      specificDispatchIncidentType: specificDispatchIncidentTypes.name,
      specificDispatchIncidentCode: incidents.specificDispatchIncidentCode,
      incidentType: actualIncidentTypes.name,
      incidentTypeCode: incidents.incidentCode,
      specificIncidentType: specificActualIncidentTypes.name,
      specificIncidentTypeCode: incidents.specificIncidentCode,
      districtName: districts.name,
      cantonName: cantons.name,
      provinceName: provinces.name,
      dispatchedVehiclesCount: sql<number>`COALESCE(${vehicleCounts.vehicleCount}, 0)`.as(
        "dispatched_vehicles_count"
      ),
      dispatchedStationsCount: sql<number>`COALESCE(${stationCounts.stationCount}, 0)`.as(
        "dispatched_stations_count"
      ),
      totalDispatched:
        sql<number>`COALESCE(${vehicleCounts.vehicleCount}, 0) + COALESCE(${stationCounts.stationCount}, 0)`.as(
          "total_dispatched"
        )
    })
    .from(incidents)
    .leftJoin(stationsTable, eq(incidents.responsibleStation, stationsTable.id))
    .leftJoin(
      dispatchIncidentTypes,
      eq(incidents.dispatchIncidentCode, dispatchIncidentTypes.incidentCode)
    )
    .leftJoin(
      specificDispatchIncidentTypes,
      eq(incidents.specificDispatchIncidentCode, specificDispatchIncidentTypes.incidentCode)
    )
    .leftJoin(actualIncidentTypes, eq(incidents.incidentCode, actualIncidentTypes.incidentCode))
    .leftJoin(
      specificActualIncidentTypes,
      eq(incidents.specificIncidentCode, specificActualIncidentTypes.incidentCode)
    )
    .leftJoin(vehicleCounts, eq(incidents.id, vehicleCounts.incidentId))
    .leftJoin(stationCounts, eq(incidents.id, stationCounts.incidentId))
    .leftJoin(districts, eq(incidents.districtId, districts.id))
    .leftJoin(cantons, eq(incidents.cantonId, cantons.id))
    .leftJoin(provinces, eq(incidents.provinceId, provinces.id))
    .where(and(...whereConditions));

  if (sort?.length === 2) {
    const [column, direction] = sort as [string, string];
    const dir = direction === "asc" ? "ASC" : "DESC";

    const sortMap: Record<string, string> = {
      incidentTimestamp: '"incidentTimestamp"',
      modifiedAt: '"modifiedAt"',
      EEConsecutive: '"EEConsecutive"',
      isOpen: '"isOpen"',
      dispatchedVehiclesCount: "dispatched_vehicles_count",
      dispatchedStationsCount: "dispatched_stations_count",
      totalDispatched: "total_dispatched"
    };

    const col = sortMap[column] ?? "id";
    query.orderBy(sql.raw(`${col} ${dir}`));
  }

  // Apply pagination
  const offset = cursor ? cursor : 0;
  query.limit(pageSize).offset(offset);

  // Execute query
  const data = await query;

  // Calculate next cursor
  const nextCursor = data && data.length === pageSize ? offset + pageSize : undefined;

  return {
    meta: {
      cursor: nextCursor ?? null,
      hasPreviousPage: offset > 0,
      hasNextPage: data && data.length === pageSize
    },
    data
  };
}

export async function getIncidentById({ id }: { id: number }, database: Database = db) {
  return await database.query.incidents.findFirst({
    where: eq(incidents.id, id),
    columns: {
      id: true,
      isOpen: true,
      EEConsecutive: true,
      address: true,
      incidentTimestamp: true,
      closedAt: true,
      closedAtSource: true,
      modifiedAt: true,
      importantDetails: true,
      latitude: true,
      longitude: true,
      coordinatesClearedUpstream: true,
      dispatchIncidentCode: true,
      specificDispatchIncidentCode: true,
      incidentCode: true,
      specificIncidentCode: true,
      responsibleStation: true,
      cantonId: true
    },
    with: {
      station: {
        columns: {
          id: true,
          name: true,
          latitude: true,
          longitude: true
        }
      },
      district: {
        columns: {
          name: true
        }
      },
      canton: {
        columns: {
          name: true
        }
      },
      province: {
        columns: {
          name: true
        }
      },
      dispatchIncidentType: {
        columns: {
          name: true
        }
      },
      specificDispatchIncidentType: {
        columns: {
          name: true
        }
      },
      incidentType: {
        columns: {
          name: true
        }
      },
      specificIncidentType: {
        columns: {
          name: true
        }
      },
      dispatchedStations: {
        columns: {
          serviceTypeId: true
        },
        with: {
          station: {
            columns: {
              id: true,
              name: true,
              stationKey: true,
              isOperative: true,
              latitude: true,
              longitude: true
            }
          }
        }
      },
      syncState: {
        columns: {
          phase: true
        }
      },
      dispatchedVehicles: {
        columns: {
          id: true,
          stationId: true,
          vehicleInternalNumber: true,
          dispatchedTime: true,
          arrivalTime: true,
          departureTime: true,
          baseReturnTime: true
        },
        with: {
          vehicle: {
            columns: {
              internalNumber: true,
              plate: true,
              descriptionType: true
            }
          },
          station: {
            columns: {
              id: true,
              name: true,
              isOperative: true
            }
          }
        }
      }
    }
  });
}

export async function getIncidentTimelineData({ id }: { id: number }) {
  return await db.query.incidents.findFirst({
    where: eq(incidents.id, id),
    columns: {
      id: true,
      incidentTimestamp: true,
      isOpen: true,
      closedAt: true,
      modifiedAt: true
    },
    with: {
      dispatchedVehicles: {
        columns: {
          vehicleInternalNumber: true,
          dispatchedTime: true,
          arrivalTime: true,
          departureTime: true
        },
        with: {
          vehicle: {
            columns: {
              internalNumber: true
            }
          },
          station: {
            columns: {
              name: true
            }
          }
        }
      }
    }
  });
}

export async function getIncidentResponseTimesData({ id }: { id: number }) {
  return await db.query.incidents.findFirst({
    where: eq(incidents.id, id),
    columns: {
      id: true,
      isOpen: true
    },
    with: {
      syncState: {
        columns: {
          phase: true
        }
      },
      dispatchedVehicles: {
        columns: {
          id: true,
          vehicleInternalNumber: true,
          dispatchedTime: true,
          arrivalTime: true,
          departureTime: true,
          baseReturnTime: true
        },
        with: {
          vehicle: {
            columns: {
              internalNumber: true
            }
          },
          station: {
            columns: {
              name: true
            }
          }
        }
      }
    }
  });
}

export async function getIncidentOgImageData({ id }: { id: number }) {
  return await db.query.incidents.findFirst({
    where: eq(incidents.id, id),
    with: {
      canton: true,
      district: true,
      province: true,
      dispatchedStations: {
        columns: {
          id: true,
          attentionOnFoot: true,
          serviceTypeId: true
        },
        with: {
          station: {
            columns: {
              id: true,
              name: true,
              stationKey: true,
              address: true,
              latitude: true,
              longitude: true
            }
          }
        }
      },
      dispatchedVehicles: {
        columns: {
          incidentId: false,
          stationId: false,
          vehicleId: false
        },
        with: {
          vehicle: {
            columns: {
              id: true,
              internalNumber: true,
              class: true
            }
          },
          station: {
            columns: {
              name: true
            }
          }
        }
      },
      dispatchIncidentType: {
        columns: {
          name: true
        }
      },
      specificDispatchIncidentType: {
        columns: {
          name: true
        }
      },
      incidentType: {
        columns: {
          name: true
        }
      },
      specificIncidentType: {
        columns: {
          name: true
        }
      }
    }
  });
}

export async function getIncidentCoordinatesById({ id }: { id: number }) {
  return await db.query.incidents.findFirst({
    where: eq(incidents.id, id),
    columns: {
      id: true,
      latitude: true,
      longitude: true
    }
  });
}

export async function getExistingIncidentIds(ids: number[]) {
  if (ids.length === 0) return [] as number[];
  const rows = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(inArray(incidents.id, ids));
  return rows.map((r) => r.id);
}

// Type exports
export type DetailedIncident = NonNullable<Awaited<ReturnType<typeof getIncidentOgImageData>>>;
