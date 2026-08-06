import { stringBoolean } from "@api/lib/zod-utils";
import { z } from "@hono/zod-openapi";

export const stationsListRequest = z.object({
  limit: z.coerce
    .number()
    .min(1)
    .max(100)
    .default(20)
    .openapi({
      description: "Number of stations to return per page.",
      param: { in: "query" },
      example: 3
    }),
  page: z.coerce
    .number()
    .min(1)
    .default(1)
    .openapi({
      description: "Page number for pagination.",
      param: { in: "query" },
      example: 1
    }),
  sort: z
    .array(z.string().min(1))
    .max(2)
    .min(2)
    .nullable()
    .optional()
    .openapi({
      description: "Sorting order as a tuple: [field, direction].",
      param: { in: "query" },
      example: ["stationKey", "asc"]
    }),
  q: z
    .string()
    .trim()
    .optional()
    .openapi({
      description: "Search by station name or key.",
      param: { in: "query" },
      example: "ACOSTA"
    }),
  operative: stringBoolean.optional().openapi({
    description: "Filter by operative status.",
    param: { in: "query" },
    example: true
  }),
  bounds: z
    .object({
      north: z.coerce.number(),
      south: z.coerce.number(),
      east: z.coerce.number(),
      west: z.coerce.number()
    })
    .nullable()
    .optional()
    .openapi({
      description: "Bounding box for filtering stations by location.",
      param: { in: "query" },
      example: {
        north: 9.9715,
        south: 9.8986,
        east: -84.0356,
        west: -84.1559
      }
    })
});

export const stationByNameRequest = z.object({
  name: z.string().openapi({
    param: { name: "name", in: "path", required: true },
    description: "Station name.",
    example: "ACOSTA"
  })
});

const stationImageUrlSchema = z.string().url().openapi({
  description: "Station image URL.",
  example: "https://api.example.com/stations/ACOSTA/image"
});

export const stationSchema = z.object({
  id: z.number().openapi({
    description: "Station ID.",
    example: 53
  }),
  name: z.string().openapi({
    description: "Station name.",
    example: "ACOSTA"
  }),
  stationKey: z.string().openapi({
    description: "Station key.",
    example: "1-11"
  }),
  radioChannel: z.string().nullable().openapi({
    description: "Radio channel designation.",
    example: "05 Abejonal"
  }),
  latitude: z.string().openapi({
    description: "Station latitude.",
    example: "9.79495174363123"
  }),
  longitude: z.string().openapi({
    description: "Station longitude.",
    example: "-84.1638760142178"
  }),
  address: z.string().nullable().openapi({
    description: "Station address.",
    example:
      "SAN JOSE, ACOSTA, SAN IGNACIO, 50 METROS OESTE DE LA ESTACIÓN DE SEVICIO COOPECARAIGRES"
  }),
  phoneNumber: z.string().nullable().openapi({
    description: "Station phone number.",
    example: "2410-1415"
  }),
  fax: z.string().nullable().openapi({
    description: "Station fax number.",
    example: "2410-1415"
  }),
  email: z.string().nullable().openapi({
    description: "Station email.",
    example: "acosta@bomberos.go.cr"
  }),
  isOperative: z.boolean().nullable().openapi({
    description: "Whether the station is operative.",
    example: true
  }),
  imageUrl: stationImageUrlSchema
});

export const stationsListMetaSchema = z.object({
  page: z.number().openapi({
    description: "Current page number.",
    example: 1
  }),
  limit: z.number().openapi({
    description: "Items per page.",
    example: 3
  }),
  total: z.number().openapi({
    description: "Total number of stations.",
    example: 152
  }),
  totalPages: z.number().openapi({
    description: "Total number of pages.",
    example: 51
  }),
  hasNextPage: z.boolean().openapi({
    description: "Whether a next page exists.",
    example: true
  }),
  hasPreviousPage: z.boolean().openapi({
    description: "Whether a previous page exists.",
    example: false
  })
});

export const stationsListResponse = z
  .object({
    data: z.array(stationSchema),
    meta: stationsListMetaSchema
  })
  .openapi({
    example: {
      data: [
        {
          id: 106,
          name: "ACADEMIA NACIONAL DE BOMBEROS",
          stationKey: "ANB",
          radioChannel: null,
          latitude: "9.89637844233335",
          longitude: "-84.0443111892689",
          address: "SAN JOSE, DESAMPARADOS, DAMAS, FRENTE AL CENTRO DE RECREO DEL INS.",
          phoneNumber: null,
          fax: null,
          email: null,
          isOperative: false,
          imageUrl: "https://api.example.com/stations/ACADEMIA%20NACIONAL%20DE%20BOMBEROS/image"
        },
        {
          id: 53,
          name: "ACOSTA",
          stationKey: "1-11",
          radioChannel: "05 Abejonal",
          latitude: "9.79495174363123",
          longitude: "-84.1638760142178",
          address:
            "SAN JOSE, ACOSTA, SAN IGNACIO, 50 METROS OESTE DE LA ESTACIÓN DE SEVICIO COOPECARAIGRES",
          phoneNumber: "2410-1415",
          fax: "2410-1415",
          email: "acosta@bomberos.go.cr",
          isOperative: true,
          imageUrl: "https://api.example.com/stations/ACOSTA/image"
        }
      ],
      meta: {
        page: 1,
        limit: 3,
        total: 152,
        totalPages: 51,
        hasNextPage: true,
        hasPreviousPage: false
      }
    }
  });

