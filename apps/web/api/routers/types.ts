import env from "@api/env";
import { getFromS3 } from "@api/lib/s3";
import { buildTypeImageUrl } from "@api/lib/url-builder";
import {
  buildImgproxyUrl,
  buildOriginalSourceUrl,
  findAvailableImageCode,
  getS3Key
} from "@api/lib/utils/incidents/type-image-utils";
import { adminAuthedRouteRequestSchema } from "@api/schemas/shared";
import {
  typeByCodeRequest,
  typeByCodeResponse,
  typeIncludeRequest,
  typesListResponse
} from "@api/schemas/types";
import { db } from "@bomberoscr/db/index";
import { incidentTypes } from "@bomberoscr/db/schema";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import * as HttpStatusCodes from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";
import { createMessageObjectSchema } from "stoker/openapi/schemas";

const app = new OpenAPIHono();

app.openapi(
  createRoute({
    method: "get",
    path: "/",
    summary: "List incident types",
    operationId: "listIncidentTypes",
    description: "Retrieve all incident types with hierarchy metadata",
    tags: ["Types"],
    responses: {
      [HttpStatusCodes.OK]: jsonContent(typesListResponse, "List of incident types")
    }
  }),
  async (c) => {
    const types = await db.query.incidentTypes.findMany({
      columns: {
        id: true,
        incidentCode: true,
        name: true,
        parentId: true
      },
      orderBy: (incidentTypesTable, { asc }) => [asc(incidentTypesTable.incidentCode)]
    });

    const codeById = new Map<number, string>();
    for (const type of types) {
      codeById.set(type.id, type.incidentCode);
    }

    const items = types.map((type) => ({
      code: type.incidentCode,
      name: type.name,
      imageUrl: buildTypeImageUrl(type.incidentCode),
      parentCode: type.parentId ? (codeById.get(type.parentId) ?? null) : null,
      level: type.incidentCode.split(".").length
    }));

    return c.json({ items }, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{code}",
    summary: "Retrieve incident type",
    operationId: "getIncidentType",
    description: "Retrieve a single incident type and its direct children",
    tags: ["Types"],
    request: {
      params: typeByCodeRequest,
      query: typeIncludeRequest
    },
    responses: {
      [HttpStatusCodes.OK]: jsonContent(typeByCodeResponse, "Incident type details"),
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Incident type not found"),
        "Incident type not found"
      )
    }
  }),
  async (c) => {
    const { code } = c.req.valid("param");
    const { include } = c.req.valid("query");
    const includeValues = include
      ? include
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : ["children"];
    const includeSet = new Set(includeValues.length > 0 ? includeValues : ["children"]);
    const includeChildren = includeSet.has("children");
    const includeAncestors = includeSet.has("ancestors");

    const type = await db.query.incidentTypes.findFirst({
      where: eq(incidentTypes.incidentCode, code),
      columns: {
        id: true,
        incidentCode: true,
        name: true,
        parentId: true
      }
    });

    if (!type) {
      return c.json({ message: "Incident type not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const parent = type.parentId
      ? await db.query.incidentTypes.findFirst({
          where: eq(incidentTypes.id, type.parentId),
          columns: {
            incidentCode: true
          }
        })
      : null;

    const children = includeChildren
      ? await db.query.incidentTypes.findMany({
          where: eq(incidentTypes.parentId, type.id),
          columns: {
            incidentCode: true,
            name: true
          },
          orderBy: (incidentTypesTable, { asc }) => [asc(incidentTypesTable.incidentCode)]
        })
      : null;

    const ancestors = includeAncestors
      ? await (async () => {
          const result: Array<{ code: string; name: string; level: number }> = [];
          let currentParentId = type.parentId;

          while (currentParentId) {
            const ancestor = await db.query.incidentTypes.findFirst({
              where: eq(incidentTypes.id, currentParentId),
              columns: {
                id: true,
                incidentCode: true,
                name: true,
                parentId: true
              }
            });

            if (!ancestor) break;

            result.unshift({
              code: ancestor.incidentCode,
              name: ancestor.name,
              level: ancestor.incidentCode.split(".").length
            });

            currentParentId = ancestor.parentId;
          }

          return result;
        })()
      : null;

    const response: {
      type: {
        code: string;
        name: string;
        imageUrl: string;
        parentCode: string | null;
        level: number;
      };
      children?: Array<{ code: string; name: string; imageUrl: string }>;
      ancestors?: Array<{ code: string; name: string; imageUrl: string; level: number }>;
    } = {
      type: {
        code: type.incidentCode,
        name: type.name,
        imageUrl: buildTypeImageUrl(type.incidentCode),
        parentCode: parent?.incidentCode ?? null,
        level: type.incidentCode.split(".").length
      }
    };

    if (includeChildren && children) {
      response.children = children.map((child) => ({
        code: child.incidentCode,
        name: child.name,
        imageUrl: buildTypeImageUrl(child.incidentCode)
      }));
    }

    if (includeAncestors && ancestors) {
      response.ancestors = ancestors.map((ancestor) => ({
        ...ancestor,
        imageUrl: buildTypeImageUrl(ancestor.code)
      }));
    }

    return c.json(response, HttpStatusCodes.OK);
  }
);

app.openapi(
  createRoute({
    method: "get",
    path: "/{code}/image",
    summary: "Retrieve incident type image",
    operationId: "getIncidentTypeImage",
    description: "Retrieve the illustration image for an incident type",
    tags: ["Types"],
    request: {
      params: typeByCodeRequest
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "Incident type illustration image",
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
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Image not found"),
        "No image found for this incident type or its parents"
      ),
      [HttpStatusCodes.BAD_GATEWAY]: jsonContent(
        createMessageObjectSchema("Failed to fetch image"),
        "Failed to fetch image from image proxy"
      )
    }
  }),
  async (c) => {
    const { code } = c.req.valid("param");

    const availableCode = await findAvailableImageCode(code);

    if (!availableCode) {
      return c.json({ message: "Image not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const sourceUrl = buildOriginalSourceUrl(availableCode);
    const imgproxyUrl = buildImgproxyUrl(sourceUrl);
    const acceptHeader = c.req.header("accept");

    const imgproxyResponse = await fetch(imgproxyUrl, {
      headers: acceptHeader ? { Accept: acceptHeader } : undefined
    });

    if (!imgproxyResponse.ok) {
      const status = imgproxyResponse.status;
      if (status === 404) {
        return c.json({ message: "Image not found" }, HttpStatusCodes.NOT_FOUND);
      }
      console.error("Failed to fetch image:", imgproxyResponse.statusText);
      return c.json({ message: "Failed to fetch image" }, HttpStatusCodes.BAD_GATEWAY);
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
    path: "/{code}/image/original",
    summary: "Retrieve original incident type image",
    operationId: "getIncidentTypeOriginalImage",
    description: "Retrieve the original incident type image from storage",
    tags: ["Types"],
    request: {
      params: typeByCodeRequest,
      query: adminAuthedRouteRequestSchema
    },
    responses: {
      [HttpStatusCodes.OK]: {
        description: "Original incident type image (PNG)",
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
      [HttpStatusCodes.NOT_FOUND]: jsonContent(
        createMessageObjectSchema("Image not found"),
        "No image found for this incident type or its parents"
      )
    }
  }),
  async (c) => {
    const { code } = c.req.valid("param");
    const { token } = c.req.valid("query");

    if (token !== env.IMGPROXY_TOKEN) {
      return c.json({ message: "Unauthorized" }, HttpStatusCodes.UNAUTHORIZED);
    }

    const availableCode = await findAvailableImageCode(code);

    if (!availableCode) {
      return c.json({ message: "Image not found" }, HttpStatusCodes.NOT_FOUND);
    }

    const s3Key = getS3Key(availableCode);
    const imageBuffer = await getFromS3(s3Key);

    if (!imageBuffer) {
      return c.json({ message: "Image not found" }, HttpStatusCodes.NOT_FOUND);
    }

    return c.body(new Uint8Array(imageBuffer), HttpStatusCodes.OK, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable"
    });
  }
);

export const typesRouter = app;
