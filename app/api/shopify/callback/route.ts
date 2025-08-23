// app/api/shopify/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto"; // ⟵ add

const SHOPIFY_TOKEN_URL = (shop: string) =>
  `https://${shop}/admin/oauth/access_token`;

// ⟵ add
function verifyHmac(params: URLSearchParams, secret: string) {
  const given = params.get("hmac") || "";
  const copy = new URLSearchParams(params);
  copy.delete("hmac");
  const message = decodeURIComponent(copy.toString());
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(given));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shop = (url.searchParams.get("shop") || "").trim();
    const code = url.searchParams.get("code") || "";

    if (!shop.endsWith(".myshopify.com") || !code) {
      return NextResponse.json({ ok: false, error: "Missing shop or code" }, { status: 400 });
    }

    // ⟵ add: verify HMAC before exchanging the code
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

    const data = (await resp.json()) as { access_token: string; scope: string };
    const accessToken = data.access_token;

    // DEV ONLY: store token in httpOnly cookies so we can confirm end‑to‑end
    const res = NextResponse.redirect(new URL("/connected", url.origin));
    res.cookies.set("pm_shop", shop,   { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    res.cookies.set("pm_token", accessToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    return res;
  } catch (err) {
    console.error("[SHOPIFY] callback error", err);
    return NextResponse.json({ ok: false, error: "Callback error" }, { status: 500 });
  }
}