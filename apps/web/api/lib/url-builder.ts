import env from "@api/env";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Get the normalized API base URL.
 */
export function getApiBaseUrl(): string {
  return normalizeBaseUrl(env.API_URL);
}

/**
 * Build the URL for an incident's map image.
 */
export function buildMapImageUrl(incidentId: number): string {
  return `${getApiBaseUrl()}/incidents/${incidentId}/map`;
}

/**
 * Build the URL for an incident type's image.
 */
export function buildTypeImageUrl(code: string): string {
  return `${getApiBaseUrl()}/types/${code}/image`;
}

/**
 * Build the URL for a station's image.
 */
export function buildStationImageUrl(stationName: string): string {
  return `${getApiBaseUrl()}/stations/${encodeURIComponent(stationName.trim())}/image`;
}
