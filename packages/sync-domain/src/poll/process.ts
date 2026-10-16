import { resolveClosedAt } from "../lifecycle/closed-at";
import { nextPoll } from "../lifecycle/next-poll";
import { keepReportValues } from "../normalize/incident";
import { resolveIncidentTypes } from "../normalize/incident-types";
import { normalizePoll } from "../normalize/index";
import { dedupeAnomalies, detectAnomalies, placeholderAnomalies } from "../reconcile/anomalies";
import { diffIncidentState, removalChanges } from "../reconcile/diff";
import { applyEmptyUnitsRule } from "../reconcile/removal";

import type { Anomaly, Change, IncidentState, SyncState } from "../types";
import type { PollClassification, PollKind } from "./classify";

export interface ProcessPollInput {
  incidentId: number;
  classification: PollClassification;
  /** What the database holds for the incident, or `null` when it isn't stored. */
  current: IncidentState | null;
  syncState: SyncState;
  /** Codes in `incident_types`. */
  knownIncidentTypes: ReadonlySet<string>;
  /** `anomalyKey`s already recorded for the incident. */
  recordedAnomalies: ReadonlySet<string>;
  now: Date;
}

export interface ProcessPollResult {
  kind: PollKind;
  /** What to store for the incident after this poll; `null` when nothing is written. */
  next: IncidentState | null;
  /** The not-found flow decided to delete the incident and its children. */
  deleteIncident: boolean;
  /** Bump `modifiedAt` only when this is non-empty. */
  changes: Change[];
  anomalies: Anomaly[];
  syncState: SyncState;
  /** Incident type codes SIGAE used that `incident_types` doesn't have yet. */
  unknownIncidentTypes: string[];
}

/**
 * Everything a poll decides, without I/O: the state to store, its changes and anomalies, and
 * the next sync state (spec section 4 pipeline, minus fetching, snapshots, reference
 * resolution and the transaction).
 */
export function processPoll(input: ProcessPollInput): ProcessPollResult {
  const { classification, current, syncState, now } = input;

  if (classification.kind === "failed") {
    const decision = nextPoll(
      syncState,
      {
        kind: "failed",
        reason: `${classification.endpoint} ${classification.reason}`
      },
      now
    );
    const issues = (classification.reportIssues ?? []).map((issue) => ({
      ...issue,
      entity: "incident" as const,
      entityId: input.incidentId
    }));
    return idle("failed", decision.state, [
      ...dedupeAnomalies(placeholderAnomalies(issues), input.recordedAnomalies),
      ...decision.anomalies
    ]);
  }

  if (classification.kind === "not_found") {
    const decision = nextPoll(syncState, { kind: "not_found" }, now);
    if (!decision.deleteIncident) return idle("not_found", decision.state, decision.anomalies);
    return {
      kind: "not_found",
      next: null,
      deleteIncident: true,
      changes: current ? removalChanges(current) : [],
      anomalies: decision.anomalies,
      syncState: decision.state,
      unknownIncidentTypes: []
    };
  }

  const normalized = normalizePoll(input.incidentId, classification.data);
  const reported =
    classification.kind === "partial"
      ? keepReportValues(current?.incident ?? null, normalized.incident)
      : normalized.incident;
  const types = resolveIncidentTypes(reported, input.knownIncidentTypes);
  const units = applyEmptyUnitsRule(
    current?.vehicles ?? [],
    normalized.vehicles,
    syncState.emptyUnitsCount
  );

  const decision = nextPoll(
    syncState,
    {
      kind: classification.kind,
      isOpen: types.incident.isOpen,
      incidentTimestamp: types.incident.incidentTimestamp
    },
    now
  );
  const closed = resolveClosedAt({
    previous: current?.incident ?? null,
    isOpen: types.incident.isOpen,
    controlledAt: types.incident.controlledAt,
    vehicles: units.vehicles,
    syncState,
    now
  });

  const next: IncidentState = {
    incident: { ...types.incident, ...closed },
    vehicles: units.vehicles,
    stations: normalized.stations
  };
  const anomalies = dedupeAnomalies(
    [
      ...types.anomalies,
      ...detectAnomalies(current, next, {
        now,
        partialReport:
          classification.kind === "partial"
            ? { description: classification.reportDescription }
            : undefined,
        issues: normalized.issues,
        reachedDone: decision.state.phase === "done" && syncState.phase !== "done"
      }),
      ...decision.anomalies
    ],
    input.recordedAnomalies
  );

  return {
    kind: classification.kind,
    next,
    deleteIncident: false,
    changes: diffIncidentState(current, next),
    anomalies,
    syncState: { ...decision.state, emptyUnitsCount: units.emptyUnitsCount },
    unknownIncidentTypes: types.unknownCodes
  };
}

/** A poll that writes nothing. It also breaks a run of zero-unit polls (spec 6.4). */
function idle(kind: PollKind, syncState: SyncState, anomalies: Anomaly[]): ProcessPollResult {
  return {
    kind,
    next: null,
    deleteIncident: false,
    changes: [],
    anomalies,
    syncState: { ...syncState, emptyUnitsCount: 0 },
    unknownIncidentTypes: []
  };
}
