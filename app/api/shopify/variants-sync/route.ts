// app/api/shopify/variants-sync/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { getShopAndTokenWithFallback, shopifyAdminGET, SHOPIFY_API_VERSION } from "../../../../lib/shopify";

type ShopifyVariant = {
  id: number;
  product_id: number;
  title: string | null;
  sku: string | null;
  price: string | null;
  compare_at_price?: string | null;
  inventory_quantity?: number | null;
  inventory_policy?: string | null;
  requires_shipping?: boolean | null;
  taxable?: boolean | null;
  barcode?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ShopifyProduct = {
  id: number;
  title?: string;
  updated_at?: string;
  created_at?: string;
  variants?: ShopifyVariant[];
};

type ProductsResp = { products: ShopifyProduct[] };

async function fetchProductsPage(
  shop: string,
  token: string,
  pageInfo?: string
): Promise<{ items: ShopifyProduct[]; nextPageInfo?: string }> {
  const path = "products.json";
  const baseQuery: Record<string, string | number> = {
    limit: 250,                                 // Shopify max per page
    fields: "id,title,updated_at,created_at,variants",
  };

  // page_info pagination per Shopify REST
  const query = { ...baseQuery, ...(pageInfo ? { page_info: pageInfo } : {}) };

  // We need the Link header for next page_info; use the raw fetch helper path
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify products fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as ProductsResp;

  // Parse Link header for next page_info
  const link = res.headers.get("link") || res.headers.get("Link");
  let next: string | undefined;
  if (link) {
    // Format: <https://...page_info=XYZ>; rel="next", <...>; rel="previous"
    const m = link.split(",").find(s => s.includes('rel="next"'));
    if (m) {
      const urlPart = m.split(";")[0].trim();
      const href = urlPart.slice(1, -1); // remove <>
      const u = new URL(href);
      const pi = u.searchParams.get("page_info");
      if (pi) next = pi;
    }
  }

  return { items: data.products || [], nextPageInfo: next };
}

export async function GET(req: NextRequest) {
  try {
    const sql = getSql();
    const { shop, token } = await getShopAndTokenWithFallback(req.headers.get("cookie") || undefined);

    // Dry run?
    const dry = (new URL(req.url).searchParams.get("dry") || "true").toLowerCase() !== "false";
    let totalInserted = 0;

    let pageInfo: string | undefined = undefined;
    let page = 0;

    do {
      page++;
      const { items, nextPageInfo } = await fetchProductsPage(shop, token, pageInfo);
      pageInfo = nextPageInfo;

      if (!items.length) break;

      // Flatten variants
      const variants: ShopifyVariant[] = [];
      for (const p of items) {
        if (!p.variants?.length) continue;
        for (const v of p.variants) variants.push(v);
      }

      if (!variants.length) continue;

      if (!dry) {
        // Upsert variants
        // NOTE: numeric strings → DB numeric using CAST in SQL
        await sql/* sql */`
          INSERT INTO variants (
            shop_domain, product_id, variant_id, sku, title, price, compare_at_price,
            inventory_quantity, inventory_policy, requires_shipping, taxable, barcode,
            created_at_shop, updated_at_shop
          )
          SELECT
            ${shop}::text                         AS shop_domain,
            x.product_id::bigint                  AS product_id,
            x.variant_id::bigint                  AS variant_id,
            x.sku::text                           AS sku,
            x.title::text                         AS title,
            NULLIF(x.price, '')::numeric(12,2)    AS price,
            NULLIF(x.compare_at_price, '')::numeric(12,2) AS compare_at_price,
            x.inventory_quantity::int             AS inventory_quantity,
            x.inventory_policy::text              AS inventory_policy,
            x.requires_shipping::boolean          AS requires_shipping,
            x.taxable::boolean                    AS taxable,
            x.barcode::text                       AS barcode,
            NULLIF(x.created_at, '')::timestamptz AS created_at_shop,
            NULLIF(x.updated_at, '')::timestamptz AS updated_at_shop
          FROM jsonb_to_recordset(${JSON.stringify(variants)}::jsonb) AS x(
            id bigint,
            product_id bigint,
            title text,
            sku text,
            price text,
            compare_at_price text,
            inventory_quantity int,
            inventory_policy text,
            requires_shipping boolean,
            taxable boolean,
            barcode text,
            created_at text,
            updated_at text,
            variant_id bigint
          )
          ON CONFLICT (shop_domain, variant_id)
          DO UPDATE SET
            sku                = EXCLUDED.sku,
            title              = EXCLUDED.title,
            price              = EXCLUDED.price,
            compare_at_price   = EXCLUDED.compare_at_price,
            inventory_quantity = EXCLUDED.inventory_quantity,
            inventory_policy   = EXCLUDED.inventory_policy,
            requires_shipping  = EXCLUDED.requires_shipping,
            taxable            = EXCLUDED.taxable,
            barcode            = EXCLUDED.barcode,
            updated_at_shop    = EXCLUDED.updated_at_shop;
        `;
      }

      totalInserted += variants.length;
    } while (pageInfo);

    return NextResponse.json({ ok: true, shop, inserted: totalInserted, dry });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "error" }, { status: 500 });
  }
}
