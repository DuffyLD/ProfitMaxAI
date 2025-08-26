// app/connected/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${path} failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as T;
}

export default async function Connected() {
  let storeBlock: React.ReactNode = null;
  let productsBlock: React.ReactNode = null;

  try {
    const store = await fetchJSON<{ ok: boolean; shop: string; name: string; plan: string }>("/api/shopify/store");
    storeBlock = (
      <ul>
        <li>Shop: <b>{store.shop}</b></li>
        <li>Name: <b>{store.name}</b></li>
        <li>Plan: <b>{store.plan}</b></li>
      </ul>
    );
  } catch (e: any) {
    storeBlock = <p>Error loading store: {String(e.message || e)}</p>;
  }

  try {
    const pc = await fetchJSON<{ ok: boolean; shop: string; count: number }>("/api/shopify/products-count");
    productsBlock = (
      <ul>
        <li>Shop: <b>{pc.shop}</b></li>
        <li>Product count: <b>{pc.count}</b></li>
      </ul>
    );
  } catch (e: any) {
    productsBlock = <p>Error loading products: {String(e.message || e)}</p>;
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Shop connected ✅</h1>

      <section>
        <h2 className="text-xl font-semibold">Store info</h2>
        {storeBlock}
      </section>

      <section>
        <h2 className="text-xl font-semibold">Products</h2>
        {productsBlock}
      </section>

      <a className="underline" href="/">Back to home</a>
    </main>
  );
}
