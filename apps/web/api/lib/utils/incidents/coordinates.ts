const EARTH_METERS_PER_DEGREE_LATITUDE = 111_320;
const TEMP_COORDINATE_RING_SPACING_METERS = 35;
const TEMP_COORDINATE_RING_COUNT = 1;
const GOLDEN_ANGLE_DEGREES = 137.50776405003785;

function isValidCoordinates(latitude: number | null, longitude: number | null): boolean {
  if (latitude === null || longitude === null) return false;
  if (latitude === 0 || longitude === 0) return false;
  return true;
}

function toCoordinateNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFirstValidCoordinatePair(
  pairs: Array<{ latitude: number | null; longitude: number | null } | null | undefined>
): { latitude: number; longitude: number } | null {
  for (const pair of pairs) {
    if (!pair) continue;
    if (
      pair.latitude !== null &&
      pair.longitude !== null &&
      isValidCoordinates(pair.latitude, pair.longitude)
    ) {
      return { latitude: pair.latitude, longitude: pair.longitude };
    }
  }
  return null;
}

function applyTemporaryCoordinateOffset(
  latitude: number,
  longitude: number,
  incidentId: number
): { latitude: number; longitude: number } {
  const angleInRadians = (((incidentId * GOLDEN_ANGLE_DEGREES) % 360) * Math.PI) / 180;
  const ring = (Math.abs(incidentId) % TEMP_COORDINATE_RING_COUNT) + 1;
  const radiusInMeters = ring * TEMP_COORDINATE_RING_SPACING_METERS;

  const latitudeOffset =
    (radiusInMeters / EARTH_METERS_PER_DEGREE_LATITUDE) * Math.sin(angleInRadians);

  const metersPerDegreeLongitude = Math.max(
    Math.abs(EARTH_METERS_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / 180)),
    1e-6
  );

  const longitudeOffset = (radiusInMeters / metersPerDegreeLongitude) * Math.cos(angleInRadians);

  return {
    latitude: latitude + latitudeOffset,
    longitude: longitude + longitudeOffset
  };
}

function resolveIncidentCoordinates({
  incidentId,
  latitude,
  longitude,
  fallbackLatitude,
  fallbackLongitude
}: {
  incidentId: number;
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  fallbackLatitude: number | string | null | undefined;
  fallbackLongitude: number | string | null | undefined;
}): {
  latitude: number;
  longitude: number;
  isTemporaryCoordinates: boolean;
  hasStoredCoordinates: boolean;
} {
  const parsedLatitude = toCoordinateNumber(latitude);
  const parsedLongitude = toCoordinateNumber(longitude);

  if (
    parsedLatitude !== null &&
    parsedLongitude !== null &&
    isValidCoordinates(parsedLatitude, parsedLongitude)
  ) {
    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      isTemporaryCoordinates: false,
      hasStoredCoordinates: true
    };
  }

  const parsedFallbackLatitude = toCoordinateNumber(fallbackLatitude);
  const parsedFallbackLongitude = toCoordinateNumber(fallbackLongitude);

  if (
    parsedFallbackLatitude === null ||
    parsedFallbackLongitude === null ||
    !isValidCoordinates(parsedFallbackLatitude, parsedFallbackLongitude)
  ) {
    return {
      latitude: parsedLatitude ?? 0,
      longitude: parsedLongitude ?? 0,
      isTemporaryCoordinates: false,
      hasStoredCoordinates: false
    };
  }

  const offsetCoordinates = applyTemporaryCoordinateOffset(
    parsedFallbackLatitude,
    parsedFallbackLongitude,
    incidentId
  );

  return {
    latitude: offsetCoordinates.latitude,
    longitude: offsetCoordinates.longitude,
    isTemporaryCoordinates: true,
    hasStoredCoordinates: false
  };
}

export { getFirstValidCoordinatePair, resolveIncidentCoordinates, toCoordinateNumber };
