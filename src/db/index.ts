import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type ScoutDb = BetterSQLite3Database<typeof schema>;

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "scout.db");
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Open (and migrate) a Scout database. Pass ":memory:" for tests.
 * Migrations are applied automatically so CLI, tests, and the web app
 * all converge on the same schema without a separate setup step.
 */
export function createDb(dbPath: string = DEFAULT_DB_PATH): ScoutDb {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 10000"); // tolerate concurrent CLI runs

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// Singleton for the Next.js app / CLI. Survives Next dev hot reloads.
const globalForDb = globalThis as unknown as { __scoutDb?: ScoutDb };

export function getDb(): ScoutDb {
  if (!globalForDb.__scoutDb) {
    globalForDb.__scoutDb = createDb();
  }
  return globalForDb.__scoutDb;
}

export { schema };
