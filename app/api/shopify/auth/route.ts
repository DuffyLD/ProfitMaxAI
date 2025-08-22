// app/api/shopify/auth/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shop = (searchParams.get("shop") || "").trim();

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json({ ok: false, error: "Invalid shop" }, { status: 400 });
  }

  const apiKey = process.env.SHOPIFY_API_KEY!;
  const scopes = process.env.SHOPIFY_SCOPES!;
  const redirectUri = `${process.env.APP_BASE_URL}/api/shopify/callback`;

  const installUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  installUrl.searchParams.set("client_id", apiKey);
  installUrl.searchParams.set("scope", scopes);
  installUrl.searchParams.set("redirect_uri", redirectUri);
  installUrl.searchParams.set("state", "pmx_oauth_1");

  return NextResponse.redirect(installUrl.toString());
}
