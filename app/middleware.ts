import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop");
  const hmac = url.searchParams.get("hmac");
  const hasSession = req.cookies.get("pmx_session");

  // When Shopify opens the App URL (/?shop=...&hmac=...), start OAuth
  if (shop && hmac && !hasSession) {
    return NextResponse.redirect(new URL(`/api/shopify/auth?shop=${shop}`, url.origin));
  }

  return NextResponse.next();
}

// Apply to the app entry routes
export const config = {
  matcher: ["/", "/connect"],
};
