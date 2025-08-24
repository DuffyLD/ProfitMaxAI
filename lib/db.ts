// lib/db.ts
import { neon } from "@neondatabase/serverless";

/** Pick the first present env var among common Neon/Vercel keys */
function readDbUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL || // sometimes added by integrations
    process.env.PGSTRING ||
    "";

  if (!url) throw new Error("DATABASE_URL not set");
  return url;
}

let _sql: ReturnType<typeof neon> | null = null;

/** Lazily create a single Neon client at runtime (not during build). */
export function getSql() {
  if (!_sql) {
    _sql = neon(readDbUrl());
  }
  return _sql;
}
