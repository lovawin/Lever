export const runtime = "nodejs";
const DEFAULT_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"; // Kamino Main Market

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || DEFAULT_MARKET;
  const wallet = searchParams.get("wallet");
  if (!wallet) {
    return new Response(JSON.stringify({ error: "wallet query param required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const res = await fetch(
    `https://api.kamino.finance/kamino-market/${market}/users/${wallet}/obligations`,
  );
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}
