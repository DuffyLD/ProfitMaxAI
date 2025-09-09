// app/api/shopify/variants-sync/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import {
  getShopAndTokenWithFallback,
  shopifyAdminGET,
} from "../../../../lib/shopify";

type ShopifyVariant = {
  id: number;
  product_id: number;
  title?: string | null;
  sku?: string | null;
  price?: string | null;
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

// Use since_id pagination via the same helper (consistent auth headers)
async function fetchProductsBatch(
  shop: string,
  token: string,
  sinceId?: number
): Promise<ShopifyProduct[]> {
  const query: Record<string, string | number> = {
    limit: 250,
    fields: "id,title,updated_at,created_at,variants",
  };
  if (sinceId && sinceId > 0) query.since_id = sinceId;

  const data = await shopifyAdminGET<ProductsResp>(shop, token, "products.json", query);
  return data.products || [];
}

export async function GET(req: NextRequest) {
  try {
    const sql = getSql();
    const { shop, token } = await getShopAndTokenWithFallback(
      req.headers.get("cookie") || undefined
    );

    const dry = (new URL(req.url).searchParams.get("dry") || "true").toLowerCase() !== "false";
    let totalUpserts = 0;

    let lastId = 0;
    let page = 0;

    while (true) {
      page++;
      const items = await fetchProductsBatch(shop, token, lastId);
      if (!items.length) break;

      // Flatten variants
      const variants: ShopifyVariant[] = [];
      for (const p of items) {
        if (p.variants && p.variants.length) {
          for (const v of p.variants) variants.push(v);
        }
      }

      if (variants.length && !dry) {
        // Upsert variants
        await sql/* sql */`
          INSERT INTO variants (
            shop_domain, product_id, variant_id, sku, title, price, compare_at_price,
            inventory_quantity, inventory_policy, requires_shipping, taxable, barcode,
            created_at_shop, updated_at_shop
          )
          SELECT
            ${shop}::text                         AS shop_domain,
            x.product_id::bigint                  AS product_id,
            x.id::bigint                          AS variant_id,
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
            updated_at text
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

      totalUpserts += variants.length;
      lastId = items[items.length - 1]?.id || lastId;
      if (items.length < 250) break; // last page
    }

    return NextResponse.json({ ok: true, shop, upserts: totalUpserts, dry });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "error" },
      { status: 500 }
    );
  }
}
