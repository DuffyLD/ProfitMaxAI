export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { NextResponse } from "next/server";

export async function GET() {
  const v = process.env.DATABASE_URL;
  return NextResponse.json({
    VERCEL_ENV: process.env.VERCEL_ENV || null,
    DATABASE_URL_PRESENT: Boolean(v),
    DATABASE_URL_LENGTH: v ? v.length : 0
  });
}
