import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const sql = getSql();

    const [{ count: ordersCount }] = await sql/*sql*/`
      select count(*)::int as count from orders where shop_domain = ${shop};
    ` as any;

    const [{ count: distinctVariants }] = await sql/*sql*/`
      select count(distinct variant_id)::int as count
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

    const top = await sql/*sql*/`
      with last60 as (
        select o.id, o.created_at
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

    return NextResponse.json({
      ok: true,
      shop,
      metrics: {
        orders_in_db: ordersCount || 0,
        unique_variants_sold_60d: distinctVariants || 0,
        recent_variant_snapshots: last_snapshots || 0
      },
      top_sellers_60d: top
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
