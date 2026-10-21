const MAX_CAUSES = 5;

/**
 * Drizzle wraps database errors as `Failed query: <sql>\nparams: <values>`. The values are
 * row data, so only the statement's first words are kept; the driver error follows as the
 * cause.
 */
export function redactQueryMessage(message: string): string {
  if (!message.startsWith("Failed query: ")) return message;
  const statement = message.slice("Failed query: ".length).split("\n")[0] ?? "";
  return `Failed query: ${statement.split(/\s+/).slice(0, 4).join(" ")} …`;
}

/** An error's message followed by its causes', for `lastError` and summaries. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && parts.length < MAX_CAUSES) {
    // Empty or repeated messages don't add parts, so only this ends a cyclic chain.
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof Error) {
      const message = redactQueryMessage(current.message);
      if (message && !parts.includes(message)) parts.push(message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.length > 0 ? parts.join(": ") : "unknown error";
}
