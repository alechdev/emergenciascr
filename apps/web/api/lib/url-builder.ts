import env from "@api/env";
import { buildMapVersion } from "@api/lib/utils/incidents/map-utils";

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
 * Build the URL for an incident's map image at the given coordinates.
 */
export function buildMapImageUrl(
  incidentId: number,
  latitude: number | string,
  longitude: number | string
): string {
  return `${getApiBaseUrl()}/incidents/${incidentId}/map?v=${buildMapVersion(latitude, longitude)}`;
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
