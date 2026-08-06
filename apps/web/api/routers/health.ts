import { healthcheckResponse } from "@api/schemas/health";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

const app = new OpenAPIHono();

app.openapi(
  createRoute({
    method: "get",
    path: "/",
    summary: "Health check",
    operationId: "getHealthcheck",
    description: "Check whether the API is up and responsive",
    tags: ["Health"],
    responses: {
      [HttpStatusCodes.OK]: jsonContent(healthcheckResponse, "API is healthy")
    }
  }),
  (c) => {
    return c.json(
      {
        status: "ok"
      },
      HttpStatusCodes.OK
    );
  }
);

export const healthRouter = app;
