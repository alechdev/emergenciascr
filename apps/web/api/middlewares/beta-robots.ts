import { withBetaHeaders } from "@bomberoscr/lib/site-env";

import type { MiddlewareHandler } from "hono";

export function betaRobots(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const response = withBetaHeaders(c.res);
    if (response !== c.res) {
      c.res = response;
    }
  };
}
