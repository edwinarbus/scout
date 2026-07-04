/**
 * One-off data migration: copies every row from the local SQLite file
 * (data/scout.db) into Turso, table by table in dependency order. Safe to
 * re-run — inserts use onConflictDoNothing, so already-migrated rows are
 * skipped and only genuinely new local rows get copied over.
 *
 *   npm run scout:migrate-to-turso
 */
import { config as loadEnvFile } from "dotenv";
loadEnvFile({ path: ".env.local" });

import { getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createDb } from "@/db";
import {
  adoptionSources,
  dogListings,
  canonicalDogs,
  sourceRuns,
  userDogStatuses,
  savedSearches,
  geocodeCache,
  dogAiEnrichment,
  pushSubscriptions,
  watches,
  watchNotifications,
} from "@/db/schema";

// Dependency order: a table only appears after every table its rows reference.
const TABLES: SQLiteTable[] = [
  adoptionSources,
  dogListings,
  canonicalDogs,
  sourceRuns,
  userDogStatuses,
  savedSearches,
  geocodeCache,
  dogAiEnrichment,
  pushSubscriptions,
  watches,
  watchNotifications,
];

const CHUNK_SIZE = 100;

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL not set in .env.local — nothing to migrate to.");
  }
  const source = await createDb("file:./data/scout.db");
  const dest = await createDb(); // no override → resolves to Turso via env

  for (const table of TABLES) {
    const name = getTableName(table);
    const rows = await source.select().from(table).all();
    if (!rows.length) {
      console.log(`${name}: 0 local rows, skipping.`);
      continue;
    }
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await dest.insert(table).values(chunk).onConflictDoNothing().run();
    }
    console.log(`${name}: ${rows.length} row(s) migrated (existing rows skipped).`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
