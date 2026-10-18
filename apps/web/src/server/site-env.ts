import { isBetaSite } from "@bomberoscr/lib/site-env";
import { createServerFn } from "@tanstack/react-start";

export type SiteEnv = {
  beta: boolean;
};

export function readSiteEnv(): SiteEnv {
  return { beta: isBetaSite() };
}

/** Read on the server so the server render and the browser see the same site. */
export const getSiteEnv = createServerFn({ method: "GET" }).handler(readSiteEnv);
