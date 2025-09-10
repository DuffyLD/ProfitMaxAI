// app/api/shopify/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getShopAndTokenWithFallback, shopifyAdminGET } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { shop, token } = await getShopAndTokenWithFallback(req.headers.get("cookie") || undefined);

    // pass through a few useful params
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") || "5";
    const since_id = url.searchParams.get("since_id") || undefined;
    const updated_at_min = url.searchParams.get("updated_at_min") || undefined;

    const query: Record<string, string> = { limit: String(limit) };
    if (since_id) query.since_id = since_id;
    if (updated_at_min) query.updated_at_min = updated_at_min;

    const data = await shopifyAdminGET<{ products: any[] }>(shop, token, "products.json", query);
    return NextResponse.json({ ok: true, shop, items: data.products });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
