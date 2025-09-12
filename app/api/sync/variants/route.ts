// app/api/sync/variants/route.ts
import { NextResponse } from "next/server";
import { getCurrentShopAndToken, SHOPIFY_API_VERSION } from "@/lib/shopify";
import { getSql } from "@/lib/db";

type VariantsResp = { variants: Array<any> };

function buildVariantsUrl(shop: string, params: Record<string, string>) {
  const url = new URL(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/variants.json`
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dry = searchParams.get("dry") === "true";

  try {
    const { shop, token } = await getCurrentShopAndToken();
    const sql = getSql();

    // 1) Read last cursor from sync_state (NO array-destructuring)
    const res = await sql/* sql */`
      SELECT variants_cursor FROM sync_state WHERE shop_domain = ${shop}
    `;
    const rows: any[] =
      (res as any)?.rows ?? (Array.isArray(res) ? (res as any[]) : []);
    const updated_at_min: string | undefined = rows[0]?.variants_cursor;

    // 2) Build Shopify request
    const query: Record<string, string> = {
      limit: "50",
      order: "updated_at asc",
      fields:
        "id,product_id,title,price,sku,position,created_at,updated_at,inventory_quantity,option1,option2,option3",
    };
    if (updated_at_min) query.updated_at_min = updated_at_min;
    const firstUrl = buildVariantsUrl(shop, query);

    // 3) Pull one page (MVP) and upsert
    const inserted = { variants: 0 };
    let url: string | null = firstUrl;

    for (let page = 0; page < 1 && url; page++) {
      const resp = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": token,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Shopify GET variants.json failed: ${resp.status} ${text}`);
      }

      const data = (await resp.json()) as VariantsResp;
      const variants = data.variants ?? [];

      if (!dry && variants.length) {
        // IMPORTANT: no sql.begin(); Neon’s sql is a function, not a client with .begin()
        for (const v of variants) {
          await sql/* sql */`
            INSERT INTO variants (
              shop_domain, variant_id, product_id, title,
              price, sku, position, created_at_shop, updated_at_shop,
              inventory_quantity, option1, option2, option3, raw_json, updated_at
            )
            VALUES (
              ${shop}, ${v.id}, ${v.product_id}, ${v.title ?? null},
              ${v.price ?? null}, ${v.sku ?? null}, ${v.position ?? null},
              ${v.created_at ? new Date(v.created_at) : null},
              ${v.updated_at ? new Date(v.updated_at) : null},
              ${v.inventory_quantity ?? null},
              ${v.option1 ?? null}, ${v.option2 ?? null}, ${v.option3 ?? null},
              ${JSON.stringify(v)}, now()
            )
            ON CONFLICT (shop_domain, variant_id) DO UPDATE SET
              product_id         = EXCLUDED.product_id,
              title              = EXCLUDED.title,
              price              = EXCLUDED.price,
              sku                = EXCLUDED.sku,
              position           = EXCLUDED.position,
              created_at_shop    = EXCLUDED.created_at_shop,
              updated_at_shop    = EXCLUDED.updated_at_shop,
              inventory_quantity = EXCLUDED.inventory_quantity,
              option1            = EXCLUDED.option1,
              option2            = EXCLUDED.option2,
              option3            = EXCLUDED.option3,
              raw_json           = EXCLUDED.raw_json,
              updated_at         = now()
          `;
        }

        // advance cursor
        const lastUpdated = variants[variants.length - 1]?.updated_at;
        if (lastUpdated) {
          await sql/* sql */`
            INSERT INTO sync_state (shop_domain, variants_cursor, updated_at)
            VALUES (${shop}, ${lastUpdated}, now())
            ON CONFLICT (shop_domain) DO UPDATE SET
              variants_cursor = EXCLUDED.variants_cursor,
              updated_at      = now()
          `;
        }
      }

      inserted.variants += variants.length;
      url = null; // one page for MVP
    }

    return NextResponse.json({
      ok: true,
      shop,
      inserted: inserted.variants,
      dry,
      cursor_after: updated_at_min ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
