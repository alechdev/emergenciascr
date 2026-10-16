import { config } from "dotenv";
import { expand } from "dotenv-expand";
import { z } from "zod";

/** The URL is the only connection setting; `POSTGRES_*` variables, if set, aren't read. */
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
