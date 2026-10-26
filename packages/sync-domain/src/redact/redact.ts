import { createHash } from "node:crypto";

import { type Allowlist, SNAPSHOT_ALLOWLISTS } from "./allowlists";

import type { JsonValue, SigaeIncidentEndpoint } from "../types";

export type RedactedPayload = { [key: string]: JsonValue };

/**
 * Keeps only the allowlisted keys of a raw SIGAE response. Allowlisted scalars must be JSON
 * scalars and allowlisted lists must be arrays (or `null`); anything else is dropped, so a
 * field changing shape can't smuggle unlisted data into a snapshot. A conditional scalar is
 * dropped unless its condition holds.
 */
export function redactSnapshot(endpoint: SigaeIncidentEndpoint, raw: unknown): RedactedPayload {
  return isRecord(raw) ? redactObject(raw, SNAPSHOT_ALLOWLISTS[endpoint]) : {};
}

function redactObject(value: Record<string, unknown>, allowlist: Allowlist): RedactedPayload {
  const redacted: RedactedPayload = {};
  for (const [key, field] of Object.entries(value)) {
    const rule = Object.hasOwn(allowlist, key) ? allowlist[key] : undefined;
    if (rule === undefined) continue;
    if (rule === true) {
      if (isScalar(field)) redacted[key] = field;
      continue;
    }
    if ("when" in rule) {
      if (value[rule.when.field] === rule.when.equals && isScalar(field)) redacted[key] = field;
      continue;
    }
    if (field === null) {
      redacted[key] = null;
    } else if (Array.isArray(field)) {
      redacted[key] = field.filter(isRecord).map((item) => redactObject(item, rule.each));
    }
  }
  return redacted;
}

/** sha256 of the key-sorted JSON, so equal payloads hash equally whatever their key order. */
export function payloadHash(payload: JsonValue): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] as JsonValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
