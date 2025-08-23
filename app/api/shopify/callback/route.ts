// app/api/shopify/callback/route.ts
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  console.log("[CALLBACK] params", { shop, code: !!code, state });

  // For now, just confirm round-trip worked.
  return new NextResponse(
    `<html><body><h1>ProfitMaxAI installed</h1>
     <p>Shop: ${shop}</p>
     <p>You can close this tab.</p></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
