import { config } from "dotenv";
import { expand } from "dotenv-expand";
import { z } from "zod";

/** Treats `KEY=` like an unset variable. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.string().default("production"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  REDIS_URL: z.string().min(1),
  SIGAE_API_URL: z.url(),
  SIGAE_IP: z.string().min(1),
  SIGAE_USER: z.string().min(1),
  SIGAE_PASSWORD: z.string().min(1),
  SIGAE_COD_SYS: z.string().min(1),
  SIGAE_PROXY_URL: optional(z.url()),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HEALTH_HOST: optional(z.string()).transform((value) => value ?? "127.0.0.1"),
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.url()),
  OTEL_SERVICE_NAME: optional(z.string())
});

export type Env = z.infer<typeof EnvSchema>;

expand(config({ quiet: true }));

function validateEnv(): Env {
  if (process.env.SKIP_ENV_CHECK) {
    return process.env as unknown as Env;
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Issue messages name the variable and the problem, never the value.
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

const env = validateEnv();

export default env;
