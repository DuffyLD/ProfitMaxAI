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

type TitleMap = Record<
  string,
  { product_title: string | null; variant_title: string | null }
>;

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP || null;
    if (!shop) {
      return NextResponse.json(
        { ok: false, error: "SHOPIFY_TEST_SHOP not set" },
        { status: 500 }
      );
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
    const [{ c: ordersCount }] = (await sql/*sql*/`
      select count(*)::int as c
      from orders
      where shop_domain = ${shop};
    `) as any;

    const [{ c: totalSnapshots }] = (await sql/*sql*/`
      select count(*)::int as c
      from variant_snapshots
      where shop_domain = ${shop};
    `) as any;

    const [{ c: uniqueVariantsSoldWindow }] = (await sql/*sql*/`
      select count(distinct oi.variant_id)::int as c
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.shop_domain = ${shop}
        and o.created_at >= now() - make_interval(days => ${windowDays});
    `) as any;

    // ---- top sellers (within window) --------------------------------------
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

    // ---- slow-movers query -------------------------------------------------
    // latest snapshot per variant + sales in window + last sold (all-time)
    const slowMovers = (await sql/*sql*/`
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
    `) as any[];

    // ---- BEST-EFFORT name enrichment (won't break if tables don't exist) ---
    const variantIdsForNames = Array.from(
      new Set([
        ...topSellers.map((t) => String(t.variant_id)),
        ...slowMovers.map((s) => String(s.variant_id)),
      ])
    );

    const productIdsForNames = Array.from(
      new Set(slowMovers.map((s) => String(s.product_id)).filter(Boolean))
    );

    const titlesByVariantId: TitleMap = await bestEffortFetchTitles(sql, {
      variantIds: variantIdsForNames,
      productIds: productIdsForNames,
    });

    // attach suggested action (price decrease by discountPct) + titles
    const slowMoversWithAction = slowMovers.map((v) => {
      const cur = Number(v.current_price || 0);
      const suggested =
        Number.isFinite(cur) ? Number((cur * (1 + discountPct / 100)).toFixed(2)) : null;

      const t = titlesByVariantId[String(v.variant_id)] || {
        product_title: null,
        variant_title: null,
      };

      return {
        ...v,
        product_title: t.product_title,
        variant_title: t.variant_title,
        recommended_action: {
          type: "price_decrease",
          discount_pct: discountPct,
          suggested_price: suggested,
        },
      };
    });

    const topSellersWithTitles = topSellers.map((t) => {
      const m = titlesByVariantId[String(t.variant_id)] || {
        product_title: null,
        variant_title: null,
      };
      return {
        ...t,
        product_title: m.product_title,
        variant_title: m.variant_title,
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
      top_sellers: topSellersWithTitles,
      slow_movers: slowMoversWithAction,
      meta: {
        filtered_by_window: true,
        window_days: windowDays,
        knobs: { minStock, inactivityDays, discountPct, maxSalesInWindow },
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

// ---------------------------------------------------------------------------
// Helpers: resilient title lookup (Postgres) — never throw, never break route
// ---------------------------------------------------------------------------

async function bestEffortFetchTitles(
  sql: any,
  args: { variantIds: string[]; productIds: string[] }
): Promise<TitleMap> {
  const out: TitleMap = {};
  try {
    if (!args.variantIds.length && !args.productIds.length) return out;

    // 1) Find candidate tables that might exist
    const tableCandidates = [
      "product_variants",
      "variants",
      "products",
      "product_snapshots",
    ];

    const existing: Record<string, boolean> = {};
    for (const t of tableCandidates) {
      const rows = (await sql/*sql*/`select to_regclass(${t}) as reg;`) as any[];
      existing[t] = !!rows?.[0]?.reg;
    }

    // 2) Column existence helper
    const hasCol = async (table: string, col: string) => {
      if (!existing[table]) return false;
      const rows = (await sql/*sql*/`
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = ${table}
          and column_name = ${col}
        limit 1;
      `) as any[];
      return rows.length > 0;
    };

    // 3) Strategy A: variants table + products table (best case)
    const variantsTable =
      existing["product_variants"] ? "product_variants" :
      existing["variants"] ? "variants" :
      null;

    const productsTable = existing["products"] ? "products" : null;

    const canUseVariants =
      !!variantsTable &&
      (await hasCol(variantsTable, "id")) &&
      ((await hasCol(variantsTable, "title")) || (await hasCol(variantsTable, "name"))) &&
      ((await hasCol(variantsTable, "product_id")) || (await hasCol(variantsTable, "productId")));

    const canUseProducts =
      !!productsTable &&
      (await hasCol(productsTable, "id")) &&
      ((await hasCol(productsTable, "title")) || (await hasCol(productsTable, "name")));

    if (canUseVariants) {
      const vTitleCol = (await hasCol(variantsTable!, "title")) ? "title" : "name";
      const vProdCol = (await hasCol(variantsTable!, "product_id")) ? "product_id" : "productId";

      if (canUseProducts) {
        const pTitleCol = (await hasCol(productsTable!, "title")) ? "title" : "name";

        const rows = (await sql/*sql*/`
          select
            v.id::text as variant_id,
            p.${sql.unsafe(pTitleCol)}::text as product_title,
            v.${sql.unsafe(vTitleCol)}::text as variant_title
          from ${sql.unsafe(variantsTable!)} v
          left join ${sql.unsafe(productsTable!)} p
            on p.id = v.${sql.unsafe(vProdCol)}
          where v.id::text = any(${args.variantIds}::text[]);
        `) as any[];

        for (const r of rows) {
          out[String(r.variant_id)] = {
            product_title: r.product_title ?? null,
            variant_title: r.variant_title ?? null,
          };
        }
        return out;
      } else {
        // variants exists but products doesn't; still return variant_title
        const rows = (await sql/*sql*/`
          select
            v.id::text as variant_id,
            null::text as product_title,
            v.${sql.unsafe(vTitleCol)}::text as variant_title
          from ${sql.unsafe(variantsTable!)} v
          where v.id::text = any(${args.variantIds}::text[]);
        `) as any[];

        for (const r of rows) {
          out[String(r.variant_id)] = {
            product_title: null,
            variant_title: r.variant_title ?? null,
          };
        }
        return out;
      }
    }

    // 4) Strategy B: product_snapshots table for product title (if you have it)
    // (This will only populate product_title by product_id; variant_title stays null)
    if (existing["product_snapshots"] && args.productIds.length) {
      const ps = "product_snapshots";
      const canPS =
        (await hasCol(ps, "product_id")) &&
        ((await hasCol(ps, "title")) || (await hasCol(ps, "name"))) &&
        (await hasCol(ps, "captured_at"));

      if (canPS) {
        const psTitleCol = (await hasCol(ps, "title")) ? "title" : "name";
        const rows = (await sql/*sql*/`
          with last_ps as (
            select distinct on (product_id)
              product_id::text as product_id,
              ${sql.unsafe(psTitleCol)}::text as product_title
            from ${sql.unsafe(ps)}
            order by product_id, captured_at desc
          )
          select * from last_ps
          where product_id = any(${args.productIds}::text[]);
        `) as any[];

        const byProduct: Record<string, string | null> = {};
        for (const r of rows) byProduct[String(r.product_id)] = r.product_title ?? null;

        // We can’t map product_id -> variant_id here without a variants table,
        // so we leave out[] empty (route will return null titles).
        // (If you later confirm you have variants table, Strategy A will work.)
      }
    }

    return out;
  } catch {
    // Never break the endpoint
    return out;
  }
}
