import { z } from "@hono/zod-openapi";

export const healthcheckResponse = z.object({
  status: z.literal("ok").openapi({
    description: "Current API health status.",
    example: "ok"
  })
});
