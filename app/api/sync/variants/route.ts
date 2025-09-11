// app/api/sync/variants/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { getShopAndTokenWithFallback, shopifyAdminGET } from "../../../../lib/shopify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sql = getSql();
  try {
    const cookieHeader = req.headers.get("cookie") || undefined;
    const { shop, token } = await getShopAndTokenWithFallback(cookieHeader);

    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";

    // read last variants cursor (updated_at_min)
    const [st] = await sql/* sql */`
      SELECT variants_cursor FROM sync_state WHERE shop_domain = ${shop}
    `;
    const updated_at_min: string | undefined = st?.variants_cursor
      ? new Date(st.variants_cursor).toISOString()
      : undefined;

    // fetch products (to enumerate variants) incrementally
    // note: Shopify doesn’t expose a top-level "variants.json"; variants come under products
    let page = 1;
    const limit = 250;
    let inserted = 0;
    let maxUpdated: Date | undefined;

    while (true) {
      const q: Record<string, string> = { limit: String(limit), page: String(page) };
      if (updated_at_min) q.updated_at_min = updated_at_min;

      const data = await shopifyAdminGET<{ products: any[] }>(
        shop,
        token,
        "products.json",
        q
      );

      const products = data.products || [];
      if (products.length === 0) break;

      for (const p of products) {
        const pUpdated = p.updated_at ? new Date(p.updated_at) : undefined;
        if (pUpdated && (!maxUpdated || pUpdated > maxUpdated)) maxUpdated = pUpdated;

        for (const v of p.variants || []) {
          if (!dry) {
            await sql/* sql */`
              INSERT INTO variants (shop_domain, variant_id, product_id, title, price, sku,
                                    inventory_item_id, inventory_quantity, updated_at_shop)
              VALUES (
                ${shop}, ${v.id}, ${v.product_id}, ${v.title}, ${v.price}::numeric, ${v.sku},
                ${v.inventory_item_id}, ${v.inventory_quantity},
                ${v.updated_at ? new Date(v.updated_at) : null}
              )
              ON CONFLICT (shop_domain, variant_id) DO UPDATE
              SET title = EXCLUDED.title,
                  price = EXCLUDED.price,
                  sku = EXCLUDED.sku,
                  inventory_item_id = EXCLUDED.inventory_item_id,
                  inventory_quantity = EXCLUDED.inventory_quantity,
                  updated_at_shop = EXCLUDED.updated_at_shop
            `;
          }
          inserted++;
        }
      }

      // naive page advance; if you prefer proper link pagination,
      // you can add it later — works fine for dev data sizes
      if (products.length < limit) break;
      page++;
    }

    if (!dry && maxUpdated) {
      await sql/* sql */`
        INSERT INTO sync_state (shop_domain, variants_cursor)
        VALUES (${shop}, ${maxUpdated})
        ON CONFLICT (shop_domain) DO UPDATE
        SET variants_cursor = GREATEST(sync_state.variants_cursor, EXCLUDED.variants_cursor),
            updated_at = now()
      `;
    }

    return NextResponse.json({ ok: true, shop, inserted, dry });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
