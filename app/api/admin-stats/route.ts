import { NextResponse } from "next/server";

const API_VERSION = "2024-10";

function iso30DaysAgo() {
  const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_TEST_SHOP!;
    const token = process.env.SHOPIFY_TEST_TOKEN!;
    if (!shop || !token) {
      return NextResponse.json({ ok:false, error:"Missing SHOPIFY_TEST_SHOP or SHOPIFY_TEST_TOKEN" }, { status: 500 });
    }

    const createdMin = iso30DaysAgo();

    const [shopInfo, prodCount, ordersCount, custCount, variantsPage, invItemsPage] = await Promise.all([
      fetchShopifyJson(shop, token, `/shop.json`),
      fetchShopifyJson(shop, token, `/products/count.json`),
      fetchShopifyJson(shop, token, `/orders/count.json?status=any&created_at_min=${encodeURIComponent(createdMin)}`),
      fetchShopifyJson(shop, token, `/customers/count.json`),
      fetchShopifyJson(shop, token, `/variants.json?limit=50&fields=id`),
      // inventory_levels requires filters; for MVP use inventory_items
      fetchShopifyJson(shop, token, `/inventory_items.json?limit=50`),
    ]);

    return NextResponse.json({
      ok: true,
      shop,
      shop_name: shopInfo?.shop?.name,
      counts: {
        products: Number(prodCount?.count ?? 0),
        orders_last_30d: Number(ordersCount?.count ?? 0),
        customers: Number(custCount?.count ?? 0),
        variants_first_page: Array.isArray(variantsPage?.variants) ? variantsPage.variants.length : 0,
        inventory_items_first_page: Array.isArray(invItemsPage?.inventory_items) ? invItemsPage.inventory_items.length : 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 });
  }
}
