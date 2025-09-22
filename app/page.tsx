// app/page.tsx
"use client";

import { redirect } from "next/navigation";
import { useEffect, useState } from "react";

type Stats = {
  ok: boolean;
  shop: string;
  shop_name?: string;
  counts?: {
    products: number;
    orders_last_30d: number;
    customers: number;
    variants_first_page: number;
    inventory_units_first_page: number;
  };
  error?: string;
};

type Rec = {
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
};

export default function Home({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const shop = typeof searchParams?.shop === "string" ? searchParams.shop : undefined;
  const hmac = typeof searchParams?.hmac === "string" ? searchParams.hmac : undefined;

  // 🚀 Auto-redirect to OAuth when Shopify loads the app with shop+hmac
  if (shop && hmac) {
    redirect(`/api/shopify/auth?shop=${encodeURIComponent(shop)}`);
  }

  const [stats, setStats] = useState<Stats | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [sRes, rRes] = await Promise.all([
          fetch("/api/admin-stats"),
          fetch("/api/recommendations"),
        ]);
        const sJson = await sRes.json();
        const rJson = await rRes.json();
        if (!mounted) return;
        setStats(sJson);
        setRecs(Array.isArray(rJson?.recommendations) ? rJson.recommendations : []);
        setErr(null);
      } catch (e: any) {
        if (!mounted) return;
        setErr(String(e?.message || e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main style={container}>
      <h1 style={h1}>ProfitMaxAI — Profit Intelligence</h1>

      {loading && <p>Loading…</p>}

      {!loading && err && (
        <div style={errorBox}>
          <b>Load error:</b> {err}
        </div>
      )}

      {!loading && stats?.ok && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={h2}>Store: {stats.shop_name || stats.shop}</h2>
          <div style={grid2}>
            <div style={card}>
              <b>Products</b>
              <div>{stats.counts?.products ?? 0}</div>
            </div>
            <div style={card}>
              <b>Orders (30d)</b>
              <div>{stats.counts?.orders_last_30d ?? 0}</div>
            </div>
            <div style={card}>
              <b>Customers</b>
              <div>{stats.counts?.customers ?? 0}</div>
            </div>
            <div style={card}>
              <b>Variants (page)</b>
              <div>{stats.counts?.variants_first_page ?? 0}</div>
            </div>
            <div style={card}>
              <b>Inventory units (page)</b>
              <div>{stats.counts?.inventory_units_first_page ?? 0}</div>
            </div>
          </div>
        </section>
      )}

      {!loading && !stats?.ok && (
        <section style={{ marginBottom: 24, color: "crimson" }}>
          <b>Stats error:</b> {stats?.error || "Unknown"}
        </section>
      )}

      {!loading && (
        <section>
          <h2 style={h2}>AI Recommendations</h2>
          {recs.length === 0 && <p>No recommendations yet for the current window.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {recs.map((r) => (
              <li key={r.variant_id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div>
                      <b>{r.type.replace("_", " ")}</b> — {r.title}{" "}
                      {r.sku ? `(${r.sku})` : ""}
                    </div>
                    <div style={meta}>
                      price: ${r.current_price.toFixed(2)} • stock: {r.inventory_quantity} •
                      sales({r.sales_window_days}d): {r.sales_in_window}
                    </div>
                    <div style={{ marginTop: 6 }}>{r.rationale}</div>
                  </div>
                  {typeof r.suggested_price === "number" && (
                    <div style={{ textAlign: "right" }}>
                      <div style={meta}>suggested</div>
                      <div>
                        <b>${r.suggested_price.toFixed(2)}</b>
                      </div>
                      {typeof r.suggested_change_pct === "number" && (
                        <div style={meta}>
                          {r.suggested_change_pct > 0 ? "+" : ""}
                          {r.suggested_change_pct}%
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

const container: React.CSSProperties = {
  maxWidth: 960,
  margin: "24px auto",
  padding: "0 16px",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
};

const h1: React.CSSProperties = { fontSize: 24, marginBottom: 12 };
const h2: React.CSSProperties = { fontSize: 18, marginBottom: 8 };
const meta: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
  gap: 12,
};

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #eee",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  background: "white",
  marginBottom: 12,
};

const errorBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid #ffb3b3",
  background: "#fff5f5",
  color: "#a40000",
  marginBottom: 16,
};