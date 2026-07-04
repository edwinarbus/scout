import { config as loadEnvFile } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs standalone (not via Next), so it doesn't get .env.local for free.
loadEnvFile({ path: ".env.local" });

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:./data/scout.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
