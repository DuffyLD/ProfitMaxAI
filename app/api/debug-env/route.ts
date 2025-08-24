// app/api/debug-env/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keys = [
    "DATABASE_URL",
    "NEON_DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "PGSTRING",
    "VERCEL_ENV",
  ] as const;

  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = process.env[k];
    out[k] = v ? (k === "VERCEL_ENV" ? v : { present: true, length: v.length }) : { present: false };
  }
  return NextResponse.json(out);
}
