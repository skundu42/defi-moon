// hooks/useOrderbookOrders.ts
"use client";

import { useEffect, useState } from "react";

export function useOrderbookOrders(maker?: `0x${string}`) {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!maker) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/orders?maker=${maker}`, { cache: "no-store" });
        const j = await r.json();
        setOrders(j.items ?? j.orders ?? j ?? []);
      } catch (e) {
        console.error(e);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [maker]);

  return { orders, loading };
}