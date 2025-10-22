// app/api/health/all/route.ts
import { NextResponse } from "next/server";

const endpoints = [
  "/api/setup-db",
  "/api/ingest/daily?days=60",
  "/api/recommendations",
  "/api/dashboard-data",
];

export async function GET(req: Request) {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const results: Record<string, any> = {};

  for (const path of endpoints) {
    try {
      const res = await fetch(`${baseUrl}${path}`);
      const body = await res.json().catch(() => ({}));
      results[path] = {
        ok: res.ok && body?.ok !== false,
        status: res.status,
        error: body?.error || null,
      };
    } catch (e: any) {
      results[path] = { ok: false, error: String(e?.message || e) };
    }
  }

  const allOk = Object.values(results).every((r: any) => r.ok);

  return NextResponse.json({
    ok: allOk,
    checked: endpoints.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
