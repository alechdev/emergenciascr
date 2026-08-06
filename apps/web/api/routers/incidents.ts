import env from "@api/env";
import { getFromS3, uploadToS3 } from "@api/lib/s3";
import { buildIncidentSlug } from "@api/lib/slug";
import { buildMapImageUrl, buildStationImageUrl, buildTypeImageUrl } from "@api/lib/url-builder";
import {
  calculateTimeDiffInSeconds,
  isUndefinedDate,
  toIsoStringOrNull
} from "@api/lib/utils/incidents/formatters";
import {
  buildImgproxyUrl,
  buildMapboxUrl,
  buildOriginalSourceUrl,
  getS3Key
} from "@api/lib/utils/incidents/map-utils";
import { generateOgImage } from "@api/lib/utils/incidents/og-image";
import { getIncidentStatistics } from "@api/lib/utils/incidents/statistics";
import { buildTimelineEvents } from "@api/lib/utils/incidents/timeline";
import {
  incidentByIdRequest,
  incidentByIdResponse,
  incidentResponseTimesResponseSchema,
  incidentsListRequest,
  incidentsListResponse,
  incidentTimelineResponseSchema
} from "@api/schemas/incidents";
import { adminAuthedRouteRequestSchema } from "@api/schemas/shared";
import {
  getIncidentById,
  getIncidentCoordinatesById,
  getIncidentOgImageData,
  getIncidentResponseTimesData,
  getIncidents,
  getIncidentTimelineData
} from "@bomberoscr/db/queries/incidents";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import * as HttpStatusPhrases from "stoker/http-status-phrases";
import { jsonContent } from "stoker/openapi/helpers";
import { createMessageObjectSchema } from "stoker/openapi/schemas";

const app = new OpenAPIHono();

const EARTH_METERS_PER_DEGREE_LATITUDE = 111_320;
const TEMP_COORDINATE_RING_SPACING_METERS = 35;
const TEMP_COORDINATE_RING_COUNT = 1;
const GOLDEN_ANGLE_DEGREES = 137.50776405003785;
const ONE_MINUTE_SECONDS = 60;
const THREE_HOURS_SECONDS = 3 * 60 * 60;

function buildCacheControlHeader(ttlSeconds: number, swrSeconds: number = ttlSeconds): string {
  return `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`;
}

function parseQueryNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIsoDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

