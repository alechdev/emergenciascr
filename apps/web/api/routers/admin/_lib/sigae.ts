import env from "@api/env";
import {
  getIncidentDetails,
  getIncidentReport,
  getStationsAttendingIncident,
  getVehiclesDispatchedToIncident
} from "@bomberoscr/sync-domain/api";
import { createFetcher } from "@bomberoscr/sync-domain/fetcher";
import { upsertIncident } from "@bomberoscr/sync-domain/persist/upsertIncident";

import type {
  ObtenerEstacionesAtiendeIncidente,
  ObtenerUnidadesDespachadasIncidente
} from "@bomberoscr/sync-domain/types";

type SigAEFetcher = ReturnType<typeof createFetcher>;

const SIGAE_ENV_KEYS = [
  "SIGAE_API_URL",
  "SIGAE_IP",
  "SIGAE_PASSWORD",
  "SIGAE_USER",
  "SIGAE_COD_SYS"
] as const;

let cachedFetcher: SigAEFetcher | null = null;

function getSigAEFetcher():
  | { ok: true; fetcher: SigAEFetcher }
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

  if (!cachedFetcher) {
    cachedFetcher = createFetcher({
      baseUrl,
      credentials: {
        IP: ip,
        Password: password,
        Usuario: user,
        codSistema: codSys
      }
    });
  }

  return { ok: true, fetcher: cachedFetcher };
}

function formatMissingEnvMessage(missing: readonly string[]) {
  const label = missing.length > 1 ? "environment variables" : "environment variable";
  return `Admin synchronization is disabled. Missing ${label}: ${missing.join(", ")}`;
}

function formatIsoDateForSIGAE(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

async function syncSingleIncident(fetcher: SigAEFetcher, incidentId: number) {
  const results = await Promise.all([
    getIncidentDetails({ fetcher, id: incidentId }),
    getIncidentReport({ fetcher, id: incidentId }),
    getStationsAttendingIncident({ fetcher, id: incidentId }),
    getVehiclesDispatchedToIncident({ fetcher, id: incidentId })
  ]);

  const [incidentDetailsResult, incidentReportResult, stationsResult, vehiclesResult] = results;

  if (incidentDetailsResult.isErr()) {
    return { incidentId, success: false, error: "Failed to fetch incident details" };
  }
  if (incidentReportResult.isErr()) {
    return { incidentId, success: false, error: "Failed to fetch incident report" };
  }
  if (stationsResult.isErr()) {
    return { incidentId, success: false, error: "Failed to fetch stations" };
  }
  if (vehiclesResult.isErr()) {
    return { incidentId, success: false, error: "Failed to fetch vehicles" };
  }

  try {
    await upsertIncident({
      incidentId,
      incidentDetails: incidentDetailsResult.value,
      incidentReport: incidentReportResult.value,
      stationsAttending: (stationsResult.value as unknown as ObtenerEstacionesAtiendeIncidente)
        .Items,
      vehiclesDispatched: (vehiclesResult.value as unknown as ObtenerUnidadesDespachadasIncidente)
        .Items
    });
    return { incidentId, success: true };
  } catch (error) {
    return {
      incidentId,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export { formatIsoDateForSIGAE, formatMissingEnvMessage, getSigAEFetcher, syncSingleIncident };
export type { SigAEFetcher };
