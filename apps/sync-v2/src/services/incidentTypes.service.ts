import { db } from "@bomberoscr/db/index";
import { upsertIncidentTypes } from "@bomberoscr/sync-domain/persist";
import { ResultAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

export function syncIncidentTypes(): ResultAsync<string, SyncError> {
  return expectOk(sigae.getIncidentTypes(), "incident types").andThen((response) =>
    ResultAsync.fromPromise(
      upsertIncidentTypes(db, response.items),
      (cause) => new SyncError("failed to store incident types", { cause })
    ).map((count) => `${count} incident types`)
  );
}
