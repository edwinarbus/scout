import { describe, expect, it } from "vitest";
import { evaluateRobots, parseRobots } from "@/lib/robots";

const DACC_ROBOTS = `User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Crawl-delay: 10

Sitemap: https://example.org/sitemap.xml
`;

describe("robots.txt evaluation", () => {
  it("allows paths not covered by rules and reports crawl-delay", () => {
    const r = evaluateRobots(DACC_ROBOTS, "/dacc-search/?PageNumber=1");
    expect(r.status).toBe("allows");
    expect(r.crawlDelaySeconds).toBe(10);
  });

  it("disallows matching paths, longest rule wins, Allow beats Disallow on tie+", () => {
    expect(evaluateRobots(DACC_ROBOTS, "/wp-admin/options.php").status).toBe(
      "disallows_listing_path"
    );
    expect(evaluateRobots(DACC_ROBOTS, "/wp-admin/admin-ajax.php").status).toBe("allows");
  });

  it("treats empty Disallow as allow-everything", () => {
    const r = evaluateRobots("User-agent: *\nDisallow:\n", "/anything");
    expect(r.status).toBe("allows");
  });

  it("supports wildcards and end anchors", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /private*/";
    expect(evaluateRobots(txt, "/docs/file.pdf").status).toBe("disallows_listing_path");
    expect(evaluateRobots(txt, "/docs/file.pdf?x=1").status).toBe("allows");
    expect(evaluateRobots(txt, "/private-stuff/page").status).toBe("disallows_listing_path");
  });

  it("groups multiple user-agents correctly", () => {
    const txt = "User-agent: BadBot\nUser-agent: WorseBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin";
    const groups = parseRobots(txt);
    expect(groups).toHaveLength(2);
    expect(evaluateRobots(txt, "/dogs").status).toBe("allows"); // * group only
    expect(evaluateRobots(txt, "/admin/x").status).toBe("disallows_listing_path");
  });

  it("no wildcard group → allows", () => {
    expect(evaluateRobots("User-agent: SomeBot\nDisallow: /", "/x").status).toBe("allows");
  });
});
