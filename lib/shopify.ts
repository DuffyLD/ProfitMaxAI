// lib/shopify.ts
export const SHOPIFY_API_VERSION = "2024-07";

import { getSql } from "./db";

// --- 1) Read shop + token from the cookies we set in /api/shopify/callback ---
export function getShopAndTokenFromCookies(cookieHeader?: string): {
  shop: string;
  token: string;
} {
  if (!cookieHeader) throw new Error("No cookies present");

  // very small cookie parser
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const [rawK, ...rest] = part.trim().split("=");
    const k = rawK?.trim();
    const v = rest.join("=").trim();
    if (k) map.set(k, decodeURIComponent(v || ""));
  }

  const shop = map.get("pm_shop");
  const token = map.get("pm_token");

  if (!shop || !token) throw new Error("Missing pm_shop/pm_token cookies");
  return { shop, token };
}

// --- 2) (Optional) Read latest shop + token from Neon (used by /connected page) ---
export async function getCurrentShopAndToken(): Promise<{ shop: string; token: string }> {
  const sql = getSql();
  // Neon in object mode returns an array of objects by default
  const rows = await sql/* sql */`
    SELECT shop_domain, access_token
    FROM shops
    ORDER BY id DESC
    LIMIT 1
  `;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No DB row for shop");
  }
  return { shop: rows[0].shop_domain as string, token: rows[0].access_token as string };
}

// --- 3) Minimal Shopify Admin GET helper the routes use ---
export async function shopifyAdminGET<T>(
  shop: string,
  token: string,
  path: string,                 // e.g. "shop.json" or "products/count.json"
  query?: Record<string, string | number | boolean>
): Promise<T> {
  const url = new URL(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    // keep these simple; your routes already set force-dynamic/no-store
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}
