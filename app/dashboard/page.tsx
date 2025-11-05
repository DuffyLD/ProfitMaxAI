// app/dashboard/page.tsx
import Link from "next/link";

function num(n: any) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString() : "0";
}
function price(n: any) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}
function chipHref(params: URLSearchParams, key: string, value: string) {
  const p = new URLSearchParams(params);
  p.set(key, value);
  return `/dashboard?${p.toString()}`;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: { [k: string]: string | string[] | undefined };
}) {
  const sp = new URLSearchParams();
  // read current knobs from URL
  const winRaw = Number(searchParams?.windowDays);
  const windowDays = Number.isFinite(winRaw) ? Math.max(30, Math.min(365, winRaw)) : 120;

  const minStock = Number.isFinite(Number(searchParams?.minStock))
    ? Number(searchParams?.minStock) as number
    : 20;
  const inactivityDays = Number.isFinite(Number(searchParams?.inactivityDays))
    ? Number(searchParams?.inactivityDays) as number
    : 60;
  const discountPct = Number.isFinite(Number(searchParams?.discountPct))
    ? Number(searchParams?.discountPct) as number
    : -5;

  sp.set("windowDays", String(windowDays));
  sp.set("minStock", String(minStock));
  sp.set("inactivityDays", String(inactivityDays));
  sp.set("discountPct", String(discountPct));

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const apiUrl = `${baseUrl}/api/dashboard-data?${sp.toString()}`;

  const res = await fetch(apiUrl, { cache: "no-store" });
  const data = await res.json().catch(() => ({} as any));

  const ok = !!data?.ok;
  const shop = data?.shop ?? "—";
  const metrics = data?.metrics ?? {};
  const top = Array.isArray(data?.top_sellers) ? data.top_sellers : [];
  const slow = Array.isArray(data?.slow_movers) ? data.slow_movers : [];

  const windows = [120, 180, 270, 365];
  const minStockPresets = [10, 20, 50];
  const inactivityPresets = [30, 60, 120];
  const discountPresets = [-5, -10, -15];

  const currentParams = new URLSearchParams(sp);

  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">ProfitMaxAI — Dashboard</h1>
        <p className="text-sm opacity-80">
          Connected shop:&nbsp;<span className="font-medium">{shop}</span>
        </p>
      </header>

      {/* Window selector */}
      <section className="flex items-center gap-3">
        <span className="opacity-80 text-sm">Window:</span>
        <div className="flex gap-2">
          {windows.map((w) => {
            const p = new URLSearchParams(currentParams);
            p.set("windowDays", String(w));
            return (
              <Link
                key={w}
                href={`/dashboard?${p.toString()}`}
                className={`px-3 py-1 rounded-md border transition ${
                  w === windowDays
                    ? "bg-white/10 border-white/30"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                {w}d
              </Link>
            );
          })}
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-[var(--card)] p-4">
          <h3 className="font-medium">Orders in DB</h3>
          <p className="text-2xl mt-2">{num(metrics.orders_in_db)}</p>
        </div>

        <div className="rounded-lg bg-[var(--card)] p-4">
          <h3 className="font-medium">Unique Variants Sold ({windowDays}d)</h3>
          <p className="text-2xl mt-2">{num(metrics.unique_variants_sold_window)}</p>
        </div>

        <div className="rounded-lg bg-[var(--card)] p-4">
          <h3 className="font-medium">Variant Snapshots (total)</h3>
          <p className="text-2xl mt-2">{num(metrics.variant_snapshots_total)}</p>
        </div>
      </section>

      {/* Top sellers */}
      <section className="rounded-lg bg-[var(--card)] p-4">
        <h3 className="font-medium">Top Sellers ({windowDays}d)</h3>
        {!ok ? (
          <p className="text-sm opacity-80 mt-2">
            Endpoint issue — open{" "}
            <a
              className="underline"
              href={`/api/dashboard-data?windowDays=${windowDays}`}
              target="_blank"
            >
              /api/dashboard-data?windowDays={windowDays}
            </a>
          </p>
        ) : top.length === 0 ? (
          <p className="text-sm opacity-80 mt-2">No sales in this window.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="opacity-70 text-left">
                <tr>
                  <th className="py-2 pr-4">Variant ID</th>
                  <th className="py-2 pr-4">Qty Sold</th>
                </tr>
              </thead>
              <tbody>
                {top.map((row: any) => (
                  <tr key={row.variant_id} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-mono">{row.variant_id}</td>
                    <td className="py-2 pr-4">{num(row.qty_sold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Slow movers controls */}
      <section className="rounded-lg bg-[var(--card)] p-4 space-y-4">
        <h3 className="font-medium">Slow Movers</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="opacity-80 text-sm mb-2">Min Stock</div>
            <div className="flex gap-2">
              {minStockPresets.map((ms) => (
                <Link
                  key={ms}
                  href={chipHref(currentParams, "minStock", String(ms))}
                  className={`px-3 py-1 rounded-md border transition ${
                    ms === minStock ? "bg-white/10 border-white/30" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  ≥ {ms}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="opacity-80 text-sm mb-2">Inactivity (days)</div>
            <div className="flex gap-2">
              {inactivityPresets.map((d) => (
                <Link
                  key={d}
                  href={chipHref(currentParams, "inactivityDays", String(d))}
                  className={`px-3 py-1 rounded-md border transition ${
                    d === inactivityDays ? "bg-white/10 border-white/30" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  ≥ {d}d
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="opacity-80 text-sm mb-2">Recommended Discount</div>
            <div className="flex gap-2">
              {discountPresets.map((p) => (
                <Link
                  key={p}
                  href={chipHref(currentParams, "discountPct", String(p))}
                  className={`px-3 py-1 rounded-md border transition ${
                    p === discountPct ? "bg-white/10 border-white/30" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {p}%
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Slow movers table */}
        {!ok ? (
          <p className="text-sm opacity-80 mt-2">
            Endpoint issue — open{" "}
            <a
              className="underline"
              href={`/api/dashboard-data?windowDays=${windowDays}&minStock=${minStock}&inactivityDays=${inactivityDays}&discountPct=${discountPct}`}
              target="_blank"
            >
              /api/dashboard-data?…
            </a>
          </p>
        ) : slow.length === 0 ? (
          <p className="text-sm opacity-80">No slow movers at current thresholds.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="opacity-70 text-left">
                <tr>
                  <th className="py-2 pr-4">Variant ID</th>
                  <th className="py-2 pr-4">Stock</th>
                  <th className="py-2 pr-4">Days Since Last Sale</th>
                  <th className="py-2 pr-4">Current Price</th>
                  <th className="py-2 pr-4">Suggested Price ({discountPct}%)</th>
                </tr>
              </thead>
              <tbody>
                {slow.map((row: any) => (
                  <tr key={row.variant_id} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-mono">{row.variant_id}</td>
                    <td className="py-2 pr-4">{num(row.stock)}</td>
                    <td className="py-2 pr-4">{num(row.days_since_last_sale)}</td>
                    <td className="py-2 pr-4">${price(row.current_price)}</td>
                    <td className="py-2 pr-4">
                      {row.recommended_action?.suggested_price
                        ? `$${price(row.recommended_action.suggested_price)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="rounded-lg bg-[var(--card)] p-4 space-y-2">
        <h3 className="font-medium">Quick Actions</h3>
        <ul className="list-disc pl-5 text-sm">
          <li>
            View pricing recommendations (&nbsp;
            <a
              className="underline"
              href={`/api/recommendations?windowDays=${windowDays}`}
              target="_blank"
            >
              /api/recommendations?windowDays={windowDays}
            </a>
            &nbsp;)
          </li>
          <li>
            Health check (&nbsp;
            <a className="underline" href="/api/health/all" target="_blank">
              /api/health/all
            </a>
            &nbsp;)
          </li>
          <li>
            Re-ingest last {windowDays}d (&nbsp;
            <a
              className="underline"
              href={`/api/ingest/daily?days=${windowDays}`}
              target="_blank"
            >
              /api/ingest/daily?days={windowDays}
            </a>
            &nbsp;)
          </li>
        </ul>
      </section>
    </main>
  );
}
