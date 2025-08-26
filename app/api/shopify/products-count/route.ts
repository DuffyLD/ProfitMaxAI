// app/api/shopify/products-count/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getShopAndTokenFromCookies, shopifyAdminGET } from "../../../../lib/shopify";

export async function GET(req: NextRequest) {
  try {
    const { shop, token } = await getShopAndTokenFromCookies(req.headers.get("cookie") || undefined);
    type CountResp = { count: number };
    const data = await shopifyAdminGET<CountResp>(shop, token, "products/count.json");
    return NextResponse.json({ ok: true, shop, count: data.count });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "error" }, { status: 500 });
  }
}
