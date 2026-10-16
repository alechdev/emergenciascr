/**
 * Runs before every integration test file. sync-v2 modules read their configuration from
 * env and `.env` on import, so every server they could reach is pointed at a throwaway one
 * (or an unreachable loopback port) first. dotenv never overrides a variable that is already
 * set, and dotenv-expand replaces empty ones, so every value here is non-empty.
 */
import { FAKE_CREDENTIALS, FAKE_SIGAE_URL, assertThrowaway } from "./harness";

const redisUrl = process.env.TEST_REDIS_URL || undefined;
const databaseUrl = process.env.TEST_DATABASE_URL || undefined;
if (redisUrl) assertThrowaway(redisUrl, "TEST_REDIS_URL", ["REDIS_URL"]);
if (databaseUrl) assertThrowaway(databaseUrl, "TEST_DATABASE_URL", ["DRIZZLE_POSTGRES_URL"]);

const UNREACHABLE = "127.0.0.1:9";
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: process.env.LOG_LEVEL || "error",
  REDIS_URL: redisUrl ?? `redis://${UNREACHABLE}`,
  // Tests pass their database in; nothing may use the env-built one.
  DRIZZLE_POSTGRES_URL: `postgres://none@${UNREACHABLE}/none`,
  SIGAE_API_URL: FAKE_SIGAE_URL,
  SIGAE_IP: FAKE_CREDENTIALS.ip,
  SIGAE_USER: FAKE_CREDENTIALS.user,
  SIGAE_PASSWORD: FAKE_CREDENTIALS.password,
  SIGAE_COD_SYS: FAKE_CREDENTIALS.systemCode,
  OTEL_EXPORTER_OTLP_ENDPOINT: `http://${UNREACHABLE}`,
  OTEL_TRACES_EXPORTER: "none",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "none"
});
