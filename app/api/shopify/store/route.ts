// app/api/shopify/store/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getShopAndTokenFromCookies, shopifyAdminGET } from "../../../../lib/shopify";

export async function GET(req: NextRequest) {
  try {
    const { shop, token } = await getShopAndTokenFromCookies(req.headers.get("cookie") || undefined);

    // Lightweight “who am I”
    type ShopResp = { shop: { name: string; email: string; plan_display_name: string } };
    const data = await shopifyAdminGET<ShopResp>(shop, token, "shop.json");

    return NextResponse.json({ ok: true, shop, name: data.shop.name, plan: data.shop.plan_display_name });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "error" }, { status: 500 });
  }
}
