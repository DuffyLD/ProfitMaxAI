// app/api/debug-env/route.ts
export const runtime = 'nodejs'; // ensure Node runtime, not Edge

function mask(v?: string) {
  if (!v) return 'MISSING';
  if (v.length <= 6) return 'SET';
  return `${v.slice(0,4)}•••${v.slice(-2)}`; // show only first 4 + last 2
}

export async function GET() {
  const data = {
    VERCEL_ENV: process.env.VERCEL_ENV || 'unknown',
    APP_BASE_URL: process.env.APP_BASE_URL || 'MISSING',
    SHOPIFY_API_KEY: mask(process.env.SHOPIFY_API_KEY),
    SHOPIFY_API_SECRET: mask(process.env.SHOPIFY_API_SECRET),
    SHOPIFY_SCOPES: (process.env.SHOPIFY_SCOPES || 'MISSING').split(',').length,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}