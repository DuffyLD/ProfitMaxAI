// app/dashboard/page.tsx
import Link from "next/link";

function num(n: any) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString() : "0";
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: { [k: string]: string | string[] | undefined };
}) {
  const raw = Number(searchParams?.windowDays);
  const windowDays = Number.isFinite(raw) ? Math.max(30, Math.min(365, raw)) : 120;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const apiUrl = `${baseUrl}/api/dashboard-data?windowDays=${windowDays}`;

  const res = await fetch(apiUrl, { cache: "no-store" });
  const data = await res.json().catch(() => ({} as any));

  const ok = !!data?.ok;
  const shop = data?.shop ?? "—";
  const metrics = data?.metrics ?? {};
  const top = Array.isArray(data?.top_sellers) ? data.top_sellers : [];

  const windows = [120, 180, 270, 365];

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
          {windows.map((w) => (
            <Link
              key={w}
              href={`/dashboard?windowDays=${w}`}
              className={`px-3 py-1 rounded-md border transition ${
                w === windowDays
                  ? "bg-white/10 border-white/30"
                  : "border-white/10 hover:border-white/30"
              }`}
            >
              {w}d
            </Link>
          ))}
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-[var(--card)] p-4">
          <h3 className="font-medium">Orders in DB</h3>
          <p className="text-2xl mt-2">{num(metrics.orders_in_db)}</p>
        </div>

        <div className="rounded-lg bg-[var(--card)] p-4">
          <h3 className="font-medium">
            Unique Variants Sold ({windowDays}d)
          </h3>
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
            <a
              className="underline"
              href="/api/health/all"
              target="_blank"
            >
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