// app/dashboard/page.tsx
import Link from "next/link";

type TopSeller = { variant_id: string; qty_sold: number };
type SlowMover = {
  variant_id: string;
  product_id: string;
  current_price: string;
  stock: number;
  captured_at: string;
  last_sold_at: string | null;
  days_since_last_sale: number | null; // null => Never
  qty_sold_window: number;
  recommended_action: { type: "price_decrease"; discount_pct: number; suggested_price: number | null };
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const windowDays = Number(searchParams?.windowDays ?? 120);
  const minStock = Number(searchParams?.minStock ?? 20);
  const inactivityDays = Number(searchParams?.inactivityDays ?? 60);
  const discountPct = Number(searchParams?.discountPct ?? -10);
  const maxSalesInWindow = Number(searchParams?.maxSalesInWindow ?? 1);

  const qs = new URLSearchParams({
    windowDays: String(windowDays),
    minStock: String(minStock),
    inactivityDays: String(inactivityDays),
    discountPct: String(discountPct),
    maxSalesInWindow: String(maxSalesInWindow),
    t: "force", // avoid cached edge responses
  }).toString();

  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/dashboard-data?${qs}`, {
    cache: "no-store",
  });
  const data = await res.json();

  const top: TopSeller[] = data?.top_sellers ?? [];
  const slows: SlowMover[] = data?.slow_movers ?? [];
  const shop = data?.shop ?? "—";

  const link = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), ...Object.entries(patch).reduce((a,[k,v])=>{a[k]=String(v);return a;},{} as any) });
    return `/dashboard?${p.toString()}`;
  };

  return (
    <main className="prose prose-sm max-w-none p-6">
      <h1>ProfitMaxAI — Dashboard</h1>
      <p>Connected shop: {shop}</p>

      {/* Window quick links */}
      <p>
        Window:&nbsp;
        {[120, 180, 270, 365].map(d => (
          <Link key={d} href={link({ windowDays: d })} className="underline mr-2">
            {d}d
          </Link>
        ))}
      </p>

      {/* Headline metrics */}
      <h2>Orders in DB</h2>
      <p>{data?.metrics?.orders_in_db ?? 0}</p>

      <h2>Unique Variants Sold ({windowDays}d)</h2>
      <p>{data?.metrics?.unique_variants_sold_window ?? 0}</p>

      <h2>Variant Snapshots (total)</h2>
      <p>{data?.metrics?.variant_snapshots_total ?? 0}</p>

      {/* Top sellers */}
      <h2>Top Sellers ({windowDays}d)</h2>
      {top.length === 0 ? (
        <p>No sellers in window.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Variant ID</th><th>Qty Sold</th></tr>
          </thead>
          <tbody>
            {top.map(t => (
              <tr key={t.variant_id}>
                <td>{t.variant_id}</td>
                <td>{t.qty_sold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Slow movers controls */}
      <h2>Slow Movers</h2>
      <div>
        <div>Min Stock</div>
        {[10, 20, 50].map(n => (
          <Link key={n} href={link({ minStock: n })} className="underline mr-2">
            ≥ {n}
          </Link>
        ))}
      </div>
      <div className="mt-1">Inactivity (days)</div>
      {[30, 60, 120].map(n => (
        <Link key={n} href={link({ inactivityDays: n })} className="underline mr-2">
          ≥ {n}d
        </Link>
      ))}
      <div className="mt-1">Recommended Discount</div>
      {[-5, -10, -15].map(n => (
        <Link key={n} href={link({ discountPct: n })} className="underline mr-2">
          {n}%
        </Link>
      ))}
      <div className="mt-1">Max sales in window</div>
      {[0, 1, 2, 5].map(n => (
        <Link key={n} href={link({ maxSalesInWindow: n })} className="underline mr-2">
          ≤{n}
        </Link>
      ))}

      {/* Slow movers table */}
      {slows.length === 0 ? (
        <p className="mt-3">No slow movers with current filters.</p>
      ) : (
        <table className="mt-3">
          <thead>
            <tr>
              <th>Variant ID</th>
              <th>Stock</th>
              <th>Days Since Last Sale</th>
              <th>Sales In Window</th>
              <th>Current Price</th>
              <th>Suggested Price ({discountPct}%)</th>
            </tr>
          </thead>
          <tbody>
            {slows.map(v => (
              <tr key={v.variant_id}>
                <td>{v.variant_id}</td>
                <td>{v.stock}</td>
                <td>{v.days_since_last_sale === null ? "Never" : v.days_since_last_sale}</td>
                <td>{v.qty_sold_window}</td>
                <td>${Number(v.current_price).toFixed(2)}</td>
                <td>
                  {v.recommended_action.suggested_price !== null
                    ? `$${v.recommended_action.suggested_price.toFixed(2)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Quick actions */}
      <h3>Quick Actions</h3>
      <ul>
        <li>
          View pricing recommendations (
          <a className="underline" href={`/api/recommendations?windowDays=${windowDays}`} target="_blank">
            /api/recommendations?windowDays={windowDays}
          </a>
          )
        </li>
        <li>
          Health check (
          <a className="underline" href="/api/health/all" target="_blank">
            /api/health/all
          </a>
          )
        </li>
        <li>
          Re-ingest last {windowDays}d (
          <a className="underline" href={`/api/ingest/daily?days=${windowDays}`} target="_blank">
            /api/ingest/daily?days={windowDays}
          </a>
          )
        </li>
      </ul>
    </main>
  );
}
