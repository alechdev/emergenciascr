import { config } from "dotenv";
import { expand } from "dotenv-expand";
import path from "node:path";
import { z } from "zod";

/** Treats `KEY=` like an unset variable. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

expand(
  config({
    path: path.resolve(process.cwd(), process.env.NODE_ENV === "test" ? ".env.test" : ".env")
  })
);

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(9999),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
  API_URL: z.string().url(),
  SIGAE_API_URL: optional(z.string().url()),
  SIGAE_IP: optional(z.string()),
  SIGAE_PASSWORD: optional(z.string()),
  SIGAE_USER: optional(z.string()),
  SIGAE_COD_SYS: optional(z.string()),
  SIGAE_PROXY_URL: optional(z.string().url()),
  ADMIN_TOKEN: z.string().optional(),
  MAPBOX_API_KEY: z.string(),
  INTERNAL_API_URL: z.string().url(),
  IMGPROXY_BASE_URL: z.string().url(),
  IMGPROXY_KEY: z.string(),
  IMGPROXY_SALT: z.string(),
  IMGPROXY_TOKEN: z.string(),
  SITEMAP_TOKEN: z.string().optional(),
  S3_ENDPOINT: z.string().url(),
  S3_KEY_ID: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET_NAME: z.string()
});

export type env = z.infer<typeof EnvSchema>;

const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid env:");
  console.error(JSON.stringify(parsedEnv.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

const env = parsedEnv.data;

export default env;
