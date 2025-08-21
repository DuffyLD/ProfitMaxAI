"use client";

import { useRouter } from "next/navigation";

export default function ConnectPage() {
  const router = useRouter();

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Connect your Shopify store</h1>
      <p className="opacity-80">OAuth coming next. This button will start the auth flow.</p>

      <button
        className="inline-block rounded-md bg-white/10 px-3 py-2"
        onClick={() => {
          // When we add the Shopify route, this will navigate to it:
          // router.push("/api/shopify/auth");
          alert("Shopify OAuth wiring is next — this button will start the auth flow.");
        }}
      >
        Start OAuth
      </button>
    </main>
  );
}
