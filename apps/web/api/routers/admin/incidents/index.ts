import {
  formatIsoDateForSIGAE,
  formatMissingEnvMessage,
  getSigAEFetcher,
  syncSingleIncident
} from "@api/routers/admin/_lib/sigae";
import {
  SearchIncidentsByDateRangeQuerySchema,
  SearchIncidentsByDateRangeResponseSchema,
  SyncIncidentsBodySchema,
  SyncIncidentsResponseSchema
} from "@api/routers/admin/_schemas";
import { getExistingIncidentIds } from "@bomberoscr/db/queries/incidents";
import { getIncidentListApp } from "@bomberoscr/sync-domain/api";
import { createRoute } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { createMessageObjectSchema } from "stoker/openapi/schemas";

import type { AppRouteHandler } from "@api/lib/types";

const unauthorizedResponse = {
  [HttpStatusCodes.UNAUTHORIZED]: jsonContent(
    createMessageObjectSchema("Unauthorized"),
    "Missing or invalid admin-token cookie"
  )
};

const serviceUnavailableResponse = {
  [HttpStatusCodes.SERVICE_UNAVAILABLE]: jsonContent(
    createMessageObjectSchema("Admin synchronization is disabled"),
    "Admin synchronization is disabled"
  )
};

export const listRoute = createRoute({
  tags: ["Admin"],
  method: "get",
  path: "/admin/incidents",
  request: {
    query: SearchIncidentsByDateRangeQuerySchema
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      SearchIncidentsByDateRangeResponseSchema,
      "List of incidents from SIGAE within the date range"
    ),
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: jsonContent(
      createMessageObjectSchema("Failed to fetch incident list from SIGAE"),
      "Failed to fetch incident list from SIGAE"
    ),
    ...unauthorizedResponse,
    ...serviceUnavailableResponse
  }
});

export const listHandler: AppRouteHandler<typeof listRoute> = async (c) => {
  const { from, to } = c.req.valid("query");
  const fetcherResult = getSigAEFetcher();

  if (!fetcherResult.ok) {
    return c.json(
      { message: formatMissingEnvMessage(fetcherResult.missing) },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    );
  }

  const { fetcher } = fetcherResult;
  const fromFormatted = formatIsoDateForSIGAE(from);
  const toFormatted = formatIsoDateForSIGAE(to);

  const incidentListResult = await getIncidentListApp({
    fetcher,
    from: fromFormatted,
    to: toFormatted
  });

  if (incidentListResult.isErr()) {
    return c.json(
      { message: "Failed to fetch incident list from SIGAE" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    );
  }

  const items = incidentListResult.value.items;
  const ids = items.map((i) => i.idBoletaIncidente);
  const existingIds = await getExistingIncidentIds(ids);
  const existingSet = new Set(existingIds);

  return c.json(
    {
      incidents: items.map((incident) => ({
        id: incident.idBoletaIncidente,
        consecutivo: incident.consecutivoEE,
        fecha: incident.fecha,
        hora: incident.horaIncidente,
        direccion: incident.direccion,
        tipoIncidente: incident.tipoIncidente,
        estacionResponsable: incident.estacionResponsable,
        synced: existingSet.has(incident.idBoletaIncidente)
      }))
    },
    HttpStatusCodes.OK
  );
};

export const syncRoute = createRoute({
  tags: ["Admin"],
  method: "post",
  path: "/admin/incidents",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SyncIncidentsBodySchema
        }
      }
    }
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      SyncIncidentsResponseSchema,
      "Sync results for the provided incident IDs"
    ),
    ...unauthorizedResponse,
    ...serviceUnavailableResponse
  }
});

export const syncHandler: AppRouteHandler<typeof syncRoute> = async (c) => {
  const { incidentIds } = c.req.valid("json");

  if (incidentIds.length === 0) {
    return c.json(
      {
        success: true,
        totalIncidents: 0,
        syncedIncidents: 0,
        failedIncidents: 0,
        failedResults: []
      },
      HttpStatusCodes.OK
    );
  }

  const fetcherResult = getSigAEFetcher();
  if (!fetcherResult.ok) {
    return c.json(
      { message: formatMissingEnvMessage(fetcherResult.missing) },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    );
  }

  const { fetcher } = fetcherResult;
  const BATCH_SIZE = 5;
  const results: { incidentId: number; success: boolean; error?: string }[] = [];

  for (let i = 0; i < incidentIds.length; i += BATCH_SIZE) {
    const batch = incidentIds.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((id) => syncSingleIncident(fetcher, id)));
    results.push(...batchResults);
  }

  const syncedCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;
  const hasFailures = failedCount > 0;

  return c.json(
    {
      success: !hasFailures,
      totalIncidents: incidentIds.length,
      syncedIncidents: syncedCount,
      failedIncidents: failedCount,
      failedResults: results.filter((r) => !r.success)
    },
    HttpStatusCodes.OK
  );
};
