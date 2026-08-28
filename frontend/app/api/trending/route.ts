export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  if (!path || !path.startsWith("/networks/")) {
    return new Response(JSON.stringify({ error: "invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const res = await fetch(`https://api.geckoterminal.com/api/v2${path}`, {
    headers: { Accept: "application/json" },
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
