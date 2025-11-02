// app/api/dashboard-data/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// 🔒 Make this endpoint always dynamic and uncached everywhere
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
// (optional) export const runtime = "edge";

const DEFAULT_WINDOW_DAYS = 120;   // <— our true default
const MIN_DAYS = 30;
const MAX_DAYS = 365;

function parseWindowDays(url: string) {
  const sp = new URL(url).searchParams;
  const raw = sp.get("windowDays");
  if (raw === null) return DEFAULT_WINDOW_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

function noCacheHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    // Vercel/Edge CDN hints
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

    const windowDays = parseWindowDays(req.url);
    const sql = getSql();

    // Orders count (all-time)
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

    // Total snapshots
    const [{ c: totalSnapshots }] = (await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    `) as any;

    // Top sellers (window)
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
          // 👇 Debug so we can see which build is running
          build: {
            default_window_days: DEFAULT_WINDOW_DAYS,
            ts: new Date().toISOString(),
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
