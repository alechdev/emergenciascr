import env from "@api/env";
import { type SigaeClient, createSigaeClient } from "@bomberoscr/sigae/client";
import { fetchIncident } from "@bomberoscr/sync-domain/fetch-incident";
import { upsertIncident } from "@bomberoscr/sync-domain/persist/upsertIncident";

const SIGAE_ENV_KEYS = [
  "SIGAE_API_URL",
  "SIGAE_IP",
  "SIGAE_PASSWORD",
  "SIGAE_USER",
  "SIGAE_COD_SYS"
] as const;

let cachedClient: SigaeClient | null = null;

function getSigaeClient():
  | { ok: true; client: SigaeClient }
  | { ok: false; missing: (typeof SIGAE_ENV_KEYS)[number][] } {
  const baseUrl = env.SIGAE_API_URL;
  const ip = env.SIGAE_IP;
  const password = env.SIGAE_PASSWORD;
  const user = env.SIGAE_USER;
  const codSys = env.SIGAE_COD_SYS;

  if (!baseUrl || !ip || !password || !user || !codSys) {
    const missing = SIGAE_ENV_KEYS.filter((key) => !env[key]);
    return { ok: false, missing };
  }

  cachedClient ??= createSigaeClient({
    baseUrl,
    credentials: { user, password, systemCode: codSys, ip },
    proxy: env.SIGAE_PROXY_URL
  });

  return { ok: true, client: cachedClient };
}

function formatMissingEnvMessage(missing: readonly string[]) {
  const label = missing.length > 1 ? "environment variables" : "environment variable";
  return `Admin synchronization is disabled. Missing ${label}: ${missing.join(", ")}`;
}

/** Noon in Costa Rica on a `YYYY-MM-DD` date, so the client sends that same date. */
function costaRicaDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00-06:00`);
}

async function syncSingleIncident(client: SigaeClient, incidentId: number) {
  const fetched = await fetchIncident(client, incidentId);
  if (fetched.isErr()) {
    const error = fetched.error;
    return {
      incidentId,
      success: false,
      error: error.kind === "not_found" ? "Incident not found in SIGAE" : error.message
    };
  }

  try {
    await upsertIncident(fetched.value);
    return { incidentId, success: true };
  } catch (error) {
    return {
      incidentId,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export { costaRicaDate, formatMissingEnvMessage, getSigaeClient, syncSingleIncident };
