import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const DEFAULT_WINDOW_DAYS = 120;
const MIN_DAYS = 30;
const MAX_DAYS = 365;

// new “slow-mover” defaults
const DEFAULT_MIN_STOCK = 20;
const DEFAULT_INACTIVITY_DAYS = 60;
const DEFAULT_DISCOUNT_PCT = -5;        // -5 means 5% price decrease
const DEFAULT_MAX_SALES_IN_WINDOW = 1;  // include items that sold <= 1 in window

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    if (!shop) {
      return NextResponse.json({ ok: false, error: "SHOPIFY_TEST_SHOP not set" }, { status: 500 });
    }

    // ---- parse knobs from query -------------------------------------------
    const { searchParams } = new URL(req.url);

    const parseNum = (v: string | null, def: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };

    const windowDays = Math.min(
      MAX_DAYS,
      Math.max(MIN_DAYS, parseNum(searchParams.get("windowDays"), DEFAULT_WINDOW_DAYS))
    );

    const minStock = Math.max(0, parseNum(searchParams.get("minStock"), DEFAULT_MIN_STOCK));
    const inactivityDays = Math.max(0, parseNum(searchParams.get("inactivityDays"), DEFAULT_INACTIVITY_DAYS));
    const discountPct = parseNum(searchParams.get("discountPct"), DEFAULT_DISCOUNT_PCT);
    const maxSalesInWindow = Math.max(0, parseNum(searchParams.get("maxSalesInWindow"), DEFAULT_MAX_SALES_IN_WINDOW));

    const sql = getSql();

    // ---- headline metrics --------------------------------------------------
    const [{ c: ordersCount }] = await sql/*sql*/`
      select count(*)::int as c
      from orders
      where shop_domain = ${shop};
    ` as any;

    const [{ c: totalSnapshots }] = await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    ` as any;

    const [{ c: uniqueVariantsSoldWindow }] = await sql/*sql*/`
      select count(distinct oi.variant_id)::int as c
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop}
        and o.created_at >= now() - make_interval(days => ${windowDays});
    ` as any;

    // ---- top sellers (within window) --------------------------------------
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

    // ---- slow-movers query -------------------------------------------------
    // latest snapshot per variant + sales in window + last sold (all-time)
    const slowMovers = await sql/*sql*/`
      with last_snap as (
        select distinct on (variant_id)
          variant_id,
          product_id,
          price,
          inventory_quantity,
          captured_at
        from variant_snapshots
        where shop_domain = ${shop}
        order by variant_id, captured_at desc
      ),
      sales_window as (
        select oi.variant_id, sum(oi.quantity)::int as qty_window
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.shop_domain = ${shop}
          and o.created_at >= now() - make_interval(days => ${windowDays})
        group by oi.variant_id
      ),
      last_sale_all_time as (
        select oi.variant_id, max(o.created_at) as last_sold_at
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.shop_domain = ${shop}
        group by oi.variant_id
      )
      select
        ls.variant_id::text,
        ls.product_id::text,
        ls.price::text as current_price,
        ls.inventory_quantity::int as stock,
        ls.captured_at,
        lsa.last_sold_at,
        /* if never sold -> return NULL; UI will render "Never" */
        case
          when lsa.last_sold_at is null then null
          else extract(day from (now() - lsa.last_sold_at))::int
        end as days_since_last_sale,
        coalesce(sw.qty_window, 0)::int as qty_sold_window
      from last_snap ls
      left join sales_window sw on sw.variant_id = ls.variant_id
      left join last_sale_all_time lsa on lsa.variant_id = ls.variant_id
      where
        ls.inventory_quantity >= ${minStock}
        and coalesce(sw.qty_window, 0) <= ${maxSalesInWindow}
        and (
          lsa.last_sold_at is null
          or extract(day from (now() - lsa.last_sold_at))::int >= ${inactivityDays}
        )
      order by ls.inventory_quantity desc nulls last, lsa.last_sold_at nulls first;
    ` as any[];

    // attach suggested action (price decrease by discountPct)
    const slowMoversWithAction = slowMovers.map(v => {
      const cur = Number(v.current_price || 0);
      const suggested =
        Number.isFinite(cur) ? Number((cur * (1 + discountPct / 100)).toFixed(2)) : null;
      return {
        ...v,
        recommended_action: {
          type: "price_decrease",
          discount_pct: discountPct,
          suggested_price: suggested,
        },
      };
    });

    return NextResponse.json({
      ok: true,
      shop,
      metrics: {
        orders_in_db: ordersCount || 0,
        unique_variants_sold_window: uniqueVariantsSoldWindow || 0,
        variant_snapshots_total: totalSnapshots || 0,
      },
      top_sellers: topSellers,
      slow_movers: slowMoversWithAction,
      meta: {
        filtered_by_window: true,
        window_days: windowDays,
        knobs: {
          minStock, inactivityDays, discountPct, maxSalesInWindow,
        },
        bounds: {
          windowDays: { min: MIN_DAYS, max: MAX_DAYS, default: DEFAULT_WINDOW_DAYS },
          minStock: { min: 0, max: 10000, default: DEFAULT_MIN_STOCK },
          inactivityDays: { min: 7, max: 720, default: DEFAULT_INACTIVITY_DAYS },
          discountPct: { min: -50, max: 50, default: DEFAULT_DISCOUNT_PCT },
          maxSalesInWindow: { min: 0, max: 50, default: DEFAULT_MAX_SALES_IN_WINDOW },
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
