import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import {
  type SigaeClientOptions,
  type SigaeCredentials,
  type SigaeEndpoint,
  type SigaeFetch,
  createSigaeClient
} from "../src/client";

export const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

export const CREDENTIALS: SigaeCredentials = {
  user: "test-user-7f3a",
  password: "s3cr3t-P4ss!",
  systemCode: "SYS-CODE-91",
  ip: "203.0.113.7"
};

export const BASE_URL = "https://sigae.example.test/ws/api/Servicio/";

export interface Fixture {
  file: string;
  source: "synthetic" | "recorded";
  endpoint: SigaeEndpoint;
  request: Record<string, unknown>;
  body: Record<string, unknown>;
}

export function loadFixture(endpoint: SigaeEndpoint, name: string): Record<string, unknown> {
  return readFixture(join(FIXTURES_DIR, endpoint, `${name}.json`)).body;
}

export function allFixtures(): Fixture[] {
  const files = readdirSync(FIXTURES_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".json"))
    .sort();
  return files.map((file) => readFixture(join(FIXTURES_DIR, file)));
}

function readFixture(path: string): Fixture {
  const fixture = JSON.parse(readFileSync(path, "utf8")) as Omit<Fixture, "file">;
  return { ...fixture, file: relative(FIXTURES_DIR, path) };
}

export interface RecordedCall {
  url: string;
  endpoint: string;
  body: Record<string, unknown>;
  init: RequestInit;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** A fake `fetch` that answers per endpoint and records every call. */
export function fakeFetch(handlers: Partial<Record<SigaeEndpoint, Handler>> | Handler) {
  const calls: RecordedCall[] = [];
  const fetch: SigaeFetch = async (url, init) => {
    const call: RecordedCall = {
      url,
      endpoint: url.split("/").at(-1) ?? "",
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      init
    };
    calls.push(call);
    const handler =
      typeof handlers === "function" ? handlers : handlers[call.endpoint as SigaeEndpoint];
    if (!handler) return json({ Codigo: "99", Descripcion: "no handler in test" });
    return handler(call);
  };
  return { fetch, calls };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  });
}

export function testClient(
  handlers: Parameters<typeof fakeFetch>[0],
  options: Partial<SigaeClientOptions> = {}
) {
  const fake = fakeFetch(handlers);
  const client = createSigaeClient({
    baseUrl: BASE_URL,
    credentials: CREDENTIALS,
    fetch: fake.fetch,
    ...options
  });
  return { client, calls: fake.calls };
}

/** Resolves when the signal aborts, rejecting like `fetch` does. */
export function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Everything an error could leak through: message, cause chain, own properties. */
export function serializeDeep(value: unknown, depth = 0): string {
  if (depth > 6 || value === null || value === undefined) return String(value);
  if (value instanceof Error) {
    const props: Record<string, string> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      props[key] = serializeDeep((value as unknown as Record<string, unknown>)[key], depth + 1);
    }
    return JSON.stringify({ name: value.name, message: value.message, props });
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
