// app/api/sync/products/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { getShopAndTokenWithFallback, SHOPIFY_API_VERSION } from "../../../../lib/shopify";

/**
 * Pulls all products (and their variants) from Shopify and UPSERTs into Neon.
 * Idempotent: safe to run multiple times.
 */
export async function GET() {
  const sql = getSql();

  // 1) Get shop + token (cookies if present, else DB fallback)
  const { shop, token } = await getShopAndTokenWithFallback();

  // 2) Helper to fetch one page of products using page_info (Graph-like pagination)
  async function fetchPage(pageInfo?: string) {
    const base = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    base.searchParams.set("limit", "250");
    if (pageInfo) base.searchParams.set("page_info", pageInfo);

    const res = await fetch(base.toString(), {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Shopify products fetch failed: ${res.status} ${t}`);
    }

    const data = (await res.json()) as { products: any[] };
    // Link header holds pagination info
    const link = res.headers.get("link") || "";
    const next = parseNextPageInfo(link);
    return { products: data.products || [], nextPageInfo: next };
  }

  function parseNextPageInfo(linkHeader: string): string | null {
    // Shopify style: <https://...page_info=XYZ>; rel="next", <...>; rel="previous"
    const parts = linkHeader.split(",").map(s => s.trim());
    const nextPart = parts.find(p => /rel="?next"?/.test(p));
    if (!nextPart) return null;
    const m = nextPart.match(/<([^>]+)>/);
    if (!m) return null;
    const url = new URL(m[1]);
    return url.searchParams.get("page_info");
  }

  // 3) Upsert helpers
  async function upsertProducts(products: any[]) {
    if (!products.length) return;

    // Build arrays for bulk upserts
    const prodRows = products.map(p => ({
      product_id: Number(p.id),
      title: String(p.title ?? ""),
      status: String(p.status ?? ""),
      vendor: String(p.vendor ?? ""),
      product_type: String(p.product_type ?? ""),
      created_at: p.created_at ? new Date(p.created_at) : null,
      updated_at: p.updated_at ? new Date(p.updated_at) : null,
    }));

    // Upsert products
    await sql/* sql */`
      INSERT INTO products (
        shop_domain, product_id, title, status, vendor, product_type, created_at, updated_at
      )
      SELECT * FROM UNNEST (
        ${[shop]},                             -- shop_domain (repeated for each row)
        ${prodRows.map(r => r.product_id)},    -- product_id[]
        ${prodRows.map(r => r.title)},         -- title[]
        ${prodRows.map(r => r.status)},        -- status[]
        ${prodRows.map(r => r.vendor)},        -- vendor[]
        ${prodRows.map(r => r.product_type)},  -- product_type[]
        ${prodRows.map(r => r.created_at)},    -- created_at[]
        ${prodRows.map(r => r.updated_at)}     -- updated_at[]
      )
      ON CONFLICT (shop_domain, product_id)
      DO UPDATE SET
        title       = EXCLUDED.title,
        status      = EXCLUDED.status,
        vendor      = EXCLUDED.vendor,
        product_type= EXCLUDED.product_type,
        updated_at  = EXCLUDED.updated_at;
    `;

    // Upsert variants
    const variantRows = products.flatMap(p =>
      (p.variants || []).map((v: any) => ({
        product_id: Number(p.id),
        variant_id: Number(v.id),
        title: String(v.title ?? ""),
        sku: String(v.sku ?? ""),
        price: v.price !== undefined ? Number(v.price) : null,
        compare_at_price: v.compare_at_price !== undefined ? Number(v.compare_at_price) : null,
        inventory_item_id: v.inventory_item_id ? Number(v.inventory_item_id) : null,
        created_at: v.created_at ? new Date(v.created_at) : null,
        updated_at: v.updated_at ? new Date(v.updated_at) : null,
      }))
    );

    if (variantRows.length) {
      await sql/* sql */`
        INSERT INTO variants (
          shop_domain, product_id, variant_id, title, sku, price, compare_at_price, inventory_item_id, created_at, updated_at
        )
        SELECT * FROM UNNEST (
          ${[shop]},
          ${variantRows.map(r => r.product_id)},
          ${variantRows.map(r => r.variant_id)},
          ${variantRows.map(r => r.title)},
          ${variantRows.map(r => r.sku)},
          ${variantRows.map(r => r.price)},
          ${variantRows.map(r => r.compare_at_price)},
          ${variantRows.map(r => r.inventory_item_id)},
          ${variantRows.map(r => r.created_at)},
          ${variantRows.map(r => r.updated_at)}
        )
        ON CONFLICT (shop_domain, variant_id)
        DO UPDATE SET
          title             = EXCLUDED.title,
          sku               = EXCLUDED.sku,
          price             = EXCLUDED.price,
          compare_at_price  = EXCLUDED.compare_at_price,
          inventory_item_id = EXCLUDED.inventory_item_id,
          updated_at        = EXCLUDED.updated_at;
      `;
    }
  }

  // 4) Iterate pages
  let pages = 0;
  let totalProducts = 0;
  let pageInfo: string | null = null;

  do {
    const { products, nextPageInfo } = await fetchPage(pageInfo || undefined);
    await upsertProducts(products);
    totalProducts += products.length;
    pages += 1;
    pageInfo = nextPageInfo;
  } while (pageInfo);

  // 5) Touch sync_state so we know when we last pulled
  await sql/* sql */`
    INSERT INTO sync_state (shop_domain, last_products_sync)
    VALUES (${shop}, NOW())
    ON CONFLICT (shop_domain)
    DO UPDATE SET last_products_sync = NOW();
  `;

  return NextResponse.json({ ok: true, shop, pages, totalProducts });
}
