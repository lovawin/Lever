export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch("https://api.kamino.finance/ktx/klend/borrow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
