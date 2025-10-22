import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const sql = getSql();

    // 0) Check if orders.created_at exists
    const col = await sql/*sql*/`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'orders'
          and column_name  = 'created_at'
      ) as has_created_at;
    ` as any;
    const hasCreatedAt = !!col?.[0]?.has_created_at;

    // 1) Basic counts (no risk)
    const [{ count: ordersCount }] = await sql/*sql*/`
      select count(*)::int as count
      from orders
      where shop_domain = ${shop};
    ` as any;

    const [{ count: distinctVariants }] = await sql/*sql*/`
      select count(distinct oi.variant_id)::int as count
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop};
    ` as any;

    const [{ last_snapshots }] = await sql/*sql*/`
      select count(*)::int as last_snapshots
      from variant_snapshots
      where shop_domain = ${shop}
        and captured_at > now() - interval '2 days';
    ` as any;

    // 2) Top sellers (use 60d window only if created_at exists)
    let top: any[] = [];
    if (hasCreatedAt) {
      top = await sql/*sql*/`
        with last60 as (
          select o.id
          from orders o
          where o.shop_domain = ${shop}
            and o.created_at > now() - interval '60 days'
        )
        select oi.variant_id, sum(oi.quantity)::int as qty_sold
        from order_items oi
        join last60 l on l.id = oi.order_id
        group by oi.variant_id
        order by qty_sold desc
        limit 10;
      ` as any;
    } else {
      // fallback: all-time top sellers
      top = await sql/*sql*/`
        select oi.variant_id, sum(oi.quantity)::int as qty_sold
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.shop_domain = ${shop}
        group by oi.variant_id
        order by qty_sold desc
        limit 10;
      ` as any;
    }

    return NextResponse.json({
      ok: true,
      shop,
      metrics: {
        orders_in_db: ordersCount || 0,
        unique_variants_sold_60d: distinctVariants || 0, // all-time if no created_at yet
        recent_variant_snapshots: last_snapshots || 0
      },
      top_sellers: top,
      meta: { filtered_by_60d: hasCreatedAt }
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
