// app/api/dashboard-data/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

const DEFAULT_WINDOW_DAYS = 120;
const MIN_DAYS = 30;
const MAX_DAYS = 365;

const DEFAULT_MIN_STOCK = 20;
const DEFAULT_INACTIVITY_DAYS = 60;
const DEFAULT_DISCOUNT_PCT = -10; // -10% discount
const DEFAULT_MAX_SALES_IN_WINDOW = 1; // <= 1 sale in window

type SlowMoverRow = {
  variant_id: string;
  product_id: string;
  current_price: string;
  stock: number;
  captured_at: string;
  last_sold_at: string | null;
  days_since_last_sale: number | null;
  qty_sold_window: number;
};

async function fetchShopifyJson(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/2024-10${path}`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token },
    cache: "no-store",
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // ignore JSON parse errors
  }
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} @ ${path} :: ${JSON.stringify(body)?.slice(0, 200)}`
    );
  }
  return body;
}

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    const token = process.env.SHOPIFY_TEST_TOKEN || null;

    if (!shop) {
      return NextResponse.json(
        { ok: false, error: "SHOPIFY_TEST_SHOP not set" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);

    // --- Window days (30..365, default 120) ---
    const rawWindow = Number(searchParams.get("windowDays"));
    const windowDays = Number.isFinite(rawWindow)
      ? Math.max(MIN_DAYS, Math.min(MAX_DAYS, rawWindow))
      : DEFAULT_WINDOW_DAYS;

    // --- Slow mover knobs ---
    const rawMinStock = Number(searchParams.get("minStock"));
    const minStock = Number.isFinite(rawMinStock)
      ? Math.max(0, Math.min(10000, rawMinStock))
      : DEFAULT_MIN_STOCK;

    const rawInactivity = Number(searchParams.get("inactivityDays"));
    const inactivityDays = Number.isFinite(rawInactivity)
      ? Math.max(7, Math.min(720, rawInactivity))
      : DEFAULT_INACTIVITY_DAYS;

    const rawDiscount = Number(searchParams.get("discountPct"));
    const discountPct = Number.isFinite(rawDiscount)
      ? Math.max(-50, Math.min(50, rawDiscount))
      : DEFAULT_DISCOUNT_PCT;

    const rawMaxSales = Number(searchParams.get("maxSalesInWindow"));
    const maxSalesInWindow = Number.isFinite(rawMaxSales)
      ? Math.max(0, Math.min(50, rawMaxSales))
      : DEFAULT_MAX_SALES_IN_WINDOW;

    const sql = getSql();

    // --- Headline metrics ---

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

    // --- Top sellers (within window) ---
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

    // --- Slow movers query ---
    const slowMovers = (await sql/*sql*/`
      with last_sale as (
        select
          oi.variant_id,
          max(o.created_at) as last_sold_at,
          sum(oi.quantity)::int as qty_sold_window
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.shop_domain = ${shop}
          and o.created_at >= now() - make_interval(days => ${windowDays})
        group by oi.variant_id
      ),
      latest_snap as (
        select distinct on (variant_id)
          variant_id,
          product_id,
          price as current_price,
          inventory_quantity as stock,
          captured_at
        from variant_snapshots
        where shop_domain = ${shop}
        order by variant_id, captured_at desc
      )
      select
        ls.variant_id,
        ls.qty_sold_window,
        ls.last_sold_at,
        latest.product_id,
        latest.current_price,
        latest.stock,
        latest.captured_at,
        case
          when ls.last_sold_at is null then null
          else extract(day from (now() - ls.last_sold_at))::int
        end as days_since_last_sale
      from last_sale ls
      join latest_snap latest on latest.variant_id = ls.variant_id
      where latest.stock >= ${minStock}
        and ls.qty_sold_window <= ${maxSalesInWindow}
        and (
          ls.last_sold_at is null
          or ls.last_sold_at <= now() - make_interval(days => ${inactivityDays})
        )
      order by latest.stock desc, ls.qty_sold_window asc, ls.last_sold_at nulls last
      limit 50;
    `) as SlowMoverRow[];

    // --- Enrich slow movers with product titles from Shopify ---
    let enrichedSlowMovers: any[] = slowMovers;
    if (slowMovers.length && shop && token) {
      const uniqueProductIds = Array.from(
        new Set(slowMovers.map((r) => String(r.product_id)))
      );
      try {
        // For MVP we assume <=250 products; this keeps things simple.
        const idsParam = encodeURIComponent(uniqueProductIds.join(","));
        const resp = await fetchShopifyJson(
          shop,
          token,
          `/products.json?ids=${idsParam}&fields=id,title`
        );
        const products: any[] = Array.isArray(resp?.products)
          ? resp.products
          : [];
        const titleById = new Map<string, string>();
        for (const p of products) {
          if (!p) continue;
          titleById.set(String(p.id), String(p.title ?? ""));
        }

        enrichedSlowMovers = slowMovers.map((row) => ({
          ...row,
          product_title: titleById.get(String(row.product_id)) || null,
        }));
      } catch (err) {
        // If Shopify fails, we just skip titles and keep everything else working
        enrichedSlowMovers = slowMovers.map((row) => ({
          ...row,
          product_title: null,
        }));
      }
    } else {
      // No token or no rows → just attach null titles
      enrichedSlowMovers = slowMovers.map((row) => ({
        ...row,
        product_title: null,
      }));
    }

    return NextResponse.json({
      ok: true,
      shop,
      metrics: {
        orders_in_db: ordersCount || 0,
        unique_variants_sold_window: uniqueVariantsSold || 0,
        variant_snapshots_total: totalSnapshots || 0,
      },
      top_sellers: topSellers,
      slow_movers: enrichedSlowMovers,
      meta: {
        filtered_by_window: true,
        window_days: windowDays,
        knobs: {
          minStock,
          inactivityDays,
          discountPct,
          maxSalesInWindow,
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
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
