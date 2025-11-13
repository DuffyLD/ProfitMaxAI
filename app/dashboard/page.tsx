// app/dashboard/page.tsx
import Link from "next/link";

type TopSeller = {
  variant_id: string;
  qty_sold: number;
};

type SlowMover = {
  variant_id: string;
  product_id: string;
  product_title: string | null;
  current_price: string;
  stock: number;
  captured_at: string;
  last_sold_at: string | null;
  days_since_last_sale: number | null;
  qty_sold_window: number;
  recommended_action: {
    type: "price_decrease" | string;
    discount_pct: number;
    suggested_price: number;
  };
};

type DashboardResponse = {
  ok: boolean;
  shop: string;
  metrics: {
    orders_in_db: number;
    unique_variants_sold_window: number;
    variant_snapshots_total: number;
  };
  top_sellers: TopSeller[];
  slow_movers: SlowMover[];
  meta: {
    filtered_by_window: boolean;
    window_days: number;
    knobs: {
      minStock: number;
      inactivityDays: number;
      discountPct: number;
      maxSalesInWindow: number;
    };
    bounds: any;
  };
};

function fmtMoney(v: string | number) {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function fmtDays(d: number | null) {
  if (d == null) return "Never";
  return d.toString();
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const windowDays = Number(searchParams?.windowDays ?? 120) || 120;
  const minStock = Number(searchParams?.minStock ?? 20) || 20;
  const inactivityDays = Number(searchParams?.inactivityDays ?? 60) || 60;
  const discountPct = Number(searchParams?.discountPct ?? -10) || -10;
  const maxSalesInWindow = Number(searchParams?.maxSalesInWindow ?? 1) || 1;

  const qs = new URLSearchParams({
    windowDays: String(windowDays),
    minStock: String(minStock),
    inactivityDays: String(inactivityDays),
    discountPct: String(discountPct),
    maxSalesInWindow: String(maxSalesInWindow),
  });

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/dashboard-data?${qs.toString()}`,
    { cache: "no-store" }
  );
  const data: DashboardResponse = await res.json();

  const { shop, metrics, top_sellers, slow_movers, meta } = data;

  // helpers to build links that just change one param
  function linkWith(overrides: Partial<{
    windowDays: number;
    minStock: number;
    inactivityDays: number;
    discountPct: number;
    maxSalesInWindow: number;
  }>) {
    const params = {
      windowDays,
      minStock,
      inactivityDays,
      discountPct,
      maxSalesInWindow,
      ...overrides,
    };
    const sp = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    );
    return `/dashboard?${sp.toString()}`;
  }

  return (
    <main style={{ padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "32px", fontWeight: 700, marginBottom: "8px" }}>
        ProfitMaxAI — Dashboard
      </h1>

      <p>
        Connected shop: <strong>{shop || "—"}</strong>
      </p>

      <p>
        Window:{" "}
        <Link href={linkWith({ windowDays: 120 })}>120d</Link>{" "}
        <Link href={linkWith({ windowDays: 180 })}>180d</Link>{" "}
        <Link href={linkWith({ windowDays: 270 })}>270d</Link>{" "}
        <Link href={linkWith({ windowDays: 365 })}>365d</Link>
      </p>

      <section style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700 }}>Orders in DB</h2>
        <p>{metrics.orders_in_db}</p>

        <h2 style={{ fontSize: "20px", fontWeight: 700 }}>
          Unique Variants Sold ({meta.window_days}d)
        </h2>
        <p>{metrics.unique_variants_sold_window}</p>

        <h2 style={{ fontSize: "20px", fontWeight: 700 }}>
          Variant Snapshots (total)
        </h2>
        <p>{metrics.variant_snapshots_total}</p>
      </section>

      {/* Top sellers */}
      <section style={{ marginTop: "32px" }}>
        <h2 style={{ fontSize: "22px", fontWeight: 700 }}>
          Top Sellers ({meta.window_days}d)
        </h2>
        {top_sellers.length === 0 ? (
          <p>No seller data yet.</p>
        ) : (
          <table cellPadding={4} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Variant ID</th>
                <th style={{ textAlign: "left" }}>Qty Sold</th>
              </tr>
            </thead>
            <tbody>
              {top_sellers.map((t) => (
                <tr key={t.variant_id}>
                  <td>{t.variant_id}</td>
                  <td>{t.qty_sold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Slow movers */}
      <section style={{ marginTop: "32px" }}>
        <h2 style={{ fontSize: "22px", fontWeight: 700 }}>Slow Movers</h2>

        <div style={{ marginBottom: "8px", marginTop: "8px" }}>
          <div>
            <strong>Min Stock</strong>
            <br />
            <Link href={linkWith({ minStock: 10 })}>&gt;= 10</Link>{" "}
            <Link href={linkWith({ minStock: 20 })}>20</Link>{" "}
            <Link href={linkWith({ minStock: 50 })}>50</Link>
          </div>
          <div style={{ marginTop: "4px" }}>
            <strong>Inactivity (days)</strong>
            <br />
            <Link href={linkWith({ inactivityDays: 30 })}>&gt;= 30d</Link>{" "}
            <Link href={linkWith({ inactivityDays: 60 })}>60d</Link>{" "}
            <Link href={linkWith({ inactivityDays: 120 })}>120d</Link>
          </div>
          <div style={{ marginTop: "4px" }}>
            <strong>Recommended Discount</strong>
            <br />
            <Link href={linkWith({ discountPct: -5 })}>-5%</Link>{" "}
            <Link href={linkWith({ discountPct: -10 })}>-10%</Link>{" "}
            <Link href={linkWith({ discountPct: -15 })}>-15%</Link>
          </div>
          <div style={{ marginTop: "4px" }}>
            <strong>Max sales in window</strong>
            <br />
            <Link href={linkWith({ maxSalesInWindow: 0 })}>&lt;=0</Link>{" "}
            <Link href={linkWith({ maxSalesInWindow: 1 })}>&lt;=1</Link>{" "}
            <Link href={linkWith({ maxSalesInWindow: 2 })}>&lt;=2</Link>{" "}
            <Link href={linkWith({ maxSalesInWindow: 5 })}>&lt;=5</Link>
          </div>
        </div>

        {slow_movers.length === 0 ? (
          <p>No slow movers match the current filters.</p>
        ) : (
          <>
            <p>
              Showing{" "}
              <strong>
                {slow_movers.length} slow-mover
                {slow_movers.length !== 1 ? "s" : ""}
              </strong>{" "}
              where stock ≥ {minStock}, inactivity ≥ {inactivityDays} days, sales
              in window ≤ {maxSalesInWindow}, discount = {discountPct}%.
            </p>
            <table cellPadding={4} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Variant ID</th>
                  <th style={{ textAlign: "left" }}>Product</th>
                  <th style={{ textAlign: "right" }}>Stock</th>
                  <th style={{ textAlign: "right" }}>Days Since Last Sale</th>
                  <th style={{ textAlign: "right" }}>Sales In Window</th>
                  <th style={{ textAlign: "right" }}>Current Price</th>
                  <th style={{ textAlign: "right" }}>
                    Suggested Price ({discountPct}%)
                  </th>
                </tr>
              </thead>
              <tbody>
                {slow_movers.map((s) => (
                  <tr key={s.variant_id}>
                    <td>{s.variant_id}</td>
                    <td>{s.product_title || "(Unknown product)"}</td>
                    <td style={{ textAlign: "right" }}>{s.stock}</td>
                    <td style={{ textAlign: "right" }}>
                      {fmtDays(s.days_since_last_sale)}
                    </td>
                    <td style={{ textAlign: "right" }}>{s.qty_sold_window}</td>
                    <td style={{ textAlign: "right" }}>
                      {fmtMoney(s.current_price)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {fmtMoney(s.recommended_action.suggested_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* Quick Actions (unchanged behaviourally) */}
      <section style={{ marginTop: "32px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700 }}>Quick Actions</h2>
        <ul>
          <li>
            View pricing recommendations (
            <Link href="/api/recommendations?windowDays=120">
              /api/recommendations?windowDays=120
            </Link>
            )
          </li>
          <li>
            Health check (
            <Link href="/api/health/all">
              /api/health/all
            </Link>
            )
          </li>
          <li>
            Re-ingest last 120d (
            <Link href="/api/ingest/daily?days=120">
              /api/ingest/daily?days=120
            </Link>
            )
          </li>
        </ul>
      </section>
    </main>
  );
}
