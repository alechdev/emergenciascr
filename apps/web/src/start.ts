import { createStart } from "@tanstack/react-start";

import { betaRobotsMiddleware } from "@/server/beta-robots-middleware";

export const startInstance = createStart(() => ({
  requestMiddleware: [betaRobotsMiddleware]
}));
