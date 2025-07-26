// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_ONEINCH_ORDERBOOK_API ?? "https://orderbook-api.1inch.io";
const KEY  = process.env.NEXT_PUBLIC_ONEINCH_AUTH_KEY ?? "";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "100"); // Gnosis

// Small helper so we always send JSON back (never HTML)
function json(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const maker = url.searchParams.get("maker");

    if (!maker) return json({ error: "maker required", items: [] }, 400);
    if (!BASE)  return json({ error: "ORDERBOOK_API_BASE missing", items: [] }, 500);
    if (!KEY)   return json({ error: "ONEINCH_AUTH_KEY missing", items: [] }, 500);

    // Common 1inch orderbook pattern. Some deployments require chainId in query,
    // others use chainId in the path. We try a query-string variant first.
    const primary = `${BASE}/v4.0/orders/address/${maker}?limit=200&chainId=${CHAIN_ID}`;

    // Abort/timeout safety
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);

    const r = await fetch(primary, {
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: "application/json",
      },
      // Avoid ISR, we want live info
      cache: "no-store",
    });

    clearTimeout(t);

    // Try to read text first; we will JSON-parse below
    const text = await r.text();

    // If upstream isn't OK, still return a JSON envelope so client parse won't blow up
    if (!r.ok) {
      // Try to parse an error body if any
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch {}
      return json(
        {
          error: `Upstream ${r.status}`,
          details: parsed ?? text ?? "",
          items: [],
        },
        r.status,
      );
    }

    // OK branch: parse JSON if present; otherwise return empty array
    if (!text) return json({ items: [] }, 200);

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // Upstream replied OK but not JSON (rare). Return empty items with raw body.
      return json({ error: "non-json upstream", raw: text, items: [] }, 200);
    }

    // Normalize shape
    const items = data?.items ?? data?.orders ?? (Array.isArray(data) ? data : []);
    return json({ items });
  } catch (e: any) {
    // Network/timeout or unexpected error
    return json({ error: "proxy-failed", details: String(e), items: [] }, 502);
  }
}