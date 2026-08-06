import { z } from "@hono/zod-openapi";

// ============================================================================
// Date Range Helpers
// ============================================================================

const MAX_DAYS = 365;
const DAILY_RESPONSE_TIME_RANGE_VALUES = [7, 30, 90, 365] as const;
const HOURLY_INCIDENTS_TIME_RANGE_VALUES = [24, 48, 72] as const;
type DailyResponseTimeRange = (typeof DAILY_RESPONSE_TIME_RANGE_VALUES)[number];
type HourlyIncidentsTimeRange = (typeof HOURLY_INCIDENTS_TIME_RANGE_VALUES)[number];

function validateDateRange(start: string | null, end: string | null) {
  if (!start || !end) return true;

  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffTime = endDate.getTime() - startDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return diffDays <= MAX_DAYS;
}

const dateRangeBase = {
  start: z.iso
    .datetime({ offset: true })
    .nullable()
    .optional()
    .openapi({
      description:
        "Start timestamp (inclusive) for filtering, in ISO 8601 datetime format with timezone.",
      param: { in: "query" },
      example: "2024-01-01T00:00:00-06:00"
    }),
  end: z.iso
    .datetime({ offset: true })
    .nullable()
    .optional()
    .openapi({
      description:
        "End timestamp (inclusive) for filtering, in ISO 8601 datetime format with timezone.",
      param: { in: "query" },
      example: "2024-01-31T23:59:59.999-06:00"
    })
};

// ============================================================================
// Year Recap
// ============================================================================

export const yearRecapRequest = z.object({
  year: z.coerce
    .number()
    .int()
    .min(2020)
    .max(2100)
    .optional()
    .default(new Date().getFullYear())
    .openapi({
      description: "Year to get recap for.",
      param: { in: "query" },
      example: 2025
    })
});

export const yearRecapResponse = z
  .object({
    topIncidentDays: z
      .array(
        z.object({
          date: z.string().openapi({
            description: "Date in YYYY-MM-DD format.",
            example: "2025-03-15"
          }),
          count: z.number().openapi({
            description: "Number of incidents on that date.",
            example: 245
          })
        })
      )
      .openapi({
        description: "Top 5 days with the most incidents in the selected year."
      }),
    topDispatchedStations: z
      .array(
        z.object({
          name: z.string().openapi({
            description: "Station name.",
            example: "METROPOLITANA SUR"
          }),
          count: z.number().openapi({
            description: "Number of dispatches.",
            example: 3500
          })
        })
      )
      .openapi({
        description: "Top 5 stations with the most dispatches in the selected year."
      }),
    topDispatchedVehicles: z
      .array(
        z.object({
          internalNumber: z.string().openapi({
            description: "Vehicle internal number.",
            example: "M-05"
          }),
          stationName: z.string().openapi({
            description: "Station name assigned to the vehicle.",
            example: "METROPOLITANA SUR"
          }),
          count: z.number().openapi({
            description: "Number of dispatches.",
            example: 1200
          })
        })
      )
      .openapi({
        description: "Top 5 vehicles with the most dispatches in the selected year."
      })
  })
  .openapi({
    description: "Year-to-date statistics about emergency response"
  });

// ============================================================================
// Incidents by Type
// ============================================================================

export const incidentsByTypeRequest = z
  .object({
    ...dateRangeBase,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .default(6)
      .openapi({
        description:
          "Maximum number of incident types to return before grouping the rest as 'Otros'.",
        param: { in: "query" },
        example: 6
      })
  })
  .refine((data) => validateDateRange(data.start ?? null, data.end ?? null), {
    message: `Date range cannot exceed ${MAX_DAYS} days`,
    path: ["end"]
  });

export const incidentsByTypeResponse = z
  .array(
    z.object({
      code: z.string().nullable().openapi({
        description:
          "Incident type code used for filtering. Null when the bucket cannot be filtered directly.",
        example: "6.1.1.2.1"
      }),
      name: z.string().openapi({
        description: "Incident type name.",
        example: "EMERGENCIAS MÉDICAS"
      }),
      count: z.number().openapi({
        description: "Number of incidents for this type.",
        example: 2450
      })
    })
  )
  .openapi({
    description:
      "Incidents grouped by type, including top N types and an optional 'Otros' bucket for the rest"
  });

// ============================================================================
// Daily Response Times
// ============================================================================

export const dailyResponseTimesRequest = z.object({
  timeRange: z.coerce
    .number()
    .int()
    .refine(
      (value): value is DailyResponseTimeRange =>
        DAILY_RESPONSE_TIME_RANGE_VALUES.includes(value as DailyResponseTimeRange),
      {
        message: "timeRange must be one of: 7, 30, 90, 365"
      }
    )
    .optional()
    .default(7)
    .openapi({
      description: "Time range in days. Allowed values: 7, 30, 90, 365.",
      param: { in: "query" },
      example: 30
    })
});

export const dailyResponseTimesResponse = z
  .object({
    data: z.array(
      z.object({
        date: z.string().openapi({
          description: "Day in YYYY-MM-DD format.",
          example: "2026-01-16"
        }),
        averageResponseTimeSeconds: z.number().openapi({
          description: "Average response time in seconds for that day.",
          example: 492
        }),
        dispatchCount: z.number().openapi({
          description: "Number of dispatched vehicles considered for that day.",
          example: 284
        })
      })
    ),
    totalDispatches: z.number().openapi({
      description: "Total dispatched vehicles considered in the requested range.",
      example: 8291
    })
  })
  .openapi({
    description: "Daily average response times for dispatched vehicles"
  });

// ============================================================================
// Incidents by Hour
// ============================================================================

export const incidentsByHourRequest = z.object({
  timeRange: z.coerce
    .number()
    .int()
    .refine(
      (value): value is HourlyIncidentsTimeRange =>
        HOURLY_INCIDENTS_TIME_RANGE_VALUES.includes(value as HourlyIncidentsTimeRange),
      {
        message: "timeRange must be one of: 24, 48, 72"
      }
    )
    .optional()
    .default(24)
    .openapi({
      description: "Time range in hours. Allowed values: 24, 48, 72.",
      param: { in: "query" },
      example: 24
    })
});

export const incidentsByHourResponse = z
  .object({
    data: z.array(
      z.object({
        hourStart: z.string().openapi({
          description: "Hour bucket start timestamp in ISO 8601 format.",
          example: "2026-02-16T18:00:00.000Z"
        }),
        hourLabel: z.string().openapi({
          description: "Localized hour label in Costa Rica time.",
          example: "12:00"
        }),
        hoursAgo: z.number().int().min(0).openapi({
          description: "How many hours ago this bucket starts from the current hour.",
          example: 5
        }),
        incidents: z.number().openapi({
          description: "Number of incidents in that hour bucket.",
          example: 14
        })
      })
    ),
    totalIncidents: z.number().openapi({
      description: "Total incidents in the requested hourly range.",
      example: 327
    })
  })
  .openapi({
    description: "Hourly incident counts for the requested 24, 48, or 72 hour range"
  });

// ============================================================================
// System Overview
// ============================================================================

export const systemOverviewResponse = z
  .object({
    stationCount: z.number().openapi({
      description: "Number of operative stations.",
      example: 127
    }),
    activeVehicleCount: z.number().openapi({
      description: "Number of active vehicles.",
      example: 450
    }),
    avgResponseTimeMinutes: z.number().nullable().openapi({
      description: "Average response time in minutes over last 30 days.",
      example: 9.5
    })
  })
  .openapi({
    description: "System overview statistics"
  });
