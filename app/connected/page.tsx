// app/connected/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

async function grab<T>(path: string): Promise<ApiOk<T> | ApiErr> {
  // Use APP_BASE_URL so server rendering knows the absolute URL
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "";
  const url = `${base}${path}`;
  const res = await fetch(url, { cache: "no-store" });

  let data: any = null;
  try { data = await res.json(); } catch { /* no-op */ }

  if (!res.ok || !data || data.ok === false) {
    // Normalize an error shape
    const msg = (data && data.error) || `HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  return data as ApiOk<T>;
}

export default async function Connected() {
  const [storeRes, countRes] = await Promise.all([
    grab<{ shop: string; name: string; plan: string }>("/api/shopify/store"),
    grab<{ shop: string; count: number }>("/api/shopify/products-count"),
  ]);

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Shop connected ✅</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Store info</h2>
        {"ok" in storeRes && storeRes.ok ? (
          <ul className="list-disc pl-6">
            <li><b>Shop domain:</b> {storeRes.shop}</li>
            <li><b>Store name:</b> {storeRes.name}</li>
            <li><b>Plan:</b> {storeRes.plan}</li>
          </ul>
        ) : (
          <p className="text-red-600">Error loading store: {(storeRes as ApiErr).error}</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Products</h2>
        {"ok" in countRes && countRes.ok ? (
          <p>Product count: <b>{countRes.count}</b></p>
        ) : (
          <p className="text-red-600">Error loading products: {(countRes as ApiErr).error}</p>
        )}
      </section>

      <a className="underline" href="/">Back to home</a>
    </main>
  );
}
