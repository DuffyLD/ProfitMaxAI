// lib/db.ts
import { neon } from "@neondatabase/serverless";

// Vercel's Neon integration may expose one of these names.
// Pick the first one that exists.
const DB_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!DB_URL) {
  throw new Error("Missing DATABASE_URL / POSTGRES_URL / NEON_DATABASE_URL");
}

export const sql = neon(DB_URL);
