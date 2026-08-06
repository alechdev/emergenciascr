import env from "@api/env";
import { createHmac } from "node:crypto";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function encodeImgproxySource(url: string): string {
  return Buffer.from(url)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signImgproxyPath(path: string): string {
  const key = Buffer.from(env.IMGPROXY_KEY, "hex");
  const salt = Buffer.from(env.IMGPROXY_SALT, "hex");
  const signature = createHmac("sha256", key).update(salt).update(path).digest("base64");
  return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Build a signed imgproxy URL for the given source URL.
 * @param sourceUrl - The URL imgproxy will fetch the original image from
 * @param options - Resize options (width and height)
 */
function buildImgproxyUrl(sourceUrl: string, options: { width: number; height: number }): string {
  const { width, height } = options;
  const processingOptions = `rs:fit:${width}:${height}`;
  const encodedSource = encodeImgproxySource(sourceUrl);
  const path = `/${processingOptions}/${encodedSource}`;
  const signature = signImgproxyPath(path);
  return `${normalizeBaseUrl(env.IMGPROXY_BASE_URL)}/${signature}${path}`;
}

/**
 * Build the URL for an original image endpoint that imgproxy will fetch from.
 * @param apiPath - The API path segment (e.g., "types/1.2.3/image/original")
 */
function buildOriginalSourceUrl(apiPath: string): string {
  const baseUrl = normalizeBaseUrl(env.INTERNAL_API_URL);
  return `${baseUrl}/api/${apiPath}?token=${env.IMGPROXY_TOKEN}`;
}

export { buildImgproxyUrl, buildOriginalSourceUrl };
