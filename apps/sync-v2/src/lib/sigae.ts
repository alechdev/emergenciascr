import { type ResultAsync, errAsync, okAsync } from "neverthrow";

import { SyncError } from "@/lib/errors";

import type { SigaeError, SigaeResponse } from "@bomberoscr/sigae/client";

/** Only a `00` answer counts; anything else is an error naming what was asked for. */
export function expectOk<T>(
  result: ResultAsync<SigaeResponse<T>, SigaeError>,
  what: string
): ResultAsync<T, SyncError> {
  return result
    .mapErr((cause) => new SyncError(`${what}: SIGAE request failed`, { cause }))
    .andThen((response) => {
      if (response.kind === "ok") return okAsync(response.data);
      const detail =
        response.kind === "not_found"
          ? "no records (Codigo 03)"
          : `Codigo ${response.code} (${response.description})`;
      return errAsync(new SyncError(`${what}: SIGAE answered ${detail}`));
    });
}
