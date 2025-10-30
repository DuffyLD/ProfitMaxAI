import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const WINDOW_DAYS = 60;

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    if (!shop) {
      return NextResponse.json(
        { ok: false, error: "SHOPIFY_TEST_SHOP not set" },
        { status: 500 }
      );
    }

    const sql = getSql();

    // 1️⃣ Basic metrics
    const [{ c: ordersCount }] = await sql/*sql*/`
      select count(*)::int as c
      from orders
      where shop_domain = ${shop};
    ` as any;

    const [{ c: uniqueVariantsSold }] = await sql/*sql*/`
      select count(distinct oi.variant_id)::int as c
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop}
        and o.created_at >= now() - interval '${WINDOW_DAYS} days';
    ` as any;

    const [{ c: totalSnapshots }] = await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    ` as any;

    // 2️⃣ Top sellers (last 60 days)
    const topSellers = await sql/*sql*/`
      select
        oi.variant_id,
        sum(oi.quantity)::int as qty_sold
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop}
        and o.created_at >= now() - interval '${WINDOW_DAYS} days'
      group by oi.variant_id
      order by qty_sold desc
      limit 10;
    ` as any[];

    // 3️⃣ Respond with structured metrics
    return NextResponse.json({
      ok: true,
      shop,
      metrics: {
        orders_in_db: ordersCount || 0,
        unique_variants_sold_60d: uniqueVariantsSold || 0,
        variant_snapshots_total: totalSnapshots || 0,
      },
      top_sellers: topSellers,
      meta: { filtered_by_60d: true, window_days: WINDOW_DAYS },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
