import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const API_VERSION = "2024-10";

function isoDaysAgoSafe(days: number) {
  const clamp = Math.max(1, Math.min(180, Number.isFinite(days) ? days : 60));
  const t = Date.now() - clamp * 24 * 60 * 60 * 1000;
  const d = new Date(t);
  return d.toISOString();
}

async function fetchShopifyJson(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${path} :: ${JSON.stringify(body)?.slice(0,200)}`);
  return body;
}

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json({ ok:false, error:"Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" }, { status: 500 });
    }

    const sql = getSql();

    // Parse ?days= safely (bounds 1..180)
    const { searchParams } = new URL(req.url);
    const raw = Number(searchParams.get("days"));
    const days = Number.isFinite(raw) ? Math.max(1, Math.min(180, raw)) : 60;
    const createdMin = isoDaysAgoSafe(days);

    // Ensure shop row exists (token intentionally not stored)
    await sql/*sql*/`
      insert into shops (shop_domain, access_token)
      values (${shop}, null)
      on conflict (shop_domain) do nothing;
    `;

    // 1) Orders (one page MVP)
    const ordersResp = await fetchShopifyJson(
      shop, token,
      `/orders.json?status=any&limit=50&created_at_min=${encodeURIComponent(createdMin)}&fields=id,created_at,total_price,line_items`
    );
    const orders: any[] = Array.isArray(ordersResp?.orders) ? ordersResp.orders : [];

    let itemsInserted = 0;

    for (const o of orders) {
      await sql/*sql*/`
        insert into orders (id, shop_domain, created_at, total_price)
        values (${o.id}, ${shop}, ${o.created_at}, ${o.total_price || null})
        on conflict (id) do nothing;
      `;

      const items: any[] = Array.isArray(o?.line_items) ? o.line_items : [];
      for (const li of items) {
        const vid = li?.variant_id;
        const qty = Number(li?.quantity || 0);
        if (!vid || qty <= 0) continue;

        await sql/*sql*/`
          insert into order_items (order_id, variant_id, quantity)
          values (${o.id}, ${vid}, ${qty})
          on conflict (order_id, variant_id) do update set quantity = excluded.quantity;
        `;
        itemsInserted++;
      }
    }

    // 2) Variant snapshot (first page)
    const variantsResp = await fetchShopifyJson(
      shop, token,
      `/variants.json?limit=50&fields=id,product_id,price,inventory_quantity`
    );
    const variants: any[] = Array.isArray(variantsResp?.variants) ? variantsResp.variants : [];

    for (const v of variants) {
      await sql/*sql*/`
        insert into variant_snapshots (shop_domain, variant_id, product_id, price, inventory_quantity)
        values (${shop}, ${v.id}, ${v.product_id}, ${v.price || null}, ${v.inventory_quantity || 0});
      `;
    }

    return NextResponse.json({
      ok: true,
      ingested: { orders: orders.length, order_items: itemsInserted, variant_snapshots: variants.length, window_days: days }
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
