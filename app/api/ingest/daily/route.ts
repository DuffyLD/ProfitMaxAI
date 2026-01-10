// app/api/ingest/daily/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const API_VERSION = "2024-10";
const DEFAULT_DAYS = 120;
const MAX_DAYS = 365;

function parseDays(url: string) {
  const sp = new URL(url).searchParams;
  const v = sp.get("days");
  let n = DEFAULT_DAYS;
  if (v !== null) {
    const maybe = Number(v);
    if (Number.isFinite(maybe) && !Number.isNaN(maybe)) n = maybe;
  }
  return Math.max(1, Math.min(MAX_DAYS, n));
}

function isoDaysAgoSafe(days: number) {
  const t = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString();
}

async function fetchShopifyJson(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${path} :: ${JSON.stringify(body)?.slice(0, 200)}`);
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
    const days = parseDays(req.url);
    const createdMin = isoDaysAgoSafe(days);

    // Ensure shop row exists (token intentionally null)
    await sql/*sql*/`
      insert into shops (shop_domain, access_token)
      values (${shop}, null)
      on conflict (shop_domain) do nothing;
    `;

    // --------------------------
    // 1) Orders (one page for MVP)
    // --------------------------
    const ordersResp = await fetchShopifyJson(
      shop,
      token,
      `/orders.json?status=any&limit=50&created_at_min=${encodeURIComponent(
        createdMin
      )}&fields=id,created_at,total_price,line_items`
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

    // --------------------------
    // 2) Variant snapshots WITH TITLES
    // We fetch products (includes variants) so we can save:
    // - product_title
    // - variant_title
    // --------------------------
    const productsResp = await fetchShopifyJson(
      shop,
      token,
      `/products.json?limit=250&fields=id,title,variants`
    );

    const products: any[] = Array.isArray(productsResp?.products) ? productsResp.products : [];

    // Flatten all variants into a list we can insert
    type FlatVariant = {
      variant_id: number;
      product_id: number;
      price: string | null;
      inventory_quantity: number;
      product_title: string | null;
      variant_title: string | null;
    };

    const flatVariants: FlatVariant[] = [];

    for (const p of products) {
      const productId = Number(p?.id);
      const productTitle = typeof p?.title === "string" ? p.title : null;
      const variants: any[] = Array.isArray(p?.variants) ? p.variants : [];

      for (const v of variants) {
        const variantId = Number(v?.id);
        if (!variantId || !productId) continue;

        flatVariants.push({
          variant_id: variantId,
          product_id: productId,
          price: v?.price != null ? String(v.price) : null,
          inventory_quantity: Number(v?.inventory_quantity ?? 0),
          product_title: productTitle,
          variant_title: typeof v?.title === "string" ? v.title : null,
        });
      }
    }

    // Insert snapshots
    for (const v of flatVariants) {
      await sql/*sql*/`
        insert into variant_snapshots (
          shop_domain,
          variant_id,
          product_id,
          price,
          inventory_quantity,
          product_title,
          variant_title
        )
        values (
          ${shop},
          ${v.variant_id},
          ${v.product_id},
          ${v.price},
          ${v.inventory_quantity},
          ${v.product_title},
          ${v.variant_title}
        );
      `;
    }

    return NextResponse.json({
      ok: true,
      ingested: {
        orders: orders.length,
        order_items: itemsInserted,
        variant_snapshots: flatVariants.length,
        window_days: days,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}