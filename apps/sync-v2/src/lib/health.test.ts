import { afterEach, describe, expect, it } from "vitest";

import { type HealthServer, startHealthServer } from "@/lib/health";

let server: HealthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${server?.port}${path}`);
  return { status: response.status, body: response.status === 404 ? null : await response.json() };
}

describe("health endpoint", () => {
  it("answers 200 when every check passes, with the SIGAE status", async () => {
    const lastSuccess = Date.now() - 5_000;
    server = await startHealthServer({
      port: 0,
      checks: { redis: async () => "PONG", database: async () => undefined },
      lastSigaeSuccessAt: () => lastSuccess
    });

    const { status, body } = await get("/health");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      checks: { redis: "ok", database: "ok" },
      sigae: { lastSuccessAt: new Date(lastSuccess).toISOString() }
    });
    expect(body.sigae.secondsSinceLastSuccess).toBeGreaterThanOrEqual(5);
  });

  it("answers 200 when SIGAE never answered, as long as the dependencies are up", async () => {
    server = await startHealthServer({
      port: 0,
      checks: { redis: async () => "PONG", database: async () => undefined },
      lastSigaeSuccessAt: () => undefined
    });

    const { status, body } = await get("/health");

    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      checks: { redis: "ok", database: "ok" },
      sigae: { lastSuccessAt: null, secondsSinceLastSuccess: null }
    });
  });

  it("answers 503 when a dependency is unreachable", async () => {
    server = await startHealthServer({
      port: 0,
      checks: {
        redis: async () => "PONG",
        database: async () => {
          throw new Error("connection refused");
        }
      },
      lastSigaeSuccessAt: () => undefined
    });

    const { status, body } = await get("/health");

    expect(status).toBe(503);
    expect(body).toEqual({
      status: "unhealthy",
      checks: { redis: "ok", database: "unreachable" },
      sigae: { lastSuccessAt: null, secondsSinceLastSuccess: null }
    });
  });

  it("answers 404 for anything else", async () => {
    server = await startHealthServer({
      port: 0,
      checks: {},
      lastSigaeSuccessAt: () => undefined
    });

    expect((await get("/")).status).toBe(404);
  });
});
