// app/api/db-ping/route.ts
import { NextResponse } from "next/server";
import { getSql } from "../../../lib/db";

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 as ok`;
    return NextResponse.json({ ok: true, rows });
  } catch (err: any) {
    console.error("[DB-PING] error", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
