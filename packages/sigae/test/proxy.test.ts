/**
 * Proxy integration tests against a local fake SIGAE and a local HTTP proxy. They run on
 * whichever runtime runs the suite: Bun sends plain-HTTP requests to the proxy in absolute
 * form, Node (undici's ProxyAgent) always tunnels with CONNECT, so the proxy handles both.
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { type SigaeClient, type SigaeClientOptions, createSigaeClient } from "../src/client";
import { CREDENTIALS, loadFixture, serializeDeep } from "./helpers";

const PROXY_USER = "proxy-user";
const PROXY_PASSWORD = "pr0xy p@ss/word";
const EXPECTED_AUTH = `Basic ${Buffer.from(`${PROXY_USER}:${PROXY_PASSWORD}`).toString("base64")}`;

const runtime = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : "node";

interface ProxyLog {
  method: string;
  target: string;
  authorized: boolean;
}

let sigae: http.Server;
let proxy: http.Server;
let sigaeUrl: string;
let proxyPort: number;
const proxyLog: ProxyLog[] = [];
const sockets = new Set<net.Socket>();

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startProxy(): http.Server {
  const server = http.createServer((req, res) => {
    const authorized = req.headers["proxy-authorization"] === EXPECTED_AUTH;
    proxyLog.push({ method: req.method ?? "", target: req.url ?? "", authorized });
    if (!authorized) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="test"' }).end();
      return;
    }
    const target = new URL(req.url ?? "");
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: req.method,
        headers
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  });

  server.on("connect", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const authorized = req.headers["proxy-authorization"] === EXPECTED_AUTH;
    proxyLog.push({ method: "CONNECT", target: req.url ?? "", authorized });
    if (!authorized) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\n\r\n'
      );
      return;
    }
    const [host, port] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  });
  return server;
}

beforeAll(async () => {
  const provinces = JSON.stringify(loadFixture("ObtenerProvinciaLista", "ok"));
  sigae = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" }).end(provinces);
    });
  });
  sigaeUrl = `http://127.0.0.1:${await listen(sigae)}/ws/api/Servicio/`;
  proxy = startProxy();
  proxyPort = await listen(proxy);
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all([
    new Promise((resolve) => proxy.close(resolve)),
    new Promise((resolve) => sigae.close(resolve))
  ]);
});

function proxyUrl({ password = PROXY_PASSWORD, port = proxyPort, host = "127.0.0.1" } = {}) {
  return `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(password)}@${host}:${port}`;
}

async function withClient<T>(
  options: Partial<SigaeClientOptions>,
  run: (client: SigaeClient) => PromiseLike<T>
): Promise<T> {
  const client = createSigaeClient({
    baseUrl: sigaeUrl,
    credentials: CREDENTIALS,
    timeoutMs: 5_000,
    ...options
  });
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function expectNoProxySecrets(value: unknown, url: string) {
  const serialized = serializeDeep(value);
  for (const secret of [
    url,
    PROXY_PASSWORD,
    encodeURIComponent(PROXY_PASSWORD),
    EXPECTED_AUTH.slice("Basic ".length),
    CREDENTIALS.password
  ]) {
    expect(serialized).not.toContain(secret);
  }
}

describe(`proxy (${runtime})`, () => {
  test("requests go through the proxy with basic auth", async () => {
    proxyLog.length = 0;
    const result = await withClient({ proxy: proxyUrl() }, (client) => client.ping());
    expect(result.isOk() && result.value.kind).toBe("ok");
    expect(proxyLog.length).toBeGreaterThan(0);
    expect(proxyLog.every((entry) => entry.authorized)).toBe(true);
    expect(proxyLog[0]?.method).toBe(runtime === "node" ? "CONNECT" : "POST");
  });

  test("a rejected proxy password is a proxy error with status 407", async () => {
    const url = proxyUrl({ password: "wrong-password-123" });
    const result = await withClient({ proxy: url }, (client) => client.ping());
    if (result.isOk()) throw new Error("expected an error");
    expect(result.error.kind).toBe("proxy");
    expect(result.error.httpStatus).toBe(407);
    expectNoProxySecrets(result.error, url);
    expect(serializeDeep(result.error)).not.toContain("wrong-password-123");
  });

  test("an unreachable proxy is a proxy error", async () => {
    const url = proxyUrl({ port: await closedPort() });
    const result = await withClient({ proxy: url }, (client) => client.ping());
    if (result.isOk()) throw new Error("expected an error");
    expect(result.error.kind).toBe("proxy");
    expectNoProxySecrets(result.error, url);
  });

  test("a proxy host that does not resolve is a proxy error", async () => {
    const url = proxyUrl({ host: "proxy.does-not-exist.invalid" });
    const result = await withClient({ proxy: url }, (client) => client.ping());
    if (result.isOk()) throw new Error("expected an error");
    expect(result.error.kind).toBe("proxy");
    expectNoProxySecrets(result.error, url);
  });

  test("a proxy that cannot reach SIGAE is a proxy error with status 502", async () => {
    const url = proxyUrl();
    const result = await withClient(
      { proxy: url, baseUrl: `http://127.0.0.1:${await closedPort()}/ws/` },
      (client) => client.ping()
    );
    if (result.isOk()) throw new Error("expected an error");
    expect(result.error.kind).toBe("proxy");
    expect(result.error.httpStatus).toBe(502);
    expectNoProxySecrets(result.error, url);
  });

  test("without a proxy, a refused connection is a network error", async () => {
    const result = await withClient(
      { baseUrl: `http://127.0.0.1:${await closedPort()}/ws/` },
      (client) => client.ping()
    );
    if (result.isOk()) throw new Error("expected an error");
    expect(result.error.kind).toBe("network");
  });
});
