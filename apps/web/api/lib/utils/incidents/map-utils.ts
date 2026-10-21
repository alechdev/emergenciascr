import env from "@api/env";
import {
  buildImgproxyUrl as buildImgproxyUrlBase,
  buildOriginalSourceUrl as buildOriginalSourceUrlBase
} from "@api/lib/imgproxy";
import { createHash } from "node:crypto";

const MAPBOX_CONFIG = {
  zoom: 15.73,
  bearing: 0,
  pitch: 39,
  width: 640,
  height: 360
};

function buildMapboxUrl(latitude: number, longitude: number): string {
  const { zoom, bearing, pitch, width, height } = MAPBOX_CONFIG;
  const marker = `pin-s+ff3b30(${longitude},${latitude})`;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${marker}/${longitude},${latitude},${zoom},${bearing},${pitch}/${width}x${height}@2x?access_token=${env.MAPBOX_API_KEY}`;
}

/** Stored coordinates use `"0"` for unknown. */
function hasMapCoordinates(latitude: number | string, longitude: number | string): boolean {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

/**
 * Identifies the map for a pair of coordinates. SIGAE moves an incident's coordinates after the
 * fact, sometimes by kilometers, so map URLs and stored images are keyed by it: a moved
 * incident gets a new map, and each map can be cached forever.
 */
function buildMapVersion(latitude: number | string, longitude: number | string): string {
  return createHash("sha256")
    .update(`${Number(latitude)},${Number(longitude)}`)
    .digest("hex")
    .slice(0, 12);
}

function getS3Key(incidentId: number, version: string): string {
  return `incidents/${incidentId}/map/${version}.png`;
}

function buildOriginalSourceUrl(incidentId: number, version: string): string {
  return buildOriginalSourceUrlBase(`incidents/${incidentId}/map/original/${version}`);
}

function buildImgproxyUrl(sourceUrl: string): string {
  const width = MAPBOX_CONFIG.width * 2;
  const height = MAPBOX_CONFIG.height * 2;
  return buildImgproxyUrlBase(sourceUrl, { width, height });
}

export {
  buildImgproxyUrl,
  buildMapboxUrl,
  buildMapVersion,
  buildOriginalSourceUrl,
  getS3Key,
  hasMapCoordinates
};
