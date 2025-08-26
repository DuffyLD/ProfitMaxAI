// lib/shopify.ts
import { getSql } from "./db";

export async function getShopAndTokenFromCookies(cookiesHeader?: string) {
  // fall back to Next's cookies() later; for now use the cookie sent by the browser
  const pmShop  = matchCookie(cookiesHeader, "pm_shop");
  if (!pmShop) throw new Error("Missing pm_shop cookie");
  const sql = getSql();
  const rows = await sql/* sql */`
    SELECT shop_domain, access_token
    FROM shops
    WHERE shop_domain = ${pmShop}
    LIMIT 1;
  `;
  if (!rows.length) throw new Error("No DB row for shop");
  return { shop: rows[0].shop_domain as string, token: rows[0].access_token as string };
}

function matchCookie(cookiesHeader: string | undefined, key: string) {
  if (!cookiesHeader) return null;
  const m = cookiesHeader.split(/;\s*/).find(p => p.startsWith(`${key}=`));
  return m ? decodeURIComponent(m.split("=").slice(1).join("=")) : null;
}

export async function shopifyAdminGET<T>(shop: string, token: string, path: string) {
  const url = `https://${shop}/admin/api/2024-07/${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Shopify ${path} ${res.status}`);
  return res.json() as Promise<T>;
}
