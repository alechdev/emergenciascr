import {
  dailyResponseTimesRequest,
  dailyResponseTimesResponse,
  incidentsByHourRequest,
  incidentsByHourResponse,
  incidentsByTypeRequest,
  incidentsByTypeResponse,
  systemOverviewResponse,
  yearRecapRequest,
  yearRecapResponse
} from "@api/schemas/stats";
import {
  getDailyResponseTimes,
  getIncidentsByHourRange,
  getIncidentsByType,
  getSystemOverview,
  getYearRecap
} from "@bomberoscr/db/queries/stats";
import { startOfCostaRicaDay, startOfCostaRicaHour } from "@bomberoscr/lib/costa-rica-time";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

const app = new OpenAPIHono();

const DEFAULT_RANGE_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const HOUR_IN_MS = 60 * 60 * 1000;
const ONE_MINUTE_SECONDS = 60;

function buildCacheControlHeader(ttlSeconds: number, swrSeconds: number = ttlSeconds): string {
  return `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`;
}

function parseIsoDateTime(value: string): Date {
  return new Date(value);
}

function resolveDateRange(start: string | null | undefined, end: string | null | undefined) {
  const endDate = end ? parseIsoDateTime(end) : new Date();
  const startDate = start
    ? parseIsoDateTime(start)
    : new Date(endDate.getTime() - DEFAULT_RANGE_DAYS * DAY_IN_MS);

  return { startDate, endDate };
}

app.openapi(
  createRoute({
    method: "get",
    path: "/year-recap",
    summary: "Get year recap statistics",
    operationId: "getYearRecap",
    description: "Year-to-date statistics about emergency response",
    tags: ["Stats"],
    request: {
      query: yearRecapRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(yearRecapResponse, "Year recap statistics")
    }
  }),
  async (c) => {
    const { year } = c.req.valid("query");

    const data = await getYearRecap(year);

    return c.json(
      {
        topIncidentDays: data.topIncidentDays,
        topDispatchedStations: data.topDispatchedStations,
        topDispatchedVehicles: data.topDispatchedVehicles
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/incidents-by-type",
    summary: "Get incidents by type",
    operationId: "getIncidentsByType",
    description: "Incidents distribution by type with top N and 'Otros' grouping",
    tags: ["Stats"],
    request: {
      query: incidentsByTypeRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(incidentsByTypeResponse, "Incidents by type")
    }
  }),
  async (c) => {
    const { start, end, limit } = c.req.valid("query");
    const { startDate, endDate } = resolveDateRange(start, end);

    const incidents = await getIncidentsByType({ startDate, endDate, limit });

    return c.json(incidents, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/daily-response-times",
    summary: "Get daily response times",
    operationId: "getDailyResponseTimes",
    description: "Daily average response times for dispatched vehicles",
    tags: ["Stats"],
    request: {
      query: dailyResponseTimesRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(dailyResponseTimesResponse, "Daily response times")
    }
  }),
  async (c) => {
    const { timeRange } = c.req.valid("query");

    const endDate = new Date();
    const startDate = startOfCostaRicaDay(endDate, -(timeRange - 1));

    const data = await getDailyResponseTimes({ startDate, endDate });
    const totalDispatches = data.reduce((sum, day) => sum + day.dispatchCount, 0);

    c.header("Cache-Control", buildCacheControlHeader(ONE_MINUTE_SECONDS));

    return c.json({ data, totalDispatches }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/incidents-by-hour",
    summary: "Get incidents by hour",
    operationId: "getIncidentsByHour",
    description: "Hourly incident counts for the last 24, 48, or 72 hours",
    tags: ["Stats"],
    request: {
      query: incidentsByHourRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(incidentsByHourResponse, "Incidents by hour")
    }
  }),
  async (c) => {
    const { timeRange } = c.req.valid("query");

    const endDate = new Date();
    const startOfCurrentHourCostaRica = startOfCostaRicaHour(endDate);
    const startDate = new Date(
      startOfCurrentHourCostaRica.getTime() - (timeRange - 1) * HOUR_IN_MS
    );

    const data = await getIncidentsByHourRange({ startDate, endDate });
    const totalIncidents = data.reduce((sum, hour) => sum + hour.incidents, 0);

    c.header("Cache-Control", buildCacheControlHeader(ONE_MINUTE_SECONDS));

    return c.json({ data, totalIncidents }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/system-overview",
    summary: "Get system overview",
    operationId: "getSystemOverview",
    description:
      "System-wide overview statistics including operative stations, active vehicles, and average response time over the last 30 days",
    tags: ["Stats"],
    responses: {
      [HttpStatusCodes.OK]: jsonContent(systemOverviewResponse, "System overview statistics")
    }
  }),
  async (c) => {
    const data = await getSystemOverview();

    return c.json(
      {
        stationCount: data.stationCount,
        activeVehicleCount: data.activeVehicleCount,
        avgResponseTimeMinutes: data.avgResponseTimeMinutes
      },
      HttpStatusCodes.OK
    );
  }
);

export const statsRouter = app;
