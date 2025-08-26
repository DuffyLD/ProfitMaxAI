// app/connected/page.tsx
export const dynamic = "force-dynamic";

async function getJSON(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `Bad JSON from ${path}` };
  }
}

export default async function Connected() {
  const [store, count] = await Promise.all([
    getJSON("/api/shopify/store"),
    getJSON("/api/shopify/products-count"),
  ]);

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Connected ✅</h1>

      {/* Store card */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium mb-2">Store</h2>
        {!store?.ok ? (
          <pre className="text-sm text-red-600">
            {store?.error ?? "Unknown store error"}
          </pre>
        ) : (
          <div className="text-sm space-y-1">
            <div><span className="opacity-70">Name:</span> {store.name}</div>
            <div><span className="opacity-70">Domain:</span> {store.shop}</div>
            <div><span className="opacity-70">Plan:</span> {store.plan}</div>
          </div>
        )}
      </section>

      {/* Products card */}
      <section className="rounded-lg border p-4">
        <h2 className="font-medium mb-2">Products</h2>
        {!count?.ok ? (
          <pre className="text-sm text-red-600">
            {count?.error ?? "Unknown products error"}
          </pre>
        ) : (
          <div className="text-sm">
            <span className="opacity-70">Total:</span> {count.count}
          </div>
        )}
      </section>

      <a className="underline text-sm" href="/">Back to home</a>
    </main>
  );
}
