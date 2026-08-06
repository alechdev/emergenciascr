import {
  formatMissingEnvMessage,
  getSigAEFetcher,
  syncSingleIncident
} from "@api/routers/admin/_lib/sigae";
import {
  IncidentIdParamsSchema,
  SyncSingleIncidentResponseSchema
} from "@api/routers/admin/_schemas";
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

export const route = createRoute({
  tags: ["Admin"],
  method: "post",
  path: "/admin/incidents/{id}",
  request: {
    params: IncidentIdParamsSchema
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      SyncSingleIncidentResponseSchema,
      "Sync result for the incident"
    ),
    ...unauthorizedResponse,
    ...serviceUnavailableResponse
  }
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const { id } = c.req.valid("param");
  const fetcherResult = getSigAEFetcher();

  if (!fetcherResult.ok) {
    return c.json(
      { message: formatMissingEnvMessage(fetcherResult.missing) },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    );
  }

  const result = await syncSingleIncident(fetcherResult.fetcher, id);
  return c.json(result, HttpStatusCodes.OK);
};
