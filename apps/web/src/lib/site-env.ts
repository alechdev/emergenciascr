import { rootRouteId } from "@tanstack/react-router";

import type { SiteEnv } from "@/server/site-env";

/**
 * Whether the root route loaded the beta site env. Route heads use it to keep their robots meta
 * from overriding the root's `noindex`, since the deepest route's meta wins.
 */
export function isBetaFromMatches(
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>
): boolean {
  const root = matches.find((match) => match.routeId === rootRouteId);
  return (root?.loaderData as Partial<SiteEnv> | undefined)?.beta === true;
}
