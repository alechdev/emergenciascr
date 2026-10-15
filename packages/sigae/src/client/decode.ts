import { ENDPOINTS, type SigaeEndpoint, type SigaeEndpointTypes } from "./endpoints";

import type { SigaeShapeIssue } from "./errors";
import type { z } from "zod";

export const SIGAE_CODE_OK = "00";
export const SIGAE_CODE_NOT_FOUND = "03";

/** The JSON body exactly as SIGAE sent it. */
export type SigaeRawResponse = Record<string, unknown>;

/**
 * What SIGAE answered.
 *
 * - `ok`: `Codigo` `00`, and the fields the sync reads are valid.
 * - `not_found`: `Codigo` `03`. The body is full of default values, so only `raw` is kept.
 * - `upstream_error`: any other `Codigo`. SIGAE often still sends most of the body (for
 *   example `ObtenerBoletaIncidente` with `99`), kept as `data` when its fields are valid.
 */
export type SigaeResponse<T> =
  | { kind: "ok"; data: T; raw: SigaeRawResponse }
  | { kind: "not_found"; raw: SigaeRawResponse }
  | {
      kind: "upstream_error";
      code: string;
      description: string;
      data: Partial<T>;
      raw: SigaeRawResponse;
    };

export type DecodeResult<E extends SigaeEndpoint> =
  | { ok: true; response: SigaeResponse<SigaeEndpointTypes[E]> }
  | { ok: false; message: string; issues?: SigaeShapeIssue[] };

export function decodeBody<E extends SigaeEndpoint>(endpoint: E, body: unknown): DecodeResult<E> {
  if (!isPlainObject(body)) {
    return { ok: false, message: "response is not a JSON object" };
  }
  const raw = body;
  const codigo = raw.Codigo;
  if (typeof codigo !== "string") {
    return { ok: false, message: "response has no Codigo" };
  }
  if (codigo === SIGAE_CODE_NOT_FOUND) {
    return { ok: true, response: { kind: "not_found", raw } };
  }

  const definition = ENDPOINTS[endpoint];
  const normalized = definition.isList ? normalizeItems(raw) : raw;

  if (codigo === SIGAE_CODE_OK) {
    const parsed = definition.schema.safeParse(normalized);
    if (!parsed.success) return shapeError(parsed.error);
    return {
      ok: true,
      response: { kind: "ok", data: parsed.data as SigaeEndpointTypes[E], raw }
    };
  }

  const parsed = definition.schema.partial().safeParse(normalized);
  if (!parsed.success) return shapeError(parsed.error);
  return {
    ok: true,
    response: {
      kind: "upstream_error",
      code: codigo,
      description: typeof raw.Descripcion === "string" ? raw.Descripcion : "",
      data: parsed.data as Partial<SigaeEndpointTypes[E]>,
      raw
    }
  };
}

function normalizeItems(raw: SigaeRawResponse): SigaeRawResponse {
  if (!("Items" in raw)) return raw;
  const { Items, ...rest } = raw;
  return "items" in rest ? rest : { ...rest, items: Items };
}

function shapeError(error: z.ZodError): { ok: false; message: string; issues: SigaeShapeIssue[] } {
  const issues = error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message
  }));
  const summary = issues
    .slice(0, 3)
    .map((issue) => `${issue.path || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, message: `unexpected response shape (${summary})`, issues };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
