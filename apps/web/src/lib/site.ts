function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

const DEFAULT_SITE_URL = "http://localhost:3000";

export const SITE_URL = normalizeBaseUrl(import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL);

export const SERVER_URL = normalizeBaseUrl(import.meta.env.VITE_SERVER_URL || `${SITE_URL}/api`);

export const STATIC_OG_IMAGE_URL = `${SERVER_URL}/og`;
