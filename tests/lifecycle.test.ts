import { describe, expect, it } from "vitest";
import { freshnessLabel, isActive, markMissed, markSeen } from "@/lib/lifecycle";

const NOW = new Date("2026-07-01T12:00:00Z");

describe("stale-listing lifecycle", () => {
  it("first sight is available, later sights are still_seen", () => {
    expect(markSeen(null).staleStatus).toBe("available");
    expect(markSeen({ staleStatus: "still_seen" }).staleStatus).toBe("still_seen");
  });

  it("escalates cautiously: 1 miss → missing_once, 2 → multiple, 4 → likely_unavailable", () => {
    const state = { staleStatus: "still_seen" as const, missedRunCount: 0, missingSince: null as Date | null };
    const s1 = markMissed(state, NOW);
    expect(s1.staleStatus).toBe("missing_once");
    expect(s1.missingSince).toEqual(NOW);
    const s2 = markMissed(s1, new Date(NOW.getTime() + 1));
    expect(s2.staleStatus).toBe("missing_multiple_runs");
    expect(s2.missingSince).toEqual(NOW); // first-missing timestamp preserved
    const s3 = markMissed(s2, new Date(NOW.getTime() + 2));
    expect(s3.staleStatus).toBe("missing_multiple_runs");
    const s4 = markMissed(s3, new Date(NOW.getTime() + 3));
    expect(s4.staleStatus).toBe("likely_unavailable");
    expect(s4.missedRunCount).toBe(4);
  });

  it("reappearing resets missing bookkeeping", () => {
    const back = markSeen({ staleStatus: "missing_multiple_runs" });
    expect(back).toEqual({ staleStatus: "still_seen", missedRunCount: 0, missingSince: null });
  });

  it("labels freshness for the UI", () => {
    expect(freshnessLabel("still_seen")).toBe("fresh");
    expect(freshnessLabel("missing_once")).toBe("stale");
    expect(freshnessLabel("likely_unavailable")).toBe("missing");
    expect(freshnessLabel("source_failed_do_not_update")).toBe("uncertain");
    expect(isActive("missing_once")).toBe(true);
    expect(isActive("likely_unavailable")).toBe(false);
  });
});
