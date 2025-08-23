// app/api/me/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const cookies = req.cookies;
  const shop  = cookies.get("pm_shop")?.value || "";
  const token = cookies.get("pm_token")?.value || "";

  if (!shop || !token) {
    return NextResponse.json({ ok: false, reason: "missing_cookie" }, { status: 401 });
  }

  // Call a harmless Shopify endpoint using the exchanged access token
  const resp = await fetch(`https://${shop}/admin/api/2024-07/shop.json`, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.json(
      { ok: false, reason: "shopify_call_failed", status: resp.status, body: text.slice(0, 200) },
      { status: 500 }
    );
  }

  const data = await resp.json();
  // Don’t leak the token; just confirm it works and return a tiny bit of shop info
  return NextResponse.json({
    ok: true,
    shop: data?.shop?.myshopify_domain || shop,
    name: data?.shop?.name,
    plan: data?.shop?.plan_display_name,
  });
}