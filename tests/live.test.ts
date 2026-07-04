import { describe, expect, it } from "vitest";
import { fetchPage } from "@/lib/fetchClient";

/**
 * Live-source smoke tests. OPT-IN ONLY so normal test runs never hit shelter
 * sites:  SCOUT_LIVE_TESTS=1 npm test -- live
 */
const LIVE = process.env.SCOUT_LIVE_TESTS === "1";

describe.skipIf(!LIVE)("live source smoke tests (opt-in)", () => {
  it("24Petconnect Santa Cruz still serves the expected markup", async () => {
    const res = await fetchPage("https://24petconnect.com/SantaCruzAdoptable?at=DOG", {
      requestDelayMs: 2000,
    });
    expect(res.ok).toBe(true);
    expect(res.text).toMatch(/Animals:\s*\d+\s*-\s*\d+\s*of\s*\d+/);
    expect(res.text).toContain("gridResult");
  }, 60_000);

  it("Muttville still serves article.card listings", async () => {
    const res = await fetchPage("https://muttville.org/available_mutts", {
      requestDelayMs: 2000,
    });
    expect(res.ok).toBe(true);
    expect(res.text).toContain('class="card"');
    expect(res.text).toContain("/mutt/");
  }, 60_000);
});