export const stationByNameResponse = z
  .object({
    station: stationSchema
  })
  .openapi({
    example: {
      station: {
        id: 53,
        name: "ACOSTA",
        stationKey: "1-11",
        radioChannel: "05 Abejonal",
        latitude: "9.79495174363123",
        longitude: "-84.1638760142178",
        address:
          "SAN JOSE, ACOSTA, SAN IGNACIO, 50 METROS OESTE DE LA ESTACIÓN DE SEVICIO COOPECARAIGRES",
        phoneNumber: "2410-1415",
        fax: "2410-1415",
        email: "acosta@bomberos.go.cr",
        isOperative: true,
        imageUrl: "https://api.example.com/stations/ACOSTA/image"
      }
    }
  });

export const stationImageTokenSchema = z.object({
  token: z.string().openapi({
    description: "Token required to access the original image.",
    example: "your-token"
  })
});

export const stationHighlightedIncidentSchema = z.object({
  id: z.number().openapi({
    description: "Incident ID.",
    example: 1558658
  }),
  incidentTimestamp: z.string().openapi({
    description: "Incident timestamp.",
    example: "2026-01-19T22:55:04.000Z"
  }),
  details: z.string().nullable().openapi({
    description: "Incident details.",
    example: "QUEMA DE CHARRAL"
  }),
  address: z.string().nullable().openapi({
    description: "Incident address.",
    example:
      "SAN JOSE LEON CORTES SAN ANDRES DEL ANTIGUO BENEFICIO 75 METROS SUR HACIA PEDREGOSO EN LA SIEMBRA DE AGUACATE"
  }),
  responsibleStation: z.string().nullable().openapi({
    description: "Responsible station name.",
    example: "ACOSTA"
  }),
  latitude: z.string().openapi({
    description: "Incident latitude.",
    example: "9.73357675239847"
  }),
  longitude: z.string().openapi({
    description: "Incident longitude.",
    example: "-84.0765451393084"
  }),
  mapImageUrl: z.string().url().nullable().openapi({
    description: "URL to the incident's map image.",
    example: "https://api.example.com/incidents/1558658/map"
  }),
  dispatchedVehiclesCount: z.number().openapi({
    description: "Number of dispatched vehicles.",
    example: 3
  }),
  dispatchedStationsCount: z.number().openapi({
    description: "Number of dispatched stations.",
    example: 2
  })
});

export const stationHighlightedIncidentsResponseSchema = z
  .object({
    incidents: z.array(stationHighlightedIncidentSchema)
  })
  .openapi({
    example: {
      incidents: [
        {
          id: 1558658,
          incidentTimestamp: "2026-01-19T22:55:04.000Z",
          details: "QUEMA DE CHARRAL",
          address:
            "SAN JOSE LEON CORTES SAN ANDRES DEL ANTIGUO BENEFICIO 75 METROS SUR HACIA PEDREGOSO EN LA SIEMBRA DE AGUACATE",
          responsibleStation: "ACOSTA",
          latitude: "9.73357675239847",
          longitude: "-84.0765451393084",
          mapImageUrl: "https://api.example.com/incidents/1558658/map",
          dispatchedVehiclesCount: 3,
          dispatchedStationsCount: 2
        },
        {
          id: 1580178,
          incidentTimestamp: "2026-01-28T03:59:00.000Z",
          details: "ESTACION DE ACOSTA REPORTA QUEMA DE CHARRAL",
          address: "SAN JOSE ASERRI VUELTA DE JORCO DEL CEMENTERIO 800 SUR CAMINO MONTE REDONDO",
          responsibleStation: "ACOSTA",
          latitude: "0",
          longitude: "0",
          mapImageUrl: null,
          dispatchedVehiclesCount: 3,
          dispatchedStationsCount: 1
        }
      ]
    }
  });

export const stationHeatmapDataPointSchema = z.object({
  date: z.string().openapi({
    description: "Day in YYYY-MM-DD format.",
    example: "2026-01-16"
  }),
  count: z.number().openapi({
    description: "Number of incidents on that day.",
    example: 4
  })
});

