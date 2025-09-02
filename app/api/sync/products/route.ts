// app/api/sync/products/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import {
  getShopAndTokenWithFallback,
  SHOPIFY_API_VERSION,
} from "../../../../lib/shopify";

/**
 * Minimal Shopify REST pagination (cursor via Link header).
 * We fetch products in pages of 250 and upsert them into Neon.
 *
 * Assumes your `products` table has at least:
 *   shop_domain TEXT
 *   product_id  BIGINT
 *   title       TEXT
 *   updated_at_shop TIMESTAMPTZ
 * and a unique constraint on (shop_domain, product_id).
 */
export async function GET(req: NextRequest) {
  try {
    const sql = getSql();

    // IMPORTANT: prefer cookie token (fresh), fall back to DB only if needed
    const { shop, token } = await getShopAndTokenWithFallback(
      req.headers.get("cookie") || undefined
    );

    const isDry = req.nextUrl.searchParams.get("dry") === "1";

    let url = new URL(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`
    );
    url.searchParams.set("limit", "250");
    // keep payload small; add more fields later as we expand schema
    url.searchParams.set("fields", "id,title,updated_at");

    let inserted = 0;
    let pageCount = 0;

    while (true) {
      pageCount++;
      if (pageCount > 40) break; // hard stop to avoid infinite loops

      const res = await fetch(url.toString(), {
        headers: {
          "X-Shopify-Access-Token": token,
          "Accept": "application/json",
        },
        cache: "no-store",
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `Shopify products fetch failed: ${res.status} ${text}`
        );
      }

      const data = JSON.parse(text) as {
        products: { id: number; title: string; updated_at: string }[];
      };

      // Upsert rows
      for (const p of data.products) {
        if (!isDry) {
          await sql/* sql */`
            INSERT INTO products (shop_domain, product_id, title, updated_at_shop)
            VALUES (${shop}, ${p.id}, ${p.title}, ${p.updated_at})
            ON CONFLICT (shop_domain, product_id)
            DO UPDATE SET
              title = EXCLUDED.title,
              updated_at_shop = EXCLUDED.updated_at_shop;
          `;
        }
        inserted++;
      }

      // Parse cursor pagination from Link header
      const link = res.headers.get("link") || res.headers.get("Link");
      if (!link) break;

      const nextMatch = link
        .split(",")
        .map((s) => s.trim())
        .find((s) => s.endsWith('rel="next"'));

      if (!nextMatch) break;

      // Extract page_info from the <...> URL
      const urlMatch = nextMatch.match(/<([^>]+)>/);
      if (!urlMatch) break;

      const nextUrl = new URL(urlMatch[1]);
      const pageInfo = nextUrl.searchParams.get("page_info");
      if (!pageInfo) break;

      // Build next request URL with our preferred fields/limit
      url = new URL(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`
      );
      url.searchParams.set("limit", "250");
      url.searchParams.set("fields", "id,title,updated_at");
      url.searchParams.set("page_info", pageInfo);
    }

    return NextResponse.json({ ok: true, shop, inserted, dry: isDry || false });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e.message || e) },
      { status: 500 }
    );
  }
}
