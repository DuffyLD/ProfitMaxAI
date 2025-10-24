// app/dashboard/page.tsx
import Link from "next/link";

type HealthResult = {
  ok: boolean;
  checked: number;
  results: Record<string, { ok: boolean; status?: number; error?: string | null }>;
  timestamp: string;
};

type DashboardData = {
  ok: boolean;
  shop: string;
  metrics: {
    orders_in_db: number;
    unique_variants_sold_60d: number;
    variant_snapshots_total?: number;
    variant_snapshots_recent_2d?: number;
    variant_snapshots_last_captured_at?: string;
  };
  top_sellers?: { variant_id: number; qty_sold: number }[];
  meta?: { filtered_by_60d?: boolean };
};

type RecsData = {
  ok: boolean;
  shop: string;
  recommendations: Array<{
    variant_id: number;
    product_id: number;
    sku: string | null;
    title: string;
    current_price: number;
    inventory_quantity: number;
    sales_window_days: number;
    sales_in_window: number;
    type: "price_increase" | "price_decrease" | "restock_alert";
    suggested_price?: number;
    suggested_change_pct?: number;
    rationale: string;
  }>;
  meta: any;
};

async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const [health, data, recs] = await Promise.all([
    getJSON<HealthResult>("/api/health/all"),
    getJSON<DashboardData>("/api/dashboard-data"),
    getJSON<RecsData>("/api/recommendations?windowDays=45"),
  ]);

  const systemOK = !!health?.ok;

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">ProfitMaxAI — Dashboard</h1>
        <p className="text-sm opacity-75">
          Connected shop: <span className="font-medium">{data?.shop ?? "—"}</span>
        </p>
      </header>

      {/* Top summary cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Orders in DB" value={data?.metrics?.orders_in_db ?? 0} />
        <Card
          title="Unique Variants Sold (60d)"
          value={data?.metrics?.unique_variants_sold_60d ?? 0}
          hint={data?.meta?.filtered_by_60d ? "60d filter" : "All-time"}
        />
        <Card
          title="Variant Snapshots (total)"
          value={data?.metrics?.variant_snapshots_total ?? 0}
          hint={data?.metrics?.variant_snapshots_last_captured_at ? "Has snapshots" : undefined}
        />
        <Card
          title="System Health"
          value={systemOK ? "OK" : "Check"}
          tone={systemOK ? "ok" : "warn"}
          hint={new Date(health?.timestamp ?? Date.now()).toLocaleString()}
        />
      </section>

      {/* System Health table */}
      <section className="rounded-lg border border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">System Health</h2>
          <Link href="/api/health/all" target="_blank" className="text-sm underline opacity-80">
            Open JSON
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left opacity-70">
              <tr>
                <th className="py-2 pr-4">Endpoint</th>
                <th className="py-2 pr-4">OK</th>
                <th className="py-2 pr-4">HTTP</th>
                <th className="py-2 pr-4">Error</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {health
                ? Object.entries(health.results).map(([path, r]) => (
                    <tr key={path} className="border-t border-white/10">
                      <td className="py-2 pr-4 font-mono">{path}</td>
                      <td className="py-2 pr-4">
                        <Badge ok={r.ok} />
                      </td>
                      <td className="py-2 pr-4">{r.status ?? "—"}</td>
                      <td className="py-2 pr-4 text-red-300/80">{r.error ?? "—"}</td>
                    </tr>
                  ))
                : (
                  <tr>
                    <td colSpan={4} className="py-3 opacity-70">Health data unavailable.</td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top Sellers */}
      <section className="rounded-lg border border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Top Sellers</h2>
          <Link href="/api/dashboard-data" target="_blank" className="text-sm underline opacity-80">
            Open JSON
          </Link>
        </div>
        {data?.top_sellers && data.top_sellers.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {data.top_sellers.slice(0, 10).map((row) => (
              <li key={row.variant_id} className="flex items-center justify-between rounded bg-white/5 px-3 py-2">
                <span className="font-mono">Variant #{row.variant_id}</span>
                <span className="opacity-80">{row.qty_sold} sold</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-70">No seller data yet. Run ingest with a larger window or place a test order.</p>
        )}
      </section>

      {/* Recommendations */}
      <section className="rounded-lg border border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Pricing & Inventory Recommendations</h2>
          <Link href="/api/recommendations?windowDays=45" target="_blank" className="text-sm underline opacity-80">
            Open JSON
          </Link>
        </div>
        {recs?.recommendations?.length ? (
          <ul className="space-y-2">
            {recs.recommendations.slice(0, 10).map((r) => (
              <li key={r.variant_id} className="rounded bg-white/5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{r.title || `Variant #${r.variant_id}`}</div>
                  <div className="text-xs opacity-70">{r.type.replace("_", " ")}</div>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Meta label="Price" value={`$${r.current_price.toFixed(2)}`} />
                  {"suggested_price" in r && r.suggested_price !== undefined ? (
                    <Meta label="Suggested" value={`$${r.suggested_price?.toFixed(2)}`} />
                  ) : <span />}
                  <Meta label="Inventory" value={String(r.inventory_quantity)} />
                  <Meta label="Sales (window)" value={`${r.sales_in_window} / ${r.sales_window_days}d`} />
                </div>
                <p className="mt-2 opacity-80">{r.rationale}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm opacity-70">No recommendations yet for this window.</p>
        )}
      </section>

      {/* Quick actions */}
      <section className="flex flex-wrap gap-3">
        <Action href="/api/ingest/daily?days=120" label="Run Ingest (120d backfill)" />
        <Action href="/api/health/all" label="Run Health Check" />
        <Action href="/" label="Home" />
      </section>
    </main>
  );
}

function Card({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "warn";
}) {
  const toneClass = tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="text-sm opacity-70">{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{String(value)}</div>
      {hint ? <div className="mt-1 text-xs opacity-60">{hint}</div> : null}
    </div>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
      }`}
    >
      {ok ? "OK" : "Check"}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/5 px-2 py-1">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
    >
      {label}
    </Link>
  );
}
