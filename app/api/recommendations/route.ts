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
};

export async function GET(req: Request) {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json({ ok:false, error:"Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" }, { status: 500 });
    }

    // Read query param windowDays (default 30)
    const { searchParams } = new URL(req.url);
    const windowDays = Math.max(1, Math.min(90, Number(searchParams.get("windowDays") || 30)));
    const createdMin = isoDaysAgo(windowDays);

    // 1) Fetch variants (first page ok for MVP)
    const variantsResp = await fetchShopifyJson(
      shop, token,
      `/variants.json?limit=50&fields=id,product_id,title,price,inventory_quantity,inventory_item_id,sku,updated_at`
    );
    const variants: VariantRow[] = Array.isArray(variantsResp?.variants) ? variantsResp.variants : [];

    // 2) Fetch products (map product_id -> product_type to skip gift cards cleanly)
    const productsResp = await fetchShopifyJson(
      shop, token,
      `/products.json?limit=250&fields=id,product_type,title`
    );
    const prodArr: any[] = Array.isArray(productsResp?.products) ? productsResp.products : [];
    const productTypeById = new Map<number, string>();
    for (const p of prodArr) {
      if (p?.id != null) productTypeById.set(Number(p.id), String(p.product_type || ""));
    }

    // 3) Fetch last windowDays orders including line_items for per-variant sales
    const ordersResp = await fetchShopifyJson(
      shop, token,
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

    // 4) Rules
    type Rec = {
      variant_id: number;
      product_id: number;
      sku: string | null;
      title: string;
      current_price: number;
      inventory_quantity: number;
      sales_window_days: number;
      sales_in_window: number;
      type: "price_increase" | "price_decrease" | "restock_alert";
      suggested_price?: number;
      suggested_change_pct?: number;
      rationale: string;
      audit: any;
    };

    const recs: Rec[] = [];
    for (const v of variants) {
      const productType = productTypeById.get(Number(v.product_id)) || "";
      if (productType.toLowerCase() === "giftcard" || productType.toLowerCase() === "gift card") {
        continue; // skip gift cards
      }

      const salesWindow = Number(salesByVariant[String(v.id)] || 0);
      const inv = Number(v.inventory_quantity || 0);
      const priceNum = Number(v.price || 0);
      if (!isFinite(priceNum) || priceNum <= 0) continue; // safety

      // A) Popular + healthy stock → suggest +5%
      if (salesWindow >= 3 && inv > 10) {
        const pct = 5;
        const newPrice = Number((priceNum * (1 + pct / 100)).toFixed(2));
        recs.push({
          variant_id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          title: v.title,
          current_price: priceNum,
          inventory_quantity: inv,
          sales_window_days: windowDays,
          sales_in_window: salesWindow,
          type: "price_increase",
          suggested_price: newPrice,
          suggested_change_pct: pct,
          rationale: `Sold ${salesWindow} in the last ${windowDays} days with ${inv} in stock. A modest +${pct}% increase should lift margin without killing conversion.`,
          audit: { variant: v, product_type: productType, sales: salesWindow }
        });
        continue;
      }

      // B) No sales + high stock → suggest -5%
      if (salesWindow === 0 && inv >= 20) {
        const pct = -5;
        const newPrice = Number((priceNum * (1 + pct / 100)).toFixed(2));
        recs.push({
          variant_id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          title: v.title,
          current_price: priceNum,
          inventory_quantity: inv,
          sales_window_days: windowDays,
          sales_in_window: salesWindow,
          type: "price_decrease",
          suggested_price: newPrice,
          suggested_change_pct: pct,
          rationale: `No sales in ${windowDays} days with ${inv} units on hand suggests price sensitivity or poor demand. Consider a temporary -5% to stimulate sell-through.`,
          audit: { variant: v, product_type: productType, sales: salesWindow }
        });
        continue;
      }

      // C) Low stock + some sales → restock alert
      if (inv < 3 && salesWindow > 0) {
        recs.push({
          variant_id: v.id,
          product_id: v.product_id,
          sku: v.sku,
          title: v.title,
          current_price: priceNum,
          inventory_quantity: inv,
          sales_window_days: windowDays,
          sales_in_window: salesWindow,
          type: "restock_alert",
          rationale: `Only ${inv} units left and ${salesWindow} sold in ${windowDays} days — risk of stockout.`,
          audit: { variant: v, product_type: productType, sales: salesWindow }
        });
        continue;
      }
    }

    recs.sort((a, b) => (b.sales_in_window - a.sales_in_window) || (b.inventory_quantity - a.inventory_quantity));

    return NextResponse.json({
      ok: true,
      shop,
      recommendations: recs,
      meta: {
        variants_considered: variants.length,
        orders_considered: orders.length,
        generated: recs.length,
        rules: [
          "If sales >= 3 and inventory > 10 -> price_increase +5%",
          "If sales == 0 and inventory >= 20 -> price_decrease -5%",
          "If inventory < 3 and sales > 0 -> restock_alert"
        ],
        window_days: windowDays
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
