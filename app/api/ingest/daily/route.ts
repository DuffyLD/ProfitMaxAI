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

async function fetchShopifyGraphQL(shop: string, token: string, query: string, variables?: any) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status} @ graphql :: ${JSON.stringify(json)?.slice(0, 300)}`);

  if (json?.errors?.length) {
    throw new Error(`GraphQL errors :: ${JSON.stringify(json.errors)?.slice(0, 300)}`);
  }

  return json;
}

function gidToNumericId(gid: string | null | undefined): string | null {
  if (!gid || typeof gid !== "string") return null;
  const parts = gid.split("/");
  return parts.length ? parts[parts.length - 1] : null;
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

    // 1) Orders (one page for MVP)
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

    // 2) Variant snapshots (GraphQL, first 250 variants)
    const gql = `
      query VariantSnapshots($first: Int!, $after: String) {
        productVariants(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              price
              inventoryQuantity
              product {
                id
                title
              }
            }
          }
        }
      }
    `;

    const first = 250;
    let after: string | null = null;
    let totalVariantsInserted = 0;

    // For MVP, do 1 page only (keeps it fast + simple)
    const resp = await fetchShopifyGraphQL(shop, token, gql, { first, after });
    const edges = resp?.data?.productVariants?.edges || [];

    for (const e of edges) {
      const n = e?.node;
      const variantId = gidToNumericId(n?.id);
      const productId = gidToNumericId(n?.product?.id);
      const productTitle = n?.product?.title ?? null;
      const variantTitle = n?.title ?? null;
      const price = n?.price ?? null;
      const invQty = Number(n?.inventoryQuantity ?? 0);

      if (!variantId || !productId) continue;

      await sql/*sql*/`
        insert into variant_snapshots (
          shop_domain, variant_id, product_id, price, inventory_quantity, product_title, variant_title
        )
        values (
          ${shop}, ${variantId}, ${productId}, ${price || null}, ${invQty}, ${productTitle}, ${variantTitle}
        );
      `;
      totalVariantsInserted++;
    }

    return NextResponse.json({
      ok: true,
      ingested: {
        orders: orders.length,
        order_items: itemsInserted,
        variant_snapshots: totalVariantsInserted,
        window_days: days,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
