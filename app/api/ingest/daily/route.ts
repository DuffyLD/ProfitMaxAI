// app/api/ingest/daily/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const API_VERSION = "2024-10";

function isoDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

async function fetchShopifyJson(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} @ ${path} :: ${JSON.stringify(body)?.slice(0, 200)}`
    );
  }
  return body;
}

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json(
        { ok: false, error: "Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" },
        { status: 500 }
      );
    }

    const sql = getSql();
    const { searchParams } = new URL(req.url);
    // allow up to 120 days per our discussion
    const days = Math.max(1, Math.min(120, Number(searchParams.get("days") || 60)));
    const createdMin = isoDaysAgo(days);

    // Ensure shop row exists (we're not storing tokens here)
    await sql/*sql*/`
      insert into shops (shop_domain, access_token)
      values (${shop}, null)
      on conflict (shop_domain) do nothing;
    `;

    // ---- 1) Ingest orders (single page, 250 max; good enough for MVP) ----
    const ordersResp = await fetchShopifyJson(
      shop,
      token,
      `/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(
        createdMin
      )}&fields=id,created_at,total_price,line_items`
    );
    const orders: any[] = Array.isArray(ordersResp?.orders) ? ordersResp.orders : [];

    let insertedOrders = 0;
    let upsertedItems = 0;

    for (const o of orders) {
      // Defensive: skip if no id or no created_at
      const orderId = o?.id;
      const createdAt = o?.created_at;
      if (!orderId || !createdAt) continue;

      // Insert order row
      await sql/*sql*/`
        insert into orders (id, shop_domain, created_at, total_price)
        values (${orderId}, ${shop}, ${createdAt}, ${o?.total_price ?? null})
        on conflict (id) do nothing;
      `;
      insertedOrders++;

      // Insert line items
      const items: any[] = Array.isArray(o?.line_items) ? o.line_items : [];
      for (const li of items) {
        const vid = li?.variant_id;
        const qty = Number(li?.quantity || 0);
        // Defensive: skip if missing IDs or non-positive qty
        if (!orderId || !vid || qty <= 0) continue;

        await sql/*sql*/`
          insert into order_items (order_id, variant_id, quantity)
          values (${orderId}, ${vid}, ${qty})
          on conflict (order_id, variant_id)
          do update set quantity = excluded.quantity; -- keep idempotent/simple
        `;
        upsertedItems++;
      }
    }

    // ---- 2) Variant snapshot (first page only for MVP) ----
    const variantsResp = await fetchShopifyJson(
      shop,
      token,
      `/variants.json?limit=250&fields=id,product_id,price,inventory_quantity`
    );
    const variants: any[] = Array.isArray(variantsResp?.variants) ? variantsResp.variants : [];

    let insertedSnapshots = 0;
    for (const v of variants) {
      const variantId = v?.id;
      const productId = v?.product_id;
      if (!variantId || !productId) continue;

      await sql/*sql*/`
        insert into variant_snapshots (shop_domain, variant_id, product_id, price, inventory_quantity)
        values (${shop}, ${variantId}, ${productId}, ${v?.price ?? null}, ${v?.inventory_quantity ?? 0});
      `;
      insertedSnapshots++;
    }

    return NextResponse.json({
      ok: true,
      ingested: {
        orders: insertedOrders,
        order_items: upsertedItems,
        variant_snapshots: insertedSnapshots,
        window_days: days,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
