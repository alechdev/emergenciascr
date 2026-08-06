import { extname, join, normalize, sep } from "node:path";

import startServer from "./dist/server/server.js";

const BASE_PATH = "";
const PORT = Number(process.env.PORT ?? 3000);

const startFetch =
  ("fetch" in startServer && typeof startServer.fetch === "function"
    ? startServer.fetch
    : undefined) ??
  ("default" in startServer &&
  typeof startServer.default === "object" &&
  startServer.default !== null &&
  "fetch" in startServer.default &&
  typeof startServer.default.fetch === "function"
    ? startServer.default.fetch
    : undefined);

if (!startFetch) {
  throw new Error("Missing fetch handler in dist/server/server.js");
}

const clientRoot = normalize(join(import.meta.dir, "dist", "client"));
const clientRootWithSep = clientRoot.endsWith(sep) ? clientRoot : `${clientRoot}${sep}`;

function normalizeBasePathRequest(request: Request): Request {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return request;
  }

  const url = new URL(request.url);

  // TanStack Start canonicalizes the base path root to `BASE_PATH/`.
  // Serve the bare base path as that same document to avoid an external redirect hop.
  if (url.pathname !== BASE_PATH) {
    return request;
  }

  url.pathname = `${BASE_PATH}/`;
  return new Request(url.toString(), request);
}

function toStaticRelativePath(pathname: string): string | null {
  let relativePath = pathname;

  if (relativePath.startsWith(`${BASE_PATH}/`)) {
    relativePath = relativePath.slice(BASE_PATH.length + 1);
  } else if (relativePath.startsWith("/")) {
    relativePath = relativePath.slice(1);
  }

  if (!relativePath || !extname(relativePath)) {
    return null;
  }

  return relativePath;
}

function resolveStaticFilePath(pathname: string): string | null {
  const relativePath = toStaticRelativePath(pathname);

  if (!relativePath) {
    return null;
  }

  const filePath = normalize(join(clientRoot, relativePath));

  if (!(filePath === clientRoot || filePath.startsWith(clientRootWithSep))) {
    return null;
  }

  return filePath;
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const normalizedRequest = normalizeBasePathRequest(request);
    const url = new URL(normalizedRequest.url);
    const staticFilePath = resolveStaticFilePath(url.pathname);

    if (staticFilePath) {
      const file = Bun.file(staticFilePath);

      if (await file.exists()) {
        const headers = new Headers();

        if (url.pathname.includes("/assets/")) {
          headers.set("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          headers.set("Cache-Control", "public, max-age=3600");
        }

        return new Response(file, { headers });
      }
    }

    try {
      return await startFetch(normalizedRequest);
    } catch (error) {
      console.error("Unhandled frontend request error", {
        path: url.pathname,
        method: request.method,
        error
      });

      return new Response("Internal Server Error", {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    }
  }
});

console.log(`frontend listening on http://0.0.0.0:${PORT}`);
