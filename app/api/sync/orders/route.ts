// app/api/sync/orders/route.ts
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

    // read last orders cursor
    const [st] = await sql/* sql */`
      SELECT orders_cursor FROM sync_state WHERE shop_domain = ${shop}
    `;
    const updated_at_min: string | undefined = st?.orders_cursor
      ? new Date(st.orders_cursor).toISOString()
      : undefined;

    const limit = 250;
    let page = 1;
    let insertedOrders = 0;
    let insertedItems = 0;
    let maxUpdated: Date | undefined;

    while (true) {
      const q: Record<string, string> = {
        limit: String(limit),
        page: String(page),
        status: "any",
      };
      if (updated_at_min) q.updated_at_min = updated_at_min;

      const data = await shopifyAdminGET<{ orders: any[] }>(
        shop,
        token,
        "orders.json",
        q
      );

      const orders = data.orders || [];
      if (orders.length === 0) break;

      for (const o of orders) {
        const upd = o.updated_at ? new Date(o.updated_at) : undefined;
        if (upd && (!maxUpdated || upd > maxUpdated)) maxUpdated = upd;

        if (!dry) {
          await sql/* sql */`
            INSERT INTO orders (shop_domain, order_id, name, email, total_price, currency,
                                created_at_shop, updated_at_shop, financial_status, fulfillment_status)
            VALUES (
              ${shop}, ${o.id}, ${o.name}, ${o.email}, ${o.total_price}::numeric, ${o.currency},
              ${o.created_at ? new Date(o.created_at) : null},
              ${o.updated_at ? new Date(o.updated_at) : null},
              ${o.financial_status}, ${o.fulfillment_status}
            )
            ON CONFLICT (shop_domain, order_id) DO UPDATE
            SET name = EXCLUDED.name,
                email = EXCLUDED.email,
                total_price = EXCLUDED.total_price,
                currency = EXCLUDED.currency,
                created_at_shop = EXCLUDED.created_at_shop,
                updated_at_shop = EXCLUDED.updated_at_shop,
                financial_status = EXCLUDED.financial_status,
                fulfillment_status = EXCLUDED.fulfillment_status
          `;
        }
        insertedOrders++;

        for (const li of o.line_items || []) {
          if (!dry) {
            await sql/* sql */`
              INSERT INTO order_items (shop_domain, order_id, line_id, product_id, variant_id,
                                       title, quantity, price)
              VALUES (
                ${shop}, ${o.id}, ${li.id}, ${li.product_id}, ${li.variant_id},
                ${li.title}, ${li.quantity}, ${li.price}::numeric
              )
              ON CONFLICT (shop_domain, order_id, line_id) DO UPDATE
              SET product_id = EXCLUDED.product_id,
                  variant_id = EXCLUDED.variant_id,
                  title = EXCLUDED.title,
                  quantity = EXCLUDED.quantity,
                  price = EXCLUDED.price
            `;
          }
          insertedItems++;
        }
      }

      if (orders.length < limit) break;
      page++;
    }

    if (!dry && maxUpdated) {
      await sql/* sql */`
        INSERT INTO sync_state (shop_domain, orders_cursor)
        VALUES (${shop}, ${maxUpdated})
        ON CONFLICT (shop_domain) DO UPDATE
        SET orders_cursor = GREATEST(sync_state.orders_cursor, EXCLUDED.orders_cursor),
            updated_at = now()
      `;
    }

    return NextResponse.json({
      ok: true,
      shop,
      inserted_orders: insertedOrders,
      inserted_items: insertedItems,
      dry,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
