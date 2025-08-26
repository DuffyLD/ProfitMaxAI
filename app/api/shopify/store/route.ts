export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getShopAndTokenWithFallback, shopifyAdminGET } from "../../../../lib/shopify";

export async function GET(req: NextRequest) {
  try {
    const cookieHeader = req.headers.get("cookie") || undefined;
    const { shop, token } = await getShopAndTokenWithFallback(cookieHeader);

    type ShopResp = { shop: { name: string; email: string; plan_display_name: string } };
    const data = await shopifyAdminGET<ShopResp>(shop, token, "shop.json");

    return NextResponse.json({ ok: true, shop, name: data.shop.name, plan: data.shop.plan_display_name });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "error" }, { status: 500 });
  }
}
