// lib/db.ts
import { neon } from "@neondatabase/serverless";

// Use the return type of `neon` to avoid generic headaches
let _sql: ReturnType<typeof neon> | null = null;

/** Lazily create a single Neon client at runtime (not during build). */
export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      // Keep this message exact; it helps us debug Vercel env issues fast
      throw new Error("DATABASE_URL not set");
    }
    _sql = neon(url);
  }
  return _sql;
}
