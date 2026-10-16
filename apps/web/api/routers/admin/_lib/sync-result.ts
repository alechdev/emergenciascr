import type { SyncIncidentOutcome } from "@bomberoscr/sync-domain/pipeline";

export type SyncResult =
  | { incidentId: number; success: true }
  | {
      incidentId: number;
      success: false;
      error: string;
    };

/** What the admin endpoints report for one manual sync. */
export function syncResult(outcome: SyncIncidentOutcome): SyncResult {
  const { incidentId } = outcome;
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
    case "skipped":
      // A newer poll stored fresher data meanwhile, so the incident is up to date.
      if (outcome.reason === "superseded by a newer poll") return { incidentId, success: true };
      return {
        incidentId,
        success: false,
        error:
          outcome.reason === "already deleted"
            ? "Incident not found in SIGAE; already deleted"
            : (outcome.reason ?? "Sync skipped")
      };
    default:
      return { incidentId, success: false, error: outcome.reason ?? "Sync failed" };
  }
}
