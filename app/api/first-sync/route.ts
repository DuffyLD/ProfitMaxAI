// app/api/first-sync/route.ts
import { NextResponse } from "next/server";

/**
 * First Sync (read-only, no DB)
 * - Pulls last 60 days of Orders (paginated, status=any)
 * - Pulls up to 250 Variants (first page) to inspect stock/price
 * - Aggregates sales per variant
 * - Surfaces top sellers + slow movers
 * Notes:
 * - Safe to call ad hoc. It does not write to Shopify.
 * - Uses REST page_info pagination on orders.
 */

const API_VERSION = "2024-10";
const WINDOW_DAYS = 60;
const ORDERS_PAGE_LIMIT = 250;   // Shopify max for orders
const VARIANTS_PAGE_LIMIT = 250; // Shopify max for variants
const MAX_ORDER_PAGES = 4;       // safety cap: up to 1000 orders (4*250)

function isoDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function buildUrl(shop: string, path: string) {
  return `https://${shop}/admin/api/${API_VERSION}${path}`;
}

async function fetchShopify(
  shop: string,
  token: string,
  path: string,
  init?: RequestInit
) {
  const url = buildUrl(shop, path);
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  // Collect Link header for pagination
  const link = res.headers.get("link") || res.headers.get("Link") || null;

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // noop
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} @ ${path} :: ${JSON.stringify(body)?.slice(0, 300)}`
    );
  }

  return { body, link };
}

/**
 * Parse Shopify Link header for page_info=... next URL.
 * Example:
 * <https://shop.myshopify.com/admin/api/2024-10/orders.json?...&page_info=xyz>; rel="next"
 */
function extractNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Find rel="next"
  const parts = linkHeader.split(",");
  for (const p of parts) {
    if (p.includes('rel="next"')) {
      // Extract page_info param
      const match = p.match(/page_info=([^&>]+)/);
      if (match && match[1]) return match[1];
    }
  }
  return null;
}

type VariantRow = {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string | null;
  inventory_item_id: number;
  inventory_quantity: number;
  updated_at: string;
};

type LineItem = {
  variant_id: number | null;
  quantity: number;
};

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json(
        { ok: false, error: "Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" },
        { status: 500 }
      );
    }

    const createdMin = isoDaysAgo(WINDOW_DAYS);

    // 1) Pull first page of variants (stock snapshot for heuristics)
    const variantsPath = `/variants.json?limit=${VARIANTS_PAGE_LIMIT}&fields=id,product_id,title,price,inventory_quantity,inventory_item_id,sku,updated_at`;
    const { body: variantsResp } = await fetchShopify(shop, token, variantsPath);
    const variants: VariantRow[] = Array.isArray(variantsResp?.variants)
      ? variantsResp.variants
      : [];

    // Build quick lookup for inventory
    const invByVariant: Record<string, number> = {};
    for (const v of variants) {
      invByVariant[String(v.id)] = Number(v.inventory_quantity || 0);
    }

    // 2) Pull orders (last 60d) with pagination using page_info
    // First page (no page_info)
    let ordersFetched = 0;
    let pagesFetched = 0;
    let nextPageInfo: string | null = null;

    const salesByVariant: Record<string, number> = {}; // variant_id -> qty sold (60d)

    const baseOrdersPath = `/orders.json?status=any&limit=${ORDERS_PAGE_LIMIT}&created_at_min=${encodeURIComponent(
      createdMin
    )}&fields=id,created_at,line_items,total_price`;

    // Helper to process one page
    async function processOrdersPage(path: string) {
      const { body, link } = await fetchShopify(shop, token, path);
      const orders: any[] = Array.isArray(body?.orders) ? body.orders : [];
      ordersFetched += orders.length;
      pagesFetched += 1;

      for (const o of orders) {
        const lis: LineItem[] = Array.isArray(o?.line_items) ? o.line_items : [];
        for (const li of lis) {
          const vid = li?.variant_id;
          const qty = Number(li?.quantity || 0);
          if (!vid || qty <= 0) continue;
          const key = String(vid);
          salesByVariant[key] = (salesByVariant[key] || 0) + qty;
        }
      }
      nextPageInfo = extractNextPageInfo(link);
    }

    // First orders page
    await processOrdersPage(baseOrdersPath);

    // Follow next pages up to cap
    let pageCount = 1;
    while (nextPageInfo && pageCount < MAX_ORDER_PAGES) {
      const nextPath = `/orders.json?page_info=${encodeURIComponent(
        nextPageInfo
      )}&limit=${ORDERS_PAGE_LIMIT}&fields=id,created_at,line_items,total_price`;
      await processOrdersPage(nextPath);
      pageCount += 1;
    }

    // 3) Simple aggregates
    // Top sellers by qty
    const topSellers = Object.entries(salesByVariant)
      .map(([variantId, qty]) => ({
        variant_id: Number(variantId),
        qty_sold_60d: Number(qty),
        inventory_quantity: invByVariant[variantId] ?? null,
      }))
      .sort((a, b) => b.qty_sold_60d - a.qty_sold_60d)
      .slice(0, 5);

    // Slow movers: seen in variant snapshot but zero sales in 60d and decent stock
    const slowMovers = variants
      .filter((v) => Number(salesByVariant[String(v.id)] || 0) === 0 && Number(v.inventory_quantity || 0) >= 20)
      .map((v) => ({
        variant_id: v.id,
        inventory_quantity: Number(v.inventory_quantity || 0),
        price: Number(v.price || 0),
        sku: v.sku,
        title: v.title,
      }))
      .slice(0, 5);

    // 4) Return summary
    return NextResponse.json({
      ok: true,
      shop,
      window_days: WINDOW_DAYS,
      totals: {
        orders_fetched: ordersFetched,
        order_pages_fetched: pagesFetched,
        variants_sampled: variants.length,
        unique_variants_sold_60d: Object.keys(salesByVariant).length,
      },
      highlights: {
        top_sellers_60d: topSellers,
        slow_movers_60d: slowMovers,
      },
      notes: [
        "Read-only first sync (no DB).",
        "Orders paginated via page_info; capped to 4 pages (1000 orders) for safety.",
        "Variants pulled from first page (up to 250) to estimate stock conditions.",
      ],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
