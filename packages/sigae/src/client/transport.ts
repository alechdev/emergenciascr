import { causeChain } from "./errors";

/** A `fetch`-compatible function. Only `POST` with a JSON string body is used. */
export type SigaeFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface Transport {
  fetch: SigaeFetch;
  readonly proxied: boolean;
  close(): Promise<void>;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export function createTransport(options: { proxy?: URL; fetch?: SigaeFetch }): Transport {
  if (options.fetch) {
    return { fetch: options.fetch, proxied: false, close: async () => {} };
  }
  const proxy = options.proxy;
  if (!proxy) {
    return {
      fetch: (url, init) => globalThis.fetch(url, init),
      proxied: false,
      close: async () => {}
    };
  }
  return isBun ? createBunProxyTransport(proxy) : createUndiciProxyTransport(proxy);
}

/** Bun's `fetch` takes the proxy URL, including basic auth, as an option. */
function createBunProxyTransport(proxy: URL): Transport {
  const proxyUrl = proxy.href;
  return {
    proxied: true,
    fetch: (url, init) => globalThis.fetch(url, { ...init, proxy: proxyUrl } as RequestInit),
    close: async () => {}
  };
}

/**
 * Node's global `fetch` is undici, but a dispatcher from a separately installed undici is
 * not guaranteed to work with it across versions. Use undici's own `fetch` with its
 * `ProxyAgent` so both always match. Loaded lazily so Bun never imports undici.
 */
function createUndiciProxyTransport(proxy: URL): Transport {
  let loaded:
    | Promise<{ fetch: typeof import("undici").fetch; agent: import("undici").ProxyAgent }>
    | undefined;
  const load = () => {
    loaded ??= import("undici").then((undici) => ({
      fetch: undici.fetch,
      agent: new undici.ProxyAgent({ uri: proxy.href })
    }));
    return loaded;
  };

  return {
    proxied: true,
    fetch: async (url, init) => {
      const { fetch, agent } = await load();
      const response = await fetch(url, {
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body as string,
        signal: init.signal ?? undefined,
        dispatcher: agent
      });
      return response as unknown as Response;
    },
    close: async () => {
      if (!loaded) return;
      const { agent } = await loaded;
      await agent.close();
    }
  };
}

/**
 * With a proxy, the only connection the client opens itself is to the proxy, so failing to
 * open it is a proxy problem. Node reports a refused CONNECT as a thrown error; Bun
 * returns the proxy's response instead (handled by {@link classifyHttpStatus}).
 */
const CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ConnectionRefused",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "FailedToOpenSocket",
  "UND_ERR_CONNECT_TIMEOUT"
]);

const PROXY_TUNNEL_PATTERN = /Proxy response \((\d{3})\) !== 200/;

export function classifyTransportError(
  error: unknown,
  proxied: boolean
): { kind: "proxy" | "network"; httpStatus?: number } {
  if (!proxied) return { kind: "network" };
  for (const item of causeChain(error)) {
    if (!(item instanceof Error) && typeof item !== "object") continue;
    const message = (item as { message?: unknown }).message;
    const tunnel = typeof message === "string" ? PROXY_TUNNEL_PATTERN.exec(message) : null;
    if (tunnel) return { kind: "proxy", httpStatus: Number(tunnel[1]) };
    const code = (item as { code?: unknown }).code;
    if (typeof code === "string" && CONNECT_ERROR_CODES.has(code)) return { kind: "proxy" };
  }
  return { kind: "network" };
}

/**
 * `407` only comes from proxies. Through a proxy, `502` is how it reports that it could not
 * reach SIGAE; Bun returns that response as-is for a failed CONNECT.
 */
export function classifyHttpStatus(status: number, proxied: boolean): "proxy" | "http" {
  if (status === 407) return "proxy";
  if (proxied && status === 502) return "proxy";
  return "http";
}
