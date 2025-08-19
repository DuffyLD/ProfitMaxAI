export async function GET() {
  return Response.json({ ok: true, service: "profitmaxai-app", ts: new Date().toISOString() });
}