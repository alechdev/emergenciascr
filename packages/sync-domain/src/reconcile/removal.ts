import type { DispatchedVehicleRow } from "../types";

/** Consecutive empty unit lists needed before the stored units are deleted. */
export const EMPTY_UNITS_POLLS_BEFORE_DELETE = 2;

export interface EmptyUnitsDecision {
  /** The units to store after this poll. */
  vehicles: DispatchedVehicleRow[];
  emptyUnitsCount: number;
  /** `true` when the stored units were kept despite an empty response. */
  deferred: boolean;
}

/**
 * Units missing from a response are deleted, except when the response has no units at all
 * while some are stored: that must happen on 2 consecutive polls, so a single empty response
 * can't wipe an incident (spec section 6.4).
 */
export function applyEmptyUnitsRule(
  stored: readonly DispatchedVehicleRow[],
  next: readonly DispatchedVehicleRow[],
  emptyUnitsCount: number
): EmptyUnitsDecision {
  if (next.length > 0 || stored.length === 0) {
    return { vehicles: [...next], emptyUnitsCount: 0, deferred: false };
  }
  const count = emptyUnitsCount + 1;
  if (count < EMPTY_UNITS_POLLS_BEFORE_DELETE) {
    return { vehicles: [...stored], emptyUnitsCount: count, deferred: true };
  }
  return { vehicles: [], emptyUnitsCount: 0, deferred: false };
}
