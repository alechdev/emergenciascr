/**
 * `SITE_ENV=beta` marks the beta site (sync-v2 data). It is read at request time, not at build
 * time, so one image serves both sites; any other value, or none, is the main site.
 */
export function isBetaSite(): boolean {
  return process.env.SITE_ENV === "beta";
}

export const BETA_ROBOTS = "noindex, nofollow";

export const ROBOTS_TAG_HEADER = "X-Robots-Tag";

/** Adds `X-Robots-Tag` on the beta site; elsewhere returns the response untouched. */
export function withBetaHeaders(response: Response): Response {
  if (!isBetaSite()) {
    return response;
  }

  try {
    response.headers.set(ROBOTS_TAG_HEADER, BETA_ROBOTS);
    return response;
  } catch {
    // Headers of fetched or `Response.redirect` responses are immutable.
    const copy = new Response(response.body, response);
    copy.headers.set(ROBOTS_TAG_HEADER, BETA_ROBOTS);
    return copy;
  }
}
