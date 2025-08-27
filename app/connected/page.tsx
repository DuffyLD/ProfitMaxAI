// app/connected/page.tsx
'use client';

import { useEffect, useState } from 'react';

type StoreResp = { ok: true; shop: string; name: string; plan: string } | { ok: false; error: string };
type CountResp = { ok: true; shop: string; count: number } | { ok: false; error: string };

export default function Connected() {
  const [store, setStore] = useState<StoreResp | null>(null);
  const [count, setCount] = useState<CountResp | null>(null);

  useEffect(() => {
    // fetch from the browser so cookies are included
    fetch('/api/shopify/store', { credentials: 'include', cache: 'no-store' })
      .then(r => r.json())
      .then(setStore)
      .catch(e => setStore({ ok: false, error: String(e.message || e) } as any));

    fetch('/api/shopify/products-count', { credentials: 'include', cache: 'no-store' })
      .then(r => r.json())
      .then(setCount)
      .catch(e => setCount({ ok: false, error: String(e.message || e) } as any));
  }, []);

  return (
    <main style={{ padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 42, fontWeight: 800 }}>
        Shop connected <span style={{ fontSize: 36 }}>✅</span>
      </h1>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 32, fontWeight: 700 }}>Store info</h2>
        {!store && <p>Loading…</p>}
        {store && store.ok && (
          <div>
            <div><b>Shop:</b> {store.shop}</div>
            <div><b>Name:</b> {store.name}</div>
            <div><b>Plan:</b> {store.plan}</div>
          </div>
        )}
        {store && !store.ok && <p style={{ color: 'crimson' }}>Error loading store: {store.error}</p>}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 32, fontWeight: 700 }}>Products</h2>
        {!count && <p>Loading…</p>}
        {count && count.ok && <p>Product count: {count.count}</p>}
        {count && !count.ok && <p style={{ color: 'crimson' }}>Error loading products: {count.error}</p>}
      </section>

      <p style={{ marginTop: 24 }}><a href="/">Back to home</a></p>
    </main>
  );
}
