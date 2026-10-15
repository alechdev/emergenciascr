import { type Server, createServer } from "node:http";

const CHECK_TIMEOUT_MS = 3_000;

export interface HealthOptions {
  port: number;
  /** Each check rejects when its dependency is unreachable. */
  checks: Record<string, () => Promise<unknown>>;
  /** Reported but never fails the check: restarting doesn't fix SIGAE being down. */
  lastSigaeSuccessAt: () => number | undefined;
}

export interface HealthServer {
  readonly port: number;
  close(): Promise<void>;
}

/** `GET /health`: 200 when every check passes, 503 otherwise. Internal only. */
export async function startHealthServer(options: HealthOptions): Promise<HealthServer> {
  const server: Server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url?.split("?")[0] !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const body = await runChecks(options);
    response
      .writeHead(body.status === "ok" ? 200 : 503, { "Content-Type": "application/json" })
      .end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : options.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })
  };
}

async function runChecks(options: HealthOptions) {
  const entries = await Promise.all(
    Object.entries(options.checks).map(async ([name, check]) => {
      try {
        await withTimeout(check(), CHECK_TIMEOUT_MS);
        return [name, "ok"] as const;
      } catch {
        return [name, "unreachable"] as const;
      }
    })
  );
  const checks = Object.fromEntries(entries);
  const lastSuccess = options.lastSigaeSuccessAt();
  return {
    status: entries.every(([, state]) => state === "ok") ? "ok" : "unhealthy",
    checks,
    sigae: {
      lastSuccessAt: lastSuccess === undefined ? null : new Date(lastSuccess).toISOString(),
      secondsSinceLastSuccess:
        lastSuccess === undefined ? null : Math.round((Date.now() - lastSuccess) / 1000)
    }
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
