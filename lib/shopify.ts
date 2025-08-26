// lib/shopify.ts
export const SHOPIFY_API_VERSION = "2024-07";

import { getSql } from "./db";

/* ----------------------------- 1) Cookies ----------------------------- */
export function getShopAndTokenFromCookies(cookieHeader?: string): {
  shop: string;
  token: string;
} {
  if (!cookieHeader) throw new Error("No cookies present");

  // tiny cookie parser
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

/* -------- 2) Read latest shop+token from Neon (normalize result) -------- */
export async function getCurrentShopAndToken(): Promise<{ shop: string; token: string }> {
  const sql = getSql();

  // Neon can return an array of rows OR a "full results" object with .rows
  const result: any = await sql/* sql */`
    SELECT shop_domain, access_token
    FROM shops
    ORDER BY id DESC
    LIMIT 1
  `;

  const rows: any[] = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : [];

  if (rows.length === 0) {
    throw new Error("No DB row for shop");
  }

  return {
    shop: rows[0].shop_domain as string,
    token: rows[0].access_token as string,
  };
}

/* -------- 3) Unified helper with cookie → DB fallback -------- */
export async function getShopAndTokenWithFallback(cookieHeader?: string) {
  try {
    if (cookieHeader) return getShopAndTokenFromCookies(cookieHeader);
  } catch {
    // ignore cookie errors and fall back to DB
  }
  return getCurrentShopAndToken();
}

/* -------- 4) Minimal Shopify Admin GET helper -------- */
export async function shopifyAdminGET<T>(
  shop: string,
  token: string,
  path: string, // e.g. "shop.json" or "products/count.json"
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
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}
