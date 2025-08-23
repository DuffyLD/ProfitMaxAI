// lib/db.ts
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in environment variables");
}

// Neon client (reusable across your app)
export const sql = neon(process.env.DATABASE_URL);
