import { z } from "@hono/zod-openapi";

export const adminAuthedRouteRequestSchema = z.object({
  token: z.string().openapi({
    description: "The admin token."
  })
});
