import { NextResponse } from "next/server";

async function check(shop: string, token: string) {
  const url = `https://${shop}/admin/api/2024-10/products.json?limit=1`;
  const r = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  let hint = "";
  if (!r.ok) { try { hint = JSON.stringify(await r.json()).slice(0,200); } catch {} }
  return { ok: r.ok, status: r.status, hint };
}

export async function GET() {
  const shop = process.env.SHOPIFY_TEST_SHOP;
  const token = process.env.SHOPIFY_TEST_TOKEN;
  if (!shop || !token) {
    return NextResponse.json({ ok:false, error:"Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" }, { status: 500 });
  }
  const { ok, status, hint } = await check(shop, token);
  return ok
    ? NextResponse.json({ ok:true, msg:"✅ OK", shop, endpoint:"products.json?limit=1" })
    : NextResponse.json({ ok:false, msg:"❌ FAIL", shop, status, hint }, { status: 500 });
}
