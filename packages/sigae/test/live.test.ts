/**
 * Opt-in smoke test against the real SIGAE, through `SIGAE_PROXY_URL` when it is set.
 *
 *   SIGAE_ENV_FILE=../../apps/sync-v2/.env bun run test:live
 *
 * Reads SIGAE_API_URL, SIGAE_USER, SIGAE_PASSWORD, SIGAE_COD_SYS (or SIGAE_SYSTEM_CODE),
 * SIGAE_IP and the optional SIGAE_PROXY_URL. Prints nothing from the response body.
 */
import { config } from "dotenv";
import { describe, expect, test } from "vitest";

import { createSigaeClient } from "../src/client";

const live = process.env.SIGAE_LIVE === "1";
if (live && process.env.SIGAE_ENV_FILE) config({ path: process.env.SIGAE_ENV_FILE, quiet: true });
// apps/web names it SIGAE_COD_SYS, apps/sync-v2 SIGAE_SYSTEM_CODE.
if (live && !process.env.SIGAE_COD_SYS && process.env.SIGAE_SYSTEM_CODE) {
  process.env.SIGAE_COD_SYS = process.env.SIGAE_SYSTEM_CODE;
}

describe.skipIf(!live)("live SIGAE", () => {
  test("ping() gets a successful answer", async () => {
    const env = (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`${key} is not set`);
      return value;
    };
    const client = createSigaeClient({
      baseUrl: env("SIGAE_API_URL"),
      credentials: {
        user: env("SIGAE_USER"),
        password: env("SIGAE_PASSWORD"),
        systemCode: env("SIGAE_COD_SYS"),
        ip: env("SIGAE_IP")
      },
      proxy: process.env.SIGAE_PROXY_URL || undefined
    });
    try {
      const result = await client.ping();
      if (result.isErr()) {
        throw new Error(`${result.error.kind}: ${result.error.message}`);
      }
      const response = result.value;
      const detail = response.kind === "upstream_error" ? ` (Codigo ${response.code})` : "";
      expect(response.kind, `SIGAE answered ${response.kind}${detail}`).toBe("ok");
    } finally {
      await client.close();
    }
  }, 30_000);
});
