// app/api/sync/orders/route.ts

import { NextResponse } from "next/server";

// NOTE: using *relative* imports to avoid alias resolution issues
import { getCurrentShopAndToken, SHOPIFY_API_VERSION } from "../../../lib/shopify";
import { getSql } from "../../../lib/db";

// ---- Helpers ----

function getNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Shopify link header example:
  // <https://shop.myshopify.com/admin/api/2024-07/orders.json?page_info=xyz&limit=250>; rel="next"
  const parts = linkHeader.split(",");
  for (const p of parts) {
    if (p.includes('rel="next"')) {
      const m = p.match(/<([^>]+)>/);
      if (!m) continue;
      const url = new URL(m[1]);
      return url.searchParams.get("page_info");
    }
  }
  return null;
}

async function shopifyGET<T>(shop: string, token: string, path: string, query?: Record<string, string>) {
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: {
      "X-Shopify-Access-Token": token,
      "Accept": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify GET ${path} failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as T;
  const link = res.headers.get("Link");
  return { data, link };
}

// ---- Route handler ----

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { shop, token } = await getCurrentShopAndToken();

    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "true";

    const sql = getSql();

    // 1) read last orders cursor
    const rows: any[] = await sql/* sql */`
      SELECT orders_cursor FROM sync_state WHERE shop_domain = ${shop}
    `;
    const updated_at_min: string | undefined = rows?.[0]?.orders_cursor || undefined;

    // 2) page through Shopify orders (ascending by updated_at)
    let pageInfo: string | null = null;
    let totalFetched = 0;
    let latestCursor: string | undefined = updated_at_min;

    do {
      const query: Record<string, string> = {
        limit: "250",
        status: "any",
        order: "updated_at asc",
      };
      if (pageInfo) query.page_info = pageInfo;
      else if (updated_at_min) query.updated_at_min = updated_at_min;

      type OrdersResp = { orders: any[] };
      const { data, link } = await shopifyGET<OrdersResp>(shop, token, "orders.json", query);

      const orders = data.orders || [];
      totalFetched += orders.length;

      if (!dry && orders.length > 0) {
        await upsertOrders(sql, shop, orders);
      }

      if (orders.length > 0) {
        // track the newest updated_at for cursor
        const last = orders[orders.length - 1];
        latestCursor = last.updated_at || last.processed_at || latestCursor;
      }

      pageInfo = getNextPageInfo(link);
    } while (pageInfo);

    // 3) persist cursor
    if (!dry && latestCursor) {
      await sql/* sql */`
        INSERT INTO sync_state (shop_domain, orders_cursor, products_cursor, variants_cursor)
        VALUES (${shop}, ${latestCursor}, COALESCE((SELECT products_cursor FROM sync_state WHERE shop_domain=${shop}), NULL), COALESCE((SELECT variants_cursor FROM sync_state WHERE shop_domain=${shop}), NULL))
        ON CONFLICT (shop_domain) DO UPDATE SET orders_cursor = EXCLUDED.orders_cursor
      `;
    }

    return NextResponse.json({
      ok: true,
      shop,
      fetched: totalFetched,
      dry,
      cursor_after: latestCursor || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// ---- DB write helpers ----

async function upsertOrders(sql: any, shop: string, orders: any[]) {
  // Upsert orders
  // Assuming you have table `orders` with columns:
  // shop_domain, order_id, name, financial_status, fulfillment_status, processed_at, updated_at_shop, total_price, currency
  if (orders.length === 0) return;

  // Batch insert orders
  for (const o of orders) {
    await sql/* sql */`
      INSERT INTO orders (
        shop_domain, order_id, name, financial_status, fulfillment_status,
        processed_at, updated_at_shop, total_price, currency, customer_email
      ) VALUES (
        ${shop}, ${o.id}, ${o.name}, ${o.financial_status}, ${o.fulfillment_status},
        ${o.processed_at || o.created_at}, ${o.updated_at}, ${o.total_price}, ${o.currency}, ${o?.email || null}
      )
      ON CONFLICT (shop_domain, order_id) DO UPDATE
      SET
        financial_status = EXCLUDED.financial_status,
        fulfillment_status = EXCLUDED.fulfillment_status,
        processed_at = EXCLUDED.processed_at,
        updated_at_shop = EXCLUDED.updated_at_shop,
        total_price = EXCLUDED.total_price,
        currency = EXCLUDED.currency,
        customer_email = EXCLUDED.customer_email
    `;
  }

  // Upsert line items
  // Assuming table `order_items` with columns:
  // shop_domain, order_id, line_item_id, product_id, variant_id, title, quantity, price
  for (const o of orders) {
    const items: any[] = Array.isArray(o.line_items) ? o.line_items : [];
    for (const li of items) {
      await sql/* sql */`
        INSERT INTO order_items (
          shop_domain, order_id, line_item_id, product_id, variant_id,
          title, quantity, price
        ) VALUES (
          ${shop}, ${o.id}, ${li.id}, ${li.product_id}, ${li.variant_id},
          ${li.title}, ${li.quantity}, ${li.price}
        )
        ON CONFLICT (shop_domain, order_id, line_item_id) DO UPDATE
        SET
          product_id = EXCLUDED.product_id,
          variant_id = EXCLUDED.variant_id,
          title = EXCLUDED.title,
          quantity = EXCLUDED.quantity,
          price = EXCLUDED.price
      `;
    }
  }
}
