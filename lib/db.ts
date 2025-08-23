// lib/db.ts
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<any[]> | null = null;

/** Returns a singleton Neon client, initialized on first use (runtime only). */
export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    _sql = neon(url);
  }
  return _sql;
}
