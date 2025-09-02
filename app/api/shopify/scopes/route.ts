// app/api/shopify/scopes/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { getShopAndTokenWithFallback, SHOPIFY_API_VERSION } from "../../../../lib/shopify";

export async function GET() {
  try {
    const { shop, token } = await getShopAndTokenWithFallback();

    const url = `https://${shop}/admin/oauth/access_scopes.json`;
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,          // ← correct header
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Scopes check failed: ${res.status} ${text}`);

    return NextResponse.json({ ok: true, shop, raw: JSON.parse(text) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
