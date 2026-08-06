import env from "@api/env";
import {
  buildImgproxyUrl as buildImgproxyUrlBase,
  buildOriginalSourceUrl as buildOriginalSourceUrlBase
} from "@api/lib/imgproxy";
import { existsInS3, getFromS3 } from "@api/lib/s3";
import { buildMapImageUrl, buildStationImageUrl } from "@api/lib/url-builder";
import {
  stationByNameRequest,
  stationByNameResponse,
  stationCollaborationsResponseSchema,
  stationHeatmapQuerySchema,
  stationHeatmapResponseSchema,
  stationHighlightedIncidentsQuerySchema,
  stationHighlightedIncidentsResponseSchema,
  stationImageTokenSchema,
  stationsListRequest,
  stationsListResponse,
  stationsOverviewResponse,
  stationVehiclesResponseSchema
} from "@api/schemas/stations";
import {
  getStationByName,
  getStationCollaborations,
  getStationHighlightedIncidents,
  getStationIdByName,
  getStationIncidentsPerDay,
  getStationsList,
  getStationsOverview,
  getStationVehiclesWithStats
} from "@bomberoscr/db/queries/stations";
import { glass } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { createMessageObjectSchema } from "stoker/openapi/schemas";

const app = new OpenAPIHono();

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png"] as const;
const IMAGE_SIZE = { width: 800, height: 600 };
const DICEBEAR_SIZE = 800;

type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

const CONTENT_TYPE_MAP: Record<ImageExtension, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png"
};

function parseQueryNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidCoordinates(latitude: string | null, longitude: string | null): boolean {
  if (latitude === null || longitude === null) return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (lat === 0 && lng === 0) return false;
  return true;
}

function buildImgproxyUrl(sourceUrl: string): string {
  return buildImgproxyUrlBase(sourceUrl, IMAGE_SIZE);
}

function buildOriginalSourceUrl(stationName: string): string {
  const encodedName = encodeURIComponent(stationName.trim());
  return buildOriginalSourceUrlBase(`stations/${encodedName}/image/original`);
}

async function getStationImage(
  stationKey: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  for (const ext of IMAGE_EXTENSIONS) {
    const s3Key = `stations/${stationKey}.${ext}`;
    const image = await getFromS3(s3Key);
    if (image) {
      return { buffer: image, contentType: CONTENT_TYPE_MAP[ext] };
    }
  }
  return null;
}

async function stationHasImageInS3(stationKey: string): Promise<boolean> {
  for (const ext of IMAGE_EXTENSIONS) {
    const s3Key = `stations/${stationKey}.${ext}`;
    if (await existsInS3(s3Key)) {
      return true;
    }
  }
  return false;
}

function createDicebearAvatar(seed: string): string {
  const avatar = createAvatar(glass, {
    seed,
    size: DICEBEAR_SIZE
  });
  return avatar.toString();
}

