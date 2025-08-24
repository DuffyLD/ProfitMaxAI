// app/api/shopify/callback/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSql } from "../../../../lib/db";

const SHOPIFY_TOKEN_URL = (shop: string) =>
  `https://${shop}/admin/oauth/access_token`;

// Build the message exactly as sent by Shopify (sorted, no decode)
function verifyHmac(params: URLSearchParams, secret: string) {
  const given = params.get("hmac") || "";
  const entries = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");

  // Constant‑time compare with equal length
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shop = (url.searchParams.get("shop") || "").trim();
    const code = url.searchParams.get("code") || "";

    if (!shop.endsWith(".myshopify.com") || !code) {
      return NextResponse.json({ ok: false, error: "Missing shop or code" }, { status: 400 });
    }

    if (!verifyHmac(url.searchParams, process.env.SHOPIFY_API_SECRET!)) {
      return NextResponse.json({ ok: false, error: "Invalid HMAC" }, { status: 400 });
    }

    // Exchange code -> access token
    const resp = await fetch(SHOPIFY_TOKEN_URL(shop), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[SHOPIFY] token exchange failed", resp.status, text);
      return NextResponse.json({ ok: false, error: "Token exchange failed" }, { status: 400 });
    }

    const data = (await resp.json()) as { access_token: string; scope?: string };
    const accessToken = data.access_token;
    const scope = data.scope ?? null;

    // ✅ GET the Neon client and persist (UPSERT)
    const sql = getSql();
    await sql/* sql */`
      INSERT INTO shops (shop_domain, access_token, scope)
      VALUES (${shop}, ${accessToken}, ${scope})
      ON CONFLICT (shop_domain)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        scope        = EXCLUDED.scope,
        updated_at   = NOW();
    `;

    // Dev cookies so /connected works
    const res = NextResponse.redirect(new URL("/connected", url.origin));
    res.cookies.set("pm_shop", shop, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    res.cookies.set("pm_token", accessToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    return res;
  } catch (err) {
    console.error("[SHOPIFY] callback error", err);
    return NextResponse.json({ ok: false, error: "Callback error" }, { status: 500 });
  }
}
