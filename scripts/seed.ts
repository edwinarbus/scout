/**
 * Seed the source registry.
 *
 *   npm run seed              # upsert all registry sources + demo saved search
 *   npm run seed -- --reset-enabled   # also reset enabled flags to registry defaults
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { adoptionSources, savedSearches } from "@/db/schema";
import { SOURCE_REGISTRY } from "@/sources/registry";
import type { SearchCriteria } from "@/lib/match";

const { values: args } = parseArgs({
  options: {
    "reset-enabled": { type: "boolean", default: false },
  },
});

async function main() {
  const db = createDb();
  const now = new Date();

  // ---- sources -------------------------------------------------------------
  let inserted = 0;
  let updated = 0;
  for (const def of SOURCE_REGISTRY) {
    const existing = db
      .select()
      .from(adoptionSources)
      .where(eq(adoptionSources.id, def.id))
      .get();
    if (!existing) {
      db.insert(adoptionSources)
        .values({ ...def, createdAt: now, updatedAt: now })
        .run();
      inserted++;
    } else {
      // Preserve locally-toggled `enabled` and runtime robots fields unless asked.
      const { enabled, robotsStatus: _rs, robotsCheckedAt: _rca, parserVersion: _pv, ...rest } = def;
      db.update(adoptionSources)
        .set({
          ...rest,
          ...(args["reset-enabled"] ? { enabled } : {}),
          updatedAt: now,
        })
        .where(eq(adoptionSources.id, def.id))
        .run();
      updated++;
    }
  }
  console.log(`Sources: ${inserted} inserted, ${updated} updated (${SOURCE_REGISTRY.length} in registry).`);

  // ---- demo saved search -----------------------------------------------------
  const demoCriteria: SearchCriteria = {
    breedIncludes: ["dachshund", "doxie"],
    excludePuppies: true,
    sizes: ["small"],
    colors: ["black", "tan"],
    statuses: ["available", "foster", "unknown"],
    center: { latitude: 37.7749, longitude: -122.4194 }, // San Francisco
    maxDistanceMiles: 100,
  };
  const existingSearch = db.select().from(savedSearches).all();
  if (existingSearch.length === 0) {
    db.insert(savedSearches)
      .values({
        name: "Small adult dachshund-ish dogs near SF",
        enabled: true,
        criteria: demoCriteria as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    console.log('Saved search seeded: "Small adult dachshund-ish dogs near SF".');
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