export const stationHeatmapResponseSchema = z
  .object({
    data: z.array(stationHeatmapDataPointSchema),
    totalIncidents: z.number().openapi({
      description: "Total incidents in the requested range.",
      example: 38
    })
  })
  .openapi({
    example: {
      data: [
        { date: "2025-12-30", count: 1 },
        { date: "2025-12-31", count: 3 },
        { date: "2026-01-01", count: 3 }
      ],
      totalIncidents: 38
    }
  });

export const stationCollaborationSchema = z.object({
  id: z.number().openapi({
    description: "Station ID.",
    example: 46
  }),
  name: z.string().openapi({
    description: "Station name.",
    example: "DESAMPARADOS"
  }),
  stationKey: z.string().openapi({
    description: "Station key.",
    example: "1-4"
  }),
  imageUrl: stationImageUrlSchema.openapi({
    description: "Station image URL."
  }),
  collaborationCount: z.number().openapi({
    description: "Number of collaborations with the station.",
    example: 19
  })
});

export const stationCollaborationsResponseSchema = z
  .object({
    collaborations: z.array(stationCollaborationSchema)
  })
  .openapi({
    example: {
      collaborations: [
        {
          id: 46,
          name: "DESAMPARADOS",
          stationKey: "1-4",
          imageUrl: "https://api.example.com/stations/DESAMPARADOS/image",
          collaborationCount: 19
        },
        {
          id: 48,
          name: "PURISCAL",
          stationKey: "1-6",
          imageUrl: "https://api.example.com/stations/PURISCAL/image",
          collaborationCount: 3
        }
      ]
    }
  });

export const stationVehicleStatsSchema = z.object({
  incidentCount: z.number().openapi({
    description: "Number of incidents the vehicle was dispatched to.",
    example: 142
  }),
  avgResponseTimeSeconds: z.number().nullable().openapi({
    description: "Average response time in seconds.",
    example: 1700
  })
});

export const stationVehicleSchema = z.object({
  id: z.number().openapi({
    description: "Vehicle ID.",
    example: 774
  }),
  internalNumber: z.string().nullable().openapi({
    description: "Vehicle internal number.",
    example: "M-107"
  }),
  plate: z.string().nullable().openapi({
    description: "Vehicle plate number.",
    example: "341-331"
  }),
  descriptionType: z.string().nullable().openapi({
    description: "Vehicle type description.",
    example: "EMERGENCIA"
  }),
  class: z.string().nullable().openapi({
    description: "Vehicle class.",
    example: ""
  }),
  descriptionOperationalStatus: z.string().nullable().openapi({
    description: "Operational status description.",
    example: "DISPONIBLE"
  }),
  stats: stationVehicleStatsSchema
});

export const stationVehiclesResponseSchema = z
  .object({
    vehicles: z.array(stationVehicleSchema)
  })
  .openapi({
    example: {
      vehicles: [
        {
          id: 774,
          internalNumber: "M-107",
          plate: "341-331",
          descriptionType: "EMERGENCIA",
          class: "",
          descriptionOperationalStatus: "DISPONIBLE",
          stats: {
            incidentCount: 142,
            avgResponseTimeSeconds: 1700
          }
        },
        {
          id: 833,
          internalNumber: "AR-01",
          plate: "341-404",
          descriptionType: "EMERGENCIA",
          class: "",
          descriptionOperationalStatus: "FUERA DE SERVICIO",
          stats: {
            incidentCount: 113,
            avgResponseTimeSeconds: 1559
          }
        }
      ]
    }
  });

export const stationHeatmapQuerySchema = z.object({
  days: z.coerce
    .number()
    .min(1)
    .max(365)
    .default(365)
    .openapi({
      description: "Number of days to include in heatmap data.",
      param: { in: "query" },
      example: 30
    })
});

export const stationHighlightedIncidentsQuerySchema = z.object({
  timeRange: z.coerce
    .number()
    .min(1)
    .max(365)
    .default(30)
    .openapi({
      description: "Time range in days to look for incidents.",
      param: { in: "query" },
      example: 30
    }),
  limit: z.coerce
    .number()
    .min(1)
    .max(20)
    .default(6)
    .openapi({
      description: "Maximum number of incidents to return.",
      param: { in: "query" },
      example: 3
    })
});

export const stationsOverviewResponse = z
  .object({
    operativeStationsCount: z.number().openapi({
      description: "Number of operative stations.",
      example: 75
    }),
    operativeVehiclesCount: z.number().openapi({
      description: "Number of active vehicles (available or in incident).",
      example: 892
    }),
    averageResponseTimeSeconds: z.number().nullable().openapi({
      description: "Average response time in seconds over the last 30 days (outliers removed).",
      example: 485
    })
  })
  .openapi({
    example: {
      operativeStationsCount: 75,
      operativeVehiclesCount: 892,
      averageResponseTimeSeconds: 485
    }
  });