function buildIncidentType(
  code: string | null,
  name: string | null | undefined
): { code: string; name: string; imageUrl: string } | null {
  if (!code || !name) return null;
  return {
    code,
    name,
    imageUrl: buildTypeImageUrl(code)
  };
}

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
    if (isValidCoordinates(pair.latitude, pair.longitude)) {
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

  if (isValidCoordinates(parsedLatitude, parsedLongitude)) {
    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      isTemporaryCoordinates: false,
      hasStoredCoordinates: true
    };
  }

  const parsedFallbackLatitude = toCoordinateNumber(fallbackLatitude);
  const parsedFallbackLongitude = toCoordinateNumber(fallbackLongitude);

  if (!isValidCoordinates(parsedFallbackLatitude, parsedFallbackLongitude)) {
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

function getIncidentTitle(
  importantDetails: string | null,
  specificType: string | null | undefined,
  type: string | null | undefined,
  location?: {
    districtName: string | null;
    cantonName: string | null;
    provinceName: string | null;
  }
): string {
  const baseTitle = importantDetails || specificType || type || "Incidente";

  if (!location) return baseTitle;

  const { districtName, cantonName, provinceName } = location;

  // Build location string: "EN district, canton, province"
  const locationParts: string[] = [];
  if (districtName) locationParts.push(districtName);
  if (cantonName) locationParts.push(cantonName);
  if (provinceName) locationParts.push(provinceName);

  if (locationParts.length === 0) return baseTitle;

  return `${baseTitle} EN ${locationParts.join(", ")}`;
}

function buildDispatchedStations(incident: {
  responsibleStation: number | null;
  dispatchedStations: Array<{
    serviceTypeId: number | null;
    station: { id: number; name: string; stationKey: string; isOperative: boolean | null };
  }>;
  dispatchedVehicles: Array<{
    id: number;
    stationId: number | null;
    dispatchedTime: Date;
    arrivalTime: Date | null;
    departureTime: Date | null;
    baseReturnTime: Date | null;
    vehicle: { internalNumber: string; plate: string; descriptionType: string } | null;
    station: { id: number; name: string; isOperative: boolean | null } | null;
  }>;
}) {
  const responsibleStationId =
    incident.dispatchedStations.find((station) => station.serviceTypeId === 1)?.station.id ??
    incident.responsibleStation ??
    null;
  const stationMap = new Map<
    number,
    {
      id: number;
      name: string;
      stationKey: string;
      isOperative: boolean;
      isResponsible: boolean;
      vehicles: Array<{
        id: number;
        internalNumber: string;
        plate: string;
        type: string;
        dispatchedTime: string;
        arrivalTime: string | null;
        departureTime: string | null;
        baseReturnTime: string | null;
      }>;
    }
  >();

  for (const dispatched of incident.dispatchedStations) {
    const stationId = dispatched.station.id;
    const isResponsible = dispatched.serviceTypeId === 1;
    const existing = stationMap.get(stationId);
    if (existing) {
      if (isResponsible) {
        existing.isResponsible = true;
      }
      continue;
    }
    stationMap.set(stationId, {
      id: stationId,
      name: dispatched.station.name,
      stationKey: dispatched.station.stationKey,
      isOperative: dispatched.station.isOperative ?? false,
      isResponsible,
      vehicles: []
    });
  }

  for (const vehicle of incident.dispatchedVehicles) {
    const stationId = vehicle.stationId ?? vehicle.station?.id;
    if (!stationId) continue;
    const existing = stationMap.get(stationId);
    if (!existing) {
      stationMap.set(stationId, {
        id: stationId,
        name: vehicle.station?.name ?? "Estación desconocida",
        stationKey: "",
        isOperative: vehicle.station?.isOperative ?? false,
        isResponsible: false,
        vehicles: []
      });
    }

    const vehicleInfo = vehicle.vehicle;
    stationMap.get(stationId)?.vehicles.push({
      id: vehicle.id,
      internalNumber: vehicleInfo?.internalNumber ?? "N/A",
      plate: vehicleInfo?.plate ?? "N/A",
      type: vehicleInfo?.descriptionType ?? "N/A",
      dispatchedTime: vehicle.dispatchedTime.toISOString(),
      arrivalTime: toIsoStringOrNull(vehicle.arrivalTime),
      departureTime: toIsoStringOrNull(vehicle.departureTime),
      baseReturnTime: toIsoStringOrNull(vehicle.baseReturnTime)
    });
  }

  if (
    !Array.from(stationMap.values()).some((station) => station.isResponsible) &&
    responsibleStationId
  ) {
    const fallback = stationMap.get(responsibleStationId);
    if (fallback) {
      fallback.isResponsible = true;
    }
  }

  return Array.from(stationMap.values()).map((station) => ({
    name: station.name,
    stationKey: station.stationKey,
    imageUrl: buildStationImageUrl(station.name),
    isResponsible: station.isResponsible,
    vehicles: station.vehicles
  }));
}

app.openapi(
  createRoute({
    method: "get",
    path: "/",
    summary: "List all incidents",
    operationId: "listIncidents",
    description: "Retrieve a list of incidents",
    tags: ["Incidents"],
    request: {
      query: incidentsListRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(incidentsListResponse, "List of incidents")
    }
  }),
  async (c) => {
    const { pageSize, cursor, sort, start, end, ...filter } = c.req.valid("query");

    const fallbackNorth = parseQueryNumber(
      c.req.query("bounds[north]") ?? c.req.query("northBound")
    );
    const fallbackSouth = parseQueryNumber(
      c.req.query("bounds[south]") ?? c.req.query("southBound")
    );
    const fallbackEast = parseQueryNumber(c.req.query("bounds[east]") ?? c.req.query("eastBound"));
    const fallbackWest = parseQueryNumber(c.req.query("bounds[west]") ?? c.req.query("westBound"));

    const fallbackBounds =
      fallbackNorth !== undefined &&
      fallbackSouth !== undefined &&
      fallbackEast !== undefined &&
      fallbackWest !== undefined
        ? {
            north: fallbackNorth,
            south: fallbackSouth,
            east: fallbackEast,
            west: fallbackWest
          }
        : undefined;

    const bounds = filter.bounds ?? fallbackBounds;

    const { data, meta } = await getIncidents({
      pageSize: pageSize ?? 25,
      cursor: cursor ?? null,
      sort: sort ?? [],
      start: parseIsoDateTime(start),
      end: parseIsoDateTime(end),
      ...filter,
      bounds
    });

    c.header("Cache-Control", buildCacheControlHeader(ONE_MINUTE_SECONDS));

    return c.json({
      meta,
      data: data.map((incident) => {
        const title = getIncidentTitle(
          incident.importantDetails,
          incident.specificIncidentType,
          incident.incidentType,
          {
            districtName: incident.districtName,
            cantonName: incident.cantonName,
            provinceName: incident.provinceName
          }
        );

        const fallbackCoordinates = getFirstValidCoordinatePair([
          {
            latitude: toCoordinateNumber(incident.responsibleStationLatitude),
            longitude: toCoordinateNumber(incident.responsibleStationLongitude)
          }
        ]);

        const coordinates = resolveIncidentCoordinates({
          incidentId: incident.id,
          latitude: incident.latitude,
          longitude: incident.longitude,
          fallbackLatitude: fallbackCoordinates?.latitude,
          fallbackLongitude: fallbackCoordinates?.longitude
        });

        return {
          id: incident.id,
          slug: buildIncidentSlug(incident.id, title, incident.incidentTimestamp),
          title,
          isOpen: incident.isOpen,
          EEConsecutive: incident.EEConsecutive,
          address: incident.address,
          incidentTimestamp: incident.incidentTimestamp,
          modifiedAt: incident.modifiedAt,
          importantDetails: incident.importantDetails,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          isTemporaryCoordinates: coordinates.isTemporaryCoordinates,
          mapImageUrl: coordinates.hasStoredCoordinates ? buildMapImageUrl(incident.id) : null,
          dispatchType: buildIncidentType(
            incident.dispatchIncidentCode,
            incident.dispatchIncidentType
          ),
          specificDispatchType: buildIncidentType(
            incident.specificDispatchIncidentCode,
            incident.specificDispatchIncidentType
          ),
          actualType: buildIncidentType(incident.incidentTypeCode, incident.incidentType),
          specificActualType: buildIncidentType(
            incident.specificIncidentTypeCode,
            incident.specificIncidentType
          ),
          responsibleStationName: incident.responsibleStation,
          districtName: incident.districtName,
          dispatchedStationsCount: incident.dispatchedStationsCount ?? 0,
          dispatchedVehiclesCount: incident.dispatchedVehiclesCount ?? 0,
          totalDispatched: incident.totalDispatched ?? 0
        };
      })
    });
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    summary: "Retrieve an incident",
    operationId: "getIncidentById",
    description: "Retrieve an incident by its unique identifier",
    tags: ["Incidents"],
    request: { params: incidentByIdRequest.pick({ id: true }) },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(
        incidentByIdResponse,
        "Retrieve an incident by its unique identifier"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident not found"),
        "Incident not found"
      )
    }
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const incident = await getIncidentById({ id });

    if (!incident) {
      return c.json({ message: HttpStatusPhrases.NOT_FOUND }, HttpStatusCodes.NOT_FOUND);
    }

    const dispatchedStations = buildDispatchedStations(incident);
    const title = getIncidentTitle(
      incident.importantDetails,
      incident.specificIncidentType?.name,
      incident.incidentType?.name,
      {
        districtName: incident.district?.name ?? null,
        cantonName: incident.canton?.name ?? null,
        provinceName: incident.province?.name ?? null
      }
    );

    const fallbackCoordinates = getFirstValidCoordinatePair([
      {
        latitude: toCoordinateNumber(incident.station?.latitude),
        longitude: toCoordinateNumber(incident.station?.longitude)
      }
    ]);

    const coordinates = resolveIncidentCoordinates({
      incidentId: incident.id,
      latitude: incident.latitude,
      longitude: incident.longitude,
      fallbackLatitude: fallbackCoordinates?.latitude,
      fallbackLongitude: fallbackCoordinates?.longitude
    });

    const statistics = await getIncidentStatistics({
      incidentTimestamp: incident.incidentTimestamp,
      incidentCode: incident.incidentCode,
      specificIncidentCode: incident.specificIncidentCode,
      cantonId: incident.cantonId,
      cantonName: incident.canton?.name ?? null
    });

    const ttlSeconds = incident.isOpen ? ONE_MINUTE_SECONDS : THREE_HOURS_SECONDS;
    c.header("Cache-Control", buildCacheControlHeader(ttlSeconds));

    return c.json(
      {
        id: incident.id,
        slug: buildIncidentSlug(incident.id, title, incident.incidentTimestamp),
        title,
        isOpen: incident.isOpen,
        EEConsecutive: incident.EEConsecutive,
        address: incident.address,
        incidentTimestamp: incident.incidentTimestamp,
        modifiedAt: incident.modifiedAt,
        importantDetails: incident.importantDetails,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        isTemporaryCoordinates: coordinates.isTemporaryCoordinates,
        cantonName: incident.canton?.name ?? null,
        mapImageUrl: coordinates.hasStoredCoordinates ? buildMapImageUrl(incident.id) : null,
        dispatchType: buildIncidentType(
          incident.dispatchIncidentCode,
          incident.dispatchIncidentType?.name
        ),
        specificDispatchType: buildIncidentType(
          incident.specificDispatchIncidentCode,
          incident.specificDispatchIncidentType?.name
        ),
        actualType: buildIncidentType(incident.incidentCode, incident.incidentType?.name),
        specificActualType: buildIncidentType(
          incident.specificIncidentCode,
          incident.specificIncidentType?.name
        ),
        statistics: {
          currentYear: statistics.currentYear,
          currentYearCount: statistics.currentYearCount,
          currentYearCantonCount: statistics.currentYearCantonCount,
          previousYear: statistics.previousYear,
          previousYearCount: statistics.previousYearCount
        },
        dispatchedStations
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{id}/timeline",
    summary: "Retrieve incident timeline",
    operationId: "getIncidentTimeline",
    description: "Retrieve timeline events for an incident",
    tags: ["Incidents"],
    request: {
      params: incidentByIdRequest.pick({ id: true })
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(
        incidentTimelineResponseSchema,
        "Timeline events for the incident"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident not found"),
        "Incident not found"
      )
    }
  }),
  async (c) => {
    const { id } = c.req.valid("param");

    const incident = await getIncidentTimelineData({ id });

    if (!incident) {
      return c.json({ message: HttpStatusPhrases.NOT_FOUND }, HttpStatusCodes.NOT_FOUND);
    }

    const ttlSeconds = incident.isOpen ? ONE_MINUTE_SECONDS : THREE_HOURS_SECONDS;
    c.header("Cache-Control", buildCacheControlHeader(ttlSeconds));

    const events = buildTimelineEvents(incident, incident.dispatchedVehicles).map((event) => ({
      id: event.id,
      date: event.date.toISOString(),
      title: event.title,
      ...(event.description ? { description: event.description } : {})
    }));

    return c.json({ events }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{id}/response-times",
    summary: "Retrieve incident response times",
    operationId: "getIncidentResponseTimes",
    description: "Retrieve response time breakdown for dispatched vehicles",
    tags: ["Incidents"],
    request: {
      params: incidentByIdRequest.pick({ id: true })
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(
        incidentResponseTimesResponseSchema,
        "Response time breakdown for dispatched vehicles"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident not found"),
        "Incident not found"
      )
    }
  }),
  async (c) => {
    const { id } = c.req.valid("param");

    const incident = await getIncidentResponseTimesData({ id });

    if (!incident) {
      return c.json({ message: HttpStatusPhrases.NOT_FOUND }, HttpStatusCodes.NOT_FOUND);
    }

    const ttlSeconds = incident.isOpen ? ONE_MINUTE_SECONDS : THREE_HOURS_SECONDS;
    c.header("Cache-Control", buildCacheControlHeader(ttlSeconds));

    const vehicles = incident.dispatchedVehicles.map((vehicle) => {
      const responseTimeSeconds = calculateTimeDiffInSeconds(
        vehicle.arrivalTime,
        vehicle.dispatchedTime
      );
      const hasDeparture = !!vehicle.departureTime && !isUndefinedDate(vehicle.departureTime);
      const hasReturn = !!vehicle.baseReturnTime && !isUndefinedDate(vehicle.baseReturnTime);
      const onSceneEndDate = hasDeparture
        ? vehicle.departureTime
        : incident.isOpen
          ? new Date()
          : null;
      const onSceneTimeSeconds = calculateTimeDiffInSeconds(onSceneEndDate, vehicle.arrivalTime);
      const isEnRoute = hasDeparture && !hasReturn;
      const returnTimeSeconds =
        hasDeparture && hasReturn
          ? calculateTimeDiffInSeconds(vehicle.baseReturnTime, vehicle.departureTime)
          : 0;
      const totalTimeSeconds = responseTimeSeconds + onSceneTimeSeconds + returnTimeSeconds;

      return {
        id: vehicle.id,
        vehicle: vehicle.vehicle?.internalNumber || "N/A",
        station: vehicle.station.name,
        dispatchedTime: toIsoStringOrNull(vehicle.dispatchedTime),
        arrivalTime: toIsoStringOrNull(vehicle.arrivalTime),
        departureTime: toIsoStringOrNull(vehicle.departureTime),
        baseReturnTime: toIsoStringOrNull(vehicle.baseReturnTime),
        responseTimeSeconds,
        onSceneTimeSeconds,
        returnTimeSeconds,
        totalTimeSeconds,
        isEnRoute
      };
    });

    return c.json({ vehicles }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{id}/og",
    summary: "Retrieve incident Open Graph image",
    operationId: "getIncidentOgImage",
    description: "Generate the Open Graph image for an incident",
    tags: ["Incidents"],
    request: {
      params: incidentByIdRequest.pick({ id: true })
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "OG Image for the incident",
        content: {
          "image/png": {
            schema: {
              type: "string",
              format: "binary"
            }
          }
        }
      },
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident not found"),
        "Incident not found"
      )
    }
  }),
  async (c) => {
    const { id } = c.req.valid("param");

    const incident = await getIncidentOgImageData({ id });

    if (!incident) {
      return c.json({ message: HttpStatusPhrases.NOT_FOUND }, HttpStatusCodes.NOT_FOUND);
    }

    const statistics = await getIncidentStatistics({
      incidentTimestamp: incident.incidentTimestamp,
      incidentCode: incident.incidentCode,
      specificIncidentCode: incident.specificIncidentCode,
      cantonId: incident.cantonId,
      cantonName: incident.canton?.name ?? null
    });

    const ttlSeconds = incident.isOpen ? ONE_MINUTE_SECONDS : THREE_HOURS_SECONDS;
    const ogResponse = await generateOgImage(incident, statistics);
    ogResponse.headers.set("Cache-Control", buildCacheControlHeader(ttlSeconds));

    return ogResponse;
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{id}/map",
    summary: "Retrieve incident map image",
    operationId: "getIncidentMap",
    description: "Retrieve the generated map image for an incident",
    tags: ["Incidents"],
    request: {
      params: incidentByIdRequest.pick({ id: true })
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "Map image for the incident",
        content: {
          "image/avif": {
            schema: {
              type: "string",
              format: "binary"
            }
          },
          "image/webp": {
            schema: {
              type: "string",
              format: "binary"
            }
          },
          "image/jpeg": {
            schema: {
              type: "string",
              format: "binary"
            }
          },
          "image/png": {
            schema: {
              type: "string",
              format: "binary"
            }
          }
        }
      },
      [HttpStatusCodes.BAD_REQUEST]: jsonContent(
        createMessageObjectSchema("Invalid coordinates"),
        "Invalid coordinates"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident not found"),
        "Incident not found"
      ),
      [HttpStatusCodes.BAD_GATEWAY]: jsonContent(
        createMessageObjectSchema("Failed to fetch map image"),
        "Failed to fetch map image"
      )
    }
  }),
  async (c) => {
    const { id } = c.req.valid("param");

    const sourceUrl = buildOriginalSourceUrl(id);
    const imgproxyUrl = buildImgproxyUrl(sourceUrl);
    const acceptHeader = c.req.header("accept");

    const imgproxyResponse = await fetch(imgproxyUrl, {
      headers: acceptHeader ? { Accept: acceptHeader } : undefined
    });

    if (!imgproxyResponse.ok) {
      const status = imgproxyResponse.status;
      if (status === 404) {
        return c.json({ message: "Incident not found" }, HttpStatusCodes.NOT_FOUND);
      }
      if (status === 400) {
        return c.json({ message: "Invalid coordinates" }, HttpStatusCodes.BAD_REQUEST);
      }
      return c.json({ message: "Failed to fetch map image" }, HttpStatusCodes.BAD_GATEWAY);
    }

    const body = await imgproxyResponse.arrayBuffer();
    const contentType = imgproxyResponse.headers.get("content-type") ?? "image/png";
    const cacheControl =
      imgproxyResponse.headers.get("cache-control") ?? "public, max-age=31536000, immutable";

    return c.body(new Uint8Array(body), HttpStatusCodes.OK, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      Vary: "Accept"
    });
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{id}/map/original",
    summary: "Retrieve original incident map image",
    operationId: "getIncidentOriginalMap",
    description: "Retrieve the original map image for an incident from Mapbox",
    tags: ["Incidents"],
    request: {
      params: incidentByIdRequest.pick({ id: true }),
      query: adminAuthedRouteRequestSchema
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "Original map image from Mapbox (PNG)",
        content: {
          "image/png": {
            schema: {
              type: "string",
              format: "binary"
            }
          }
        }
      },
      [HttpStatusCodes.UNAUTHORIZED]: jsonContent(
        createMessageObjectSchema("Unauthorized"),
        "Invalid or missing token"
      ),
      [HttpStatusCodes.BAD_REQUEST]: jsonContent(
        createMessageObjectSchema("Invalid coordinates"),
        "Invalid coordinates"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident not found"),
        "Incident not found"
      ),
      [HttpStatusCodes.BAD_GATEWAY]: jsonContent(
        createMessageObjectSchema("Failed to fetch map image"),
        "Failed to fetch map image"
      )
    }
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { token } = c.req.valid("query");

    if (token !== env.IMGPROXY_TOKEN) {
      return c.json({ message: "Unauthorized" }, HttpStatusCodes.UNAUTHORIZED);
    }

    const s3Key = getS3Key(id);

    const cachedImage = await getFromS3(s3Key);
    if (cachedImage) {
      return c.body(new Uint8Array(cachedImage), HttpStatusCodes.OK, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable"
      });
    }

    const incident = await getIncidentCoordinatesById({ id });

    if (!incident) {
      return c.json({ message: "Incident not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const latitude = Number(incident.latitude);
    const longitude = Number(incident.longitude);

    if (!latitude || !longitude || latitude === 0 || longitude === 0) {
      return c.json({ message: "Invalid coordinates" }, HttpStatusCodes.BAD_REQUEST);
    }

    const mapboxUrl = buildMapboxUrl(latitude, longitude);
    const mapboxResponse = await fetch(mapboxUrl);

    if (!mapboxResponse.ok) {
      const responseBody = await mapboxResponse.text().catch(() => "");
      console.error("Mapbox response error:", {
        status: mapboxResponse.status,
        statusText: mapboxResponse.statusText,
        body: responseBody.slice(0, 500)
      });
      return c.json({ message: "Failed to fetch map image" }, HttpStatusCodes.BAD_GATEWAY);
    }

    const imageBuffer = await mapboxResponse.arrayBuffer();

    void uploadToS3(s3Key, imageBuffer, "image/png").catch((error) => {
      console.error("Failed to save original to S3:", error);
    });

    return c.body(new Uint8Array(imageBuffer), HttpStatusCodes.OK, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable"
    });
  }
);

export const incidentsRouter = app;
