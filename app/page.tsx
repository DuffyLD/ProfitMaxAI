// app/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";

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

  // 🔽 Your existing UI stays exactly the same
  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">ProfitMaxAI</h1>
        <p className="text-sm/6 opacity-80">
          AI-native pricing, inventory, and abandoned cart recovery for Shopify.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-[var(--card)] p-4">
          <h2 className="font-medium">Step 1: Connect Shopify</h2>
          <p className="text-sm opacity-80">Secure OAuth — no passwords.</p>
          <Link
            href="/connect"
            className="inline-block mt-3 rounded-md bg-white/10 px-3 py-2"
          >
            Connect store
          </Link>
        </div>

        <div className="rounded-lg bg-[var(--card)] p-4">
          <h2 className="font-medium">Step 2: First Sync (60 days)</h2>
          <p className="text-sm opacity-80">
            Orders, products, and inventory with batching.
          </p>
        </div>

        <div className="rounded-lg bg-[var(--card)] p-4">
          <h2 className="font-medium">Step 3: See 3 Actions</h2>
          <p className="text-sm opacity-80">
            Pricing recs, inventory alerts, and abandoned checkout insights.
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-[var(--card)] p-4">
        <h2 className="font-medium">System health</h2>
        <p className="text-sm opacity-80">
          API reachable?{" "}
          <a className="underline" href="/api/health" target="_blank">
            Check status
          </a>
        </p>
      </div>
    </main>
  );
}
