export const runtime = "nodejs";
export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch("https://api.kamino.finance/ktx/klend/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}
