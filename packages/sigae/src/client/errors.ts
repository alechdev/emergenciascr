import type { SigaeEndpoint } from "./endpoints";

/**
 * Why nothing usable came back from SIGAE.
 *
 * - `timeout`: the request took longer than its timeout.
 * - `aborted`: the caller's `AbortSignal` fired.
 * - `network`: the connection to SIGAE failed or broke.
 * - `proxy`: the configured proxy refused, failed authentication (`407`) or could not
 *   reach SIGAE (`502`).
 * - `http`: SIGAE answered with a non-2xx status.
 * - `invalid_json`: the body was not JSON.
 * - `unexpected_shape`: JSON without an envelope, or a field the sync reads has the wrong
 *   type or format.
 */
export type SigaeErrorKind =
  | "timeout"
  | "aborted"
  | "network"
  | "proxy"
  | "http"
  | "invalid_json"
  | "unexpected_shape";

export interface SigaeShapeIssue {
  path: string;
  message: string;
}

/**
 * Never contains the request body, credentials or the proxy URL. Causes are copied into
 * plain errors with those values scrubbed, because runtime errors may include them.
 */
export class SigaeError extends Error {
  override readonly name = "SigaeError";
  readonly kind: SigaeErrorKind;
  readonly endpoint: SigaeEndpoint;
  readonly durationMs: number;
  readonly httpStatus: number | undefined;
  readonly issues: readonly SigaeShapeIssue[] | undefined;

  constructor(args: {
    kind: SigaeErrorKind;
    endpoint: SigaeEndpoint;
    durationMs: number;
    message: string;
    httpStatus?: number;
    issues?: readonly SigaeShapeIssue[];
    cause?: Error;
  }) {
    super(`SIGAE ${args.endpoint}: ${args.message}`, { cause: args.cause });
    this.kind = args.kind;
    this.endpoint = args.endpoint;
    this.durationMs = args.durationMs;
    this.httpStatus = args.httpStatus;
    this.issues = args.issues;
  }
}

const MAX_CAUSE_DEPTH = 5;

/** Copies an error chain into plain `Error`s whose messages have every secret removed. */
export function sanitizeError(
  error: unknown,
  secrets: readonly string[],
  depth = 0
): Error | undefined {
  if (error === undefined || error === null || depth >= MAX_CAUSE_DEPTH) return undefined;

  const source = error instanceof Error ? error : undefined;
  const message = scrub(source ? source.message : String(error), secrets);
  const cause = source ? sanitizeError(source.cause, secrets, depth + 1) : undefined;
  const copy = new Error(message, cause ? { cause } : undefined);
  copy.name = source?.name ?? "NonError";

  const code = (source as { code?: unknown } | undefined)?.code;
  if (typeof code === "string" || typeof code === "number") {
    (copy as Error & { code?: string | number }).code = code;
  }
  delete copy.stack;
  return copy;
}

function scrub(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("[redacted]");
  }
  return result;
}

/** Returns each error in a cause chain, outermost first. */
export function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < MAX_CAUSE_DEPTH + 1) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}
