import { NextResponse } from "next/server";

const API_VERSION = "2024-10";

function isoDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

async function fetchShopifyJson(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} @ ${path} :: ${JSON.stringify(body)?.slice(0,200)}`);
  }
  return body;
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
  title?: string;
  sku?: string | null;
};

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json({ ok:false, error:"Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" }, { status: 500 });
    }

    // 1) Fetch variants (first page is enough for MVP rules)
    const variantsResp = await fetchShopifyJson(
      shop,
      token,
      `/variants.json?limit=50&fields=id,product_id,title,price,inventory_quantity,inventory_item_id,sku,updated_at`
    );
    const variants: VariantRow[] = Array.isArray(variantsResp?.variants) ? variantsResp.variants : [];

    // 2) Fetch last 30d orders with line_items to compute per-variant sales
    const createdMin = isoDaysAgo(30);
    const ordersResp = await fetchShopifyJson(
      shop,
      token,
      `/orders.json?status=any&limit=50&created_at_min=${encodeURIComponent(createdMin)}&fields=id,created_at,line_items,total_price`
    );
    const orders: any[] = Array.isArray(ordersResp?.orders) ? ordersResp.orders : [];

    // Build sales by variant_id
    const salesByVariant: Record<string, number> = {};
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

    // 3) Simple rules to create recommendations
    type Rec = {
      variant_id: number;
      product_id: number;
      sku: string | null;
      title: string;
      current_price: number;
      inventory_quantity: number;
      sales_30d: number;
      type: "price_increase" | "price_decrease" | "restock_alert";
      suggested_price?: number;
      suggested_change_pct?: number; // e.g., +5 or -5
      rationale: string;
      audit: any; // raw fields for transparency
    };

    const recs: Rec[] = [];
    for (const v of variants) {
      const sales30 = Number(salesByVariant[String(v.id)] || 0);
      const inv = Number(v.inventory_quantity || 0);
      const priceNum = Number(v.price || 0);

      // Skip gift cards (Shopify treats them differently)
      // Heuristic: gift cards usually have product_type "giftcard" and $10/25/50 variants,
      // but since we don't have product_type here, skip if price is 0 or null.
      if (!isFinite(priceNum) || priceNum <= 0) continue;

      // Rule A: Popular + healthy stock → suggest +5%
      if (sales30 >= 3 && inv > 10) {
        const pct = 5;
        const newPrice = Number((priceNum * (1 + pct / 100)).toFixed(2));
        recs.push({
          variant_id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          title: v.title,
          current_price: priceNum,
          inventory_quantity: inv,
          sales_30d: sales30,
          type: "price_increase",
          suggested_price: newPrice,
          suggested_change_pct: pct,
          rationale: `Sold ${sales30} in the last 30 days with ${inv} units in stock. A modest +${pct}% increase should preserve conversion while improving margin.`,
          audit: { variant: v, salesByVariant: sales30 }
        });
        continue;
      }

      // Rule B: No sales + high stock → suggest -5% (or promo)
      if (sales30 === 0 && inv >= 20) {
        const pct = -5;
        const newPrice = Number((priceNum * (1 + pct / 100)).toFixed(2));
        recs.push({
          variant_id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          title: v.title,
          current_price: priceNum,
          inventory_quantity: inv,
          sales_30d: sales30,
          type: "price_decrease",
          suggested_price: newPrice,
          suggested_change_pct: pct,
          rationale: `No sales in 30 days with ${inv} units on hand suggests price sensitivity or poor demand. Consider a temporary -5% to stimulate sell-through.`,
          audit: { variant: v, salesByVariant: sales30 }
        });
        continue;
      }

      // Rule C: Low stock + some sales → restock alert
      if (inv < 3 && sales30 > 0) {
        recs.push({
          variant_id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          title: v.title,
          current_price: priceNum,
          inventory_quantity: inv,
          sales_30d: sales30,
          type: "restock_alert",
          rationale: `Only ${inv} units left and ${sales30} sold in 30 days — risk of stockout.`,
          audit: { variant: v, salesByVariant: sales30 }
        });
        continue;
      }
    }

    // Sort by biggest potential impact (roughly: sales_30d desc, then inventory desc)
    recs.sort((a, b) => (b.sales_30d - a.sales_30d) || (b.inventory_quantity - a.inventory_quantity));

    return NextResponse.json({
      ok: true,
      shop,
      recommendations: recs,
      meta: {
        variants_considered: variants.length,
        orders_considered: orders.length,
        generated: recs.length,
        rules: [
          "If sales_30d >= 3 and inventory > 10 -> price_increase +5%",
          "If sales_30d == 0 and inventory >= 20 -> price_decrease -5%",
          "If inventory < 3 and sales_30d > 0 -> restock_alert"
        ],
        window_days: 30
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
