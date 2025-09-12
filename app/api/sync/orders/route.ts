// app/api/sync/orders/route.ts
import { NextResponse } from "next/server";
import { getCurrentShopAndToken, SHOPIFY_API_VERSION } from "@/lib/shopify";
import { getSql } from "@/lib/db";

type OrdersResp = { orders: Array<any> };

function buildOrdersUrl(shop: string, params: Record<string, string>) {
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json`);
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

    // 1) Read last cursor (if any) from sync_state
    const rows: any[] = await sql/* sql */`
      SELECT orders_cursor FROM sync_state WHERE shop_domain = ${shop}
    `;
    const updated_at_min: string | undefined = rows[0]?.orders_cursor;

    // 2) Build Shopify request (minimal fields; order by updated_at asc for monotonic cursor)
    const query: Record<string, string> = {
      status: "any",
      limit: "50",
      order: "updated_at asc",
      fields:
        "id,name,created_at,updated_at,financial_status,fulfillment_status,total_price,currency,customer",
    };
    if (updated_at_min) query.updated_at_min = updated_at_min;

    const firstUrl = buildOrdersUrl(shop, query);

    // 3) Page loop (single page for now; refresh again to continue)
    const inserted = { orders: 0 };
    let url: string | null = firstUrl;

    for (let page = 0; page < 1 && url; page++) {
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": token,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Shopify GET orders.json failed: ${res.status} ${text}`);
      }

      const data = (await res.json()) as OrdersResp;
      const orders = data.orders ?? [];

      if (!dry && orders.length) {
        await sql.begin(async (tx) => {
          for (const o of orders) {
            await tx/* sql */`
              INSERT INTO orders (
                shop_domain, order_id, name,
                created_at_shop, updated_at_shop,
                financial_status, fulfillment_status, currency,
                total_price, customer_id, raw_json, updated_at
              )
              VALUES (
                ${shop}, ${o.id}, ${o.name ?? null},
                ${o.created_at ? new Date(o.created_at) : null},
                ${o.updated_at ? new Date(o.updated_at) : null},
                ${o.financial_status ?? null},
                ${o.fulfillment_status ?? null},
                ${o.currency ?? null},
                ${o.total_price ?? null},
                ${o.customer?.id ?? null},
                ${JSON.stringify(o)}, now()
              )
              ON CONFLICT (shop_domain, order_id) DO UPDATE SET
                name              = EXCLUDED.name,
                created_at_shop   = EXCLUDED.created_at_shop,
                updated_at_shop   = EXCLUDED.updated_at_shop,
                financial_status  = EXCLUDED.financial_status,
                fulfillment_status= EXCLUDED.fulfillment_status,
                currency          = EXCLUDED.currency,
                total_price       = EXCLUDED.total_price,
                customer_id       = EXCLUDED.customer_id,
                raw_json          = EXCLUDED.raw_json,
                updated_at        = now()
            `;
          }

          const lastUpdated = orders[orders.length - 1]?.updated_at;
          if (lastUpdated) {
            await tx/* sql */`
              INSERT INTO sync_state (shop_domain, orders_cursor, updated_at)
              VALUES (${shop}, ${lastUpdated}, now())
              ON CONFLICT (shop_domain) DO UPDATE SET
                orders_cursor = EXCLUDED.orders_cursor,
                updated_at    = now()
            `;
          }
        });
      }

      inserted.orders += orders.length;
      // TODO: parse Link header for real pagination; single page for MVP.
      url = null;
    }

    return NextResponse.json({
      ok: true,
      shop,
      inserted: inserted.orders,
      dry,
      cursor_after: updated_at_min ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