app.openapi(
  createRoute({
    method: "get",
    path: "/",
    summary: "List stations",
    operationId: "listStations",
    description: "Retrieve stations",
    tags: ["Stations"],
    request: {
      query: stationsListRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(stationsListResponse, "List of stations")
    }
  }),
  async (c) => {
    const { limit, page, q, operative, bounds, sort } = c.req.valid("query");

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

    const resolvedBounds = bounds ?? fallbackBounds;

    const { data, meta } = await getStationsList({
      limit,
      page,
      sort: sort ?? [],
      q,
      operative,
      bounds: resolvedBounds
    });

    return c.json(
      {
        data: data.map((station) => ({
          ...station,
          imageUrl: buildStationImageUrl(station.name)
        })),
        meta
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/overview",
    summary: "Get stations overview",
    operationId: "getStationsOverview",
    description:
      "Get overview statistics for all stations including operative station count, active vehicle count, and average response time",
    tags: ["Stations"],
    responses: {
      [HttpStatusCodes.OK]: jsonContent(stationsOverviewResponse, "Stations overview statistics")
    }
  }),
  async (c) => {
    const data = await getStationsOverview();

    return c.json(
      {
        operativeStationsCount: data.operativeStationsCount,
        operativeVehiclesCount: data.operativeVehiclesCount,
        averageResponseTimeSeconds: data.averageResponseTimeSeconds
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}",
    summary: "Retrieve station",
    operationId: "getStationByName",
    description: "Retrieve a station by its name",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(stationByNameResponse, "Station details"),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station not found"),
        "Station not found"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");
    const decodedName = decodeURIComponent(name).trim();
    const station = await getStationByName({ name: decodedName });

    if (!station) {
      return c.json({ message: "Station not found" }, HttpStatusCodes.NOT_FOUND);
    }

    return c.json(
      {
        station: {
          ...station,
          imageUrl: buildStationImageUrl(station.name)
        }
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}/heatmap",
    summary: "Retrieve station heatmap",
    operationId: "getStationHeatmap",
    description: "Retrieve incident counts per day for the station",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest,
      query: stationHeatmapQuerySchema
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(stationHeatmapResponseSchema, "Incident heatmap data"),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station not found"),
        "Station not found"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");
    const { days } = c.req.valid("query");

    const station = await getStationIdByName({ name: decodeURIComponent(name).trim() });
    if (!station) {
      return c.json({ message: "Station not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const data = await getStationIncidentsPerDay({ stationId: station.id, days });
    const totalIncidents = data.reduce((sum, day) => sum + day.count, 0);

    return c.json({ data, totalIncidents }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}/highlighted-incidents",
    summary: "Retrieve station highlighted incidents",
    operationId: "getStationHighlightedIncidents",
    description: "Retrieve highlighted incidents for the station",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest,
      query: stationHighlightedIncidentsQuerySchema
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(
        stationHighlightedIncidentsResponseSchema,
        "Highlighted incidents for the station"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station not found"),
        "Station not found"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");
    const { timeRange, limit } = c.req.valid("query");

    const station = await getStationIdByName({ name: decodeURIComponent(name).trim() });
    if (!station) {
      return c.json({ message: "Station not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const incidents = await getStationHighlightedIncidents({
      stationId: station.id,
      timeRange,
      limit
    });

    return c.json(
      {
        incidents: incidents.map((incident) => ({
          ...incident,
          incidentTimestamp: incident.incidentTimestamp.toISOString(),
          mapImageUrl: isValidCoordinates(incident.latitude, incident.longitude)
            ? buildMapImageUrl(incident.id)
            : null
        }))
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}/collaborations",
    summary: "Retrieve station collaborations",
    operationId: "getStationCollaborations",
    description: "Retrieve stations that collaborated with the given station",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(
        stationCollaborationsResponseSchema,
        "Stations that collaborated with this one"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station not found"),
        "Station not found"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");

    const station = await getStationIdByName({ name: decodeURIComponent(name).trim() });
    if (!station) {
      return c.json({ message: "Station not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const collaborations = await getStationCollaborations({ stationId: station.id });
    return c.json(
      {
        collaborations: collaborations.map((collab) => ({
          ...collab,
          imageUrl: buildStationImageUrl(collab.name)
        }))
      },
      HttpStatusCodes.OK
    );
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}/vehicles",
    summary: "Retrieve station vehicles",
    operationId: "getStationVehicles",
    description: "Retrieve vehicles assigned to the station with stats",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(
        stationVehiclesResponseSchema,
        "Vehicles assigned to this station with stats"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station not found"),
        "Station not found"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");

    const station = await getStationIdByName({ name: decodeURIComponent(name).trim() });
    if (!station) {
      return c.json({ message: "Station not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const vehicles = await getStationVehiclesWithStats({ stationId: station.id });
    return c.json({ vehicles }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}/image",
    summary: "Retrieve station image",
    operationId: "getStationImage",
    description:
      "Retrieve the station image. Returns processed image from S3 if available, otherwise returns a generated avatar.",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "Station image",
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
          },
          "image/svg+xml": {
            schema: {
              type: "string",
              format: "binary"
            }
          }
        }
      },
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station not found"),
        "Station not found"
      ),
      [HttpStatusCodes.BAD_GATEWAY]: jsonContent(
        createMessageObjectSchema("Failed to fetch station image"),
        "Failed to fetch station image"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");
    const decodedName = decodeURIComponent(name).trim();

    const station = await getStationIdByName({ name: decodedName });
    if (!station) {
      return c.json({ message: "Station not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const isOperative = station.isOperative ?? false;
    const hasS3Image = isOperative && (await stationHasImageInS3(station.stationKey));

    // If operative and has S3 image, serve via imgproxy
    if (hasS3Image) {
      const sourceUrl = buildOriginalSourceUrl(decodedName);
      const imgproxyUrl = buildImgproxyUrl(sourceUrl);
      const acceptHeader = c.req.header("accept");

      const imgproxyResponse = await fetch(imgproxyUrl, {
        headers: acceptHeader ? { Accept: acceptHeader } : undefined
      });

      if (!imgproxyResponse.ok) {
        return c.json({ message: "Failed to fetch station image" }, HttpStatusCodes.BAD_GATEWAY);
      }

      const body = await imgproxyResponse.arrayBuffer();
      const contentType = imgproxyResponse.headers.get("content-type") ?? "image/jpeg";
      const cacheControl =
        imgproxyResponse.headers.get("cache-control") ?? "public, max-age=31536000, immutable";

      return c.body(new Uint8Array(body), HttpStatusCodes.OK, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        Vary: "Accept"
      });
    }

    // Fallback to dicebear avatar
    const avatar = createDicebearAvatar(station.name);

    // Non-operative stations get cache headers, operative ones don't (still adding images)
    const headers: Record<string, string> = {
      "Content-Type": "image/svg+xml"
    };
    if (!isOperative) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }

    return c.body(avatar, HttpStatusCodes.OK, headers);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{name}/image/original",
    summary: "Retrieve original station image",
    operationId: "getStationOriginalImage",
    description: "Retrieve the original station image from storage",
    tags: ["Stations"],
    request: {
      params: stationByNameRequest,
      query: stationImageTokenSchema
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "Original station image",
        content: {
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
      [HttpStatusCodes.UNAUTHORIZED]: jsonContent(
        createMessageObjectSchema("Unauthorized"),
        "Invalid or missing token"
      ),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Station image not found"),
        "Station image not found"
      )
    }
  }),
  async (c) => {
    const { name } = c.req.valid("param");
    const { token } = c.req.valid("query");

    if (token !== env.IMGPROXY_TOKEN) {
      return c.json({ message: "Unauthorized" }, HttpStatusCodes.UNAUTHORIZED);
    }

    const station = await getStationIdByName({ name: decodeURIComponent(name).trim() });
    if (!station) {
      return c.json({ message: "Station image not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const image = await getStationImage(station.stationKey);
    if (!image) {
      return c.json({ message: "Station image not found" }, HttpStatusCodes.NOT_FOUND);
    }

    return c.body(new Uint8Array(image.buffer), HttpStatusCodes.OK, {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
  }
);

export const stationsRouter = app;
