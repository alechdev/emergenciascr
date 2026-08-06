import { z } from "@hono/zod-openapi";

/**
 * A Zod schema for boolean query parameters.
 * Accepts "true" or "false" strings and transforms them to actual booleans.
 */
export const stringBoolean = z
  .string()
  .refine((val) => val === "true" || val === "false", {
    message: "Must be 'true' or 'false'"
  })
  .transform((val) => val === "true");
