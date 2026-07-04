import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

export type ScoutDb = LibSQLDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const LOCAL_FALLBACK_URL = `file:${path.join(process.cwd(), "data", "scout.db")}`;

// One shared exit handler for every ":memory:" temp file a test suite opens,
// rather than a listener per call (a large suite calling createDb(":memory:")
// per test would otherwise trip Node's MaxListenersExceededWarning).
const tmpTestDbFiles = new Set<string>();
process.once("exit", () => {
  for (const f of tmpTestDbFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* best-effort cleanup */
    }
  }
});

/**
 * Resolve a libSQL connection target. An explicit url wins over env. With
 * neither, TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) is what makes ingested
 * data and watches actually persist: a Vercel serverless function's
 * filesystem is read-only outside /tmp, so a local file can't be written
 * there at all. No Turso credential falls back to a local file for pure
 * offline dev.
 *
 * ":memory:" (tests) does NOT map to libSQL's special in-memory path — a bare
 * "file::memory:" hands each new physical connection its OWN private empty
 * database (standard SQLite in-memory semantics), and @libsql/client's local
 * driver can open more than one connection over a session's lifetime. Tests
 * saw exactly that: migrations ran on one connection, a later query landed on
 * a second, empty one ("no such table"). A real temp file sidesteps the
 * ambiguity entirely — every connection to the same path sees the same data —
 * and it's deleted once the process exits.
 */
function resolveTarget(urlOrSentinel?: string): { url: string; authToken?: string } {
  if (urlOrSentinel === ":memory:") {
    const tmpFile = path.join(
      os.tmpdir(),
      `scout-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`
    );
    tmpTestDbFiles.add(tmpFile);
    return { url: `file:${tmpFile}` };
  }
  if (urlOrSentinel) return { url: urlOrSentinel, authToken: process.env.TURSO_AUTH_TOKEN };
  if (process.env.TURSO_DATABASE_URL) {
    return { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  return { url: LOCAL_FALLBACK_URL };
}

/**
 * Open (and migrate) a Scout database. Pass ":memory:" for tests.
 * Migrations are applied automatically so CLI, tests, and the web app
 * all converge on the same schema without a separate setup step.
 */
export async function createDb(urlOverride?: string): Promise<ScoutDb> {
  const { url, authToken } = resolveTarget(urlOverride);
  const client = createClient({ url, authToken });
  await client.execute("PRAGMA foreign_keys = ON");

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// Singleton for the Next.js app / CLI. Survives Next dev hot reloads. Caches
// the in-flight promise (not just the resolved db) so concurrent requests
// during startup share one connection + migration run instead of racing.
const globalForDb = globalThis as unknown as { __scoutDb?: Promise<ScoutDb> };

export function getDb(): Promise<ScoutDb> {
  if (!globalForDb.__scoutDb) {
    globalForDb.__scoutDb = createDb();
  }
  return globalForDb.__scoutDb;
}

export { schema };
