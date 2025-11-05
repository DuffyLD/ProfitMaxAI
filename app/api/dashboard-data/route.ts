// app/api/dashboard-data/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Always fresh
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const DEFAULT_WINDOW_DAYS = 120;
const MIN_DAYS = 30;
const MAX_DAYS = 365;

const DEFAULT_MIN_STOCK = 20;   // tunable threshold for "slow mover"
const MIN_STOCK_MIN = 0;
const MIN_STOCK_MAX = 10_000;

const DEFAULT_INACTIVITY_DAYS = 60; // days since last sale
const INACTIVITY_MIN = 7;
const INACTIVITY_MAX = 720;

const DEFAULT_DISCOUNT_PCT = -5; // suggested markdown
const DISC_MIN = -50;
const DISC_MAX = 50;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function parseNumberParam(sp: URLSearchParams, key: string, def: number, lo: number, hi: number) {
  const raw = sp.get(key);
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return clamp(n, lo, hi);
}
function noCacheHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
}

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    if (!shop) {
      return NextResponse.json(
        { ok: false, error: "SHOPIFY_TEST_SHOP not set" },
        { status: 500, headers: noCacheHeaders() }
      );
    }

    const sp = new URL(req.url).searchParams;
    const windowDays      = parseNumberParam(sp, "windowDays", DEFAULT_WINDOW_DAYS, MIN_DAYS, MAX_DAYS);
    const minStock        = parseNumberParam(sp, "minStock", DEFAULT_MIN_STOCK, MIN_STOCK_MIN, MIN_STOCK_MAX);
    const inactivityDays  = parseNumberParam(sp, "inactivityDays", DEFAULT_INACTIVITY_DAYS, INACTIVITY_MIN, INACTIVITY_MAX);
    const discountPct     = parseNumberParam(sp, "discountPct", DEFAULT_DISCOUNT_PCT, DISC_MIN, DISC_MAX);

    const sql = getSql();

    // --- Metrics (existing) ---
    const [{ c: ordersCount }] = (await sql/*sql*/`
      select count(*)::int as c
      from orders
      where shop_domain = ${shop};
    `) as any;

    const [{ c: uniqueVariantsSold }] = (await sql/*sql*/`
      with win_orders as (
        select id
        from orders
        where shop_domain = ${shop}
          and created_at >= now() - make_interval(days => ${windowDays})
      )
      select count(distinct oi.variant_id)::int as c
      from order_items oi
      join win_orders w on w.id = oi.order_id;
    `) as any;

    const [{ c: totalSnapshots }] = (await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    `) as any;

    const topSellers = (await sql/*sql*/`
      with win_orders as (
        select id
        from orders
        where shop_domain = ${shop}
          and created_at >= now() - make_interval(days => ${windowDays})
      )
      select
        oi.variant_id,
        sum(oi.quantity)::int as qty_sold
      from order_items oi
      join win_orders w on w.id = oi.order_id
      group by oi.variant_id
      order by qty_sold desc, oi.variant_id asc
      limit 10;
    `) as any[];

    // --- Slow movers (latest inventory, no sales in inactivityDays) ---
    // latest snap per variant
    // last sold at per variant
    const slowMovers = (await sql/*sql*/`
      with latest_snap as (
        select distinct on (variant_id)
          variant_id, product_id, price, inventory_quantity, captured_at
        from variant_snapshots
        where shop_domain = ${shop}
        order by variant_id, captured_at desc
      ),
      last_sale as (
        select
          oi.variant_id,
          max(o.created_at) as last_sold_at
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.shop_domain = ${shop}
        group by oi.variant_id
      )
      select
        ls.variant_id,
        ls.product_id,
        ls.price::numeric as current_price,
        ls.inventory_quantity::int as stock,
        ls.captured_at,
        lsa.last_sold_at,
        case
          when lsa.last_sold_at is null then 99999
          else extract(day from (now() - lsa.last_sold_at))::int
        end as days_since_last_sale
      from latest_snap ls
      left join last_sale lsa on lsa.variant_id = ls.variant_id
      where ls.inventory_quantity >= ${minStock}
        and (lsa.last_sold_at is null or lsa.last_sold_at < now() - make_interval(days => ${inactivityDays}))
      order by ls.inventory_quantity desc, ls.variant_id
      limit 100;
    `) as any[];

    // Attach recommendation suggestion (discount) on the server so UI is dumb-simple
    const smWithRec = slowMovers.map((row) => {
      const price = Number(row.current_price ?? 0);
      const pct = discountPct;
      const suggested =
        Number.isFinite(price) && price > 0
          ? Number((price * (1 + pct / 100)).toFixed(2))
          : null;
      return {
        ...row,
        recommended_action: {
          type: pct < 0 ? "price_decrease" : pct > 0 ? "price_increase" : "no_change",
          discount_pct: pct,
          suggested_price: suggested,
        },
      };
    });

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
        slow_movers: smWithRec,
        meta: {
          filtered_by_window: true,
          window_days: windowDays,
          knobs: {
            minStock,
            inactivityDays,
            discountPct,
          },
          bounds: {
            windowDays: { min: MIN_DAYS, max: MAX_DAYS, default: DEFAULT_WINDOW_DAYS },
            minStock:   { min: MIN_STOCK_MIN, max: MIN_STOCK_MAX, default: DEFAULT_MIN_STOCK },
            inactivityDays: { min: INACTIVITY_MIN, max: INACTIVITY_MAX, default: DEFAULT_INACTIVITY_DAYS },
            discountPct: { min: DISC_MIN, max: DISC_MAX, default: DEFAULT_DISCOUNT_PCT },
          },
        },
      },
      { headers: noCacheHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500, headers: noCacheHeaders() }
    );
  }
}
