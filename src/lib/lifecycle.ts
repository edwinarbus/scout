import type { StaleStatus } from "./types";

/**
 * Cautious stale-listing lifecycle.
 *
 * Rules (deliberately conservative):
 *  - A dog seen in the current successful run is fresh: "available" on first
 *    sight, "still_seen" afterwards. missingSince/missedRunCount reset.
 *  - A dog NOT seen is only escalated when the run was a trustworthy success
 *    (the runner decides that; failed/partial/suspicious runs apply no updates).
 *  - Escalation ladder by consecutive missed successful runs:
 *      1 → missing_once, 2-3 → missing_multiple_runs, 4+ → likely_unavailable
 *  - Nothing is ever deleted; "likely_unavailable" is as far as we go without
 *    a human verifying with the shelter.
 */

export const MISSING_ONCE_THRESHOLD = 1;
export const MISSING_MULTIPLE_THRESHOLD = 2;
export const LIKELY_UNAVAILABLE_THRESHOLD = 4;

export interface LifecycleState {
  staleStatus: StaleStatus;
  missedRunCount: number;
  missingSince: Date | null;
}

/** Dog was present in a successful run. */
export function markSeen(prev: Pick<LifecycleState, "staleStatus"> | null): LifecycleState {
  return {
    staleStatus: prev == null ? "available" : "still_seen",
    missedRunCount: 0,
    missingSince: null,
  };
}

/**
 * Dog was absent from a successful, complete run.
 * `now` injected for testability.
 */
export function markMissed(prev: LifecycleState, now: Date): LifecycleState {
  const missedRunCount = prev.missedRunCount + 1;
  let staleStatus: StaleStatus;
  if (missedRunCount >= LIKELY_UNAVAILABLE_THRESHOLD) staleStatus = "likely_unavailable";
  else if (missedRunCount >= MISSING_MULTIPLE_THRESHOLD) staleStatus = "missing_multiple_runs";
  else staleStatus = "missing_once";
  return {
    staleStatus,
    missedRunCount,
    missingSince: prev.missingSince ?? now,
  };
}

/** Is this listing still plausibly live at the source? */
export function isActive(staleStatus: StaleStatus): boolean {
  return (
    staleStatus === "available" ||
    staleStatus === "still_seen" ||
    staleStatus === "missing_once"
  );
}

/** Freshness label for the UI. */
export function freshnessLabel(staleStatus: StaleStatus): "fresh" | "stale" | "missing" | "uncertain" {
  switch (staleStatus) {
    case "available":
    case "still_seen":
      return "fresh";
    case "missing_once":
      return "stale";
    case "missing_multiple_runs":
    case "likely_unavailable":
      return "missing";
    default:
      return "uncertain";
  }
}
