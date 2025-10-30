import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const DEFAULT_WINDOW_DAYS = 60;

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    if (!shop) {
      return NextResponse.json({ ok: false, error: "SHOPIFY_TEST_SHOP not set" }, { status: 500 });
    }

    // Allow override via ?windowDays= (bounds 7..180)
    const { searchParams } = new URL(req.url);
    const raw = Number(searchParams.get("windowDays"));
    const windowDays = Number.isFinite(raw) ? Math.max(7, Math.min(180, raw)) : DEFAULT_WINDOW_DAYS;

    const sql = getSql();

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
        and o.created_at >= now() - make_interval(days => ${windowDays});
    ` as any;

    const [{ c: totalSnapshots }] = await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    ` as any;

    const topSellers = await sql/*sql*/`
      select
        oi.variant_id,
        sum(oi.quantity)::int as qty_sold
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop}
        and o.created_at >= now() - make_interval(days => ${windowDays})
      group by oi.variant_id
      order by qty_sold desc, oi.variant_id asc
      limit 10;
    ` as any[];

    return NextResponse.json({
      ok: true,
      shop,
      metrics: {
        orders_in_db: ordersCount || 0,
        unique_variants_sold_window: uniqueVariantsSold || 0,
        variant_snapshots_total: totalSnapshots || 0,
      },
      top_sellers: topSellers,
      meta: { filtered_by_window: true, window_days: windowDays },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
