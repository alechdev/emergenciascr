/** An error raised by the sync itself. Always pass the underlying error as `cause`. */
export class SyncError extends Error {
  override readonly name = "SyncError";
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
  errors?: SerializedError[];
  [field: string]: unknown;
}

const MAX_DEPTH = 8;
const MAX_AGGREGATED = 10;

/**
 * Fields copied from errors when present: SIGAE client errors (`kind`, `endpoint`,
 * `httpStatus`, `durationMs`, `issues`), sync errors (`incidentId`) and Postgres errors.
 * Postgres `detail` is handled apart (see {@link redactDetail}).
 */
const FIELDS = [
  "kind",
  "code",
  "endpoint",
  "httpStatus",
  "durationMs",
  "issues",
  "incidentId",
  "constraint",
  "table",
  "column"
] as const;

const KEY_DETAIL = /^Key \((.+?)\)=\(.*\) (is not present in table .*|already exists\.)$/s;

/**
 * Postgres `detail` carries row values: `Key (col)=(value) …` for key violations and
 * `Failing row contains (…)` for others. Only the key names survive.
 */
function redactDetail(detail: unknown): string | undefined {
  if (typeof detail !== "string") return undefined;
  const match = KEY_DETAIL.exec(detail);
  return match ? `Key (${match[1]})=(…) ${match[2]}` : undefined;
}

/** Turns an error and its whole cause chain into plain JSON. */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: String(error) };
  }

  const serialized: SerializedError = { name: error.name, message: error.message };
  const source = error as unknown as Record<string, unknown>;
  for (const field of FIELDS) {
    const value = source[field];
    if (value !== undefined && value !== null) serialized[field] = value;
  }
  const detail = redactDetail(source.detail);
  if (detail !== undefined) serialized.detail = detail;
  if (depth === 0 && error.stack) serialized.stack = error.stack;
  if (depth >= MAX_DEPTH) return serialized;

  if (error instanceof AggregateError) {
    serialized.errors = error.errors
      .slice(0, MAX_AGGREGATED)
      .map((item: unknown) => serializeError(item, depth + 1));
  }
  if (error.cause !== undefined) serialized.cause = serializeError(error.cause, depth + 1);
  return serialized;
}
