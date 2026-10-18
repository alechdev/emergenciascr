import { withBetaHeaders } from "@bomberoscr/lib/site-env";
import { createMiddleware } from "@tanstack/react-start";

/** Every Start response (pages, server routes, server functions) gets the beta robots header. */
export const betaRobotsMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    const result = await next();
    // A route redirect is a Response with router options attached, so it is updated in place.
    result.response = withBetaHeaders(result.response);
    return result;
  }
);
