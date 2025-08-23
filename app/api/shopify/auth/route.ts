// app/api/shopify/auth/route.ts
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shop = (searchParams.get("shop") || "").trim();

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_shop" }, { status: 400 });
  }

  const appUrl = process.env.APP_BASE_URL!;                       // e.g. https://profit-max-ai.vercel.app
  const clientId = process.env.SHOPIFY_API_KEY!;
  const scopes = (process.env.SHOPIFY_SCOPES || "").replace(/\s+/g, "");
  const state = Math.random().toString(36).slice(2);

  const redirectUri = `${appUrl}/api/shopify/callback`;
  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&grant_options[]=per-user`;

  console.log("[AUTH] redirecting to Shopify", { shop, redirectUri }); // shows in Vercel logs
  return NextResponse.redirect(authUrl, 302);
}
