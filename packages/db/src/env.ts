import { config } from "dotenv";
import { expand } from "dotenv-expand";
import { z } from "zod";

/**
 * `DRIZZLE_POSTGRES_URL` is the only setting validated here. `POSTGRES_*` variables are not
 * required, but a `.env` may still build the URL from them through dotenv expansion.
 */
const EnvSchema = z.object({
  DRIZZLE_POSTGRES_URL: z.string().min(1)
});

export type EnvSchema = z.infer<typeof EnvSchema>;

expand(config({ quiet: true }));

function validateEnv() {
  if (process.env.SKIP_ENV_CHECK) {
    return process.env as unknown as EnvSchema;
  }

  return EnvSchema.parse(process.env);
}

export default validateEnv();
