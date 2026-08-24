export const runtime = "nodejs";
export async function GET() {
  const res = await fetch("https://api.kamino.finance/kamino-market/7WQeTuLsFrZsgnHW7ddFdNfhfJAViqH4mvcFZPQ5zuQ9/reserves/metrics");
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}
