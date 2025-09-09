// app/api/shopify/whoami/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import {
  getShopAndTokenFromCookies,
  getCurrentShopAndToken,
  shopifyAdminGET,
} from "../../../../lib/shopify";

export async function GET(req: NextRequest) {
  try {
    const cookie = req.headers.get("cookie") || "";

    // Prefer cookies (this is what your working endpoints use)
    let used: "cookie" | "db" = "cookie";
    let creds: { shop: string; token: string };
    try {
      creds = getShopAndTokenFromCookies(cookie);
    } catch {
      // fallback (should rarely be needed now)
      used = "db";
      creds = await getCurrentShopAndToken();
    }

    const me = await shopifyAdminGET<{ shop: { name: string; email: string } }>(
      creds.shop,
      creds.token,
      "shop.json"
    );

    return NextResponse.json({ ok: true, used, shop: creds.shop, shopName: me.shop.name });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
  }
}
