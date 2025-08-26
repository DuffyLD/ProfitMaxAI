// lib/shopify.ts
import { cookies } from "next/headers";
import { getSql } from "./db";

// shape of the row we select from Neon
type ShopRow = { shop_domain: string; access_token: string; scope?: string | null };

// Get the current shop + token from the cookie and DB
export async function getCurrentShopAndToken() {
  const c = await cookies();
  const shopFromCookie = c.get("pm_shop")?.value;
  if (!shopFromCookie) throw new Error("Missing pm_shop cookie");

  const sql = getSql();

  // Tell TS this query returns an array of ShopRow
  const rows = (await sql<ShopRow[]>`
    SELECT shop_domain, access_token, scope
    FROM shops
    WHERE shop_domain = ${shopFromCookie}
    LIMIT 1;
  `) as ShopRow[];

  if (!rows || rows.length === 0) throw new Error("No DB row for shop");

  return {
    shop: rows[0].shop_domain,
    token: rows[0].access_token,
    scope: rows[0].scope ?? null,
  };
}

// Simple helper to call Shopify Admin REST and throw on non-200
export async function shopifyFetch(shop: string, token: string, path: string) {
  const resp = await fetch(`https://${shop}/admin/api/2024-07/${path}`, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    // disable caching for these probes
    next: { revalidate: 0 },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Shopify ${resp.status}: ${text}`);
  }
  return resp.json();
}
