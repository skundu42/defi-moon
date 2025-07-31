// hooks/useOrderbookOrders.ts
import { useEffect, useState } from "react";
import { fetchOrders, type ApiOrder } from "@/lib/orderApi";

export function useOrderbookOrders(makerAddress?: `0x${string}`) {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOrders = async () => {
      if (!makerAddress) {
        setOrders([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { orders: fetchedOrders } = await fetchOrders({
          maker: makerAddress,
          active: false, // Get all orders including filled ones for PnL calculation
        });
        
        setOrders(fetchedOrders);
      } catch (err: any) {
        console.error("Failed to load orders:", err);
        setError(err.message || "Failed to load orders");
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };

    loadOrders();

    // Refresh orders every 30 seconds
    const interval = setInterval(loadOrders, 30000);
    return () => clearInterval(interval);
  }, [makerAddress]);

  return { orders, loading, error };
}