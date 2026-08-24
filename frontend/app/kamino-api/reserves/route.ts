export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = url.searchParams.get("market") || "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
  const res = await fetch(`https://api.kamino.finance/v2/kamino-market/${market}/reserves`);
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
