import { NextResponse } from "next/server";
const API_VERSION = "2024-10";

async function fetchShopifyJson(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${path} :: ${JSON.stringify(body)?.slice(0,200)}`);
  return body;
}

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json({ ok:false, error:"Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" }, { status: 500 });
    }

    const [products, variants, orders, invLevels, customers] = await Promise.all([
      fetchShopifyJson(shop, token, `/products.json?limit=5&fields=id,title,product_type,status,created_at`),
      fetchShopifyJson(shop, token, `/variants.json?limit=5`),
      fetchShopifyJson(shop, token, `/orders.json?status=any&limit=5&fields=id,name,created_at,financial_status,fulfillment_status,total_price`),
      fetchShopifyJson(shop, token, `/inventory_levels.json?limit=5`),
      fetchShopifyJson(shop, token, `/customers.json?limit=5&fields=id,created_at,orders_count,total_spent`),
    ]);

    return NextResponse.json({
      ok: true,
      shop,
      samples: {
        products: (products?.products || []).map((p: any) => ({
          id: p.id, title: p.title, product_type: p.product_type, status: p.status, created_at: p.created_at
        })),
        variants: (variants?.variants || []).map((v: any) => ({
          id: v.id, product_id: v.product_id, title: v.title, price: v.price, inventory_quantity: v.inventory_quantity
        })),
        orders: (orders?.orders || []).map((o: any) => ({
          id: o.id, name: o.name, created_at: o.created_at, financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, total_price: o.total_price
        })),
        inventory_levels: (invLevels?.inventory_levels || []).map((l: any) => ({
          inventory_item_id: l.inventory_item_id, available: l.available, location_id: l.location_id, updated_at: l.updated_at
        })),
        customers: (customers?.customers || []).map((c: any) => ({
          id: c.id, created_at: c.created_at, orders_count: c.orders_count, total_spent: c.total_spent
        })),
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}