import env from "@api/env";
import { getCookie } from "hono/cookie";
import * as HttpStatusCodes from "stoker/http-status-codes";

import type { MiddlewareHandler } from "hono";

export const adminAuth: MiddlewareHandler = async (c, next) => {
  if (!env.ADMIN_TOKEN) {
    return c.json(
      { message: "Admin authentication is disabled" },
      HttpStatusCodes.SERVICE_UNAVAILABLE
    );
  }

  const adminToken = getCookie(c, "admin-token");

  if (!adminToken || adminToken !== env.ADMIN_TOKEN) {
    return c.json({ message: "Unauthorized" }, HttpStatusCodes.UNAUTHORIZED);
  }

  await next();
};
