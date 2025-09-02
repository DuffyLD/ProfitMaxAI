// app/api/sync/products/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { getShopAndTokenWithFallback, SHOPIFY_API_VERSION } from "../../../../lib/shopify";

type ShopifyProduct = {
  id: number;
  title: string;
  status?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  created_at?: string;
  updated_at?: string;
};

async function fetchProductsPage(shop: string, token: string, pageInfo?: string) {
  const base = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
  base.searchParams.set("limit", "250");
  if (pageInfo) base.searchParams.set("page_info", pageInfo);

  const res = await fetch(base.toString(), {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,  // ← IMPORTANT
      "Accept": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify products fetch failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { products: ShopifyProduct[] };
  const link = res.headers.get("link") || "";
  // parse next page_info (if present)
  let next: string | null = null;
  // Shopify's Link header format: <...page_info=XYZ>; rel="next"
  const m = link.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/i);
  if (m) next = decodeURIComponent(m[1]);
  return { products: json.products, nextPageInfo: next };
}

export async function GET(req: NextRequest) {
  try {
    const sql = getSql();
    const { shop, token } = await getShopAndTokenWithFallback();

    const dry = req.nextUrl.searchParams.get("dry") === "1"; // optional "dry run"
    let inserted = 0;
    let pageInfo: string | undefined;

    do {
      const { products, nextPageInfo } = await fetchProductsPage(shop, token, pageInfo);
      pageInfo = nextPageInfo || undefined;

      if (!dry && products.length) {
        // upsert (dedupe by shop_domain + product_id)
        await sql/* sql */`
          INSERT INTO products (
            shop_domain, product_id, title, status, vendor, product_type, tags, created_at_shop, updated_at_shop
          )
          SELECT
            ${shop},
            p.id,
            p.title,
            COALESCE(p.status, 'active'),
            COALESCE(p.vendor, ''),
            COALESCE(p.product_type, ''),
            COALESCE(p.tags, ''),
            to_timestamp(extract(epoch from NOW())), -- fallback if missing
            to_timestamp(extract(epoch from NOW()))
          FROM jsonb_to_recordset(${JSON.stringify(products)}::jsonb) as p(
            id bigint,
            title text,
            status text,
            vendor text,
            product_type text,
            tags text,
            created_at text,
            updated_at text
          )
          ON CONFLICT (shop_domain, product_id) DO UPDATE SET
            title = EXCLUDED.title,
            status = EXCLUDED.status,
            vendor = EXCLUDED.vendor,
            product_type = EXCLUDED.product_type,
            tags = EXCLUDED.tags,
            updated_at_shop = EXCLUDED.updated_at_shop
        `;
      }

      inserted += products.length;
      // Safety break for very large stores during early testing:
      if (inserted > 2000) break;
    } while (pageInfo);

    return NextResponse.json({ ok: true, shop, inserted, dry });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
