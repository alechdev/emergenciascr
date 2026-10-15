import { migrateDatabase } from "@bomberoscr/db/migrate";
import { config } from "dotenv";
import { expand } from "dotenv-expand";

expand(config({ quiet: true }));

type SerializedError = {
  name: string;
  message: string;
  code?: string;
  detail?: string;
  cause?: SerializedError;
};

function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: String(error) };
  }
  const { code, detail } = error as { code?: unknown; detail?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === "string" && { code }),
    ...(typeof detail === "string" && { detail }),
    ...(error.cause !== undefined && { cause: serializeError(error.cause) })
  };
}

function log(level: "info" | "error", msg: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
}

const connectionString = process.env.DRIZZLE_POSTGRES_URL;
if (!connectionString) {
  log("error", "DRIZZLE_POSTGRES_URL is not set");
  process.exit(1);
}

const startedAt = performance.now();
try {
  const result = await migrateDatabase(connectionString);
  log("info", result.applied.length > 0 ? "migrations applied" : "database up to date", {
    applied: result.applied,
    total: result.total,
    durationMs: Math.round(performance.now() - startedAt)
  });
} catch (error) {
  log("error", "migration failed", {
    error: serializeError(error),
    durationMs: Math.round(performance.now() - startedAt)
  });
  process.exit(1);
}
