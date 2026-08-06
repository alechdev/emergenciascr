import env from "@api/env";
import {
  buildImgproxyUrl as buildImgproxyUrlBase,
  buildOriginalSourceUrl as buildOriginalSourceUrlBase
} from "@api/lib/imgproxy";

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

function getS3Key(incidentId: number): string {
  return `incidents/${incidentId}/map.png`;
}

function buildOriginalSourceUrl(incidentId: number): string {
  return buildOriginalSourceUrlBase(`incidents/${incidentId}/map/original`);
}

function buildImgproxyUrl(sourceUrl: string): string {
  const width = MAPBOX_CONFIG.width * 2;
  const height = MAPBOX_CONFIG.height * 2;
  return buildImgproxyUrlBase(sourceUrl, { width, height });
}

export { buildImgproxyUrl, buildMapboxUrl, buildOriginalSourceUrl, getS3Key };
