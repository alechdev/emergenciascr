import { desc, eq } from "@bomberoscr/db/operators";
import { sigaeSnapshots } from "@bomberoscr/db/schema";

import type { RedactedPayload } from "../redact/index";
import type { SigaeIncidentEndpoint } from "../types";
import type { Executor } from "./executor";

export interface SnapshotInput {
  endpoint: SigaeIncidentEndpoint;
  /** Envelope `Codigo`, when the body had one. */
  codigo: string | null;
  /** Already redacted. */
  payload: RedactedPayload;
  payloadHash: string;
}

export interface StoredSnapshots {
  /** The latest snapshot per endpoint after this call: the new row, or the unchanged one. */
  ids: Partial<Record<SigaeIncidentEndpoint, number>>;
  /** Endpoints whose payload changed and got a new row. */
  inserted: SigaeIncidentEndpoint[];
}

/**
 * Stores each payload unless its hash equals the latest one for the same incident and
 * endpoint (spec section 5.2).
 */
export async function storeSnapshots(
  db: Executor,
  incidentId: number,
  fetchedAt: Date,
  snapshots: readonly SnapshotInput[]
): Promise<StoredSnapshots> {
  const ids: StoredSnapshots["ids"] = {};
  const inserted: SigaeIncidentEndpoint[] = [];
  if (snapshots.length === 0) return { ids, inserted };

  const latest = await db
    .selectDistinctOn([sigaeSnapshots.endpoint], {
      id: sigaeSnapshots.id,
      endpoint: sigaeSnapshots.endpoint,
      payloadHash: sigaeSnapshots.payloadHash
    })
    .from(sigaeSnapshots)
    .where(eq(sigaeSnapshots.incidentId, incidentId))
    .orderBy(sigaeSnapshots.endpoint, desc(sigaeSnapshots.fetchedAt), desc(sigaeSnapshots.id));
  const latestByEndpoint = new Map(latest.map((row) => [row.endpoint, row]));

  const changed = snapshots.filter((snapshot) => {
    const previous = latestByEndpoint.get(snapshot.endpoint);
    if (previous && previous.payloadHash === snapshot.payloadHash) {
      ids[snapshot.endpoint] = previous.id;
      return false;
    }
    return true;
  });
  if (changed.length === 0) return { ids, inserted };

  const rows = await db
    .insert(sigaeSnapshots)
    .values(
      changed.map((snapshot) => ({
        incidentId,
        endpoint: snapshot.endpoint,
        codigo: snapshot.codigo,
        fetchedAt,
        payloadHash: snapshot.payloadHash,
        payload: snapshot.payload
      }))
    )
    .returning({ id: sigaeSnapshots.id, endpoint: sigaeSnapshots.endpoint });
  for (const row of rows) {
    ids[row.endpoint] = row.id;
    inserted.push(row.endpoint);
  }
  return { ids, inserted };
}
