// app/api/dashboard-data/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// ✅ Force dynamic execution (no ISR) and disable caching
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_WINDOW_DAYS = 120;
const MIN_DAYS = 30;
const MAX_DAYS = 365;

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    if (!shop) {
      return NextResponse.json(
        { ok: false, error: "SHOPIFY_TEST_SHOP not set" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Parse ?windowDays= with safe bounds (30..365), default 120
    const { searchParams } = new URL(req.url);
    const raw = Number(searchParams.get("windowDays"));
    const windowDays = Number.isFinite(raw)
      ? Math.max(MIN_DAYS, Math.min(MAX_DAYS, raw))
      : DEFAULT_WINDOW_DAYS;

    const sql = getSql();

    // Orders count (all-time for shop)
    const [{ c: ordersCount }] = (await sql/*sql*/`
      select count(*)::int as c
      from orders
      where shop_domain = ${shop};
    `) as any;

    // Unique variants sold within window
    const [{ c: uniqueVariantsSold }] = (await sql/*sql*/`
      select count(distinct oi.variant_id)::int as c
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop}
        and o.created_at >= now() - make_interval(days => ${windowDays});
    `) as any;

    // Total snapshots for shop
    const [{ c: totalSnapshots }] = (await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    `) as any;

    // Top sellers (within window)
    const topSellers = (await sql/*sql*/`
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
    `) as any[];

    return NextResponse.json(
      {
        ok: true,
        shop,
        metrics: {
          orders_in_db: ordersCount || 0,
          unique_variants_sold_window: uniqueVariantsSold || 0,
          variant_snapshots_total: totalSnapshots || 0,
        },
        top_sellers: topSellers,
        meta: {
          filtered_by_window: true,
          window_days: windowDays,
          bounds: { min: MIN_DAYS, max: MAX_DAYS },
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
