import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FAKE_CREDENTIALS,
  INCIDENT_ID,
  INTEGRATION,
  type IncidentAnswers,
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
  type TestDatabase,
  detailsBody,
  eventually,
  listBody,
  loadHistory,
  openTestDatabase,
  reportBody,
  resetDatabase,
  seedReferences,
  sigaeFixtureBody,
  sigaeTime,
  station,
  unit
} from "./harness";

import type { SigaeEndpoint } from "@bomberoscr/sigae/client";
import type Redis from "ioredis";

const MINUTE = 60_000;
/** How long SIGAE takes to answer the incident poll: the shutdown starts meanwhile. */
const POLL_HOLD_MS = 2_000;
const APP = fileURLToPath(new URL("../../", import.meta.url));

function incidentAnswers(reportedAt: Date): IncidentAnswers {
  const time = sigaeTime(reportedAt);
  const date = `${time.slice(0, 10)}T00:00:00`;
  return {
    ObtenerBoletaIncidente: { body: reportBody({ Fecha: date, Hora_Aviso: time }) },
    ObtenerDetalleEmergencias: { body: detailsBody({ fecha: date, hora_incidente: time }) },
    ObtenerEstacionesAtiendeIncidente: { body: listBody([station()]) },
    ObtenerUnidadesDespachadasIncidente: {
      body: listBody([unit({ HoraDespacho: sigaeTime(new Date(reportedAt.getTime() + MINUTE)) })])
    }
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * The real service (`src/index.ts`) in a child process, against the throwaway Postgres and
 * Redis, a fake SIGAE server and a fake OTLP collector. SIGTERM arrives while a poll waits
 * for SIGAE: the poll must finish and be stored, and the telemetry flushed, before exit.
 */
describe.skipIf(!INTEGRATION)("graceful shutdown", () => {
  let db: TestDatabase;
  let redis: Redis;
  let closeRedis: () => Promise<void>;
  let child: ChildProcess | undefined;
  let cwd: string | undefined;
  const servers: Server[] = [];

  beforeAll(async () => {
    db = await openTestDatabase();
    ({ redis, closeRedis } = await import("@/config/redis"));
  });
  afterAll(async () => {
    child?.kill("SIGKILL");
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await closeRedis?.();
    await db?.$client.end();
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("finishes the running poll and flushes telemetry on SIGTERM", async () => {
    await redis.flushall();
    await resetDatabase(db);
    await seedReferences(db);
    const { trackNewIncidents, loadSyncState } = await import("@bomberoscr/sync-domain/persist");
    await trackNewIncidents(db, [{ incidentId: INCIDENT_ID, firstSeenAt: new Date() }]);
    // What the legacy sync left in Redis: boot removes it.
    const { Queue } = await import("bullmq");
    const legacy = new Queue("open-incidents", { connection: redis });
    await legacy.add("open-incident", { incidentId: INCIDENT_ID }, { jobId: "open-incident-1" });
    await legacy.close();

    const answers = incidentAnswers(new Date(Date.now() - MINUTE));
    let pollStarted: () => void = () => {};
    const pollRequested = new Promise<void>((resolve) => {
      pollStarted = resolve;
    });
    const answeredAt: number[] = [];
    const sigae = createServer(async (request, response) => {
      await readBody(request);
      const endpoint = (request.url ?? "").split("/").at(-1) as SigaeEndpoint;
      const incident = answers[endpoint as keyof IncidentAnswers];
      let body: unknown;
      if (incident && "body" in incident) {
        pollStarted();
        await new Promise((resolve) => setTimeout(resolve, POLL_HOLD_MS));
        answeredAt.push(Date.now());
        body = incident.body;
      } else if (
        endpoint === "ObtenerListaEmergenciasApp" ||
        endpoint === "ObtenerListaUltimasEmergenciasApp"
      ) {
        body = sigaeFixtureBody(endpoint, { items: [] });
      } else {
        body = sigaeFixtureBody(endpoint);
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    });
    const exports: { path: string; body: string }[] = [];
    const collector = createServer(async (request, response) => {
      exports.push({ path: request.url ?? "", body: await readBody(request) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
    servers.push(sigae, collector);
    const [sigaePort, collectorPort, healthPort] = await Promise.all([
      listen(sigae),
      listen(collector),
      freePort()
    ]);

    // Outside the app directory, so no `.env` is loaded: everything comes from here.
    cwd = mkdtempSync(join(tmpdir(), "sync-v2-shutdown-"));
    const output: string[] = [];
    const started = spawn(
      join(APP, "node_modules/.bin/tsx"),
      ["--tsconfig", join(APP, "tsconfig.json"), join(APP, "src/index.ts")],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TZ: process.env.TZ,
          NODE_ENV: "test",
          LOG_LEVEL: "info",
          REDIS_URL: TEST_REDIS_URL,
          DRIZZLE_POSTGRES_URL: TEST_DATABASE_URL,
          SIGAE_API_URL: `http://127.0.0.1:${sigaePort}/ws/api/Servicio/`,
          SIGAE_IP: FAKE_CREDENTIALS.ip,
          SIGAE_USER: FAKE_CREDENTIALS.user,
          SIGAE_PASSWORD: FAKE_CREDENTIALS.password,
          SIGAE_COD_SYS: FAKE_CREDENTIALS.systemCode,
          HEALTH_HOST: "127.0.0.1",
          HEALTH_PORT: String(healthPort),
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorPort}`,
          OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
          OTEL_SERVICE_NAME: "sync-v2-shutdown-test"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child = started;
    started.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
    started.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
    const exited = new Promise<number | null>((resolve) => started.on("exit", resolve));

    await Promise.race([
      pollRequested,
      exited.then(() => {
        throw new Error(`sync-v2 exited before polling:\n${output.join("")}`);
      })
    ]);
    const signalledAt = Date.now();
    started.kill("SIGTERM");
    const code = await Promise.race([
      exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`no exit:\n${output.join("")}`)), 40_000)
      )
    ]);
    child = undefined;
    const log = output
      .join("")
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(code, output.join("")).toBe(0);
    expect(answeredAt.length).toBe(4);
    expect(Math.min(...answeredAt)).toBeGreaterThan(signalledAt);

    // The poll was stored and its job moved back to delayed for the next one.
    const state = await loadSyncState(db, INCIDENT_ID);
    expect(state).toMatchObject({ phase: "active", consecutiveFailures: 0 });
    expect(state?.lastPolledAt).not.toBeNull();
    expect((await loadHistory(db, INCIDENT_ID)).snapshots).toHaveLength(4);
    expect(
      await redis.zscore(`bull:incident-poll:delayed`, `incident-poll-${INCIDENT_ID}`)
    ).not.toBeNull();

    expect(await redis.keys("bull:open-incidents:*")).toEqual([]);
    expect(log).toContainEqual(
      expect.objectContaining({ message: "removed legacy queue", queue: "open-incidents" })
    );

    const messages = log.map((entry) => entry.message);
    const stopping = messages.indexOf("shutting down");
    const polled = log.findIndex(
      (entry) => entry.message === "incident polled" && entry.incidentId === INCIDENT_ID
    );
    expect(stopping).toBeGreaterThanOrEqual(0);
    expect(polled).toBeGreaterThan(stopping);
    expect(log.at(-1)).toMatchObject({ message: "sync-v2 stopped", exitCode: 0 });
    expect(log.filter((entry) => entry.level === "error")).toEqual([]);

    // The metric interval is a minute, so metrics only arrive through the shutdown flush.
    await eventually(async () => exports.length > 0);
    const paths = new Set(exports.map((item) => item.path));
    expect(paths).toEqual(new Set(["/v1/traces", "/v1/metrics", "/v1/logs"]));
    const sent = (path: string) =>
      exports
        .filter((item) => item.path === path)
        .map((item) => item.body)
        .join("\n");
    expect(sent("/v1/traces")).toContain('"name":"sync.poll"');
    expect(sent("/v1/metrics")).toContain('"name":"sync.poll.results"');
    expect(sent("/v1/logs")).toContain('"stringValue":"incident polled"');
    for (const secret of [FAKE_CREDENTIALS.user, FAKE_CREDENTIALS.password]) {
      expect(exports.map((item) => item.body).join("\n")).not.toContain(secret);
      expect(output.join("")).not.toContain(secret);
    }
  });
});
