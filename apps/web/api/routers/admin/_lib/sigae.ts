import env from "@api/env";
import { db } from "@bomberoscr/db/index";
import { type SigaeClient, createSigaeClient } from "@bomberoscr/sigae/client";
import {
  type ReferenceResolver,
  createReferenceResolver,
  describeError,
  syncIncident
} from "@bomberoscr/sync-domain/pipeline";

const SIGAE_ENV_KEYS = [
  "SIGAE_API_URL",
  "SIGAE_IP",
  "SIGAE_PASSWORD",
  "SIGAE_USER",
  "SIGAE_COD_SYS"
] as const;

let cachedClient: SigaeClient | null = null;
const resolvers = new WeakMap<SigaeClient, ReferenceResolver>();

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

/**
 * Polls one incident through the sync pipeline, as sync-v2 does: snapshots, changes,
 * anomalies and the sync state are recorded too. It runs even for incidents sync-v2 no
 * longer polls; one that ends up `active` or `settling` is picked up by sync-v2's next
 * hourly resume.
 */
async function syncSingleIncident(client: SigaeClient, incidentId: number) {
  let references = resolvers.get(client);
  if (!references) {
    references = createReferenceResolver({ db, sigae: client });
    resolvers.set(client, references);
  }

  try {
    const outcome = await syncIncident(
      { db, sigae: client, references, now: () => new Date() },
      incidentId,
      { force: true }
    );
    switch (outcome.kind) {
      case "ok":
      case "partial":
        return { incidentId, success: true };
      case "not_found":
        return {
          incidentId,
          success: false,
          error: outcome.deleted
            ? "Incident not found in SIGAE; deleted"
            : "Incident not found in SIGAE"
        };
      default:
        return { incidentId, success: false, error: outcome.reason ?? "Sync failed" };
    }
  } catch (error) {
    return { incidentId, success: false, error: describeError(error) };
  }
}

export { costaRicaDate, formatMissingEnvMessage, getSigaeClient, syncSingleIncident };
